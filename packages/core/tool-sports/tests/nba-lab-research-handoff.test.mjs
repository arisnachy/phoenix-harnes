import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readNbaLabHandoff} from '../src/nba-lab-research-handoff.ts'
const modules=Object.fromEntries('ABCDEFGHIJKLMNOPQ'.split('').map(k=>[k,{estado:'partial'}]))
const game=()=>({
  eventId:'401909985',sport:'basketball',league:'nba',
  snapshotCreatedUtc:'2026-11-15T19:16:00Z',
  scheduledUtc:'2026-11-15T18:00:00Z',snapshotState:'in',
  captureBeforeTipoff:true,quarantinedInjuryRecords:4,
  evidenceModules:modules,checklistObservations:{
    fixture:{state:'verified',detail:'Event ID checked'},
    starters:{state:'missing',detail:'No confirmed lineup'}},
  missingResearch:[{event_id:'401909985',module:'K',
    missing_fields:['quinteto_confirmado'],route:'Official lineup'}],
  gate:{researchOnly:true,eligibleForTicket:false,
    quotedOddsLive:false,modelCalibrated:false,
    expectedValue:null,recommendation:'investigate'}
})
test('NBA archive is research-only and a live score cannot be pregame',()=>{
  const [parsed]=readNbaLabHandoff({
    schema:'phoenix.nba.read-model.v1',operational:false,games:[game()]})
  assert.equal(parsed.captureBeforeTipoff,false)
  assert.equal(parsed.gate.eligibleForTicket,false)
  assert.equal(parsed.checklistObservations.starters.state,'missing')
  assert.equal(parsed.missingResearch[0].module,'K')
})
test('historical odds cannot be elevated to operational odds',()=>{
  const g=game()
  g.gate.quotedOddsLive=true
  assert.throws(()=>readNbaLabHandoff({
    schema:'phoenix.nba.read-model.v1',operational:false,games:[g]}),/unsafe/)
})
test('rejects A-Q gaps and duplicate events',()=>{
  const g=game(),broken=game()
  delete broken.evidenceModules.Q
  assert.throws(()=>readNbaLabHandoff({
    schema:'phoenix.nba.read-model.v1',operational:false,games:[broken]}),/A-Q/)
  assert.throws(()=>readNbaLabHandoff({
    schema:'phoenix.nba.read-model.v1',operational:false,games:[g,g]}),/duplicate/)
})
