/**
 * Protected Healthia clinical draft composer. Deterministic and LOCAL:
 * not an LLM, not a diagnosis, never exports patient data.
 * The professional must confirm every statement before saving or signing.
 */
export interface ClinicalNoteProposalInput {
  readonly complaint:string
  readonly answers:unknown
  readonly history:unknown
  readonly exam:unknown
  readonly assessment:unknown
  readonly plan:unknown
}
export interface ClinicalNoteProposal {
  readonly source:'local-recorded-facts'
  readonly reviewed:false
  readonly canAutoSign:false
  readonly suggestedComplaint:string
  readonly suggestedHistory:string
  readonly originalHistory:string
  readonly note:{readonly history:string;readonly exam:string;readonly assessment:string;readonly plan:string}
  readonly missingInformation:readonly string[]
}
const FIELDS:Readonly<Record<string,string>>={
  onset:'Inicio y evolución temporal',severity:'Intensidad e impacto funcional',
  associated:'Síntomas asociados',alarm:'Evaluación de signos de alarma',background:'Antecedentes, medicamentos y alergias',
  location:'Localización e irradiación',digestive:'Síntomas digestivos y urinarios',
  abdominal_alarm:'Signos de alarma abdominales',pattern:'Patrón de cefalea',
  neurological:'Síntomas neurológicos',headache_alarm:'Signos de alarma neurológicos',
  chest_pattern:'Características del síntoma torácico',cardiac_associated:'Síntomas cardiovasculares asociados',
  cardiac_alarm:'Signos de alarma cardiovasculares',respiratory_duration:'Evolución respiratoria',
  respiratory_features:'Características respiratorias',respiratory_alarm:'Signos de alarma respiratorios',
  metabolic_history:'Tratamientos y controles previos',metabolic_symptoms:'Síntomas metabólicos',
  metabolic_alarm:'Signos de alarma metabólicos',function:'Repercusión funcional',
  risk:'Evaluación profesional de riesgos',support:'Apoyos y tratamientos',
}
function safeText(input:unknown,max:number):string {
  if(typeof input!=='string'||input.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input))throw Error('CLINICAL_INVALID_SOURCE')
  return input.trim()
}
export function composeProtectedClinicalNote(input:ClinicalNoteProposalInput):ClinicalNoteProposal {
  if(!input||typeof input!=='object')throw Error('CLINICAL_INVALID_SOURCE')
  const complaint=safeText(input.complaint,2000)
  if(!complaint)throw Error('CLINICAL_COMPLAINT_REQUIRED')
  const originalHistory=safeText(input.history,12000)
  const exam=safeText(input.exam,4000),assessment=safeText(input.assessment,4000),plan=safeText(input.plan,4000)
  if(!input.answers||typeof input.answers!=='object'||Array.isArray(input.answers))throw Error('CLINICAL_INVALID_ANSWERS')
  const entries=Object.entries(input.answers as Record<string,unknown>)
  if(entries.length>50)throw Error('CLINICAL_ANSWER_LIMIT')
  const lines:string[]=[]
  const seen=new Set<string>()
  for(const [key,value] of entries){
    if(!/^[a-z_]{1,40}$/u.test(key)||seen.has(key))throw Error('CLINICAL_INVALID_QUESTION')
    seen.add(key)
    const answer=safeText(value,1600)
    if(answer)lines.push((FIELDS[key]??('Pregunta documentada ('+key+')'))+': '+answer)
  }
  const missing=Object.entries(FIELDS).slice(0,5).filter(([key])=>!seen.has(key))
    .map(([,label])=>label)
  const proposed=[
    ...(originalHistory?[originalHistory,'Motivo documentado: '+complaint]:['Motivo documentado: '+complaint]),
    ...(lines.length?['Relato registrado durante la entrevista:',...lines]:
      originalHistory?[]:['Entrevista clínica no documentada todavía.']),
    'Borrador asistido: completar y verificar secuencia temporal, síntomas pertinentes y hallazgos antes de firmar.',
  ].join('\n')
  if(proposed.length>3900)throw Error('CLINICAL_DRAFT_LIMIT: demasiada información; seleccione respuestas pertinentes')
  return {
    source:'local-recorded-facts',reviewed:false,canAutoSign:false,
    suggestedComplaint:complaint,suggestedHistory:proposed,originalHistory,
    note:{history:originalHistory||proposed,exam,assessment,plan},
    missingInformation:missing,
  }
}
