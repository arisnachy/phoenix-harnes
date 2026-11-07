/**
 * Source-to-hypothesis reconciliation for ANY registered PHOENIX medical input.
 *
 * The gate NEVER sees a patient study, pixel, ECG sample or pathology slide.
 * Its only job is to reject unsupported conclusions/visual claims and flag
 * dangerous omissions in a written interpretation BEFORE rendering.
 * PHI must not be supplied to the metadata-only Kira tools.
 */
import {diagnosticInputById,diagnosticPolicyFor} from './diagnostic-catalog.ts'

export interface DiagnosticConcordanceInput {
  readonly modality:unknown
  readonly sourceType?:unknown
  readonly sourceReviewed:unknown
  readonly sourceCompleteness?:unknown
  readonly observedEvidence?:unknown
  readonly proposedImpression?:unknown
  readonly differentialConsidered?:unknown
  readonly intendedVisualization?:unknown
  readonly criticalFeaturesAssessed?:unknown
  readonly calibratedMeasurementsAvailable?:unknown
}
const bounded=(input:unknown,name:string,limit:number)=>{
 if(input===undefined||input===null)return ''
 if(typeof input!=='string'||input.length>limit||/[<>{}\u0000-\u001f]/u.test(input))
   throw Error('Invalid '+name+' metadata')
 return input.trim()
}
const normalize=(text:string)=>text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .toLocaleLowerCase('en')
function ecgPriority(observed:string,impression:string){
 const findings=normalize(observed)
 const conclusion=normalize(impression)
 // This ONLY triggers a differential review; it cannot diagnose or infer a delta wave.
 const deltaLikely=/(?:onda[s]? delta|delta wave|pre.?excitac|wpw)/u.test(findings)&&
   !/(?:sin onda delta|no se observa onda delta|ausencia de onda delta)/u.test(findings)
 const shortPr=/(?:pr corto|short pr|pr\s*(?:de\s*)?(?:menor|inferior)|pr\s*\d{2,3}\s*ms)/u.test(findings)
 const widenedQrs=/(?:qrs ancho|qrs ensanchad|wide qrs|qrs\s*\d{3}\s*ms)/u.test(findings)
 const axisOnly=/(?:eje.*izquier|left.*axis|hemibloqueo|fascicular)/u.test(conclusion)&&
   !/(?:wpw|pre.?excitac|onda delta)/u.test(conclusion)
 return {
   preexcitationDifferentialRequired:deltaLikely||(shortPr&&widenedQrs),
   axisOnlyConclusionInadequate:axisOnly&&(deltaLikely||(shortPr&&widenedQrs)),
   photoRequiresCalibratedVerification:deltaLikely||shortPr||widenedQrs,
 }
}
export function auditDiagnosticConcordance(input:DiagnosticConcordanceInput){
 const entry=diagnosticInputById(input.modality)
 if(!entry)throw Error('Unsupported medical study type')
 const family=diagnosticPolicyFor(entry.id)
 if(!family)throw Error('No modality evidence policy')
 if(typeof input.sourceReviewed!=='boolean')throw Error('Source review must be explicit')
 const source=bounded(input.sourceType,'sourceType',30).toLowerCase()||'unknown'
 const sourceComplete=input.sourceCompleteness==='complete'
 if(input.sourceCompleteness!==undefined&&
   !['complete','partial','unknown'].includes(String(input.sourceCompleteness)))
   throw Error('Invalid source completeness')
 const evidence=bounded(input.observedEvidence,'observedEvidence',900)
 const impression=bounded(input.proposedImpression,'proposedImpression',400)
 const differential=bounded(input.differentialConsidered,'differentialConsidered',650)
 const visualization=bounded(input.intendedVisualization,'intendedVisualization',30)||'none'
 if(!['none','mechanism','patient-specific','educational','quantitative'].includes(visualization))
   throw Error('Unsupported diagnostic visualization')
 if(input.criticalFeaturesAssessed!==undefined&&typeof input.criticalFeaturesAssessed!=='boolean')
   throw Error('Critical-feature review state invalid')
 if(input.calibratedMeasurementsAvailable!==undefined&&
    typeof input.calibratedMeasurementsAvailable!=='boolean')
   throw Error('Measurement verification state invalid')
 const missing:string[]=[]
 const warnings:string[]=[]
 if(!input.sourceReviewed||source==='unknown'||source==='glb')
   missing.push('Original clinical source actually reviewed')
 if(!evidence)missing.push('Explicit observed findings from that source')
 if(!impression)missing.push('Proposed differential or impression, separated from facts')
 if(impression&&!evidence)warnings.push('A conclusion without directly observed evidence cannot be accepted')
 if(!differential)warnings.push('Alternative explanations have not been considered')
 if(input.criticalFeaturesAssessed!==true)warnings.push('Critical findings not documented as assessed')
 if(!sourceComplete)warnings.push('Partial/unknown source completeness: absence of findings does not exclude disease')
 const ecg=entry.family==='ecg'?ecgPriority(evidence,impression):null
 if(ecg?.preexcitationDifferentialRequired){
   warnings.push('Assess WPW/pre-excitation morphology before concluding axis deviation or isolated fascicular block')
   if(source!=='waveform'||input.calibratedMeasurementsAvailable!==true)
     warnings.push('Photo/uncalibrated ECG: no verified PR/QRS values or pathway localization')
 }
 if(ecg?.axisOnlyConclusionInadequate)
   missing.push('Pre-excitation/WPW differential when delta/short PR and broad QRS are suggested')
 if(visualization==='patient-specific')
   missing.push('Registered patient-specific geometry authorized by separate source-validated reconstruction pipeline')
 if(visualization==='mechanism'&&!evidence)
   missing.push('Observed electrophysiologic or pathophysiologic mechanism evidence')
 // Text metadata cannot prove clinical correctness, even when evidence fields were completed.
 const decision=missing.length?'BLOCK_UNSUPPORTED_INTERPRETATION':(!sourceComplete?
    'ALLOW_PROVISIONAL_REVIEW_ONLY':'ALLOW_CLINICIAN_REVIEW_DRAFT')
 return {
   modality:entry.id,modalityLabel:entry.label,family:entry.family,
   decision,sourceReviewed:input.sourceReviewed===true,
   sourceComplete,sourceType:source,findingsProvided:Boolean(evidence),
   proposedImpressionProvided:Boolean(impression),
   clinicalDiagnosisConfirmed:false,modelValidated:false,
   medicalPixelsOrSignalAnalyzedByThisTool:false,
   patientSpecificImageAuthorized:false,
   differentialFlags:ecg?{
     preexcitationMustBeConsidered:ecg.preexcitationDifferentialRequired,
     leftAxisConclusionInsufficient:ecg.axisOnlyConclusionInadequate,
     confirmQualitativePhotoOnCalibratedTrace:ecg.photoRequiresCalibratedVerification,
   }:null,
   missing,warnings,
   sourceRequirements:family.source,
   visualInstructions:ecg?.preexcitationDifferentialRequired?
     'Show only a schematic of possible electrical pre-excitation via a generic accessory AV pathway, labelled PROVISIONAL. Do NOT show patient-specific anatomical pathway location, myocardial lesion, or left-axis vectors as a substitute for WPW review.':
     'Only an educational, explicitly provisional explanation of directly observed source findings is possible; do not invent a patient lesion or pathology.',
   nextAction:missing.length?'Re-examine original study and reconcile overlooked differentials before any patient-facing medical visualization.':
     'Offer provisional differential with evidence and alternative explanations; require competent clinician review and modality-specific validation.',
 }
}
