/**
 * No universal diagnostic model: route each recognized study to its original
 * data requirements and a specialty-specific review checklist.
 *
 * No files, patient data, waveform samples, pixels, or diagnoses are read here.
 */
import { DIAGNOSTIC_FAMILY_POLICIES, DIAGNOSTIC_INPUTS,
  diagnosticInputById, diagnosticPolicyFor } from './diagnostic-catalog.ts'
export const PROTOCOLS=DIAGNOSTIC_FAMILY_POLICIES
export type DiagnosticModality=string
export function protocolFor(modality:string,sourceType='unknown'){
  const input=diagnosticInputById(modality)
  if(!input)throw Error('Unsupported clinical study modality')
  const policy=diagnosticPolicyFor(modality)
  if(!policy)throw Error('Missing modality evidence policy')
  const source=String(sourceType).toLowerCase()
  const supportedSources=['image','pdf','dicom','waveform','numeric','glb','unknown',
    'video','wsi','ecg','edf','vcf','fastq','hl7','fhir','csv','signal','audio','text','device']
  if(!supportedSources.includes(source))throw Error('Unsupported study source category')
  const likelyPartial=source==='glb'||source==='unknown'||(
    ['image','pdf','text'].includes(source)&&
    !['image'].includes(policy.nativeFormat))
  return {
    modality,modalityLabel:input.label,modalityGroup:input.group,
    family:input.family,sourceType:source,nativeSourceFormat:policy.nativeFormat,
    recognizedByCatalog:true,
    completeStudyAvailable:false,
    modelAvailableForPatientDiagnosis:false,
    pixelsOrSignalReadByTool:false,
    automaticDiagnosticFinding:null,
    interpretationStatus:'ORIGINAL_STUDY_REQUIRED',
    sourceRequirements:policy.source,
    reviewChecklist:policy.review,
    sourceLimitations:policy.avoid,
    formatIsDemonstrablyLimited:likelyPartial,
    acceptedByHealthIAAsOriginal:false,
    diagnosticInputCount:Object.keys(DIAGNOSTIC_INPUTS).length,
    requiredReportSections:[
      'verified modality, acquisition, raw file type and completeness',
      'observed findings with source coordinates, units and relevant quantitative measurements',
      'artifact and data quality assessment',
      'clinical context and prioritized differentials only if supported',
      'unassessed regions or missing measurements',
      'criticality, urgency and specialist review',
      'source/provenance and exact AI model version when actually run',
    ],
    guidance:'Do not diagnose from a GLB, screenshots, an uploaded filename or an unexamined report. A catalog entry is a routing protocol, NOT an installed or validated diagnostic model. If no engine processed the original source, label findings NOT ANALYZED; do not invent diagnostic probabilities.',
  }
}
