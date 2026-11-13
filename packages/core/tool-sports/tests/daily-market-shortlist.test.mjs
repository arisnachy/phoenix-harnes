import {test} from 'node:test'
import assert from 'node:assert/strict'
import {shortlistDailyMarkets,dailyOddsSportKey,requestedDailyOddsMarkets,espnQuoteNeedsRecheck,planDailyOddsLeagueKeys} from '../src/daily-market-shortlist.ts'

test('quote discovery gives each active sport a first-pass league before extra soccer leagues',()=>{
  const games=[
    ...Array.from({length:12},(_,i)=>({sport:'soccer',league:'eng.1',kickoff:'2026-11-13T18:00:00Z'})),
    ...Array.from({length:10},(_,i)=>({sport:'soccer',league:'esp.1',kickoff:'2026-11-13T19:00:00Z'})),
    {sport:'basketball',league:'nba',kickoff:'2026-11-13T23:00:00Z'},
    {sport:'hockey',league:'nhl',kickoff:'2026-11-13T23:00:00Z'},
    {sport:'football',league:'nfl',kickoff:'2026-11-13T23:00:00Z'},
  ]
  const keys=planDailyOddsLeagueKeys(games,4)
  assert.deepEqual(new Set(keys),new Set(['soccer_epl','basketball_nba',
    'icehockey_nhl','americanfootball_nfl']))
  assert.equal(planDailyOddsLeagueKeys(games,5).length,5)
  assert.throws(()=>planDailyOddsLeagueKeys(games,33),/1 a 32/)
})

const now=Date.parse('2026-11-06T17:00:00Z')
const kickoff='2026-11-07T00:00:00Z'
const observed='2026-11-06T16:45:00Z'
const sports=[
  ['basketball','nba','basketball_nba'],
  ['basketball','wnba','basketball_wnba'],
  ['baseball','mlb','baseball_mlb'],
  ['football','nfl','americanfootball_nfl'],
  ['hockey','nhl','icehockey_nhl'],
  ['soccer','eng.1','soccer_epl'],
]
const fixtures=sports.map(([sport,league],i)=>({
  sport,league,eventId:String(i+100),kickoff,
  home:{id:String(i+500),name:'Home '+i},
  away:{id:String(i+600),name:'Away '+i},
  source:'ESPN Site API',status:'scheduled',
}))
const price=(i,selection,market='h2h',point=null,bookmaker='Book A')=>({
  eventId:'book-'+i,bookmaker,market,selection,point,price:selection.startsWith('Home')?1.55:2.8,
  home:'Home '+i,away:'Away '+i,time:kickoff,timeIso:kickoff,updatedAt:observed,
  sportKey:sports[i][2],source:'The Odds API',
})
const pair=(i,market='h2h',book='Book A')=>market==='totals'
  ?[{...price(i,'Over',market,225.5,book),price:1.9},
    {...price(i,'Under',market,225.5,book),price:1.9}]
  :market==='spreads'
    ?[{...price(i,'Home '+i,market,-2.5,book),price:1.9},
      {...price(i,'Away '+i,market,2.5,book),price:1.9}]
    :[price(i,'Home '+i,market,null,book),price(i,'Away '+i,market,null,book)]

test('six sports can supply a five-leg same-bookmaker priced market research pool',()=>{
  const quotes=[...pair(0),...pair(1,'totals'),...pair(2,'spreads'),...pair(3),...pair(4),
    ...pair(5),price(5,'Draw')]
  const result=shortlistDailyMarkets(fixtures,quotes,5,now)
  assert.equal(result.complete,true)
  assert.equal(result.goal,5)
  assert.equal(result.selected.length,5)
  assert.equal(result.bookmaker,'Book A')
  assert.equal(result.matchesInSlate,6)
  assert.equal(new Set(result.selected.map(x=>x.espnEventId)).size,5)
  assert.equal(new Set(result.selected.map(x=>x.sport)).size,5)
  assert.ok(result.selected.some(x=>x.market==='spreads'))
  // The five-game discovery pool must not force totals into the ticket.
  // A larger research reserve still explores them when genuine offers exist.
  const expanded=shortlistDailyMarkets(fixtures,quotes,5,now,6)
  assert.ok(expanded.selected.some(x=>x.market==='totals'))
  assert.ok(result.selected.every(x=>x.assessment==='quote-only-research-pending'))
  assert.ok(result.selected.every(x=>x.marketNoVigShare>0&&x.marketNoVigShare<1))
  assert.match(result.warning,/NO de un modelo/)
})

