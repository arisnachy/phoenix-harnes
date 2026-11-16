import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseNhlRightRailScratches,probeNhlPregameScratches} from '../src/nhl-pregame-scratches.ts'
const args={gameId:'2026020314',homeAbbrev:'TOR',awayAbbrev:'EDM',
  kickoff:'2026-11-18T01:00:00Z'}
const now=Date.parse('2026-11-17T23:45:00Z')
const payload=()=>({gameId:2026020314,gameState:'FUT',gameInfo:{
  homeTeam:{abbrev:'TOR',scratches:[
    {id:8471111,firstName:{default:'John'},lastName:{default:'Example'}},
    {id:8471112,firstName:'A',lastName:'Player'}]},
  awayTeam:{abbrev:'EDM',scratches:[
    {id:8472222,firstName:{default:'Away'},lastName:{default:'Scratch'}}]}}})
test('right-rail returns dated observations, never healthy or final lineups',()=>{
  const r=parseNhlRightRailScratches(payload(),args,now)
  assert.equal(r.state,'observed')
  assert.equal(r.home.length,2)
  assert.equal(r.home[0].name,'John Example')
  assert.equal(r.away[0].id,'8472222')
  assert.equal(r.away[0].availability,'scratch-observed')
  assert.equal(r.officialFinalLineup,false)
  assert.equal(r.publishedAt,null)
  assert.match(r.url,/\/right-rail$/)
})
test('both explicit empty arrays are observed, not proof of healthy roster',()=>{
  const p=payload()
  p.gameInfo.homeTeam.scratches=[]
  p.gameInfo.awayTeam.scratches=[]
  const r=parseNhlRightRailScratches(p,args,now)
  assert.equal(r.state,'observed')
  assert.deepEqual(r.home,[])
  assert.equal(r.officialFinalLineup,false)
})
test('missing one team, unstructured data, identity swap do not pass',()=>{
  const one=payload();delete one.gameInfo.awayTeam.scratches
  assert.equal(parseNhlRightRailScratches(one,args,now).state,'not-published')
  const wrong=payload();wrong.gameId=2026020900
  assert.equal(parseNhlRightRailScratches(wrong,args,now).state,'identity-conflict')
  const swapped=payload();swapped.gameInfo.homeTeam.abbrev='EDM'
  assert.equal(parseNhlRightRailScratches(swapped,args,now).state,'identity-conflict')
})
test('postgame snapshot cannot masquerade as pregame',()=>{
  const f=async()=>{throw Error('do not fetch')}
  assert.equal(parseNhlRightRailScratches(payload(),args,Date.parse(args.kickoff)).state,
    'not-pregame')
  return probeNhlPregameScratches(args,f,Date.parse(args.kickoff)).then(x=>{
    assert.equal(x.state,'not-pregame')
  })
})
test('right-rail 404 is unpublished rather than a confirmed empty list',async()=>{
  const r=await probeNhlPregameScratches(args,
    async()=>new Response('',{status:404}),now)
  assert.equal(r.state,'not-published')
})
test('HTTP errors and malformed JSON are not scratch evidence',async()=>{
  const bad=await probeNhlPregameScratches(args,
    async()=>new Response('error',{status:503}),now)
  assert.equal(bad.state,'unavailable')
  const badJson=await probeNhlPregameScratches(args,
    async()=>new Response('error',{status:200}),now)
  assert.equal(badJson.state,'unavailable')
})
test('probe preserves gameId, teams and observed timestamp',async()=>{
  const r=await probeNhlPregameScratches(args,
    async()=>new Response(JSON.stringify(payload()),{status:200}),now)
  assert.equal(r.state,'observed')
  assert.equal(r.checkedAt,new Date(now).toISOString())
})
