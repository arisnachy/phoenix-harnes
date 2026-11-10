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
    else if(u===web+'athletes/101/gamelog')body={
      events:{'401555001':{name:'Home NBA vs Away NBA'}},
      seasonTypes:[{categories:[{labels:['Points','Assists'],
        events:[{eventId:'401555001',stats:['26','7']}]}]}]}
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
  assert.match(player.lastGames[0].value,/Points: 26.*Assists: 7/)
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


test('failed ESPN season stats do not cause 90 further empty gamelog calls',async()=>{
  const urls=[]
  const roster={athletes:[{items:Array.from({length:15},(_,i)=>({
    id:String(i+100),displayName:'Athlete '+i,position:{abbreviation:'F'}}))}]}
  const fetcher=async url=>{
    urls.push(String(url))
    return new Response(JSON.stringify(String(url).endsWith('/roster')?roster:{}))
  }
  const dossier=await collectDirectEspnStats('soccer','eng.1',
    [{id:'5',name:'Home'},{id:'6',name:'Away'}],fetcher,Date.now(),15)
  assert.equal(dossier.teams[0].athletes.length,15)
  assert.equal(dossier.teams[1].athletes.length,15)
  assert.equal(dossier.errors,0)
  assert.ok(urls.length<50,'No lanzar 90 llamadas vacías para dos plantillas')
  assert.ok(dossier.teams.every(t=>t.athletes.every(a=>a.status==='unavailable')))
})

test('live ESPN results and singular depthchart objects are not discarded',async()=>{
  const calls=[]
  const transport=async url=>{
    const u=String(url);calls.push(u)
    const payload=u.endsWith('/roster')?{athletes:[{id:'221',displayName:'Active Player'}]}:
      u.endsWith('/statistics')?{status:'success',results:{
        season:{displayName:'2026-27'},
        categories:[{stats:[{displayName:'Points Per Game',displayValue:'117.5'},
          {displayName:'Offensive Rating',displayValue:'118.6'}]}]}}:
      u.endsWith('/depthcharts')?{depthchart:{
        items:[{displayName:'Starting Five',displayValue:'Five listed'}]}}:
      u.endsWith('/stats')?{categories:[{stats:[{displayName:'Points',
        displayValue:'19.7'}]}]}:{}
    return new Response(JSON.stringify(payload),{status:200})
  }
  const result=await collectDirectEspnStats('basketball','nba',
    [{id:'18',name:'New York Knicks'}],transport,Date.now(),1)
  assert.equal(result.teams.length,1)
  assert.ok(result.teams[0].stats.some(x=>x.name==='Offensive Rating'))
  assert.ok(result.teams[0].depthChart.some(x=>x.name==='Starting Five'))
  assert.ok(result.teams[0].coverage.some(x=>x.endpoint==='team_statistics'
    &&x.status==='available'))
  assert.ok(calls.some(x=>x.endsWith('/teams/18/statistics')))
})