test('fresh provider observation is eligible without bookmaker updatedAt',()=>{
  const quotes=pair(0).map(q=>({...q,observedAt:observed,updatedAt:'No indicada por la casa'}))
  const result=shortlistDailyMarkets(fixtures,quotes,4,now)
  assert.equal(result.selected.length,1)
  assert.equal(result.selected[0].bookmaker,'Book A')
  assert.equal(result.matchDiagnostics.invalidQuote,0)
})

test('never combines different bookmakers to fake four available legs',()=>{
  const quotes=[...pair(0),...pair(1),...pair(2),...pair(3,'h2h','Book B'),
    ...pair(4,'h2h','Book B')]
  const result=shortlistDailyMarkets(fixtures,quotes,4,now)
  assert.equal(result.complete,false)
  assert.equal(result.selected.length,3)
  assert.equal(result.bookmaker,'Book A')
})

test('rejects stale odds, wrong sports, noncomplementary spreads and started fixtures',()=>{
  const quotes=[...pair(0).map(q=>({...q,updatedAt:'2026-11-06T14:00:00Z'})),
    ...pair(1).map(q=>({...q,sportKey:'basketball_nba'})),
    ...pair(2,'spreads').map(q=>({...q,point:-2.5})),
    ...pair(3).map(q=>({...q,timeIso:'2026-11-06T11:00:00Z'})),
  ]
  const result=shortlistDailyMarkets(fixtures,quotes,4,now)
  assert.equal(result.complete,false)
  assert.equal(result.selected.length,0)
  assert.ok(result.rejectedQuotes>=6)
  assert.equal(result.matchDiagnostics.invalidQuote,4)
  assert.equal(result.matchDiagnostics.unmatchedFixture,2)
  assert.equal(result.matchDiagnostics.invalidMarketSides,1)
})

test('soccer h2h requires a real draw quote and never turns 1x2 into two outcomes',()=>{
  const noDraw=shortlistDailyMarkets(fixtures,pair(5),4,now)
  assert.equal(noDraw.selected.length,0)
  const complete=shortlistDailyMarkets(fixtures,[...pair(5),{...price(5,'Draw'),price:3.5}],4,now)
  assert.equal(complete.selected.length,1)
  assert.equal(complete.complete,false)
})

test('market pool validates supported providers and exact target range',()=>{
  assert.equal(dailyOddsSportKey('hockey','nhl'),'icehockey_nhl')
  assert.equal(dailyOddsSportKey('basketball','wnba'),'basketball_wnba')
  assert.equal(dailyOddsSportKey('soccer','ger.1'),'soccer_germany_bundesliga')
  assert.equal(dailyOddsSportKey('soccer','bra.1'),'soccer_brazil_campeonato')
  assert.equal(dailyOddsSportKey('soccer','unknown'),null)
  assert.throws(()=>shortlistDailyMarkets(fixtures,[],3,now),/4 a 6/)
  assert.throws(()=>shortlistDailyMarkets(fixtures,[],7,now),/4 a 6/)
})

test('known sportsbook team abbreviations match uniquely to actual ESPN fixtures',()=>{
  const nba=[{...fixtures[0],home:{id:'10',name:'Los Angeles Clippers'},
    away:{id:'11',name:'New York Knicks'}}]
  const two=[{...price(0,'LA Clippers'),eventId:'book-la',home:'LA Clippers',
    away:'NY Knicks',price:1.65},
    {...price(0,'NY Knicks'),eventId:'book-la',home:'LA Clippers',
      away:'NY Knicks',price:2.35}]
  const result=shortlistDailyMarkets(nba,two,4,now)
  assert.equal(result.matchesInSlate,1)
  assert.equal(result.selected.length,1)
  assert.equal(result.selected[0].espnEventId,nba[0].eventId)
  assert.equal(result.selected[0].fixture,'New York Knicks vs Los Angeles Clippers')
})

test('unrecognized abbreviations never join a different fixture',()=>{
  const nba=[{...fixtures[0],home:{id:'10',name:'Los Angeles Clippers'},
    away:{id:'11',name:'New York Knicks'}}]
  const two=[{...price(0,'Clippers'),eventId:'book-la',home:'Clippers',
    away:'NY Knicks'},
    {...price(0,'NY Knicks'),eventId:'book-la',home:'Clippers',
      away:'NY Knicks'}]
  const result=shortlistDailyMarkets(nba,two,4,now)
  assert.equal(result.matchesInSlate,0)
  assert.equal(result.selected.length,0)
  assert.equal(result.rejectedQuotes,2)
})

