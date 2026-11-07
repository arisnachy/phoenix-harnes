import test from 'node:test'
import assert from 'node:assert/strict'
import {assessPreexcitation} from '../packages/core/tool-health/src/ecg-preexcitation.ts'
import {planClinicalVisualization} from '../packages/core/tool-health/src/diagnostic-visualization.ts'
import {DIAGNOSTIC_INPUTS} from '../packages/core/tool-health/src/diagnostic-catalog.ts'
import {auditDiagnosticConcordance} from '../packages/core/tool-health/src/diagnostic-concordance.ts'

test('WPW pattern is explicitly considered when PR <120, delta and broad QRS are measured',()=>{
 const r=assessPreexcitation({source:'calibrated-12-lead',clinicianReviewed:true,
   prMs:96,qrsMs:138,deltaWave:'present',leadEvidence:'I, II, V3',
   rhythm:'sinus'})
 assert.equal(r.pattern,'COMPATIBLE_WPW_PREEXCITATION_PATTERN')
 assert.equal(r.shortPr,true)
 assert.equal(r.widenedQrs,true)
 assert.equal(r.wpwSyndromeConfirmed,false)
 assert.equal(r.exactAccessoryPathwayLocalized,false)
 assert.equal(r.imagePixelsAnalysed,false)
 assert.match(r.visualExplanation,/GENERIC accessory/)
 assert.match(r.caution,/leftward QRS axis alone/)
})
test('minor/incomplete preexcitation never becomes confirmed WPW syndrome',()=>{
 const partial=assessPreexcitation({source:'calibrated-12-lead',clinicianReviewed:true,
   prMs:105,qrsMs:108,deltaWave:'present',leadEvidence:'V4',rhythm:'sinus'})
 assert.equal(partial.pattern,'POSSIBLE_PREEXCITATION')
 assert.equal(partial.wpwSyndromeConfirmed,false)
 const noDelta=assessPreexcitation({source:'calibrated-12-lead',clinicianReviewed:true,
   prMs:130,qrsMs:100,deltaWave:'absent',rhythm:'sinus'})
 assert.equal(noDelta.pattern,'CLASSIC_PATTERN_NOT_SHOWN')
 assert.match(noDelta.differential.join(' '),/Intermittent/)
})
test('ECG screenshot and left-axis description cannot magically yield measured PR or delta',()=>{
 const image=assessPreexcitation({source:'partial-image',clinicianReviewed:false,
   deltaWave:'not-assessable',rhythm:'unknown'})
 assert.equal(image.pattern,'INSUFFICIENT_ECG_EVIDENCE')
 assert.equal(image.prMs,null)
 assert.equal(image.qrsMs,null)
 assert(image.missing.includes('complete calibrated 12-lead tracing'))
 assert.throws(()=>assessPreexcitation({source:'partial-image',clinicianReviewed:false,
   deltaWave:'present',prMs:92,qrsMs:140}),/reviewed, calibrated/)
 const missingLead=assessPreexcitation({source:'calibrated-12-lead',clinicianReviewed:true,
   deltaWave:'present',prMs:92,qrsMs:140})
 assert.equal(missingLead.pattern,'INSUFFICIENT_ECG_EVIDENCE')
 assert(missingLead.missing.includes('lead-specific delta-wave evidence'))
})
test('tachycardia red flag is surfaced without issuing unreviewed medication instructions',()=>{
 const r=assessPreexcitation({source:'calibrated-12-lead',clinicianReviewed:true,
   prMs:95,qrsMs:135,deltaWave:'present',leadEvidence:'II',rhythm:'irregular-wide-complex'})
 assert.equal(r.pattern,'COMPATIBLE_WPW_PREEXCITATION_PATTERN')
 assert(r.urgentFlags.length>0)
 assert.match(r.urgentFlags.join(' '),/urgent clinical evaluation/)
})
test('medical visualization never outruns evidence and patient-specific geometries',()=>{
 const p=(modality,overrides={})=>planClinicalVisualization({
   modality,sourceType:'dicom',sourceReviewed:false,
   observedFindings:'',visualizationKind:'conceptual',patientSpecific:false,...overrides})
 assert.equal(p('ecg').decision,'BLOCK_NO_SOURCE')
 assert.equal(p('ecg',{sourceReviewed:true}).decision,'BLOCK_NO_FINDINGS')
 assert.equal(p('ecg',{sourceType:'waveform',sourceReviewed:true,
   observedFindings:'PR medido 96ms, QRS 138ms, onda delta en derivación II'}).decision,
   'ALLOW_EDUCATIONAL_EXPLANATION')
 assert.equal(p('ecg',{sourceType:'waveform',sourceReviewed:true,
   observedFindings:'Patrón medido de preexcitación en ECG original',patientSpecific:true,
   verifiedSpatialGeometry:true,diagnosticUncertaintyAcknowledged:true}).decision,
   'BLOCK_NO_VALIDATED_GEOMETRY')
 assert.equal(p('mri',{sourceReviewed:true,observedFindings:'Lesión focal informada',
   patientSpecific:true,verifiedSpatialGeometry:true}).decision,
   'BLOCK_NO_VALIDATED_GEOMETRY')
})
test('same evidence-first rule applies to every registered medical input modality',()=>{
 for(const modality of Object.keys(DIAGNOSTIC_INPUTS)){
  assert.equal(planClinicalVisualization({modality,sourceReviewed:false,
    sourceType:'image',observedFindings:'no examinado',patientSpecific:false}).decision,
    'BLOCK_NO_SOURCE',modality)
 }
})

