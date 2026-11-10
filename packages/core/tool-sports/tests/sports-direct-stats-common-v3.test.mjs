import {test} from 'node:test'
import assert from 'node:assert/strict'
import {collectDirectEspnStats} from '../src/sports-direct-stats.ts'

test('ESPN Common v3 parallel labels/totals supply player stats, games and splits',async()=>{
 const seen=[]
 const transport=async url=>{
  const u=String(url);seen.push(u)
  const body=u.endsWith('/roster')?{athletes:[{
    id:'4683730',displayName:'Player Example',position:{abbreviation:'PG'}}]}:
   u.endsWith('/statistics')?{results:{stats:[
    {displayName:'Offensive Rating',displayValue:'118.2'},
    {displayName:'Defensive Rating',displayValue:'112.4'},
    {displayName:'Pace',displayValue:'99.8'}]}}:
   u.endsWith('/depthcharts')?{depthchart:{items:[]}}:
   u.endsWith('/stats')?{categories:[{name:'general',
    labels:['GP','MIN','PTS','REB','AST'],totals:['10','32.0','25.3','7.1','9.0']}]}:
   u.endsWith('/gamelog')?{events:{
    '401800001':{name:'Cavaliers vs Knicks',date:'2026-11-05T00:00:00Z'}},
    seasonTypes:[{categories:[{labels:['MIN','PTS','REB'],
      events:[{eventId:'401800001',stats:['33','29','7']}]}]}]}:
   u.endsWith('/splits')?{splitCategories:[{
    labels:['GP','PTS','AST'],totals:['4','27.0','10.2']}]}:{}
  return new Response(JSON.stringify(body),{status:200,
    headers:{'content-type':'application/json'}})
 }
 const result=await collectDirectEspnStats('basketball','nba',
   [{id:'18',name:'New York Knicks'}],transport,Date.now(),1)
 assert.equal(result.errors,0)
 assert.equal(result.teams.length,1)
 const team=result.teams[0],p=team.athletes[0]
 assert.equal(team.athleteCount,1)
 assert.ok(team.stats.some(x=>x.name==='Offensive Rating'&&x.value==='118.2'))
 assert.ok(team.stats.some(x=>x.name==='Defensive Rating'&&x.value==='112.4'))
 assert.ok(team.stats.some(x=>x.name==='Pace'&&x.value==='99.8'))
 assert.ok(p.stats.some(x=>x.name==='PTS'&&x.value==='25.3'))
 assert.ok(p.stats.some(x=>x.name==='AST'&&x.value==='9.0'))
 assert.ok(p.lastGames.some(x=>/Cavaliers vs Knicks/.test(x.name)&&/29/.test(x.value)))
 assert.ok(p.splits.some(x=>x.name==='PTS'&&x.value==='27.0'))
 assert.equal(p.status,'verified')
 assert.ok(seen.some(u=>u.includes('/athletes/4683730/stats')))
 assert.ok(!seen.some(u=>u.includes('/athletes/123456/')))
})

test('an unrelated season total does not masquerade as an individual recent game',async()=>{
 const transport=async url=>{
  const u=String(url)
  const body=u.endsWith('/roster')?{athletes:[{id:'55',
    displayName:'True Player',position:{abbreviation:'G'}}]}:
   u.endsWith('/stats')?{categories:[{labels:['PTS'],totals:['15.0']}]}:
   u.endsWith('/gamelog')?{categories:[{labels:['PTS'],totals:['15.0']}]}:{}
  return new Response(JSON.stringify(body),{status:200})
 }
 const result=await collectDirectEspnStats('basketball','nba',
   [{id:'18',name:'NY Knicks'}],transport,Date.now(),1)
 const athlete=result.teams[0].athletes[0]
 assert.equal(athlete.stats[0].value,'15.0')
 assert.deepEqual(athlete.lastGames,[])
 assert.equal(athlete.status,'partial')
})