test('researches ten legitimate game markets before choosing the final five',()=>{
  const extra=Array.from({length:6},(_,i)=>({
    ...fixtures[0],eventId:String(300+i),
    home:{id:'extra-home-'+i,name:'Extra Home '+i},
    away:{id:'extra-away-'+i,name:'Extra Away '+i},
  }))
  const quotes=[
    ...sports.flatMap((_,i)=>i===5?
      [...pair(i),{...price(i,'Draw'),price:3.5}]:pair(i)),
    ...extra.flatMap((game,i)=>[
      {...price(0,game.home.name),eventId:'extra-'+i,
        home:game.home.name,away:game.away.name,price:1.6},
      {...price(0,game.away.name),eventId:'extra-'+i,
        home:game.home.name,away:game.away.name,price:2.3},
    ]),
  ]
  const result=shortlistDailyMarkets([...fixtures,...extra],quotes,5,now,10)
  assert.equal(result.complete,true)
  assert.equal(result.selected.length,10)
  assert.equal(new Set(result.selected.map(x=>x.espnEventId)).size,10)
  assert.equal(result.bookmaker,'Book A')
  assert.throws(()=>shortlistDailyMarkets(fixtures,[],5,now,4),
    /Reserva de investigación/)
  assert.throws(()=>shortlistDailyMarkets(fixtures,[],5,now,17),
    /Reserva de investigación/)
})

test('one fixture keeps two different authentic markets for comparison after dossier research',()=>{
  const quotes=[...pair(0),...pair(0,'spreads'),...pair(0,'totals'),...pair(1)]
  const result=shortlistDailyMarkets(fixtures,quotes,4,now)
  assert.equal(result.selected.length,2)
  assert.equal(result.alternatives.length,2)
  const fromGame=result.selected.find(x=>x.espnEventId===fixtures[0].eventId)
  assert.ok(fromGame)
  const other=result.alternatives.filter(x=>x.espnEventId===fixtures[0].eventId)
  assert.equal(other.length,2)
  assert.deepEqual(new Set([fromGame.market,...other.map(x=>x.market)]),
    new Set(['h2h','spreads','totals']))
  assert.ok(other.every(x=>x.bookmaker===result.bookmaker))
})

test('does not automatically choose the cheapest +1.5 or totals for an event',()=>{
  const quotes=[...pair(0),...pair(0,'spreads').map(q=>({
    ...q,point:q.selection.startsWith('Home')?-1.5:1.5,
    price:q.selection.startsWith('Home')?3.2:1.37
  })),...pair(0,'totals').map(q=>({...q,price:1.9}))]
  const list=shortlistDailyMarkets(fixtures,quotes,4,now)
  assert.equal(list.selected.length,1)
  assert.equal(list.selected[0].market,'h2h')
  assert.deepEqual(new Set(list.alternatives.map(x=>x.market)),
    new Set(['spreads','totals']))
  assert.ok(list.alternatives.some(x=>x.market==='spreads'&&
    x.marketNoVigShare>.6))
})

test('research retains two different actual NBA total lines for the same game',()=>{
  const quotes=[...pair(0),...pair(0,'totals'),
    ...pair(0,'totals').map(q=>({...q,point:229.5})),
    ...pair(0,'spreads')]
  const list=shortlistDailyMarkets(fixtures,quotes,4,now)
  assert.equal(list.selected.length,1)
  const lines=list.alternatives.filter(x=>x.market==='totals').map(x=>x.line)
  assert.deepEqual(lines.sort((a,b)=>a-b),[225.5,229.5])
  assert.equal(list.alternatives.length,3)
})


test('winner-only research queries exactly two-way/three-way winner market, never premium spreads/totals',()=>{
  assert.equal(requestedDailyOddsMarkets(true),'h2h')
  assert.equal(requestedDailyOddsMarkets(false),'h2h,spreads,totals')
  assert.equal(dailyOddsSportKey('basketball','nba'),'basketball_nba')
})

test('women Champions League fixtures are routed to their own ESPN odds league, never mens UCL',()=>{
  assert.equal(dailyOddsSportKey('soccer','uefa.wchampions'),'soccer_uefa_womens_champions_league')
  assert.equal(dailyOddsSportKey('soccer','uefa.champions'),'soccer_uefa_champs_league')
})

