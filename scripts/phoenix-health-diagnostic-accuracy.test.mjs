import test from 'node:test'
import assert from 'node:assert/strict'
import {assessPreexcitation} from '../packages/core/tool-health/src/ecg-preexcitation.ts'
import {planClinicalVisualization} from '../packages/core/tool-health/src/diagnostic-visualization.ts'
import {DIAGNOSTIC_INPUTS} from '../packages/core/tool-health/src/diagnostic-catalog.ts'

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
