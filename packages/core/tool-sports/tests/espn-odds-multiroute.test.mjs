import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fetchPublicEspnOddsDetailed,normalizeEspnMarkets} from '../src/espn-odds.ts'
import {marketOddsDetailed} from '../src/sports.ts'

const now=Date.parse('2026-10-29T15:00:00Z')
const tomorrow='2026-10-30T20:00:00Z'
const updated=new Date(now-60_000).toISOString()
const teams=[
  {homeAway:'home',team:{displayName:'Home Club'}},
  {homeAway:'away',team:{displayName:'Away Club'}},
]
const event=(odds=[],id='401111111')=>({
  id,date:tomorrow,competitions:[{id,competitors:teams,odds}],
})
const priced=(provider={name:'DraftKings'})=>({
  provider,lastUpdated:updated,
  homeTeamOdds:{moneyLine:-130},awayTeamOdds:{moneyLine:110},
})
const scoreboard=(events)=>({events})

test('embedded ESPN scoreboard odds are preferred, bounded and attributable',async()=>{
  const paths=[]
  const fetcher=async url=>{
    paths.push(url)
    if(!url.includes('/scoreboard?'))throw Error('unnecessary fallback')
    return scoreboard([event([priced()])])
  }
  const result=await fetchPublicEspnOddsDetailed('basketball_nba','h2h',fetcher,{now,days:1})
  assert.equal(result.quotes.length,2)
  assert.equal(result.diagnostics.embedded,2)
  assert.equal(result.diagnostics.core,0)
  assert.equal(result.diagnostics.summary,0)
  assert.equal(paths.length,1)
  assert.deepEqual([...new Set(result.quotes.map(q=>q.bookmaker))],['DraftKings'])
})

test('Core outage falls back to summary pickcenter and reports partial failure',async()=>{
  const requested=[]
  const fetcher=async url=>{
    requested.push(url)
    if(url.includes('/scoreboard?'))return scoreboard([event()])
    if(url.includes('/odds?'))throw Error('Proveedor HTTP 404')
    if(url.includes('/summary?event='))return {pickcenter:[priced({name:'Caesars'})]}
    throw Error('Unexpected '+url)
  }
  const result=await fetchPublicEspnOddsDetailed('basketball_nba','h2h',fetcher,{now,days:1})
  assert.equal(result.quotes.length,2)
  assert.equal(result.diagnostics.summary,2)
  assert.equal(result.diagnostics.failures,1)
  assert.equal(result.quotes[0].bookmaker,'Caesars')
  assert.ok(requested.some(url=>url.includes('summary?event=')))
})

test('Core list expands only same-game ESPN references; stale summary odds stay excluded',async()=>{
  const tried=[]
  const own='https://sports.core.api.espn.pvt/v2/sports/basketball/leagues/nba/events/401111111/competitions/401111111/odds/41'
  const read=async url=>{
    tried.push(url)
    if(url.includes('scoreboard?'))return scoreboard([event()])
    if(url.includes('/odds?'))return {count:2,items:[
      {$ref:'https://evil.example/odds/41'},{$ref:own},
    ]}
    if(url.endsWith('/odds/41'))return priced({name:'Verified book'})
    if(url.includes('/summary?'))return {odds:[{...priced(),lastUpdated:'2026-10-01T12:00:00Z'}]}
    throw Error('unexpected '+url)
  }
  const result=await fetchPublicEspnOddsDetailed('basketball_nba','h2h,totals',read,{now,days:1})
  assert.equal(result.quotes.length,2)
  assert.equal(result.diagnostics.resolvedRefs,1)
  assert.equal(tried.some(url=>url.includes('evil.example')),false)
  assert.equal(tried.some(url=>url.includes('espn.pvt')),false)
})

test('date-scoped scanning discovers tomorrow games when today has no events',async()=>{
  const dates=[]
  const fetcher=async url=>{
    if(!url.includes('/scoreboard?'))throw Error('unexpected secondary call')
    const date=new URL(url).searchParams.get('dates')
    dates.push(date)
    return scoreboard(date==='20261030'?[event([priced()])]:[])
  }
  const result=await fetchPublicEspnOddsDetailed('basketball_nba','h2h',fetcher,{now,days:2})
  assert.deepEqual(dates,['20261029','20261030'])
  assert.equal(result.diagnostics.games,1)
  assert.equal(result.quotes.length,2)
})

