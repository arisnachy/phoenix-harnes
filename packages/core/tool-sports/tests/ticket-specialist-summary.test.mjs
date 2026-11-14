import {test} from 'node:test'
import assert from 'node:assert/strict'
import {summarizeTicketSpecialist,needsSelectedSpecialistRecheck}
  from '../src/ticket-specialist-summary.ts'

const nba={sport:'basketball',league:'nba',eventId:'401903773',
  specialist:'NBA/WNBA',status:'researched',approvedForBetting:false,
  checkedAt:'2026-11-13T18:00:00Z',
  verifiedSteps:['Roster 28 players','Last 10 games'],
  pendingSteps:['Official starters not yet published'],
  checklist:{complete:false,verified:3,partial:1,missing:1,
    criticalPending:['Quintetos y rotaciones confirmados',
      'Lesiones, descansos y bajas actualizadas'],
    steps:[
      {key:'fixture',state:'verified'},
      {key:'form',state:'verified'},
      {key:'rosters',state:'verified'},
      {key:'starters',state:'missing'},
      {key:'injuries',state:'partial'},
    ]},
  injuryAudit:{status:'partial',source:'ESPN',home:{},away:{}}}

test('researched NBA with actual roster and form is partial, never no dossier',()=>{
  const summary=summarizeTicketSpecialist(nba,'basketball')
  assert.equal(summary.state,'partial')
  assert.equal(summary.verified,3)
  assert.equal(summary.partial,1)
  assert.equal(summary.missing,1)
  assert.match(summary.detail,/Expediente NBA\/WNBA parcial/)
  assert.match(summary.detail,/3 controles verificados/)
  assert.ok(summary.pendingEvidence.some(x=>x.includes('Quintetos:')))
  assert.ok(summary.pendingEvidence.some(x=>x.includes('ESPN consultado')))
  assert.doesNotMatch(summary.detail,/sin expediente especializado/i)
})

test('no specialist audit means unavailable, not researched',()=>{
  const summary=summarizeTicketSpecialist(undefined,'basketball')
  assert.equal(summary.state,'unavailable')
  assert.match(summary.detail,/Investigación especializada no completada/)
  assert.ok(summary.pendingEvidence.some(x=>x.includes('Quintetos:')))
})

test('a specialist timeout reports the concrete failure',()=>{
  const summary=summarizeTicketSpecialist({...nba,status:'unavailable',
    verifiedSteps:[],checklist:undefined,
    pendingSteps:['Límite de investigación (18000 ms) alcanzado']},'basketball')
  assert.equal(summary.state,'unavailable')
  assert.match(summary.detail,/18000 ms/)
})

test('documented NBA requires actual checklist completion',()=>{
  const review={...nba,checklist:{...nba.checklist,complete:true,
    criticalPending:[],steps:nba.checklist.steps.map(x=>({
      ...x,state:'verified'}))}}
  const summary=summarizeTicketSpecialist(review,'basketball')
  assert.equal(summary.state,'documented')
  assert.equal(summary.verified,5)
})

test('selected NBA receives a full pass after short incomplete preflight',()=>{
  assert.equal(needsSelectedSpecialistRecheck({sport:'basketball'},nba),true)
  assert.equal(needsSelectedSpecialistRecheck({sport:'basketball'},
    {...nba,checklist:{...nba.checklist,complete:true}}),false)
  assert.equal(needsSelectedSpecialistRecheck({sport:'hockey'},nba),false)
  assert.equal(needsSelectedSpecialistRecheck({sport:'hockey'},
    {...nba,status:'unavailable'}),true)
  assert.equal(needsSelectedSpecialistRecheck({sport:'basketball'}),true)
})
