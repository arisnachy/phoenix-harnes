import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseEspnGameLog,parseEspnSplits,parseNhlLast5}
  from '../src/espn-player-history.ts'
import {parseNhlSeasonGameLog} from '../src/nhl-player-game-history.ts'
import {collectDirectEspnStats} from '../src/sports-direct-stats.ts'

const now=Date.parse('2026-11-12T16:00:00Z')
const event=(id,day,pts,ast)=>({eventId:String(id),stats:['32','4','8',String(ast),String(pts)]})
const rawLog={
  labels:['MIN','REB','FG','AST','PTS'],
  events:{
    '401800001':{id:'401800001',gameDate:'2026-11-08T01:00Z',
      name:'Toronto at Philadelphia',opponent:{abbreviation:'TOR'}},
    '401800002':{id:'401800002',gameDate:'2026-11-10T01:00Z',
      name:'Philadelphia at Boston',opponent:{abbreviation:'BOS'}},
    '401800003':{id:'401800003',gameDate:'2026-11-14T01:00Z',
      name:'Philadelphia at Chicago'},
  },
  seasonTypes:[{displayName:'Regular Season',categories:[
    {name:'general',events:[
      event(401800001,'2026-11-08',18,4),
      event(401800002,'2026-11-10',22,7),
      event(401800003,'2026-11-14',90,14),
    ]},
  ]}],
}
test('real ESPN v3 root.labels + events metadata + seasonTypes categories no longer lose all gamelogs',()=>{
  const items=parseEspnGameLog(rawLog,now)
  assert.equal(items.length,2)
  assert.equal(items[0].name,'Philadelphia at Boston')
  assert.match(items[0].value,/PTS: 22/)
  assert.match(items[0].value,/AST: 7/)
  assert.match(items[1].value,/PTS: 18/)
  assert.ok(items.every(x=>!x.value.includes('90')))
})
test('gamelog reads category local headers and direct event-array format too',()=>{
  const nested={events:{'500':{date:'2026-11-09T00:00:00Z'}},
    seasonTypes:[{categories:[{labels:['PTS','AST'],
      events:[{eventId:'500',stats:['10','8']}]}]}]}
  assert.match(parseEspnGameLog(nested,now)[0].value,/AST: 8/)
  const direct={labels:['PTS','AST'],events:[{id:'501',date:'2026-11-08T00:00:00Z',
    stats:['12','6']}]}
  assert.equal(parseEspnGameLog(direct,now)[0].value,'PTS: 12 · AST: 6')
  assert.deepEqual(parseEspnGameLog({categories:[{totals:['25']}]},now),[])
})
test('NBA splits retain HOME and AWAY duplicates independently',()=>{
  const data={categories:[{name:'home',displayName:'Home',
    labels:['GP','PTS','REB','AST'],totals:['6','29.4','8.2','6.3']},
    {name:'away',displayName:'Away',
      labels:['GP','PTS','REB','AST'],totals:['5','18.0','4.1','8.9']}]}
  const x=parseEspnSplits(data)
  assert.equal(x.length,8)
  assert.equal(x.find(y=>y.name==='Home · PTS')?.value,'29.4')
  assert.equal(x.find(y=>y.name==='Away · PTS')?.value,'18.0')
  assert.equal(x.find(y=>y.name==='Away · AST')?.value,'8.9')
})
test('nested NHL/ESPN situational splits preserve category and cap records',()=>{
  const x=parseEspnSplits({splitCategories:[
    {displayName:'Home/Road',splits:[
      {displayName:'Home',labels:['GP','PTS'],totals:['11','23']},
      {displayName:'Road',labels:['GP','PTS'],totals:['10','17']},
    ]}]})
  assert.equal(x.find(v=>v.name==='Home/Road · Home · PTS')?.value,'23')
  assert.equal(x.find(v=>v.name==='Home/Road · Road · PTS')?.value,'17')
  assert.equal(parseEspnSplits({categories:[{labels:['PTS','REB'],
    totals:['14'] }]}).length,0)
})
test('NHL official game-log yields real 20-game rows and exact per-venue averages',()=>{
  const games=[
    {gameId:2026020001,gameDate:'2026-11-01',homeRoadFlag:'H',
      opponentAbbrev:'BOS',goals:2,assists:1,points:3,shots:7},
    {gameId:2026020002,gameDate:'2026-11-05',homeRoadFlag:'R',
      opponentAbbrev:'NYR',goals:0,assists:2,points:2,shots:3},
    {gameId:2026020003,gameDate:'2026-11-08',homeRoadFlag:'H',
      opponentAbbrev:'NYI',goals:1,assists:0,points:1,shots:2},
    {gameId:2026020004,gameDate:'2026-11-13',homeRoadFlag:'H',
      goals:14,points:14},
  ]
  const p=parseNhlSeasonGameLog({gameLog:games},now)
  assert.equal(p.games.length,3)
  assert.equal(p.games[0].date,'2026-11-08')
  assert.equal(p.splits.home.games,2)
  assert.equal(p.splits.away.games,1)
  assert.equal(p.splits.home.averages.goals,1.5)
  assert.equal(p.splits.away.averages.goals,0)
  assert.equal(p.splits.away.averages.points,2)
  assert.deepEqual(parseNhlSeasonGameLog({},now),{games:[],splits:{home:null,away:null}})
})
test('NHL player landing last5 never interprets season totals as a gamelog',()=>{
  const r=parseNhlLast5({featuredStats:{goals:22},
    last5Games:[{gameDate:'2026-11-10',goals:1,assists:2}]},now)
  assert.equal(r.length,1)
  assert.match(r[0].value,/goals: 1/)
  assert.deepEqual(parseNhlLast5({featuredStats:{goals:22}},now),[])
})
test('full direct ESPN adapter now returns actual NBA gamelogs and both home/road splits',async()=>{
  const urls=[]
  const fetcher=async url=>{
    const u=String(url);urls.push(u)
    let body={}
    if(u.endsWith('/teams/20/roster'))body={athletes:[{
      id:'1234',displayName:'Roster-confirmed athlete',position:{abbreviation:'F'}}]}
    else if(u.endsWith('/athletes/1234/stats'))body={
      categories:[{labels:['PTS','REB'],totals:['24.4','5.8']}]}
    else if(u.endsWith('/athletes/1234/gamelog'))body=rawLog
    else if(u.endsWith('/athletes/1234/splits'))body={
      categories:[{displayName:'Home',labels:['PTS'],totals:['29.4']},
        {displayName:'Away',labels:['PTS'],totals:['18.0']}]}
    return new Response(JSON.stringify(body),{status:200})
  }
  const d=await collectDirectEspnStats('basketball','nba',
    [{id:'20',name:'Philadelphia 76ers'}],fetcher,now,1)
  const a=d.teams[0].athletes[0]
  assert.equal(a.lastGames.length,2)
  assert.equal(a.splits.length,2)
  assert.ok(a.verifiedSources.includes('gamelog'))
  assert.ok(a.verifiedSources.includes('splits'))
  assert.equal(a.coverage.find(x=>x.endpoint==='gamelog')?.status,'available')
  assert.equal(a.coverage.find(x=>x.endpoint==='splits')?.status,'available')
  assert.equal(a.splits[1].name,'Away · PTS')
  assert.ok(urls.some(x=>x.endsWith('/gamelog')))
})
test('ESPN NHL 404 gamelog route is not retried as if athlete ID were an NHL ID',async()=>{
  const calls=[]
  const fetcher=async url=>{const u=String(url);calls.push(u)
    return new Response(JSON.stringify(u.endsWith('/roster')?{athletes:[
      {id:'801',displayName:'ESPN NHL athlete',position:{abbreviation:'G'}}]}:{}))}
  const d=await collectDirectEspnStats('hockey','nhl',
    [{id:'6',name:'Boston Bruins'}],fetcher,now,1)
  assert.equal(d.teams[0].athletes[0].lastGames.length,0)
  assert.ok(calls.every(u=>!u.includes('/athletes/801/gamelog')))
  assert.ok(calls.every(u=>!u.includes('/v1/player/801/')))
})