test('ESPN website markets use fresh observation without inventing bookmaker update',()=>{
  const rows=pair(0).map(q=>({...q,updatedAt:'',observedAt:observed,
    source:'ESPN Site/Core · DraftKings'}))
  const result=shortlistDailyMarkets(fixtures,rows,4,now)
  assert.equal(result.selected.length,1)
  assert.equal(result.selected[0].quoteUpdatedAt,'')
  assert.equal(Date.parse(result.selected[0].observedAt),Date.parse(observed))
  assert.equal(result.selected[0].timestampSource,'espn-observation')
  const stale=shortlistDailyMarkets(fixtures,rows.map(q=>({
    ...q,observedAt:'2026-11-06T15:45:00Z'
  })),4,now)
  assert.equal(stale.selected.length,1)
  assert.equal(stale.selected[0].requiresRecheck,true)
  assert.equal(stale.matchDiagnostics.requiresRefresh,1)
  assert.equal(stale.rejectedQuotes,0)
})
test('ESPN soccer prices without draw remain rejected even with fresh observation',()=>{
  const rows=pair(5).map(q=>({...q,updatedAt:'',observedAt:observed,
    source:'ESPN Site/Core'}))
  assert.equal(shortlistDailyMarkets(fixtures,rows,4,now).selected.length,0)
  const approved=shortlistDailyMarkets(fixtures,[...rows,{
    ...price(5,'Draw'),source:'ESPN Site/Core',updatedAt:'',observedAt:observed,
    price:3.5
  }],4,now)
  assert.equal(approved.selected.length,1)
})

test('genuine sub-1.20 NBA winner prices survive shortlist discovery',()=>{
  const game=fixtures[0]
  const quotes=[
    {...price(0,'Home 0'),price:1.08333,source:'ESPN Site/Core · DraftKings',
      observedAt:observed,updatedAt:''},
    {...price(0,'Away 0'),price:9.10,source:'ESPN Site/Core · DraftKings',
      observedAt:observed,updatedAt:''},
  ]
  // Opposite side may exceed the research candidate price ceiling, but
  // the market pair must still be preserved for no-vig comparison.
  const result=shortlistDailyMarkets([game],quotes,4,now)
  assert.equal(result.matchesInSlate,1)
  assert.equal(result.selected.length,1)
  assert.equal(result.selected[0].decimalOdds,1.08333)
  assert.equal(result.selected[0].selection,'Home 0')
  assert.equal(result.selected[0].timestampSource,'espn-observation')
})

test('old bookmaker update remains valid when ESPN was consulted now',()=>{
  const es=pair(0).map(q=>({...q,source:'ESPN Site/Core (evento exacto)',
    updatedAt:'2026-11-01T11:00:00Z',observedAt:new Date(now).toISOString()}))
  const found=shortlistDailyMarkets(fixtures,es,4,now)
  assert.equal(found.selected.length,1)
  assert.equal(found.selected[0].requiresRecheck,false)
})
test('an older ESPN observation stays visible for recheck, not counted as fresh',()=>{
  const es=pair(0).map(q=>({...q,source:'ESPN Site/Core (evento exacto)',
    updatedAt:'2026-11-01T11:00:00Z',observedAt:'2026-11-06T15:00:00Z'}))
  const found=shortlistDailyMarkets(fixtures,es,4,now)
  assert.equal(found.selected.length,1)
  assert.equal(found.selected[0].requiresRecheck,true)
  assert.equal(found.matchDiagnostics.requiresRefresh,1)
})
test('verified world soccer league matches by exact official ESPN ID only',()=>{
  const game={...fixtures[5],league:'por.2',eventId:'77778'}
  const es=[...pair(5),{...price(5,'Draw'),price:3.45}]
    .map(q=>({...q,source:'ESPN Site/Core (evento exacto)',
      eventId:'77778',sportKey:'soccer_espn_dynamic',
      observedAt:new Date(now).toISOString()}))
  const good=shortlistDailyMarkets([game],es,4,now)
  assert.equal(good.selected.length,1)
  const bad=shortlistDailyMarkets([game],es.map(q=>({...q,eventId:'77779'})),4,now)
  assert.equal(bad.selected.length,0)
})

test('a fresh ESPN event snapshot replaces a stale quote for the same bookmaker and market',()=>{
  const previous=pair(0).map(q=>({...q,source:'ESPN Site/Core (evento exacto)',
    updatedAt:'2026-11-01T11:00:00Z',observedAt:'2026-11-06T15:00:00Z'}))
  const latest=previous.map(q=>({...q,observedAt:new Date(now).toISOString()}))
  assert.equal(espnQuoteNeedsRecheck(previous[0],now),true)
  assert.equal(espnQuoteNeedsRecheck(latest[0],now),false)
  const report=shortlistDailyMarkets(fixtures,[...previous,...latest],4,now)
  assert.equal(report.selected.length,1)
  assert.equal(report.selected[0].requiresRecheck,false)
  assert.equal(report.matchDiagnostics.requiresRefresh,0)
})