test('does not advertise unnamed, undated or historical odds as current offers',async()=>{
  const read=async url=>{
    if(url.includes('scoreboard?'))return scoreboard([event([
      {...priced({id:'41'}),lastUpdated:updated},
      {...priced({name:'Old book'}),lastUpdated:'2026-10-20T10:00:00Z'},
    ])])
    if(url.includes('/odds?'))return {items:[]}
    if(url.includes('/summary?'))return {pickcenter:[]}
    throw Error('unexpected '+url)
  }
  const result=await fetchPublicEspnOddsDetailed('basketball_nba','h2h',read,{now,days:1})
  assert.deepEqual(result.quotes,[])
  assert.match(result.diagnostics.notes.join(' '),/sin|No se|ESPN/u)
})

test('source diagnostics include Core/summary failures, never claim all markets closed',async()=>{
  const fetcher=async url=>new Response(JSON.stringify(
    String(url).includes('scoreboard?')?scoreboard([event([priced()])]):{}
  ),{status:200})
  const result=await marketOddsDetailed('basketball_nba','h2h',
    {PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'0',PHOENIX_SPORTS_ESPN_DISABLED:'0'},
    fetcher,now)
  assert.equal(result.quotes.length,2)
  const state=result.sources.find(x=>x.provider==='ESPN Site/Core')
  assert.equal(state.status,'observed')
  assert.match(state.detail,/días consultados/)
  assert.match(state.detail,/líneas scoreboard/)
})

test('still reads embedded prices beyond the eight per-day Core fallback probes',async()=>{
  const events=Array.from({length:12},(_,index)=>event([priced()],String(401111111+index)))
  const called=[]
  const get=async url=>{
    called.push(url)
    if(url.includes('/scoreboard?'))return scoreboard(events)
    throw Error('Core not needed')
  }
  const result=await fetchPublicEspnOddsDetailed('basketball_nba','h2h',get,{now,days:1})
  assert.equal(result.quotes.length,24)
  assert.equal(result.diagnostics.games,12)
  assert.equal(called.length,1)
})

test('real ESPN Core item shape decodes nested decimal and American prices without using opening line',()=>{
  const future=new Date(Date.now()+48*60*60*1000).toISOString()
  const game={id:'401809303',date:future,competitions:[{id:'401809303',competitors:[
    {homeAway:'away',team:{displayName:'Los Angeles Dodgers'}},
    {homeAway:'home',team:{displayName:'Toronto Blue Jays'}},
  ]}]}
  const odds=[{
    provider:{id:'58',name:'ESPN BET'},details:'LAD -126',overUnder:8.5,
    overOdds:110,underOdds:-130,spread:1.5,
    awayTeamOdds:{moneyline:-126,pointSpread:-1.5,
      spread:{american:'-105'},open:{moneyLine:{american:'-180',value:1.556}}},
    homeTeamOdds:{moneyLine:{american:'+116',decimal:2.16},
      pointSpread:1.5,spreadOdds:{decimal:1.952}},
  }]
  const quotes=normalizeEspnMarkets(game,odds)
  assert.equal(quotes.length,6)
  const away=quotes.find(q=>q.selection==='Los Angeles Dodgers'&&q.market==='h2h')
  const home=quotes.find(q=>q.selection==='Toronto Blue Jays'&&q.market==='h2h')
  assert.equal(away.price,1.79365)
  assert.equal(home.price,2.16)
  assert.equal(quotes.find(q=>q.market==='totals'&&q.selection==='Over').price,2.1)
  assert.equal(quotes.find(q=>q.market==='totals'&&q.selection==='Under').price,1.76923)
  assert.equal(quotes.find(q=>q.market==='spreads'&&q.selection==='Los Angeles Dodgers').point,-1.5)
  assert.equal(quotes.find(q=>q.market==='spreads'&&q.selection==='Los Angeles Dodgers').price,1.95238)
  assert.equal(quotes.find(q=>q.market==='spreads'&&q.selection==='Toronto Blue Jays').price,1.952)
  assert.ok(!quotes.some(q=>q.price===1.55556))
  assert.ok(quotes.every(q=>q.bookmaker==='ESPN BET'))
})