test('full 82-game season preserves the most recent twenty games, not first twenty returned',()=>{
  const base=Date.parse('2026-09-01T00:00:00Z')
  const eightyTwo=Array.from({length:82},(_,i)=>{
    const when=new Date(base+i*86400000).toISOString()
    return{eventId:String(600000000+i),stats:[String(i)]}
  })
  const meta=Object.fromEntries(eightyTwo.map((x,i)=>[x.eventId,{
    name:'Game #'+i,date:new Date(base+i*86400000).toISOString(),
  }]))
  const result=parseEspnGameLog({labels:['PTS'],events:meta,
    seasonTypes:[{categories:[{events:eightyTwo}]}]},
    Date.parse('2026-12-31T00:00:00Z'))
  assert.equal(result.length,20)
  assert.equal(result[0].name,'Game #81')
  assert.equal(result[19].name,'Game #62')
})


test('NBA recovers season-scoped gamelog and splits when default 200 is empty',async()=>{
  const calls=[]
  const fetcher=async url=>{
    const u=String(url);calls.push(u)
    let body={}
    if(u.endsWith('/teams/20/roster'))
      body={athletes:[{id:'123',displayName:'Verified Player',position:{abbreviation:'G'}}]}
    else if(u.endsWith('/athletes/123/stats'))
      body={categories:[{labels:['PTS'],totals:['21.0']}]}
    else if(u.endsWith('/athletes/123/gamelog?season=2027'))
      body={labels:['PTS'],events:{'900':{gameDate:'2026-11-05T23:00:00Z',
        name:'Prior played game'}},seasonTypes:[{categories:[{
          events:[{eventId:'900',stats:['21']}]}]}]}
    else if(u.endsWith('/athletes/123/splits?season=2027'))
      body={categories:[{displayName:'Home',labels:['PTS'],totals:['24']},
        {displayName:'Away',labels:['PTS'],totals:['19']}]}
    return new Response(JSON.stringify(body))
  }
  const d=await collectDirectEspnStats('basketball','nba',
    [{id:'20',name:'Philadelphia 76ers'}],fetcher,now,1)
  const a=d.teams[0].athletes[0]
  assert.equal(a.lastGames.length,1)
  assert.equal(a.splits.length,2)
  assert.equal(a.verifiedSources.includes('gamelog:season=2027'),true)
  assert.equal(a.verifiedSources.includes('splits:season=2027'),true)
  assert.ok(calls.some(x=>x.endsWith('/gamelog?season=2027')))
  assert.ok(calls.some(x=>x.endsWith('/splits?season=2027')))
})
