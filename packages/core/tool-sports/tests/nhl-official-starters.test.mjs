import {test} from 'node:test'
import assert from 'node:assert/strict'
import {probeNhlOfficialStarters} from '../src/nhl-official-starters.ts'

const kickoff='2026-11-15T01:00:00Z'
const now=Date.parse('2026-11-14T19:00:00Z')
const opts={gameId:'2026020314',homeAbbrev:'TOR',awayAbbrev:'EDM',kickoff}
const template=(state='FUT')=>({
  id:2026020314,gameState:state,homeTeam:{abbrev:'TOR'},
  awayTeam:{abbrev:'EDM'},
  playerByGameStats:{homeTeam:{goalies:[]},awayTeam:{goalies:[]}},
})
const get=(payload)=>async()=>new Response(JSON.stringify(payload),{
  status:200,headers:{'Content-Type':'application/json'}})
test('only explicit pregame official starter flags count',async()=>{
  const payload=template()
  payload.playerByGameStats.homeTeam.goalies=[
    {firstName:{default:'Joseph'},lastName:{default:'Woll'},starter:true},
    {firstName:{default:'Anthony'},lastName:{default:'Stolarz'},starter:false}]
  payload.playerByGameStats.awayTeam.goalies=[
    {firstName:{default:'Stuart'},lastName:{default:'Skinner'},isStarter:true}]
  const r=await probeNhlOfficialStarters(opts,get(payload),now)
  assert.equal(r.state,'confirmed')
  assert.equal(r.homeGoalie,'Joseph Woll')
  assert.equal(r.awayGoalie,'Stuart Skinner')
  assert.match(r.url,/gamecenter\/2026020314\/boxscore$/)
})
test('a goalie listed on the roster does not imply a confirmed starter',async()=>{
  const payload=template()
  payload.playerByGameStats.homeTeam.goalies=[{firstName:'Joseph',lastName:'Woll'}]
  payload.playerByGameStats.awayTeam.goalies=[{firstName:'Stuart',lastName:'Skinner'}]
  const r=await probeNhlOfficialStarters(opts,get(payload),now)
  assert.equal(r.state,'not-published')
  assert.equal(r.homeGoalie,null)
})
test('wrong NHL ID or local/visitor never enters the selected ticket',async()=>{
  const wrongId=template();wrongId.id=2026020222
  assert.equal((await probeNhlOfficialStarters(opts,get(wrongId),now)).state,
    'identity-conflict')
  const wrongTeam=template();wrongTeam.awayTeam.abbrev='NYR'
  assert.equal((await probeNhlOfficialStarters(opts,get(wrongTeam),now)).state,
    'identity-conflict')
})
test('postkickoff requests never fetch current boxscore as a pregame source',async()=>{
  let called=0
  const r=await probeNhlOfficialStarters(opts,async()=>{
    called++;throw Error('no fetching allowed')
  },Date.parse('2026-11-15T01:05:00Z'))
  assert.equal(r.state,'not-pregame')
  assert.equal(called,0)
})
test('no gamecenter record is unavailable, not a healthy or confirmed team',async()=>{
  const r=await probeNhlOfficialStarters(opts,async()=>new Response('error',{status:503}),now)
  assert.equal(r.state,'unavailable')
})

test('HTTP 404 pregame NHL boxscore is not published, NOT a network outage',async()=>{
  const fixture={gameId:'2026020314',homeAbbrev:'TOR',awayAbbrev:'EDM',
    kickoff:'2026-11-20T23:00:00Z'}
  const read=async()=>new Response('No boxscore before faceoff',{status:404})
  const result=await probeNhlOfficialStarters(fixture,read,
    Date.parse('2026-11-16T13:00:00Z'))
  assert.equal(result.state,'not-published')
  assert.match(result.note,/404/)
  assert.equal(result.homeGoalie,null)
  assert.equal(result.awayGoalie,null)
})

test('pregame NHL boxscore scratches preserve team-scoped official NHL IDs',async()=>{
  const payload=template()
  payload.playerByGameStats.homeTeam.scratches=[
    {playerId:8478402,firstName:{default:'Connor'},lastName:{default:'McDavid'}}]
  payload.playerByGameStats.awayTeam.scratches=[8481234]
  const x=await probeNhlOfficialStarters(opts,get(payload),now)
  assert.equal(x.state,'not-published','goalies remain unconfirmed')
  assert.deepEqual(x.scratches.home,[{playerId:'8478402',name:'Connor McDavid'}])
  assert.deepEqual(x.scratches.away,[{playerId:'8481234',name:null}])
  assert.equal(x.homeGoalie,null)
})