test('Core inline items are recognized but undated prices are never advertised as active ticket odds',async()=>{
  const now=Date.now()
  const start=new Date(now+86_400_000).toISOString()
  const sample={provider:{id:'58',name:'ESPN BET'},details:'LAD -126',
    homeTeamOdds:{moneyLine:{american:'+110'}},
    awayTeamOdds:{moneyline:-126,open:{moneyLine:{american:'-180'}}},
    overUnder:8.5,overOdds:110,underOdds:-130}
  const calls=[]
  const read=async url=>{
    calls.push(url)
    if(url.includes('scoreboard?'))return {events:[{id:'401809303',date:start,competitions:[{
      id:'401809303',competitors:[
        {homeAway:'home',team:{displayName:'Toronto Blue Jays'}},
        {homeAway:'away',team:{displayName:'Los Angeles Dodgers'}},
      ],
    }]}]}
    if(url.includes('/odds?'))return {count:2,pageCount:1,items:[sample]}
    if(url.includes('/summary?'))return {pickcenter:[]}
    throw Error('Unexpected '+url)
  }
  const found=await fetchPublicEspnOddsDetailed('baseball_mlb','h2h,totals',
    read,{now,days:1})
  assert.equal(found.quotes.length,0)
  assert.equal(found.diagnostics.rawOddsEntries,1)
  assert.ok(found.diagnostics.undatedOutcomes>=2)
  assert.equal(found.diagnostics.expiredOutcomes,0)
  assert.match(found.diagnostics.notes.join(' '),/sin fecha/u)
  assert.ok(calls.some(x=>x.includes('/events/401809303/competitions/401809303/odds')))
})

test('dated nested ESPN Core lines are usable on a future game, old lines are excluded',async()=>{
  const now=Date.now(),date=new Date(now+72*60*60*1000).toISOString()
  const updated=new Date(now-60_000).toISOString()
  const board={events:[{id:'401809303',date,competitions:[{id:'401809303',
    competitors:[{homeAway:'home',team:{displayName:'Toronto Blue Jays'}},
      {homeAway:'away',team:{displayName:'Los Angeles Dodgers'}}]}]}]}
  const read=async url=>{
    if(url.includes('scoreboard?'))return board
    if(url.includes('/odds?'))return {count:2,items:[
      {provider:{name:'ESPN BET'},lastUpdated:updated,
        homeTeamOdds:{moneyLine:{american:'+110'}},
        awayTeamOdds:{moneyline:-126}},
      {provider:{name:'OldBook'},lastUpdated:'2026-01-01T00:00:00Z',
        homeTeamOdds:{moneyline:-110},awayTeamOdds:{moneyline:110}},
    ]}
    if(url.includes('/summary?'))return {}
    throw Error('Unexpected '+url)
  }
  const result=await fetchPublicEspnOddsDetailed('baseball_mlb','h2h',
    read,{now,days:1})
  assert.equal(result.quotes.length,2)
  assert.equal(result.quotes[0].bookmaker,'ESPN BET')
  assert.equal(result.diagnostics.rawOddsEntries,2)
  assert.equal(result.diagnostics.expiredOutcomes,2)
})

test('started NHL games retain detected embedded odds for diagnostics, never pregame ticket',async()=>{
  const now=Date.now(),started=new Date(now-30*60_000).toISOString()
  const read=async url=>{
    if(!url.includes('/scoreboard?'))throw Error('No Core needed for started events')
    return {events:[{id:'401888888',date:started,competitions:[{
      id:'401888888',odds:[{provider:{name:'Book A'},homeTeamOdds:{moneyline:-125}}],
      competitors:[
        {homeAway:'home',team:{displayName:'Home Hockey'}},
        {homeAway:'away',team:{displayName:'Away Hockey'}},
      ],
    }]}]}
  }
  const result=await fetchPublicEspnOddsDetailed('icehockey_nhl','h2h',read,{now,days:1})
  assert.deepEqual(result.quotes,[])
  assert.equal(result.diagnostics.games,0)
  assert.equal(result.diagnostics.startedGames,1)
  assert.equal(result.diagnostics.startedOddsEntries,1)
  assert.match(result.diagnostics.notes.join(' '),/iniciados/)
  const mock=async url=>new Response(JSON.stringify(await read(url)),{status:200})
  const sources=await marketOddsDetailed('icehockey_nhl','h2h',
    {PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'0'},mock,now)
  assert.equal(sources.quotes.length,0)
  const espn=sources.sources.find(x=>x.provider==='ESPN Site/Core')
  assert.equal(espn.rawCount,1) // Duplicate scoreboard listings are counted only once.
  assert.equal(espn.startedOddsEntries,1)
})

