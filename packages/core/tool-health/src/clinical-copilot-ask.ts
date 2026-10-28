/**
 * Kira Clinical Copilot: a bounded workflow adapter for Phoenix's existing ASK UI.
 * ASK decisions are not patient testimony, medical records, clinical consent,
 * diagnosis, assessment or clinician signature.
 */
import { planInterview, type InterviewMode } from './clinical-flow.ts'

/** The types of human clinical workflow decisions made through existing ASK. */
export type ClinicalAskAction = 'choose_mode' | 'screen_urgency' | 'next_question'
/** Generic complaint categories only: no record identifier or clinical free text. */
export type ClinicalAskPathway = 'general' | 'abdominal' | 'headache' | 'mental-health'
/** Minimal ASK option payload sent to the existing user-questions provider. */
export interface ClinicalAskOption { readonly label:string;readonly description?:string }
/** An ASK question with a stable, clinically sensitive ID and no PHI. */
export interface ClinicalAskQuestion {
 readonly id:string
 readonly header:string
 readonly question:string
 readonly sensitive:true
 readonly options:readonly ClinicalAskOption[]
}
/** The safe outcome of the clinical ASK workflow. */
export interface ClinicalAskOutcome {
 readonly status:'UNANSWERED'|'CANCELLED'|'MODE_SELECTED'|'NEEDS_CLINIC_ENTRY'|'PENDING'|'COMPLETE'
 readonly mode?:InterviewMode
 readonly field?:string
 readonly acceptedClinicalFact:false
 readonly savedToRecord:false
 readonly clinicianReviewRequired:true
 readonly message:string
}
/** A generic prompt and the recognized options for safe ASK interpretation. */
export interface ClinicalAskStep {
 readonly action:ClinicalAskAction
 readonly question?:ClinicalAskQuestion
 readonly field?:string
 readonly done:boolean
}

const MODE_OPTIONS=[
 { label:'Kira guía las preguntas',description:'Kira propone preguntas; el médico valida y registra en Health.'},
 { label:'Profesional dirige',description:'El médico realiza el interrogatorio con apoyo puntual de Kira.'},
 { label:'Modo mixto',description:'Kira y el profesional alternan preguntas y revisión.'},
 { label:'Cancelar',description:'No iniciar la guía clínica.'},
] as const
const PROGRESS_OPTIONS=[
 { label:'Registrar en expediente protegido',description:'Abrir PHOENIX Health y documentar la respuesta real allí.'},
 { label:'Dejar pendiente',description:'Todavía no se ha completado esta pregunta.'},
 { label:'Cancelar',description:'Suspender la guía, sin inferir ninguna respuesta.'},
] as const
const PATHWAY_COMPLAINT:Readonly<Record<ClinicalAskPathway,string>>={
 general:'síntomas generales',abdominal:'dolor abdominal',headache:'cefalea','mental-health':'ansiedad',
}
const PATHWAY_SPECIALTY:Readonly<Record<ClinicalAskPathway,string>>={
 general:'medicina familiar',abdominal:'medicina familiar',headache:'neurología','mental-health':'psicología',
}
function validAnswered(keys:readonly string[]):void {
 if(!Array.isArray(keys)||keys.length>50||keys.some(key=>typeof key!=='string'||!/^[a-z_]{1,40}$/u.test(key)))
  throw new TypeError('Claves de preguntas inválidas')
}
/**
 * Build a single question using the existing ASK service, with sensitive expiry.
 * @param action - One of the supported clinical workflow phases.
 * @param pathway - Generic de-identified clinical question category.
 * @param answered - Already documented question keys; no patient answers.
 * @returns Exactly one safe ASK question or a completed step.
 */
export function buildClinicalAskStep(action:ClinicalAskAction,pathway:ClinicalAskPathway='general',answered:readonly string[]=[]):ClinicalAskStep {
 if(!['choose_mode','screen_urgency','next_question'].includes(action))throw new TypeError('Acción ASK inválida')
 if(!Object.hasOwn(PATHWAY_COMPLAINT,pathway))throw new TypeError('Categoría clínica inválida')
 validAnswered(answered)
 if(action==='choose_mode')return { action,done:false,question:{
  id:'health-ask-mode',header:'Kira Clínica · ASK',sensitive:true,
  question:'¿Cómo deseas realizar el interrogatorio? No introduzcas datos identificables del paciente en este chat.',
  options:MODE_OPTIONS,
 } }
 if(action==='screen_urgency')return { action,done:false,question:{
  id:'health-ask-urgency',header:'Seguridad clínica · ASK',sensitive:true,
  question:'Antes del interrogatorio: ¿el profesional realizó una evaluación inicial de signos de alarma? No compartas información identificable. Si hay emergencia, prioriza la atención inmediata.',
  options:PROGRESS_OPTIONS,
 } }
 const p=planInterview(PATHWAY_COMPLAINT[pathway],PATHWAY_SPECIALTY[pathway],'mixed',answered)
 const q=p.nextQuestions[0]
 if(!q)return { action,done:true }
 return { action,field:q.key,done:false,question:{
  id:'health-ask-'+q.key,header:'Kira Clínica · Pregunta pendiente',sensitive:true,
  question:q.question+' Registra la respuesta en el expediente protegido de PHOENIX Health; no escribas aquí datos del paciente.',
  options:PROGRESS_OPTIONS,
 } }
}
/**
 * Parse only recognized labels; never treat expiry, arbitrary free text, or model inference as clinical testimony.
 * @param step - The ASK step originally shown to the clinician.
 * @param selected - The human-selected option label, if any.
 * @param automatic - Whether the provider applied an automatic response.
 * @returns Workflow intent only, never a saved clinical fact or authorization.
 */
export function interpretClinicalAsk(step:ClinicalAskStep,selected:string|undefined,automatic:boolean):ClinicalAskOutcome {
 const base={ acceptedClinicalFact:false as const,savedToRecord:false as const,clinicianReviewRequired:true as const }
 if(automatic||!selected||!step.question)return { ...base,status:'UNANSWERED',
  message:'ASK expiró o quedó sin respuesta; no se presume dato clínico ni autorización.'}
 if(!step.question.options.some(option=>option.label===selected))return { ...base,status:'UNANSWERED',
  message:'Opción no reconocida; no se registra ninguna respuesta.'}
 if(selected==='Cancelar')return { ...base,status:'CANCELLED',message:'Interrogatorio interrumpido sin cambios en el expediente.' }
 if(step.action==='choose_mode'){
  const modes:Record<string,InterviewMode>={
   'Kira guía las preguntas':'kira','Profesional dirige':'professional','Modo mixto':'mixed',
  }
  const mode=modes[selected]
  if(!mode)return { ...base,status:'UNANSWERED',message:'Modo inválido.'}
  return { ...base,status:'MODE_SELECTED',mode,message:'Modo elegido para guía; el médico debe iniciar el episodio autenticado en Health.'}
 }
 if(selected==='Dejar pendiente')return { ...base,status:'PENDING',...(step.field?{ field:step.field }:{}),
  message:'Pregunta pendiente. La falta de respuesta nunca equivale a un hallazgo negativo.' }
 if(selected==='Registrar en expediente protegido')return { ...base,status:'NEEDS_CLINIC_ENTRY',
  ...(step.field?{ field:step.field }:{}),
  message:'Abrir el episodio autorizado en PHOENIX Health y registrar la respuesta real; ASK no guarda datos clínicos.'}
 return { ...base,status:'UNANSWERED',message:'No hay evidencia suficiente de una respuesta clínica.'}
}
