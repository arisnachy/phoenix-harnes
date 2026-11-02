import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {SPORTS,SOURCES,sourceAuthorization,emptySourceRecord,observeSource,sourceScore,gameDate,normalizeEspn,normalizeMlb,normalizeOdds,evaluateSelection,quoteTicket,getJSON,fetchGames,fetchOdds,discoverLeagues,discoverOddsSports} from './phoenix-sports-engine.mjs'
test('17 disciplines, public ESPN by default and optional paid source',()=>{
  assert.equal(Object.keys(SPORTS).length,17)
  assert.ok(SPORTS.baseball.includes('dominican-winter-league'))
  assert.equal(SOURCES.some(x=>x.id==='the-odds-api'),true)
  assert.equal(sourceAuthorization('espn',{}),true)
  assert.equal(sourceAuthorization('mlb',{}),true)
  assert.equal(sourceAuthorization('espn',{PHOENIX_SPORTS_ESPN_DISABLED:'1'}),false)
  assert.equal(sourceAuthorization('mlb',{PHOENIX_SPORTS_MLB_DISABLED:'1'}),false)
  assert.equal(sourceAuthorization('the-odds-api',{}),false)
  assert.equal(sourceAuthorization('the-odds-api',{THE_ODDS_API_KEY:'secret'}),true)
})
test('source health improves with evidence; repeated failures are quarantined',()=>{
  let row=emptySourceRecord('provider')
  assert.equal(sourceScore(row).status,'unverified')
  row=observeSource(row,{ok:true,completeness:1,agreement:1,at:1000})
  assert.equal(row.successes,1)
  for(let i=0;i<5;i++)row=observeSource(row,{ok:false,at:1001+i})
  assert.equal(row.quarantined,true)
  assert.equal(sourceScore(row,true,1010).status,'quarantined')
  assert.equal(sourceScore(row,false,1010).status,'not-authorized')
})
test('dates never silently coerce to a different calendar day',()=>{
  assert.equal(gameDate('2026-10-24'),'2026-10-24')
  assert.throws(()=>gameDate('2026-02-30'))
  assert.throws(()=>gameDate('24-10-2026'))
})
test('ESPN normalizes event provenance and venue',()=>{
  const games=normalizeEspn({events:[{id:'123',date:'2026-10-24T19:00:00Z',name:'Home vs Away',status:{type:{description:'Scheduled'}},competitions:[{venue:{fullName:'Estadio de prueba',address:{city:'Santiago'}},competitors:[{homeAway:'home',team:{id:'1',displayName:'Local'}},{homeAway:'away',team:{id:'2',displayName:'Visita'}}]}]}]},{sport:'soccer',league:'esp.1'})
  assert.equal(games.length,1)
  assert.equal(games[0].venue,'Estadio de prueba')
  assert.equal(games[0].away.name,'Visita')
  assert.equal(games[0].source,'espn')
  assert.throws(()=>normalizeEspn({},{}))
})
test('MLB probable pitchers, teams and venue come only from supplied feed',()=>{
  const x=normalizeMlb({dates:[{games:[{gamePk:9,gameDate:'2026-10-24T20:00:00Z',status:{detailedState:'Pre-Game'},venue:{name:'Target Field'},teams:{home:{team:{id:3,name:'Home'},probablePitcher:{id:44,fullName:'Pitcher A'}},away:{team:{id:4,name:'Away'}}}}]}]})
  assert.equal(x[0].pitchers[0].name,'Pitcher A')
  assert.equal(x[0].pitchers[0].confirmed,false)
  assert.equal(x[0].venue,'Target Field')
  assert.equal(x[0].home.id,'3')
  const licensed=normalizeMlb({dates:[{games:[{gamePk:9,teams:{home:{team:{name:'H'},probablePitcher:{id:44,fullName:'P'}},away:{team:{name:'A'}}}}]}]},{imageLicensed:true})
  assert.match(licensed[0].pitchers[0].headshot,/img.mlbstatic.com/u)
})
test('odds markets, source and timestamps remain attributable',()=>{
  const o=normalizeOdds([{id:'evt',sport_key:'baseball_mlb',home_team:'H',away_team:'A',bookmakers:[{key:'book',title:'Sportsbook',markets:[{key:'h2h',last_update:'2026-10-24T12:00:00Z',outcomes:[{name:'H',price:1.8},{name:'A',price:0}]}]}]}])
  assert.equal(o.length,1)
  assert.equal(o[0].decimalOdds,1.8)
  assert.equal(o[0].updatedAt,'2026-10-24T12:00:00Z')
  assert.equal(o[0].bookmaker,'Sportsbook')
  assert.throws(()=>normalizeOdds({}))
})
test('ticket simulation does not claim a guaranteed winner or invent probabilities',()=>{
  const l1={eventId:'A',market:'h2h',selection:'Home',decimalOdds:1.8}
  const l2={eventId:'B',market:'h2h',selection:'Away',decimalOdds:2.1}
  const q=quoteTicket([l1,l2],{stake:100})
  assert.equal(q.placed,false)
  assert.equal(q.guaranteed,false)
  assert.equal(q.grossPotential,378)
  assert.equal(q.jointEstimatedProbability,null)
  assert.equal(q.expectedValue,null)
  assert.ok(quoteTicket([l1,{...l2,eventId:'A'}]).correlationWarning)
  assert.throws(()=>quoteTicket([l1,l1]))
  assert.throws(()=>quoteTicket([l1],{stake:-5}))
  assert.ok(Math.abs(evaluateSelection({decimalOdds:2,estimatedProbability:.6}).expectedValue-.2)<1e-9)
})
test('network is restricted to known hosts with redirects disabled',async()=>{
  await assert.rejects(()=>getJSON('http://127.0.0.1/secret'),/no autorizado/)
  await assert.rejects(()=>getJSON('https://example.org/private'),/no autorizado/)
  const calls=[]
  const json=await getJSON('https://site.api.espn.com/test',{fetcher:async(url,opt)=>{calls.push({url,opt});return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({valid:true})}}})
  assert.equal(json.valid,true)
  assert.equal(calls[0].opt.redirect,'error')
})
test('public ESPN game query uses intended provider and supports operator disable',async()=>{
  await assert.rejects(()=>fetchGames({sport:'soccer',league:'eng.1',date:'2026-10-24',env:{PHOENIX_SPORTS_ESPN_DISABLED:'1'}}),/deshabilitado/)
  const visits=[]
  const fetcher=async(url)=>{visits.push(url);return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({events:[]})}}
  const data=await fetchGames({sport:'soccer',league:'eng.1',date:'2026-10-24',env:{},fetcher})
  assert.equal(data.source,'espn')
  assert.match(visits[0],/dates=20261024/u)
})
test('league discovery is limited to verified source and safe slugs',async()=>{
  const fetcher=async()=>({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({items:[{$ref:'https://sports.core.api.espn.com/v2/sports/soccer/leagues/esp.1'},{slug:'mex.1'},{slug:'invalid/path'},{slug:'mex.1'}]})})
  const rows=await discoverLeagues('soccer',{env:{},fetcher})
  assert.deepEqual(rows.map(x=>x.league),['esp.1','mex.1'])
  await assert.rejects(()=>discoverOddsSports({env:{}}),/THE_ODDS_API_KEY/)
})
test('local studio serves catalog and refuses cross-origin requests',async()=>{
  const home=await mkdtemp(join(tmpdir(),'phoenix-sports-'))
  process.env.PHOENIX_SPORTS_HOME=home
  const {startStudio}=await import('./phoenix-sports-studio.mjs')
  const server=await startStudio({port:0})
  const addr=server.address()
  try {
    const url='http://127.0.0.1:'+addr.port
    const response=await fetch(url+'/api/catalog')
    assert.equal(response.status,200)
    const x=await response.json()
    assert.equal(x.ok,true)
    assert.equal(Object.keys(x.sports).length,17)
    const refused=await fetch(url+'/api/catalog',{headers:{origin:'https://evil.example'}})
    assert.equal(refused.status,403)
    const homePage=await fetch(url+'/')
    assert.equal(homePage.status,200)
    assert.match(await homePage.text(),/PHOENIX/u)
  }finally{
    await new Promise(resolve=>server.close(resolve))
    await rm(home,{recursive:true,force:true})
  }
})

test('public ESPN odds are readable without The Odds API key when actual prices exist',async()=>{
  const later=new Date(Date.now()+86400000).toISOString()
  const fetcher=async()=>new Response(JSON.stringify({events:[{id:'456',date:later,competitions:[{
    id:'456',competitors:[{homeAway:'home',team:{displayName:'Home'}},{homeAway:'away',team:{displayName:'Away'}}],
    odds:[{provider:{name:'ESPN provider'},homeTeamOdds:{moneyLine:-110},awayTeamOdds:{moneyLine:+110}}],
  }]}]}),{status:200})
  const priced=await fetchOdds('baseball_mlb',{env:{},fetcher})
  assert.equal(priced.length,2)
  assert.equal(priced[0].source,'espn')
  assert.ok(Math.abs(priced[0].decimalOdds-1.90909)<.0001)
  assert.deepEqual(await fetchOdds('baseball_mlb',{env:{},fetcher,markets:'totals'}),[])
})