test('specific game/date queries ESPN scoreboard once, never borrowing another event odds',async()=>{
  const urls=[]
  const target=event([priced({name:'TargetBook'})],'401111111')
  const foreign=event([priced({name:'ForeignBook'})],'401222222')
  const get=async url=>{
    urls.push(url)
    if(url.includes('/scoreboard?'))return scoreboard([foreign,target])
    if(url.includes('/odds?'))return {items:[]}
    if(url.includes('/summary?'))return {}
    throw Error('Unexpected fallback '+url)
  }
  const result=await fetchPublicEspnOddsDetailed('basketball_nba','h2h',get,{
    now,date:'2026-10-30',eventId:'401111111',days:1,
  })
  assert.equal(result.quotes.length,2)
  assert.ok(result.quotes.every(q=>q.eventId==='401111111'&&q.bookmaker==='TargetBook'))
  assert.ok(result.quotes.every(q=>q.endpointSource==='scoreboard'))
  assert.deepEqual(result.diagnostics.datesQueried,['20261030'])
  assert.equal(result.diagnostics.eventMatched,true)
  assert.equal(urls.length,3)
  assert.equal(new URL(urls[0]).searchParams.get('dates'),'20261030')
})

test('specific event odds never use unrelated event when the requested ID is not found',async()=>{
  const get=async url=>{
    if(url.includes('/scoreboard?'))return scoreboard([event([priced()],'401111111')])
    throw Error('Secondary routes must not run')
  }
  const result=await fetchPublicEspnOddsDetailed('basketball_nba','h2h',get,{
    now,date:'2026-10-30',eventId:'401999999',days:1,
  })
  assert.equal(result.quotes.length,0)
  assert.equal(result.diagnostics.eventMatched,false)
  assert.match(result.diagnostics.notes.join(' '),/no localizado/)
})

test('event-specific lookups reject malformed ESPN IDs and calendar dates',async()=>{
  const noRequest=async()=>{throw Error('should not fetch')}
  await assert.rejects(()=>fetchPublicEspnOddsDetailed('basketball_nba','h2h',noRequest,
    {now,date:'2026-02-30',eventId:'401111111',days:1}),/Fecha ESPN inválida/)
  await assert.rejects(()=>fetchPublicEspnOddsDetailed('basketball_nba','h2h',noRequest,
    {now,date:'2026-10-30',eventId:'../other',days:1}),/eventId ESPN inválido/)
})

test('Core HTTP references from ESPN are upgraded to HTTPS only for exact game and host',async()=>{
 const original='http://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/401111111/competitions/401111111/odds/41'
 const called=[]
 const get=async url=>{
  called.push(url)
  if(url.includes('/scoreboard?'))return scoreboard([event()])
  if(url.includes('/odds?'))return {items:[{$ref:original},{$ref:'http://not-espn.example/odds/11'}]}
  if(url.endsWith('/odds/41'))return priced({name:'ESPN Resolved Book'})
  if(url.includes('/summary?'))return {pickcenter:[]}
  throw Error('Unexpected '+url)
 }
 const r=await fetchPublicEspnOddsDetailed('basketball_nba','h2h',get,{now,days:1})
 assert.equal(r.quotes.length,2)
 assert.equal(r.diagnostics.resolvedRefs,1)
 assert.ok(called.some(url=>url==='https://'+original.slice('http://'.length)))
 assert.ok(called.every(url=>!url.includes('not-espn.example')))
 assert.ok(r.quotes.every(x=>x.endpointSource==='core'))
})


test('Core inline records carrying $ref preserve priced odds without a second provider request',async()=>{
  const urls=[]
  const inline='http://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/401111111/competitions/401111111/odds/41'
  const get=async url=>{
    urls.push(url)
    if(url.includes('/scoreboard?'))return scoreboard([event([])])
    if(url.includes('/odds?'))return {count:1,items:[{$ref:inline,...priced({name:'Inline Core Book'})}]}
    throw Error('Already received inline odds; do not require extra request '+url)
  }
  const result=await fetchPublicEspnOddsDetailed('basketball_nba','h2h',get,{now,days:1})
  assert.equal(result.quotes.length,2)
  assert.equal(result.diagnostics.core,2)
  assert.ok(result.quotes.every(q=>q.bookmaker==='Inline Core Book'&&q.endpointSource==='core'))
  assert.equal(urls.length,2)
})

