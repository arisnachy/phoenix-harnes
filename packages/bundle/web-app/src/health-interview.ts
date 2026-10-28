/** Deterministic protected-clinic interview guide, separate from model-facing Kira tools.
 * It runs entirely inside the loopback Health Host and never sends clinical text to an LLM.
 */

/** Supported local clinical interview mode. */
export type ClinicalInterviewMode = 'kira' | 'professional' | 'mixed'
/** A single non-diagnostic suggested interview question. */
export interface ClinicalInterviewQuestion {readonly key:string;readonly question:string}
/** A bounded, non-diagnostic set of questions to review with the patient. */
export interface ClinicalInterviewGuide {
 readonly mode:ClinicalInterviewMode
 readonly specialty:string
 readonly pathway:string
 readonly nextQuestions:readonly ClinicalInterviewQuestion[]
 readonly patientDataPersisted:false
 readonly requiresClinicianAssessment:true
 readonly emergencyScreeningRequired:true
 readonly guidance:string
}
const COMMON:readonly ClinicalInterviewQuestion[]=[
 {key:'onset',question:'¿Cuándo comenzaron y cómo han evolucionado los síntomas?'},
 {key:'severity',question:'¿Qué gravedad y repercusión funcional tienen?'},
 {key:'associated',question:'¿Qué otros síntomas se presentaron?'},
 {key:'alarm',question:'¿Existen signos de alarma, inicio brusco o inestabilidad?'},
 {key:'background',question:'¿Qué antecedentes, medicamentos y alergias son relevantes?'},
]
const SPECIAL:Readonly<Record<string,readonly ClinicalInterviewQuestion[]>>={
 abdominal:[
  {key:'location',question:'¿Dónde se localiza el dolor y hacia dónde se irradia?'},
  {key:'digestive',question:'¿Existen síntomas digestivos o urinarios asociados?'},
  {key:'abdominal_alarm',question:'¿Hay sangrado, síncope o dolor rápidamente progresivo?'},
 ],
 headache:[
  {key:'pattern',question:'¿Cómo comenzó el dolor y es similar a episodios anteriores?'},
  {key:'neurological',question:'¿Existen déficits neurológicos o alteraciones visuales nuevas?'},
  {key:'headache_alarm',question:'¿El dolor alcanzó súbitamente su intensidad máxima?'},
 ],
 'mental-health':[
  {key:'function',question:'¿Cómo afecta al sueño, trabajo y relaciones?'},
  {key:'risk',question:'¿Hay riesgo actual que requiera evaluación profesional inmediata?'},
  {key:'support',question:'¿Qué apoyos y tratamientos previos existen?'},
 ],
}
function required(value:unknown,label:string,max:number):string{
 if(typeof value!=='string'||!value.trim()||value.length>max)throw new TypeError(label+' inválido')
 return value.trim()
}
/** Derive up to four generic questions from a clinician-authorized encounter.
 * @param complaint - Reason for consultation, processed only on the protected Host.
 * @param specialty - Professional specialty, not a clinical diagnosis.
 * @param mode - Whether Kira, the professional, or both guide the interview.
 * @param answered - Question identifiers already answered in the encrypted encounter.
 * @returns Generic next-step questions and explicit safety requirements.
 */
export function localInterviewPlan(complaint:string,specialty:string,mode:ClinicalInterviewMode,answered:readonly string[]):ClinicalInterviewGuide {
 const c=required(complaint,'Motivo',500).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/gu,'')
 const s=required(specialty,'Especialidad',100)
 if(!['kira','professional','mixed'].includes(mode))throw new TypeError('Modo inválido')
 if(!Array.isArray(answered)||answered.length>50||answered.some(x=>!/^[a-z_]{1,40}$/u.test(x)))
  throw new TypeError('Preguntas registradas inválidas')
 const pathway=/(?:dolor abdominal|abdomen|barriga)/u.test(c)?'abdominal':
   /(?:cefalea|migraña|dolor de cabeza)/u.test(c)?'headache':
   /(?:ansiedad|depresion|tristeza|angustia)/u.test(c)?'mental-health':'general'
 const remaining=[...(SPECIAL[pathway]??[]),...COMMON].filter(x=>!answered.includes(x.key)).slice(0,4)
 return {mode,specialty:s,pathway,nextQuestions:remaining,patientDataPersisted:false,
  requiresClinicianAssessment:true,emergencyScreeningRequired:true,
  guidance:'Guía estructurada, no diagnóstico ni evaluación de urgencias. El profesional confirma respuestas y signos de alarma.'}
}
