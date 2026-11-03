import {test} from 'node:test'
import assert from 'node:assert/strict'
import {researchNbaSlate} from '../src/nba-research.ts'
const date='2026-10-28'
const today='2026-10-28T23:00:00Z'
const fixture={events:[{id:'9001',date:today,status:{type:{state:'pre'}},competitions:[{competitors:[
  {homeAway:'home',team:{id:'10',displayName:'Atlanta Hawks'},records:[{summary:'4-1'}]},
  {homeAway:'away',team:{id:'11',displayName:'Miami Heat'},records:[{summary:'2-3'}]},
]}]}]}
const past=(id,day,homeScore,awayScore)=>({id:String(id),date:day+'T23:00:00Z',status:{type:{state:'post'}},competitions:[{competitors:[
  {homeAway:'home',team:{id:'10',displayName:'Atlanta Hawks'},score:String(homeScore)},
  {homeAway:'away',team:{id:'11',displayName:'Miami Heat'},score:String(awayScore)},
]}]})
const days={'20261027':past(100,'2026-10-27',110,108),'20261026':past(101,'2026-10-26',107,98),'20261025':past(102,'2026-10-25',88,94)}
const mock=async url=>{
  const key=String(url).split('dates=')[1]
  return new Response(JSON.stringify(key==='20261028'?fixture:{events:days[key]?[days[key]]:[]}),{status:200})
}
test('NBA report builds actual form from completed games instead of fabricated percentages',async()=>{
  const report=await researchNbaSlate(date,'9001',mock,Date.parse('2026-10-28T12:00:00Z'),{},4)
  const match=report.matches[0]
  assert.equal(report.daysRetrieved,4)
  assert.equal(match.sampleAdequate,true)
  assert.equal(match.home.recentWins,2)
  assert.equal(match.home.recentLosses,1)
  assert.equal(match.home.recentAverageMargin,1.67)
  assert.equal(match.away.recentWins,1)
  assert.equal(match.home.recentResults[0].eventId,'100')
  assert.equal(match.missing.some(x=>x.includes('Lesiones')),true)
  assert.equal(match.evidenceStatus,'limited')
  assert.match(report.note,/no predicciones/i)
})
test('NBA report marks incomplete archives as insufficient and does not award form for missing scores',async()=>{
  const fetcher=async url=>{
    const key=String(url).split('dates=')[1]
    if(key==='20261026')throw new Error('provider unavailable')
    return mock(url)
  }
  const report=await researchNbaSlate(date,'9001',fetcher,Date.parse('2026-10-28T12:00:00Z'),{},4)
  assert.equal(report.daysRetrieved,3)
  assert.equal(report.matches[0].sampleAdequate,false)
  assert.equal(report.matches[0].evidenceStatus,'insufficient')
})
test('NBA report rejects invented matches and invalid dates before recommending anything',async()=>{
  await assert.rejects(()=>researchNbaSlate('2026-02-31','9001',mock),/Fecha/)
  await assert.rejects(()=>researchNbaSlate(date,'NOT-REAL',mock),/ID/)
  await assert.rejects(()=>researchNbaSlate(date,'9002',mock,Date.parse('2026-10-28T12:00:00Z')),/No hay partidos/)
  await assert.rejects(()=>researchNbaSlate(date,'9001',mock,Date.parse('2026-10-28T12:00:00Z'),{PHOENIX_SPORTS_ESPN_DISABLED:'1'}),/deshabilitado/)
})
