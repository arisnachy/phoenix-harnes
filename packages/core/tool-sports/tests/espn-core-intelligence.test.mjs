import {test} from 'node:test'
import assert from 'node:assert/strict'
import {espnCoreUrl,queryEspnCore,espnCoreModes} from '../src/espn-core-intelligence.ts'
import {normalizeEspnMarkets,fetchPublicEspnOdds} from '../src/espn-odds.ts'

const base={sport:'football',league:'nfl'}
const game={...base,eventId:'401220181',competitionId:'401220181',providerId:'41'}
const team={...base,teamId:'1',providerId:'41',season:2026}
const path=(q)=>new URL(espnCoreUrl(q)).pathname
test('all ESPN Core market endpoints have exact, validated URL templates',()=>{
  assert.equal(path({...game,mode:'odds'}),'/v2/sports/football/leagues/nfl/events/401220181/competitions/401220181/odds')
  assert.equal(path({...game,mode:'provider'}),'/v2/sports/football/leagues/nfl/events/401220181/competitions/401220181/odds/41')
  assert.equal(path({...game,mode:'movement'}),'/v2/sports/football/leagues/nfl/events/401220181/competitions/401220181/odds/41/history/0/movement')
  assert.equal(path({...game,mode:'head_to_heads'}),'/v2/sports/football/leagues/nfl/events/401220181/competitions/401220181/odds/41/head-to-heads')
  assert.equal(path({...team,mode:'ats'}),'/v2/sports/football/leagues/nfl/seasons/2026/types/2/teams/1/ats')
  assert.equal(path({...team,mode:'futures'}),'/v2/sports/football/leagues/nfl/seasons/2026/futures')
  assert.equal(path({...team,mode:'past_performances'}),'/v2/sports/football/leagues/nfl/teams/1/odds/41/past-performances')
  assert.equal(path({...team,mode:'odds_records'}),'/v2/sports/football/leagues/nfl/seasons/2026/types/0/teams/1/odds-records')
  assert.equal(path({...game,mode:'probabilities'}),'/v2/sports/football/leagues/nfl/events/401220181/competitions/401220181/probabilities')
  assert.equal(path({...game,mode:'predictor'}),'/v2/sports/football/leagues/nfl/events/401220181/competitions/401220181/predictor')
  assert.equal(path({...base,mode:'providers'}),'/v2/sports/football/leagues/nfl/providers')
  assert.equal(Object.keys(espnCoreModes).length,11)
})
test('supports optional distinct ESPN competition IDs and safe pagination',()=>{
  assert.match(espnCoreUrl({...game,mode:'odds',competitionId:'701100',limit:25,page:3}),
    /events\/401220181\/competitions\/701100\/odds\?limit=25&page=3$/u)
  assert.match(espnCoreUrl({...base,mode:'providers',limit:999,page:0}),/limit=25&page=1$/u)
})
test('rejects invalid IDs and path injection before any external fetch',()=>{
  for(const bad of [
    {...game,mode:'odds',eventId:'../private'},
    {...game,mode:'odds',competitionId:'http://bad.example'},
    {...game,mode:'provider',providerId:'not-an-id'},
    {...team,mode:'ats',teamId:'1/other'},
    {...base,mode:'futures',season:Infinity},
    {...base,mode:'providers',league:'../unsafe'},
    {...base,mode:'providers',sport:'http://x'},
    {...team,mode:'ats',seasonType:19},
  ])assert.throws(()=>espnCoreUrl(bad),/inválid|ausente/u)
})
test('resolves only same-league, same-host ESPN references, never arbitrary URLs',async()=>{
  const called=[]
  const own='https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/401220181/competitions/401220181/odds/41'
  const data={count:4,pageInfo:{current:1,pages:1},items:[
    {$ref:own},{$ref:'https://evil.example/rebound'},
    {$ref:'https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/teams/1'},
    {$ref:own.replace('odds/41','odds/38')},
  ]}
  const result=await queryEspnCore({...game,mode:'odds',page:6},async url=>{
    called.push(url)
    if(url.includes('/odds?'))return data
    return {provider:{id:'41',name:'DraftKings'},homeTeamOdds:{moneyLine:-130}}
  })
  assert.equal(result.state,'data')
  assert.equal(result.count,4)
  assert.equal(result.refCount,2)
  assert.equal(result.resolvedRefs,2)
  assert.equal(called.length,3)
  assert.equal(result.items.length,4)
  assert.equal(called.some(x=>x.includes('evil.example')),false)
  assert.equal(called.some(x=>x.includes('/soccer/')),false)
})
test('preserves core ATS and futures JSON as descriptive data, not priced bets',async()=>{
  const report=await queryEspnCore({...team,mode:'ats'},async()=>{
    return {wins:5,losses:3,pushes:1,season:2026}
  },{resolveRefs:false})
  assert.equal(report.state,'data')
  assert.deepEqual(report.details,{wins:5,losses:3,pushes:1,season:2026})
  assert.match(report.warning,/NO son cotizaciones/)
})
test('missing endpoint becomes an explicit unavailable status and never a fake zero-odds quote',async()=>{
  const r=await queryEspnCore({...game,mode:'provider'},async()=>{
    throw Error('Proveedor HTTP 404')
  })
  assert.equal(r.state,'unavailable')
  assert.equal(r.count,0)
  assert.equal(r.items.length,0)
  assert.match(r.error,/404/)
})
test('empty futures collection reports empty with source and endpoint',async()=>{
  const r=await queryEspnCore({...team,mode:'futures'},async()=>({count:0,items:[]}))
  assert.equal(r.state,'empty')
  assert.equal(r.source,'ESPN Core API (pública, sin clave)')
})

