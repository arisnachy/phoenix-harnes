/**
 * PHOENIX Health · imaging/laboratory/cytology interpretation integrity gate.
 *
 * This module NEVER diagnoses a patient and NEVER calls a language model.
 * It records the availability and provenance of evidence to prevent
 * a pretty GLB or a single screenshot from masquerading as a complete study.
 */
export const STUDY_MODALITIES = Object.freeze({
  ecg: {label:'ECG / EKG',native:'ECG waveform or original twelve-lead recording',
    limited:'A photograph/PDF does not establish signal calibration or complete rhythm review.'},
  ultrasound: {label:'Ecografía / Doppler',native:'Original DICOM images, measurements and clips',
    limited:'A still image alone does not provide cine loops, Doppler waveforms or complete acoustic windows.'},
  xray: {label:'Radiografía',native:'Original DICOM study, projection and clinical context',
    limited:'A screenshot can lose projection, contrast, resolution and DICOM context.'},
  ct: {label:'TC / Angio-TC',native:'Complete DICOM series with slices, reconstruction and contrast phase',
    limited:'A rendered GLB or one axial screenshot cannot evaluate the full CT volume.'},
  mri: {label:'RM',native:'Complete DICOM sequences and acquisition parameters',
    limited:'A single MRI sequence or screenshot is insufficient for many diagnoses.'},
  laboratory: {label:'Laboratorio',native:'Individual measured values with units and local reference ranges',
    limited:'A screenshot or transcription must be verified against the authenticated original report.'},
  cytology: {label:'Citología',native:'Original microscopy slides and stain/magnification metadata',
    limited:'A single low-resolution photomicrograph cannot exclude findings outside the field.'},
  histopathology: {label:'Histopatología',native:'Original whole-slide imaging with stain and scale',
    limited:'A selected image field cannot establish the complete specimen diagnosis.'},
  other: {label:'Otro estudio clínico',native:'Authenticated source and modality-specific interpretation method',
    limited:'No validated interpreter is configured for this study type.'},
} as const)
export type StudyModality = keyof typeof STUDY_MODALITIES
export type StudyEvidenceState = 'UNEXAMINED_SOURCE'|'CLINICIAN_PRELIMINARY'
const ALLOWED_MIME = new Set(['image/png','image/jpeg','image/webp','application/pdf'])
const ORIGINAL_REQUIRED = new Set<StudyModality>(['ct','mri','ultrasound','cytology','histopathology'])
const SENSITIVE = /(?:diagn[oó]stico confirmado|certeza del 100%|validado por IA)/iu
const noControl = (s:string)=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(s)
const clean=(x:unknown,field:string,max:number,required=false)=>{
  if(x===undefined||x===null||x==='') {
    if(required)throw new Error(field+' obligatorio')
    return ''
  }
  if(typeof x!=='string'||x.length>max||!noControl(x))throw new Error(field+' inválido')
  if(required&&!x.trim())throw new Error(field+' obligatorio')
  return x.trim()
}
export interface StudyEvidenceInput {
  modality:unknown
  sourceMime:unknown
  originalReviewed:unknown
  observations?:unknown
  preliminaryInterpretation?:unknown
  criticalConcern?:unknown
  studyContext?:unknown
}
export function evaluateStudyEvidence(input:StudyEvidenceInput) {
  const modality=String(input.modality) as StudyModality
  if(!Object.hasOwn(STUDY_MODALITIES,modality))throw new Error('Modalidad diagnóstica no admitida')
  const sourceMime=String(input.sourceMime)
  if(!ALLOWED_MIME.has(sourceMime))
    throw new Error('Para valorar un estudio se requiere su imagen o informe original, no un modelo GLB')
  if(typeof input.originalReviewed!=='boolean')
    throw new Error('Debe indicar si el profesional revisó el archivo fuente')
  const observations=clean(input.observations,'Hallazgos observados',3500)
  const preliminaryInterpretation=clean(input.preliminaryInterpretation,'Impresión clínica',1600)
  const context=clean(input.studyContext,'Contexto del estudio',600)
  if(SENSITIVE.test(preliminaryInterpretation))
    throw new Error('No se puede afirmar certeza diagnóstica ni validación automática')
  const criticalConcern=['not-assessed','suspected-critical','assessed-no-critical'].includes(String(input.criticalConcern))
    ?String(input.criticalConcern):'not-assessed'
  if(input.originalReviewed!==true&&(observations||preliminaryInterpretation||criticalConcern!=='not-assessed'))
    throw new Error('No registre hallazgos o urgencia sin haber revisado el archivo original')
  if(preliminaryInterpretation&&!observations)
    throw new Error('Toda impresión preliminar necesita hallazgos observados explícitos')
  const selected=STUDY_MODALITIES[modality]
  const limitations=[selected.limited]
  if(ORIGINAL_REQUIRED.has(modality))
    limitations.push('Debe cotejar el estudio completo y sus metadatos, no solo el adjunto parcial.')
  if(modality==='ecg')
    limitations.push('Confirmar velocidad, calibración, derivaciones, ritmo y medidas sobre el trazado original.')
  if(modality==='laboratory')
    limitations.push('Antes de interpretar, verificar analito, unidad, intervalo de referencia, edad y contexto.')
  return {
    modality,modalityLabel:selected.label,sourceMime,
    sourceRequirement:selected.native,
    sourceReviewedByClinician:input.originalReviewed===true,
    evidenceState:input.originalReviewed===true?'CLINICIAN_PRELIMINARY' as StudyEvidenceState:
      'UNEXAMINED_SOURCE' as StudyEvidenceState,
    observations,preliminaryInterpretation,studyContext:context,
    criticalConcern:input.originalReviewed===true?criticalConcern:'not-assessed',
    aiImageInterpreted:false,aiModelId:null,automatedDiagnosis:false,
    diagnosticValidation:'NOT_VALIDATED' as const,
    originalSeriesVerified:false,
    limitations,
    notice:'Interpretación preliminar introducida por profesional, NO diagnóstico generado o validado por IA. Conservar y revisar imágenes originales.',
  }
}
