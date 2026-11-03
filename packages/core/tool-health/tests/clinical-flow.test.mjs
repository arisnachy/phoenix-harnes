import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openEncounter, advanceEncounter, planInterview, planKiraMail } from '../src/clinical-flow.ts'

const actor = { actorRole: 'clinician', actorRef: 'test-professional' }
test('el expediente abre sin firma ni diagnóstico', () => {
  assert.deepEqual(openEncounter('test-encounter'), {
    encounterRef: 'test-encounter', stage: 'opened', revision: 0,
    reviewedRevision: null, signedBy: null,
  })
})
test('el interrogatorio es adaptativo y nunca presume respuestas', () => {
  const p = planInterview('dolor abdominal', 'medicina familiar', 'kira', ['location'])
  assert.equal(p.pathway,'abdominal')
  assert.equal(p.nextQuestions.some(x=>x.key==='location'),false)
  assert.equal(p.nextQuestions.some(x=>x.key==='abdominal_alarm'),true)
  assert.equal(p.patientDataPersisted,false)
  assert.equal(p.emergencyScreeningRequired,true)
})
test('no se interpreta un motivo de cefalea como un diagnóstico', () => {
  const p = planInterview('cefalea','neurología','mixed')
  assert.equal(p.pathway,'headache')
  assert.equal(p.nextQuestions.length,4)
  assert.equal('diagnosis' in p,false)
})
test('entradas inválidas y campos arbitrarios fallan cerrados', () => {
  assert.throws(()=>planInterview('','general'))
  assert.throws(()=>planInterview('dolor','general','robot'))
  assert.throws(()=>planInterview('dolor','general','mixed',['un campo libre']))
  assert.throws(()=>openEncounter(''))
})
test('revisión, firma y cierre tienen estado y autoridad explícita', () => {
  let state = openEncounter('test-encounter')
  assert.throws(()=>advanceEncounter(state,{...actor,action:'sign-history'}))
  state=advanceEncounter(state,{...actor,action:'record-interview'})
  state=advanceEncounter(state,{...actor,action:'draft-history'})
  assert.throws(()=>advanceEncounter(state,{actorRole:'assistant',actorRef:'kira',action:'review-history'}))
  state=advanceEncounter(state,{...actor,action:'review-history'})
  assert.throws(()=>advanceEncounter(state,{actorRole:'assistant',actorRef:'kira',action:'sign-history'}))
  state=advanceEncounter(state,{...actor,action:'sign-history'})
  assert.equal(state.signedBy,'test-professional')
  state=advanceEncounter(state,{...actor,action:'close-encounter'})
  assert.equal(state.stage,'closed')
  assert.throws(()=>advanceEncounter(state,{...actor,action:'draft-history'}))
})
test('editar tras revisión invalida la revisión anterior',()=>{
  let s=openEncounter('test-encounter')
  for(const action of ['record-interview','draft-history','review-history','draft-history']){
    s=advanceEncounter(s,{...actor,action})
  }
  assert.equal(s.reviewedRevision,null)
  assert.throws(()=>advanceEncounter(s,{...actor,action:'sign-history'}))
})
const approvals={senderConnected:true,senderVerified:true,recipientVerified:true,
  patientConsent:true,clinicianSigned:true,clinicianAuthorizedSend:true,
  securePortalReady:true,idempotencyKeyPresent:true}
test('Kira no envía correos; solo habilita la cola con ocho controles',()=>{
  const p=planKiraMail(approvals)
  assert.equal(p.approvedForQueue,true)
  assert.equal(p.sendsNow,false)
  assert.equal(p.delivery,'secure-portal-notification')
  assert.equal(p.requiredEvidence.length,8)
})
test('sin consentimiento, firma o remitente verificado no se prepara entrega',()=>{
  for(const key of Object.keys(approvals)){
    const p=planKiraMail({...approvals,[key]:false})
    assert.equal(p.approvedForQueue,false)
    assert(p.blockers.length>=1)
    assert.equal(p.sendsNow,false)
  }
})
