import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fetchPublicEspnOddsDetailed} from '../src/espn-odds.ts'
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

test('specific game/date queries ESPN scoreboard once, never borrowing another event odds',async()=>{
  const urls=[]
  const target=event([priced({name:'TargetBook'})],'401111111')
  const foreign=event([priced({name:'ForeignBook'})],'401222222')
  const get=async url=>{
    urls.push(url)
    if(url.includes('/scoreboard?'))return scoreboard([foreign,target])
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
  assert.equal(urls.length,1)
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