test('Core current.moneyLine is parsed when the top-level moneyline is missing, never the opening odds',()=>{
  const quote={
    provider:{id:'41',name:'Current Lines'},lastUpdated:updated,
    homeTeamOdds:{current:{moneyLine:{american:'-120'}},open:{moneyLine:{american:'-500'}}},
    awayTeamOdds:{current:{moneyLine:{american:'+110'}},open:{moneyLine:{american:'+450'}}},
  }
  const result=normalizeEspnMarkets(event([]),[quote],{now})
  assert.equal(result.length,2)
  assert.deepEqual(result.map(q=>q.price).sort((a,b)=>a-b),[1.83333,2.1])
  assert.equal(result.some(q=>q.price===1.2||q.price===5.5),false)
})


test('targeted event searches Scoreboard, Core and Summary for distinct ESPN books',async()=>{
 const requests=[],when=new Date(now+86_400_000).toISOString()
 const game={...event([priced({name:'BoardBook'})]),date:when}
 const get=async url=>{
  requests.push(url)
  if(url.includes('/scoreboard?'))return scoreboard([game])
  if(url.includes('/odds?'))return {items:[{...priced({name:'CoreBook'})}]}
  if(url.includes('/summary?'))return {pickcenter:[priced({name:'SummaryBook'})]}
  throw Error('Unexpected '+url)
 }
 const r=await fetchPublicEspnOddsDetailed('basketball_nba','h2h',get,
  {now,eventId:'401111111',date:'2026-10-30',days:1})
 assert.deepEqual([...new Set(r.quotes.map(x=>x.bookmaker))].sort(),['BoardBook','CoreBook','SummaryBook'])
 assert.equal(requests.length,3)
})

test('ESPN missing timestamps and old prices remain available for research, not ticket odds',async()=>{
 const game=event([{...priced({name:'Unknown time'}),lastUpdated:undefined},
  {...priced({name:'Old book'}),lastUpdated:new Date(now-3_600_001).toISOString()}])
 const read=async url=>{
  if(url.includes('/scoreboard?'))return scoreboard([game])
  if(url.includes('/odds?'))return {items:[]}
  if(url.includes('/summary?'))return {}
  throw Error('Unexpected '+url)
 }
 const r=await fetchPublicEspnOddsDetailed('basketball_nba','h2h',read,{now,days:1})
 assert.equal(r.quotes.length,0)
 assert.deepEqual([...new Set(r.observations.map(x=>x.reason))].sort(),['antigua','sin_fecha'])
 assert.ok(r.observations.every(x=>x.price>1&&x.endpointSource==='scoreboard'))
})

test('top-level spread reconstructs sides only when the favorite is identified',()=>{
 const odd={provider:{name:'Book'},lastUpdated:updated,spread:7.5,
  homeTeamOdds:{favorite:false,spreadOdds:-110},awayTeamOdds:{favorite:true,spreadOdds:-105}}
 const quotes=normalizeEspnMarkets(event(),[odd],{now})
 assert.equal(quotes.find(x=>x.market==='spreads'&&x.selection==='Home Club')?.point,7.5)
 assert.equal(quotes.find(x=>x.market==='spreads'&&x.selection==='Away Club')?.point,-7.5)
 const unknown=normalizeEspnMarkets(event(),[{...odd,homeTeamOdds:{spreadOdds:-110},
  awayTeamOdds:{spreadOdds:-105}}],{now})
 assert.equal(unknown.filter(x=>x.market==='spreads').length,0)
})

test('provider ID alone is not a verified bookmaker name',async()=>{
 const read=async url=>{
  if(url.includes('/scoreboard?'))return scoreboard([event([{
   provider:{id:'58'},lastUpdated:updated,homeTeamOdds:{moneyLine:-110},
   awayTeamOdds:{moneyLine:120}}])])
  if(url.includes('/odds?'))return {items:[]}
  if(url.includes('/summary?'))return {}
  throw Error('Unexpected '+url)
 }
 const r=await fetchPublicEspnOddsDetailed('basketball_nba','h2h',read,{now,days:1})
 assert.equal(r.quotes.length,0)
 assert.equal(r.observations.length,2)
 assert.ok(r.observations.every(x=>x.reason==='proveedor_sin_nombre'))
})
