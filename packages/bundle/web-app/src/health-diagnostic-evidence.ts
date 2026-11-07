/**
 * PHOENIX Health · imaging/laboratory/cytology interpretation integrity gate.
 *
 * This module NEVER diagnoses a patient and NEVER calls a language model.
 * It records the availability and provenance of evidence to prevent
 * a pretty GLB or a single screenshot from masquerading as a complete study.
 */
import {DIAGNOSTIC_INPUTS,diagnosticPolicyFor}
  from './health-diagnostic-catalog.ts'
export const STUDY_MODALITIES:Readonly<Record<string,{
  label:string;native:string;limited:string;family:string;nativeFormat:string}>>=
 Object.freeze(Object.fromEntries(Object.values(DIAGNOSTIC_INPUTS).map(entry=>{
   const policy=diagnosticPolicyFor(entry.id)
   if(!policy)throw new Error('Missing evidence family policy: '+entry.id)
   return [entry.id,{label:entry.label,native:policy.source,limited:policy.avoid,
     family:entry.family,nativeFormat:policy.nativeFormat}]
 })))
export type StudyModality=string
export type StudyEvidenceState = 'UNEXAMINED_SOURCE'|'SOURCE_REVIEWED_NO_OBSERVATIONS'|'CLINICIAN_PRELIMINARY'
const ALLOWED_MIME = new Set(['image/png','image/jpeg','image/webp','application/pdf'])
const ORIGINAL_REQUIRED=new Set<StudyModality>(Object.keys(STUDY_MODALITIES)
  .filter(id=>diagnosticPolicyFor(id)?.requiresNative===true))
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
  customModality?:unknown
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
  const customModality=clean(input.customModality,'Estudio no catalogado',160,modality==='other')
  if(SENSITIVE.test(preliminaryInterpretation))
    throw new Error('No se puede afirmar certeza diagnóstica ni validación automática')
  const concern=input.criticalConcern===undefined?'not-assessed':String(input.criticalConcern)
  if(!['not-assessed','suspected-critical','assessed-no-critical'].includes(concern))
    throw new Error('Estado crítico inválido')
  const criticalConcern=concern
  if(input.originalReviewed!==true&&(observations||preliminaryInterpretation||criticalConcern!=='not-assessed'))
    throw new Error('No registre hallazgos o urgencia sin haber revisado el archivo original')
  if(preliminaryInterpretation&&!observations)
    throw new Error('Toda impresión preliminar necesita hallazgos observados explícitos')
  const selected=STUDY_MODALITIES[modality]
  const policy=diagnosticPolicyFor(modality)
  if(!selected||!policy)throw new Error('Modalidad diagnóstica sin protocolo')
  const limitations:string[]=[selected.limited]
  if(ORIGINAL_REQUIRED.has(modality))
    limitations.push('Debe cotejar el estudio completo y sus metadatos, no solo el adjunto parcial.')
  if(selected.family==='ecg')
    limitations.push('Confirmar velocidad, calibración, derivaciones, ritmo y medidas sobre el trazado original.')
  if(selected.family==='laboratory')
    limitations.push('Antes de interpretar, verificar analito, unidad, intervalo de referencia, edad y contexto.')
  return {
    modality,modalityLabel:customModality||selected.label,sourceMime,
    customModality:modality==='other'?customModality:null,
    family:selected.family,nativeSourceFormat:selected.nativeFormat,
    sourceRequirement:selected.native,
    sourceModalityRecognized:true,
    nativeStudyDataParsed:false,sourceFileMayBeIncomplete:true,
    sourceReviewedByClinician:input.originalReviewed===true,
    evidenceState:(input.originalReviewed===false?'UNEXAMINED_SOURCE':
      !observations?'SOURCE_REVIEWED_NO_OBSERVATIONS':'CLINICIAN_PRELIMINARY') as StudyEvidenceState,
    observations,preliminaryInterpretation,studyContext:context,
    criticalConcern:input.originalReviewed===true?criticalConcern:'not-assessed',
    aiImageInterpreted:false,aiModelId:null,automatedDiagnosis:false,
    diagnosticValidation:'NOT_VALIDATED' as const,
    originalSeriesVerified:false,
    limitations,
    notice:'Interpretación preliminar introducida por profesional, NO diagnóstico generado o validado por IA. Conservar y revisar imágenes originales.',
  }
}
