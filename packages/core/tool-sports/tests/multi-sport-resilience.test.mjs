import {test} from 'node:test'
import assert from 'node:assert/strict'
import {researchSport} from '../src/multi-sport-research.ts'

const day='2026-11-08',now=Date.parse('2026-11-08T12:00:00Z')
const event=(id,date,state,homeScore,awayScore)=>({
  id:String(id),date,status:{type:{state}},
  competitions:[{competitors:[
    {homeAway:'home',team:{id:'111',displayName:'Home Club'},
      ...(homeScore===null?{}:{score:String(homeScore)})},
    {homeAway:'away',team:{id:'222',displayName:'Away Club'},
      ...(awayScore===null?{}:{score:String(awayScore)})},
  ]}],
})
function provider(successDays){
  return async url=>{
    const d=String(url).match(/dates=(\d{8})/u)?.[1]
    if(d==='20261108')return new Response(JSON.stringify({events:[
      event(100,'2026-11-08T19:00:00Z','pre',null,null)]}))
    const dayNum=Number(d?.slice(-2))
    const diff=8-dayNum
    if(successDays.includes(dayNum)){
      return new Response(JSON.stringify({events:[
        event(200+dayNum,'2026-11-'+d.slice(-2)+'T19:00:00Z','post',3,0)]}))
    }
    return new Response('service unavailable',{status:503})
  }
}
test('one to three failed archive days do not veto five independently completed games',async()=>{
  const r=await researchSport('soccer','eng.1',day,
    provider([7,6,5,4,3]),now,{},8)
  assert.equal(r.failedDays,3)
  assert.equal(r.matches.length,1)
  assert.equal(r.matches[0].home.completedGames,5)
  assert.equal(r.matches[0].away.completedGames,5)
  assert.equal(r.matches[0].evidence,'descriptive')
  assert.match(r.matches[0].limitations.join(' '),/Cobertura parcial: 5\/8/)
})
test('four games remain insufficient even if ESPN returned enough days',async()=>{
  const r=await researchSport('soccer','eng.1',day,
    provider([7,6,5,4]),now,{},8)
  assert.equal(r.matches[0].evidence,'insufficient')
  assert.match(r.matches[0].limitations.join(' '),/requieren 5 partidos/)
})
