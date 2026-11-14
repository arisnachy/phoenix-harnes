import {test} from 'node:test'
import assert from 'node:assert/strict'
import {SPORTS_SOURCE_RESEARCH,nbaOfficialInjuryPdf,
  auditInjuryTimeline,auditCapturedBacktest}
  from '../src/sports-pregame-research.ts'

const a='https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-13_11_45AM.pdf'
const b='https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-13_06_45PM.pdf'
const morning='2026-11-13T16:45:00Z'
const evening='2026-11-13T23:45:00Z'
const cutoff='2026-11-13T23:50:00Z'
const firstTip='2026-11-14T00:00:00Z'
const snaps=[
  {team:'Indiana Pacers',athlete:'Aaron Nesmith',status:'Questionable',
    publishedAt:morning,url:a,important:true},
  {team:'Indiana Pacers',athlete:'Aaron Nesmith',status:'Available',
    publishedAt:evening,url:b,important:true},
  {team:'Chicago Bulls',athlete:'Norman Powell',status:'Questionable',
    publishedAt:morning,url:a,important:true},
  {team:'Chicago Bulls',athlete:'Norman Powell',status:'Questionable',
    publishedAt:evening,url:b,important:true},
]
test('source catalog has auditable official NBA report and ESPN fallback',()=>{
  assert.ok(SPORTS_SOURCE_RESEARCH.some(x=>x.id==='nba-official-pdf'&&x.format==='pdf'))
  assert.ok(SPORTS_SOURCE_RESEARCH.some(x=>x.id==='espn-nba-injuries'&&x.format==='json'))
  assert.equal(nbaOfficialInjuryPdf('2026-11-13','11:45'),a)
  assert.equal(nbaOfficialInjuryPdf('2026-11-13','18:45'),b)
  assert.throws(()=>nbaOfficialInjuryPdf('2026-11-13','18:31'))
})
test('November 13 NBA official snapshot transitions are discoverable without inferring wins',()=>{
  const r=auditInjuryTimeline(snaps,{
    decisionAt:cutoff,kickoffAt:firstTip,mode:'reconstruction'})
  assert.equal(r.changes.length,1)
  assert.equal(r.changes[0].athlete,'Aaron Nesmith')
  assert.equal(r.changes[0].previous,'questionable')
  assert.equal(r.changes[0].current,'available')
  assert.equal(r.pending.length,1)
  assert.equal(r.pending[0].athlete,'Norman Powell')
  assert.equal(r.requiresReevaluation,true)
  assert.match(r.warning,/NO prueba/)
})
test('future information cannot leak into retrospective as-of snapshot',()=>{
  const r=auditInjuryTimeline(snaps,{decisionAt:'2026-11-13T17:00:00Z',
    kickoffAt:firstTip,mode:'reconstruction'})
  assert.equal(r.changes.length,0)
  assert.equal(r.excludedFuture,2)
  assert.equal(r.pending.length,2)
})
test('reconstruction does not masquerade as real-time captured evidence',()=>{
  const r=auditInjuryTimeline(snaps,{decisionAt:cutoff,
    kickoffAt:firstTip,mode:'prospective'})
  assert.equal(r.changes.length,0)
  assert.equal(r.excludedUncaptured,4)
  const simulated=snaps.map(s=>({...s,capturedAt:s.publishedAt}))
  const valid=auditInjuryTimeline(simulated,{
    decisionAt:cutoff,kickoffAt:firstTip,mode:'prospective'})
  assert.equal(valid.changes.length,1)
})
test('pre-game outcomes give Brier only when true forecasts were captured',()=>{
  const valid={eventKey:'g1',featuresThroughAt:morning,decisionAt:cutoff,
    kickoffAt:firstTip,outcomePublishedAt:'2026-11-14T03:30:00Z',
    result:'lost',modelProbability:0.75,marketProbabilityNoVig:0.73}
  const impossible={...valid,eventKey:'g2',featuresThroughAt:
    '2026-11-14T02:00:00Z',result:'won'}
  const r=auditCapturedBacktest([valid,impossible])
  assert.equal(r.eligible,1)
  assert.equal(r.rejected,1)
  assert.equal(r.hitRate,0)
  assert.equal(r.modelBrier,0.5625)
  assert.equal(r.calibrationValidated,false)
})
