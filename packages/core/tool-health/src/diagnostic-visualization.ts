/** Diagnostic-grounded visualization authorization for ALL medical study inputs.
 * The returned plan is never a diagnostic image interpreter or generator.
 */
import {diagnosticInputById,diagnosticPolicyFor} from './diagnostic-catalog.ts'
export interface VisualStudyInput {
  readonly modality:unknown
  readonly sourceType?:unknown
  readonly sourceReviewed?:unknown
  readonly observedFindings?:unknown
  readonly visualizationKind?:unknown
  readonly patientSpecific?:unknown
  readonly verifiedSpatialGeometry?:unknown
  readonly diagnosticUncertaintyAcknowledged?:unknown
}
export function planClinicalVisualization(input:VisualStudyInput) {
  const entry=diagnosticInputById(input.modality)
  if(!entry)throw Error('Unsupported clinical modality')
  const family=diagnosticPolicyFor(entry.id)
  if(!family)throw Error('Missing clinical evidence family protocol')
  const sourceType=String(input.sourceType??'unknown')
  const observed=String(input.observedFindings??'').trim()
  if(observed.length>1000||/[<>{}]/.test(observed))
    throw Error('Finding summary invalid or too detailed for metadata-only planning')
  if(typeof input.sourceReviewed!=='boolean'||typeof input.patientSpecific!=='boolean')
    throw Error('Study review and model scope must be explicitly declared')
  if(input.verifiedSpatialGeometry!==undefined&&typeof input.verifiedSpatialGeometry!=='boolean')
    throw Error('Spatial geometry status must be explicit')
  const kind=String(input.visualizationKind??'conceptual')
  if(!['conceptual','anatomical','quantitative','patient-lesion'].includes(kind))
    throw Error('Unrecognized medical visualization kind')
  const hasSource=input.sourceReviewed===true
  const hasEvidence=observed.length>=12&&hasSource&&sourceType!=='unknown'&&sourceType!=='glb'
  const spatialProof=input.verifiedSpatialGeometry===true
  let decision:'BLOCK_NO_SOURCE'|'BLOCK_NO_FINDINGS'|'BLOCK_ECG_INCOMPLETE_INTERPRETATION'|
    'BLOCK_NO_VALIDATED_GEOMETRY'|'ALLOW_EDUCATIONAL_EXPLANATION'='BLOCK_NO_SOURCE'
  if(hasSource&&!hasEvidence)decision='BLOCK_NO_FINDINGS'
  // ECG/medical illustration regression: left-axis vectors alone are not a
  // complete ECG interpretation, particularly in the presence of preexcitation.
  // Require explicit review of PR, initial QRS/delta and QRS duration before
  // rendering a patient-facing electrical interpretation. No pixel recognition
  // or numeric interval estimation is performed by this metadata-only gate.
  const ecg=entry.family==='ecg'
  const normalized=observed.normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'')
    .toLocaleLowerCase('en')
  const isolatedAxis=ecg&&/(?:eje.*izquier|left.axis|fascicular|hemibloqueo)/u.test(normalized)&&
    !/(?:onda delta|delta wave|pre.?excit|wpw|qrs|pr corto|intervalo pr)/u.test(normalized)
  if(isolatedAxis&&hasEvidence)decision='BLOCK_ECG_INCOMPLETE_INTERPRETATION'
  // Boolean assertions from a language model cannot certify patient anatomy.
  // Only the registered, source-validated DICOM/mask reconstruction workflow
  // can authorize patient-specific GLBs; this metadata-only planner never can.
  else if(hasEvidence&&(input.patientSpecific===true||kind==='patient-lesion'))
    decision='BLOCK_NO_VALIDATED_GEOMETRY'
  else if(hasEvidence&&!isolatedAxis)decision='ALLOW_EDUCATIONAL_EXPLANATION'
  return {
    decision,modality:entry.id,modalityLabel:entry.label,
    family:entry.family,sourceRequirements:family.source,
    sourceReviewed:hasSource,findingsEntered:hasEvidence,
    patientSpecificRequested:input.patientSpecific===true,
    spatialGeometryVerified:spatialProof,medicalInterpretationVerifiedByThisTool:false,
    ecgIncompleteAxisOnly:isolatedAxis,
    ecgReviewRequired:ecg?['Verify PR in calibrated tracing',
      'Review initial QRS slope and delta waves on visible leads',
      'Measure QRS duration and rhythm',
      'Rule out ventricular preexcitation before attributing abnormalities solely to axis/fascicles']:[],
    illustrativeOnly:input.patientSpecific!==true,
    caveats:[
      'A generated illustration is never itself evidence of a diagnosis.',
      'For a patient-specific lesion, use registered DICOM/segmentation, source coordinates and clinician review; a generic atlas cannot show the patient lesion.',
      'Do not invent lesion shape, accessory pathway location, affected region, diagnostic probability, or measurement from incomplete sources.',
      'If ECG shows possible preexcitation, explain a generic AV accessory pathway instead of depicting axis deviation as the primary diagnosis.',
    ],
    nextStep:decision==='ALLOW_EDUCATIONAL_EXPLANATION'?
      'May render a clearly labelled educational mechanism based solely on observed findings. Use a registered patient-specific pipeline for verified geometry.':
      'Review original source, document measurable relevant findings, and confirm patient geometry where applicable before generating a depiction.',
  }
}
