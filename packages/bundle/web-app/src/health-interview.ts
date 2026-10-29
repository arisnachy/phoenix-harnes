/** Deterministic protected-clinic interview guide, separate from model-facing Kira tools.
 * It runs entirely inside the loopback Health Host and never sends clinical text to an LLM.
 */

/** Supported local clinical interview mode. */
export type ClinicalInterviewMode = 'kira' | 'professional' | 'mixed'
/** A single non-diagnostic suggested interview question. */
export interface ClinicalInterviewQuestion { readonly key:string;readonly question:string }
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
  { key:'onset',question:'¿Cuándo comenzaron y cómo han evolucionado los síntomas?' },
  { key:'severity',question:'¿Qué gravedad y repercusión funcional tienen?' },
  { key:'associated',question:'¿Qué otros síntomas se presentaron?' },
  { key:'alarm',question:'¿Existen signos de alarma, inicio brusco o inestabilidad?' },
  { key:'background',question:'¿Qué antecedentes, medicamentos y alergias son relevantes?' },
]
const SPECIAL:Readonly<Record<string,readonly ClinicalInterviewQuestion[]>>={
  respiratory:[
    { key:'respiratory_duration',question:'¿Desde cuándo hay tos o dificultad respiratoria y cómo ha cambiado?' },
    { key:'respiratory_features',question:'¿Hay fiebre, expectoración o factores desencadenantes?' },
    { key:'respiratory_alarm',question:'¿Hay disnea en reposo, cianosis, confusión u otros signos de alarma?' },
  ],
  cardiovascular:[
    { key:'chest_pattern',question:'¿Cómo comenzó el síntoma torácico, duración, esfuerzo y factores asociados?' },
    { key:'cardiac_associated',question:'¿Hay síncope, palpitaciones, sudoración o dificultad respiratoria?' },
    { key:'cardiac_alarm',question:'¿Existen dolor persistente, inestabilidad o signos de alarma que exijan atención inmediata?' },
  ],
  urinary:[
    { key:'urinary_symptoms',question:'¿Hay síntomas miccionales y cuál fue su evolución?' },
    { key:'urinary_associated',question:'¿Hay fiebre, dolor lumbar, sangrado o síntomas generales?' },
    { key:'urinary_alarm',question:'¿Hay retención, compromiso general o signos de infección grave?' },
  ],
  musculoskeletal:[
    { key:'injury_mechanism',question:'¿Hubo traumatismo o sobrecarga y cómo limita la movilidad?' },
    { key:'joint_features',question:'¿Existen inflamación, deformidad, fiebre o déficit funcional?' },
    { key:'joint_alarm',question:'¿Hay pérdida de fuerza, sensibilidad, compromiso vascular o dolor desproporcionado?' },
  ],
  pediatric:[
    { key:'caregiver_history',question:'¿Quién aporta la historia y cuál es la evolución observada por el cuidador?' },
    { key:'child_intake',question:'¿Cómo están alimentación, hidratación y comportamiento habitual?' },
    { key:'pediatric_alarm',question:'¿Existen dificultad respiratoria, letargia, deshidratación u otros signos de alarma?' },
  ],
  obstetric:[
    { key:'gestational_context',question:'¿Cuál es la edad gestacional documentada y el motivo de esta consulta?' },
    { key:'pregnancy_symptoms',question:'¿Qué síntomas o controles prenatales están registrados?' },
    { key:'obstetric_alarm',question:'¿Hay sangrado, dolor intenso, cefalea grave, convulsiones o signos de alarma?' },
  ],
  dermatology:[
    { key:'skin_timeline',question:'¿Cuándo apareció la lesión, dónde inició y cómo evolucionó?' },
    { key:'skin_exposure',question:'¿Qué exposiciones, tratamientos o síntomas asociados refiere?' },
    { key:'skin_alarm',question:'¿Hay fiebre, afectación mucosa, lesiones rápidamente progresivas o compromiso sistémico?' },
  ],
  metabolic:[
    { key:'metabolic_history',question:'¿Qué tratamiento metabólico y controles previos están documentados?' },
    { key:'metabolic_symptoms',question:'¿Hay poliuria, polidipsia, cambios de peso o episodios de hipoglucemia?' },
    { key:'metabolic_alarm',question:'¿Hay alteración del sensorio, deshidratación o signos de descompensación aguda?' },
  ],
  ent:[
    { key:'ear_history',question:'¿Cómo comenzaron los síntomas auditivos o vestibulares y cómo evolucionaron?' },
    { key:'ear_associated',question:'¿Hay secreción, fiebre, pérdida auditiva o vértigo asociado?' },
    { key:'ear_alarm',question:'¿Hay pérdida auditiva súbita, signos neurológicos o infección con compromiso general?' },
  ],
  abdominal:[
    { key:'location',question:'¿Dónde se localiza el dolor y hacia dónde se irradia?' },
    { key:'digestive',question:'¿Existen síntomas digestivos o urinarios asociados?' },
    { key:'abdominal_alarm',question:'¿Hay sangrado, síncope o dolor rápidamente progresivo?' },
  ],
  headache:[
    { key:'pattern',question:'¿Cómo comenzó el dolor y es similar a episodios anteriores?' },
    { key:'neurological',question:'¿Existen déficits neurológicos o alteraciones visuales nuevas?' },
    { key:'headache_alarm',question:'¿El dolor alcanzó súbitamente su intensidad máxima?' },
  ],
  'mental-health':[
    { key:'function',question:'¿Cómo afecta al sueño, trabajo y relaciones?' },
    { key:'risk',question:'¿Hay riesgo actual que requiera evaluación profesional inmediata?' },
    { key:'support',question:'¿Qué apoyos y tratamientos previos existen?' },
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
export function localInterviewPlan(
  complaint:string,specialty:string,mode:ClinicalInterviewMode,answered:readonly string[],
):ClinicalInterviewGuide {
  const c=required(complaint,'Motivo',500).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/gu,'')
  const s=required(specialty,'Especialidad',100)
  if(!['kira','professional','mixed'].includes(mode))throw new TypeError('Modo inválido')
  if(!Array.isArray(answered)||answered.length>50||answered.some((x:unknown)=>typeof x!=='string'||!/^[a-z_]{1,40}$/u.test(x)))
    throw new TypeError('Preguntas registradas inválidas')
  const specialtyText=s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/gu,'')
  const pathway=/(?:dolor abdominal|abdomen|barriga)/u.test(c)?'abdominal':
    /(?:cefalea|migraña|dolor de cabeza)/u.test(c)?'headache':
      /(?:ansiedad|depresion|tristeza|angustia)/u.test(c)?'mental-health':
        /(?:tos|disnea|dificultad respiratoria|falta de aire)/u.test(c)||/(?:neumologia)/u.test(specialtyText)?'respiratory':
          /(?:dolor toracico|dolor en el pecho|palpitaciones)/u.test(c)||/(?:cardiologia)/u.test(specialtyText)?'cardiovascular':
            /(?:disuria|dolor al orinar|hematuria|infeccion urinaria)/u.test(c)||/(?:urologia)/u.test(specialtyText)?'urinary':
              /(?:dolor articular|dolor lumbar|rodilla|traumatismo|lesion muscular)/u.test(c)||/(?:traumatologia)/u.test(specialtyText)?'musculoskeletal':
                /(?:pediatria|nino|nina|lactante|fiebre infantil)/u.test(c)||/(?:pediatria)/u.test(specialtyText)?'pediatric':
                  /(?:embarazo|prenatal|gestacion|obstetricia)/u.test(c)||/(?:obstetricia)/u.test(specialtyText)?'obstetric':
                    /(?:piel|lesion cutanea|erupcion|sarpullido)/u.test(c)||/(?:dermatologia)/u.test(specialtyText)?'dermatology':
                      /(?:diabetes|glucosa|glicemia|hipoglucemia|hiperglucemia)/u.test(c)||/(?:endocrinologia)/u.test(specialtyText)?'metabolic':
                        /(?:dolor de oido|otitis|hipoacusia|audicion|vertigo)/u.test(c)||/(?:otorrinolaringologia)/u.test(specialtyText)?'ent':
                          'general'
  const remaining=[...(SPECIAL[pathway]??[]),...COMMON].filter(x=>!answered.includes(x.key)).slice(0,4)
  return { mode,specialty:s,pathway,nextQuestions:remaining,patientDataPersisted:false,
    requiresClinicianAssessment:true,emergencyScreeningRequired:true,
    guidance:'Guía estructurada, no diagnóstico ni evaluación de urgencias. El profesional confirma respuestas y signos de alarma.' }
}
