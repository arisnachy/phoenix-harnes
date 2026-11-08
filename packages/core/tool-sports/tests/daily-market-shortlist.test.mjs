import {test} from 'node:test'
import assert from 'node:assert/strict'
import {shortlistDailyMarkets,dailyOddsSportKey} from '../src/daily-market-shortlist.ts'

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
  assert.ok(result.selected.some(x=>x.market==='totals'))
  assert.ok(result.selected.every(x=>x.assessment==='quote-only-research-pending'))
  assert.ok(result.selected.every(x=>x.marketNoVigShare>0&&x.marketNoVigShare<1))
  assert.match(result.warning,/NO de un modelo/)
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