test('a photographed ECG can suggest delta/WPW provisionally but never create numeric PR or QRS',()=>{
 const observed=assessPreexcitation({
  source:'partial-image',clinicianReviewed:false,deltaWave:'not-assessable',
  photoDeltaHint:'possible',qualitativePrHint:'appears-short',
  axisHint:'left',rhythm:'unknown',leadEvidence:'derivaciones parcialmente visibles',
 })
 assert.equal(observed.pattern,'PHOTO_SUGGESTS_PREEXCITATION_UNVERIFIED')
 assert.equal(observed.prMs,null)
 assert.equal(observed.qrsMs,null)
 assert.equal(observed.imageSuspectedPreexcitationUnverified,true)
 assert.equal(observed.imagePixelsAnalysed,false)
 assert.equal(observed.visualDecision,'PROVISIONAL_ELECTROPHYSIOLOGY_MECHANISM_ONLY')
 assert.equal(observed.wpwSyndromeConfirmed,false)
 assert.match(observed.visualExplanation,/GENERIC accessory/i)
 assert.throws(()=>assessPreexcitation({
  source:'partial-image',clinicianReviewed:false,photoDeltaHint:'possible',
  prMs:96,qrsMs:138}),/reviewed, calibrated/)
})
test('axis-only explanation must not obscure photo-observed delta and WPW differential',()=>{
 const result=auditDiagnosticConcordance({
  modality:'ecg',sourceType:'image',sourceReviewed:true,sourceCompleteness:'partial',
  observedEvidence:'Eje izquierdo, PR corto aparente y onda delta en inicio de QRS, sin calibración confirmada.',
  proposedImpression:'Desviación del eje eléctrico hacia la izquierda.',
  differentialConsidered:'Bloqueo fascicular anterior',
  intendedVisualization:'mechanism',criticalFeaturesAssessed:false,
 })
 assert.equal(result.decision,'BLOCK_UNSUPPORTED_INTERPRETATION')
 assert.equal(result.differentialFlags.leftAxisConclusionInsufficient,true)
 assert.equal(result.differentialFlags.preexcitationMustBeConsidered,true)
 assert.match(result.visualInstructions,/accessory AV pathway/i)
 assert.equal(result.clinicalDiagnosisConfirmed,false)
 assert.equal(result.medicalPixelsOrSignalAnalyzedByThisTool,false)
})
test('all medical modalities require observed evidence and cannot authorize a patient-specific pathology illustration',()=>{
 for(const modality of Object.keys(DIAGNOSTIC_INPUTS)){
  const missing=auditDiagnosticConcordance({
   modality,sourceType:'image',sourceReviewed:false,
   observedEvidence:'',proposedImpression:'Diagnóstico definitivo',
   intendedVisualization:'patient-specific'})
  assert.equal(missing.decision,'BLOCK_UNSUPPORTED_INTERPRETATION',modality)
  assert.equal(missing.clinicalDiagnosisConfirmed,false,modality)
  const data=auditDiagnosticConcordance({
   modality,sourceType:'dicom',sourceReviewed:true,
   sourceCompleteness:'complete',
   observedEvidence:'Anomalía objetiva descrita en fuente médica original',
   proposedImpression:'Hipótesis provisional a correlacionar clínicamente',
   differentialConsidered:'Variantes normales, error de adquisición y diferencial específico',
   intendedVisualization:'patient-specific',criticalFeaturesAssessed:true})
  assert.equal(data.decision,'BLOCK_UNSUPPORTED_INTERPRETATION',modality)
  assert(data.missing.some(s=>/geometry/.test(s)),modality)
  assert.equal(data.patientSpecificImageAuthorized,false)
 }
})