test('normalizes actual ESPN moneyline, point spread and totals without guessing missing sides',()=>{
 const start=new Date(Date.now()+86_400_000).toISOString()
 const game={id:'401999999',date:start,competitions:[{competitors:[
   {homeAway:'home',team:{displayName:'Boston Celtics'}},
   {homeAway:'away',team:{displayName:'Miami Heat'}},
 ]}]}
 const odds=[{provider:{id:41,name:'DraftKings'},lastUpdated:new Date(Date.now()-60_000).toISOString(),
   homeTeamOdds:{moneyLine:-135,spreadOdds:-110,spreadValue:-3.5},
   awayTeamOdds:{moneyLine:115,spreadOdds:-110,spreadValue:3.5},
   overUnder:220.5,overOdds:-110,underOdds:-110}]
 const result=normalizeEspnMarkets(game,odds)
 assert.equal(result.length,6)
 assert.equal(result.filter(x=>x.market==='h2h').length,2)
 assert.equal(result.filter(x=>x.market==='spreads').length,2)
 assert.equal(result.filter(x=>x.market==='totals').length,2)
 assert.ok(result.every(x=>x.bookmaker==='DraftKings'&&x.timeIso===start))
 assert.equal(result.find(x=>x.market==='h2h'&&x.selection==='Boston Celtics').price,1.74074)
 assert.equal(result.find(x=>x.market==='spreads'&&x.selection==='Miami Heat').point,3.5)
 assert.equal(result.find(x=>x.market==='totals'&&x.selection==='Over').point,220.5)
 const bad=normalizeEspnMarkets(game,[{provider:{name:'Book X'},homeTeamOdds:{spreadOdds:-105}}])
 assert.deepEqual(bad,[])
})

test('rewrites only the exact ESPN private hostname to the public Core host',async()=>{
 const calls=[]
 const ref='https://sports.core.api.espn.pvt/v2/sports/football/leagues/nfl/events/401220181/competitions/401220181/odds/2000'
 const result=await queryEspnCore({...game,mode:'odds',page:10},async url=>{
   calls.push(url)
   return url.includes('/odds?')?{count:1,items:[{$ref:ref}]}:{provider:{name:'DraftKings'}}
 })
 assert.equal(result.resolvedRefs,1)
 assert.equal(calls.length,2)
 assert.match(calls[1],/^https:\/\/sports\.core\.api\.espn\.com\//u)
})

test('keyless ESPN public market fallback resolves safe game odds to actual priced selections',async()=>{
 const start=new Date(Date.now()+3*86_400_000).toISOString()
 const head='https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/401999999/competitions/401999999/odds'
 const ref=head.replace('.com','.pvt')+'/41'
 const sources=[]
 const output=await fetchPublicEspnOdds('basketball_nba','h2h,totals,spreads',async url=>{
   sources.push(url)
   if(url.includes('/scoreboard?'))return {events:[{id:'401999999',date:start,competitions:[{
     id:'401999999',competitors:[
       {homeAway:'home',team:{displayName:'Atlanta Hawks'}},
       {homeAway:'away',team:{displayName:'Miami Heat'}}],
   }]}]}
   if(url.endsWith('/odds?limit=5'))return {count:1,items:[{$ref:ref}]}
   if(url.includes('/odds/41'))return {provider:{name:'DraftKings'},
     lastUpdated:new Date(Date.now()-40_000).toISOString(),
     homeTeamOdds:{moneyLine:-120},awayTeamOdds:{moneyLine:105},
     overUnder:211.5,overOdds:-110,underOdds:-110}
   throw Error('Unexpected url '+url)
 })
 assert.equal(output.length,4)
 assert.deepEqual([...new Set(output.map(x=>x.market))].sort(),['h2h','totals'])
 assert.ok(output.every(x=>x.bookmaker==='DraftKings'))
 assert.ok(sources.length>=3)
 assert.equal(sources.some(x=>x.includes('espn.pvt')),false)
})

test('Core resource reader upgrades same-host HTTP refs without allowing cross-host redirection',async()=>{
 const original='http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/401220181/competitions/401220181/odds/41'
 const called=[]
 const r=await queryEspnCore({...game,mode:'odds',page:44},async url=>{
  called.push(url)
  if(url.includes('/odds?'))return {count:2,items:[
   {$ref:original},{$ref:'http://untrusted.example/v2/sports/football/leagues/nfl/events/401220181/competitions/401220181/odds/99'},
  ]}
  return {provider:{id:'41',name:'Book'},homeTeamOdds:{moneyLine:-110}}
 })
 assert.equal(r.resolvedRefs,1)
 assert.ok(called.some(x=>x===original.replace('http:','https:')))
 assert.ok(called.every(x=>!x.includes('untrusted.example')))
})
