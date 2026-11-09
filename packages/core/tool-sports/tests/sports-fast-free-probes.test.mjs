import {test} from 'node:test'
import assert from 'node:assert/strict'
import {probeFastFreeSports} from '../src/sports-fast-free-probes.ts'
const day='2026-11-08'
const now=Date.parse('2026-11-08T16:00:00Z')
const mock=async(input)=>{
  const url=String(input)
  if(url.includes('/basketball/nba/'))return Response.json({events:[{id:'NBA-1'}]})
  if(url.includes('/football/nfl/'))return Response.json({events:[]})
  if(url.includes('/soccer/mex.1/'))return Response.json({events:[{id:'MX-1'}]})
  if(url.includes('statsapi.mlb.com'))return Response.json({dates:[{games:[{gamePk:44}]}]})
  if(url.includes('api-web.nhle.com'))return Response.json({games:[]})
  if(url.includes('thesportsdb.com'))return Response.json({events:null})
  throw Error('Unexpected public source '+url)
}
test('free public sports probes separate observed, off-season empty and price unverified',async()=>{
  const out=await probeFastFreeSports(day,mock,now,{})
  assert.equal(out.sources.length,6)
  assert.equal(out.observed,3)
  assert.equal(out.empty,3)
  assert.equal(out.unavailable,0)
  assert.equal(out.disabled,0)
  assert.equal(out.sources.find(x=>x.provider==='MLB StatsAPI')?.records,1)
  assert.equal(out.sources.find(x=>x.discipline==='NHL')?.status,'empty')
  assert.match(out.instruction,/NO lesiones, titulares, cuotas/)
  assert.ok(out.sources.every(x=>x.endpoint.startsWith('https://')&&x.checkedAt))
})
test('ESPN opt-out never triggers a fetch; other feeds stay readable',async()=>{
  const seen=[]
  const out=await probeFastFreeSports(day,async url=>{seen.push(String(url));return mock(url)},
    now,{PHOENIX_SPORTS_ESPN_DISABLED:'1'})
  assert.equal(out.disabled,3)
  assert.ok(seen.every(url=>!url.includes('site.api.espn.com')))
  assert.equal(out.sources.find(x=>x.discipline==='MLB')?.status,'observed')
})
test('HTTP 401 and malformed schemas are unavailable, not no-games or valid quotes',async()=>{
  const out=await probeFastFreeSports(day,async url=>{
    if(String(url).includes('api-web.nhle.com'))return new Response('Unauthorized',{status:401})
    if(String(url).includes('thesportsdb.com'))return Response.json({error:'bad schema'})
    return mock(url)
  },now,{})
  assert.equal(out.unavailable,2)
  assert.match(out.sources.find(x=>x.discipline==='NHL')?.detail??'',/401/)
  assert.match(out.sources.find(x=>x.provider==='TheSportsDB')?.detail??'',/Esquema/)
})
test('invalid date is rejected before any provider fetch',async()=>{
  let queried=false
  await assert.rejects(()=>probeFastFreeSports('2026-02-31',async()=>{queried=true;
    throw Error('must not request')},now,{}),/Fecha inválida/)
  assert.equal(queried,false)
})
