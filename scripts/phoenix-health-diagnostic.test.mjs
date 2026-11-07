import test from 'node:test'
import assert from 'node:assert/strict'
import {evaluateStudyEvidence,STUDY_MODALITIES} from '../packages/bundle/web-app/src/health-diagnostic-evidence.ts'
import {protocolFor} from '../packages/core/tool-health/src/diagnostic-routing.ts'
import {DIAGNOSTIC_INPUT_COUNT} from '../packages/core/tool-health/src/diagnostic-catalog.ts'

const modalities=['ecg','ultrasound','xray','ct','mri','laboratory','cytology','histopathology','other']
test('all nine study modalities are explicit; no invented universal diagnostic engine',()=>{
 assert.equal(Object.keys(STUDY_MODALITIES).length,DIAGNOSTIC_INPUT_COUNT)
 for(const id of modalities)assert.ok(STUDY_MODALITIES[id],id)
 for(const m of modalities){
  const protocol=protocolFor(m,'image')
  assert.equal(protocol.modelAvailableForPatientDiagnosis,false)
  assert.equal(protocol.pixelsOrSignalReadByTool,false)
  assert.equal(protocol.automaticDiagnosticFinding,null)
  assert.equal(protocol.completeStudyAvailable,false)
  assert(protocol.reviewChecklist.length>=4)
 }
})
test('file not actually inspected cannot generate clinical findings or assurance',()=>{
 const input={modality:'ct',sourceMime:'image/png',originalReviewed:false}
 const r=evaluateStudyEvidence(input)
 assert.equal(r.evidenceState,'UNEXAMINED_SOURCE')
 assert.equal(r.aiImageInterpreted,false)
 assert.equal(r.automatedDiagnosis,false)
 assert.equal(r.criticalConcern,'not-assessed')
 assert.throws(()=>evaluateStudyEvidence({...input,observations:'Tumor confirmed'}),/revisado/)
 assert.throws(()=>evaluateStudyEvidence({...input,preliminaryInterpretation:'Normal'}),/revisado/)
 assert.throws(()=>evaluateStudyEvidence({...input,criticalConcern:'assessed-no-critical'}),/revisado/)
})
test('a GLB is not primary diagnostic source even when rendered successfully',()=>{
 assert.throws(()=>evaluateStudyEvidence({modality:'mri',sourceMime:'model/gltf-binary',originalReviewed:true}),
   /no un modelo GLB/)
 const p=protocolFor('ct','glb')
 assert.equal(p.formatIsDemonstrablyLimited,true)
 assert.match(p.sourceLimitations,/GLB/)
})
test('human-preliminary findings remain explicitly not validated by AI',()=>{
 const x=evaluateStudyEvidence({modality:'ecg',sourceMime:'application/pdf',
  originalReviewed:true,observations:'Trazado revisado por médico; QRS medido en el original.',
  preliminaryInterpretation:'Hipótesis clínica pendiente de correlación.',
  criticalConcern:'not-assessed'})
 assert.equal(x.evidenceState,'CLINICIAN_PRELIMINARY')
 assert.equal(x.aiModelId,null)
 assert.equal(x.aiImageInterpreted,false)
 assert.equal(x.diagnosticValidation,'NOT_VALIDATED')
 assert(x.limitations.some(x=>/calibración/i.test(x)))
})
test('rejects unsupported modality, false certainty and unobserved conclusions',()=>{
 assert.throws(()=>evaluateStudyEvidence({modality:'telepathy',sourceMime:'image/png',
  originalReviewed:true}),/Modalidad/)
 assert.throws(()=>evaluateStudyEvidence({modality:'cytology',sourceMime:'image/jpeg',
  originalReviewed:true,preliminaryInterpretation:'Carcinoma demostrado'}),/hallazgos/)
 assert.throws(()=>evaluateStudyEvidence({modality:'xray',sourceMime:'image/png',
  originalReviewed:true,observations:'Opacidad focal',preliminaryInterpretation:'Diagnóstico confirmado de neumonía'}),
  /certeza/)
 assert.throws(()=>evaluateStudyEvidence({modality:'mri',sourceMime:'image/png',
  originalReviewed:true,criticalConcern:'no risk'}),/crítico/)
})
test('source-specific limitations cannot be hidden by an isolated screenshot',()=>{
 for(const m of ['ct','mri','ultrasound','histopathology','cytology']){
   const x=protocolFor(m,'image')
   assert.equal(x.formatIsDemonstrablyLimited,true)
   const result=evaluateStudyEvidence({modality:m,sourceMime:'image/png',originalReviewed:true})
   assert(result.limitations.some(x=>/completo/i.test(x)))
 }
})

test('uncatalogued source requires named protocol and never implies AI diagnosis',()=>{
 const bare={modality:'other',sourceMime:'application/pdf',originalReviewed:false}
 assert.throws(()=>evaluateStudyEvidence(bare),/obligatorio/)
 const recorded=evaluateStudyEvidence({...bare,customModality:'Dispositivo médico experimental'})
 assert.equal(recorded.modalityLabel,'Dispositivo médico experimental')
 assert.equal(recorded.nativeStudyDataParsed,false)
 assert.equal(recorded.aiImageInterpreted,false)
})
