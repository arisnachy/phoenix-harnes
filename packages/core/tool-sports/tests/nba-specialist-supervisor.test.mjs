import {test} from 'node:test'
import assert from 'node:assert/strict'
import {researchNbaWithSpecialists} from '../src/nba-specialist-supervisor.ts'
import {researchNbaSlate} from '../src/nba-research.ts'

const date='2026-10-28',now=Date.parse('2026-10-28T12:00:00Z')
const fixture={events:[{id:'9001',date:'2026-10-28T23:00:00Z',
  status:{type:{state:'pre'}},competitions:[{competitors:[
    {homeAway:'home',team:{id:'10',displayName:'Atlanta Hawks'},records:[{summary:'4-1'}]},
    {homeAway:'away',team:{id:'11',displayName:'Miami Heat'},records:[{summary:'2-3'}]},
  ]}]}]}
const past=(day)=>({id:'8'+day.replaceAll('-',''),date:day+'T23:00:00Z',
  season:{type:2},status:{type:{state:'post'}},competitions:[{competitors:[
    {homeAway:'home',team:{id:'10',displayName:'Atlanta Hawks'},score:'112'},
    {homeAway:'away',team:{id:'11',displayName:'Miami Heat'},score:'101'},
  ]}]})
const mocked=async url=>{
  const u=String(url),match=u.match(/scoreboard\?dates=(\d{8})/)
  if(match){
    const d=match[1],day=d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8)
    return new Response(JSON.stringify(d==='20261028'?fixture:
      {events:d>='20261024'&&d<='20261027'?[past(day)]:[]}),{status:200})
  }
  // The specialist must not interpret generic HTTP 200 as verified NBA data.
  return new Response(JSON.stringify({events:[]}),{status:200})
}
test('NBA research invokes real specialist and produces the full 22-step per-game audit',async()=>{
  const report=await researchNbaWithSpecialists(date,'9001',mocked,now,{},5)
  const match=report.matches[0]
  assert.equal(report.researchCoverage.expectedStepsPerMatch,22)
  assert.equal(report.researchCoverage.auditedMatches,1)
  assert.equal(match.specialistResearch.checklist.fullSteps.length,22)
  assert.equal(match.specialistResearch.checklist.fullComplete,false)
  assert.equal(match.specialistResearch.approvedForBetting,false)
  assert.ok(report.sourceAudit.some(x=>x.url.includes('scoreboard?dates=20261028')))
  assert.ok(match.specialistResearch.sourceChecks!==undefined||
    match.specialistResearch.status==='unavailable')
  const b04=match.specialistResearch.checklist.fullSteps.find(x=>x.key==='B04')
  assert.notEqual(b04?.state,'verified')
})
test('NBA audit distinguishes endpoint errors from valid empty historical scoreboards',async()=>{
  const fetcher=async url=>{
    if(String(url).includes('scoreboard?dates=20261026'))throw Error('offline NBA archive')
    return mocked(url)
  }
  const report=await researchNbaSlate(date,'9001',fetcher,now,{},5)
  const failed=report.sourceAudit.find(x=>x.url.includes('20261026'))
  assert.equal(failed?.status,'error')
  assert.match(failed?.detail??'',/offline NBA archive/)
  assert.ok(report.sourceAudit.some(x=>x.status==='empty'))
  assert.ok(report.sourceAudit.some(x=>x.status==='verified'))
})
