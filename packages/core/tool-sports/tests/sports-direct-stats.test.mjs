import {test} from 'node:test'
import assert from 'node:assert/strict'
import {collectDirectEspnStats} from '../src/sports-direct-stats.ts'

const now=Date.parse('2026-11-02T18:00:00Z')
const site='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/'
const web='https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/'
test('directly fetches ESPN player stats, gamelog and splits without a prompt action',async()=>{
  const calls=[]
  const fetcher=async url=>{
    const u=String(url);calls.push(u)
    let body={}
    if(u===site+'teams/5/roster')body={athletes:[{items:[
      {id:'101',displayName:'Player A',position:{abbreviation:'G'},
        jersey:'1',headshot:{href:'https://a.espncdn.com/a.png'}},
      {id:'102',displayName:'Player B',position:{abbreviation:'F'}}]}]}
    else if(u===site+'teams/6/roster')body={athletes:[{id:'103',
      displayName:'Player C',position:{abbreviation:'G'}}]}
    else if(u.endsWith('/statistics')&&u.includes('/teams/'))body={
      categories:[{stats:[{displayName:'Points per game',displayValue:'118.2'}]}]}
    else if(u===web+'athletes/101/stats')body={
      categories:[{stats:[{displayName:'Points per game',displayValue:'24.4'},
        {displayName:'Rebounds',displayValue:'5.1'}]}]}
    else if(u===web+'athletes/101/gamelog')body={tables:[{
      labels:['Points','Assists'],stats:['26','7']}]}
    else if(u===web+'athletes/101/splits')body={
      categories:[{stats:[{name:'Home points',value:'27.0'}]}]}
    return new Response(JSON.stringify(body),{status:200})
  }
  const report=await collectDirectEspnStats('basketball','nba',[
    {id:'5',name:'Home NBA'},{id:'6',name:'Away NBA'}],fetcher,now,4)
  assert.equal(report.teams.length,2)
  assert.equal(report.teams[0].athleteCount,2)
  assert.equal(report.teams[0].stats[0].value,'118.2')
  const player=report.teams[0].athletes.find(p=>p.id==='101')
  assert.equal(player.teamId,'5')
  assert.equal(player.stats[0].value,'24.4')
  assert.equal(player.lastGames[0].value,'26')
  assert.equal(player.splits[0].value,'27.0')
  assert.ok(player.verifiedSources.includes('gamelog'))
  assert.ok(calls.every(u=>u.startsWith(site)||u.startsWith(web)))
  assert.ok(calls.every(u=>!u.includes('undefined')))
})
test('does not invent metrics from blank endpoints or athlete names not on team roster',async()=>{
  const fetcher=async url=>{
    const u=String(url)
    const body=u.endsWith('/roster')?{athletes:[{id:'555',displayName:'Roster Player'}]}:{}
    return new Response(JSON.stringify(body),{status:200})
  }
  const result=await collectDirectEspnStats('basketball','nba',[{id:'5',name:'Team'}],
    fetcher,now+86_400_000,4)
  assert.equal(result.teams[0].athletes.length,1)
  assert.equal(result.teams[0].athletes[0].status,'unavailable')
  assert.deepEqual(result.teams[0].athletes[0].stats,[])
  assert.deepEqual(result.teams[0].athletes[0].lastGames,[])
})
test('never reads attacker supplied IDs or invalid sport/leagues',async()=>{
  let calls=0
  const fetcher=async()=>{calls++;return new Response('{}')}
  await assert.rejects(()=>collectDirectEspnStats('basketball','nba',
    [{id:'5?redirect=https://evil.example',name:'Team'}],fetcher))
  await assert.rejects(()=>collectDirectEspnStats('basketball','../../nba',
    [{id:'5',name:'Team'}],fetcher))
  await assert.rejects(()=>collectDirectEspnStats('basketball','nba',
    [{id:'5',name:'Team'}],fetcher,now,200))
  assert.equal(calls,0)
})

test('isolates identical ESPN URLs between independent fetch transports',async()=>{
  const makeFetcher=name=>async url=>new Response(JSON.stringify(
    String(url).endsWith('/roster')?{athletes:[{id:'991',displayName:name}]}:
    String(url).endsWith('/stats')?{categories:[{stats:[{displayName:'Points',displayValue:name}]}]}:{}
  ),{status:200})
  const first=await collectDirectEspnStats('basketball','nba',
    [{id:'456',name:'Team'}],makeFetcher('First'),now,1)
  const second=await collectDirectEspnStats('basketball','nba',
    [{id:'456',name:'Team'}],makeFetcher('Second'),now,1)
  assert.equal(first.teams[0].athletes[0].name,'First')
  assert.equal(second.teams[0].athletes[0].name,'Second')
  assert.equal(second.teams[0].athletes[0].stats[0].value,'Second')
})
