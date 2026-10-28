/**
 * PHOENIX Health Engine: deterministic clinical workflow foundation.
 * No patient records, diagnoses, prescriptions or email are persisted/sent here.
 * Do not pass directly identifying patient data to model-facing tools.
 */
/** Clinical planning InterviewMode: documented type in the bounded PHOENIX clinical contract. */
export type InterviewMode = 'kira' | 'professional' | 'mixed'
/** Clinical planning EncounterStage: documented type in the bounded PHOENIX clinical contract. */
export type EncounterStage = 'opened' | 'interviewed' | 'drafted' | 'reviewed' | 'signed' | 'closed'
/** Clinical planning EncounterAction: documented type in the bounded PHOENIX clinical contract. */
export type EncounterAction = 'record-interview' | 'draft-history' | 'review-history' | 'sign-history' | 'close-encounter'

/** Clinical planning WorkflowSnapshot: documented interface in the bounded PHOENIX clinical contract. */
export interface WorkflowSnapshot {
  readonly encounterRef: string
  readonly stage: EncounterStage
  readonly revision: number
  readonly reviewedRevision: number | null
  readonly signedBy: string | null
}
/** Clinical planning WorkflowEvent: documented interface in the bounded PHOENIX clinical contract. */
export interface WorkflowEvent {
  readonly action: EncounterAction
  readonly actorRole: 'clinician' | 'assistant' | 'patient'
  readonly actorRef: string
}
const TRANSITIONS: Readonly<Record<EncounterStage, Partial<Record<EncounterAction, EncounterStage>>>> = {
  opened: { 'record-interview': 'interviewed' },
  interviewed: { 'record-interview': 'interviewed', 'draft-history': 'drafted' },
  drafted: { 'record-interview': 'interviewed', 'review-history': 'reviewed' },
  reviewed: { 'record-interview': 'interviewed', 'draft-history': 'drafted', 'sign-history': 'signed' },
  signed: { 'close-encounter': 'closed' },
  closed: {},
}
function required(value: string, field: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TypeError(`${field} debe contener entre 1 y ${max} caracteres.`)
  }
  return value.trim()
}
/** openEncounter provides bounded, deterministic clinical workflow guidance.
 * @param encounterRef - Validated encounterRef used for this clinical workflow step.
 * @returns The derived clinical workflow state or planning result.
 */
export function openEncounter(encounterRef: string): WorkflowSnapshot {
  return { encounterRef: required(encounterRef, 'Referencia', 128), stage: 'opened',
    revision: 0, reviewedRevision: null, signedBy: null }
}
/** A signature is an explicit, clinician-only state transition, never an LLM command. */
/** advanceEncounter provides bounded, deterministic clinical workflow guidance.
 * @param state - Validated state used for this clinical workflow step.
 * @param event - Validated event used for this clinical workflow step.
 * @returns The derived clinical workflow state or planning result.
 */
export function advanceEncounter(state: WorkflowSnapshot, event: WorkflowEvent): WorkflowSnapshot {
  if ([state, event].some((value: unknown) => value === null || value === undefined)) {
    throw new TypeError('Faltan el estado y el evento.')
  }
  required(state.encounterRef, 'Referencia', 128)
  required(event.actorRef, 'Profesional', 128)
  if (!Object.hasOwn(TRANSITIONS, state.stage)) throw new Error('Estado clínico no reconocido.')
  const next = TRANSITIONS[state.stage][event.action]
  if (!next) throw new Error('Transición clínica no permitida.')
  if (event.action === 'review-history' || event.action === 'sign-history') {
    if (event.actorRole !== 'clinician') throw new Error('La revisión y firma requieren un profesional habilitado.')
  }
  if (event.action === 'sign-history' && state.reviewedRevision !== state.revision) {
    throw new Error('La versión actual debe revisarse antes de firmar.')
  }
  const revision = (event.action === 'record-interview' || event.action === 'draft-history')
    ? state.revision + 1 : state.revision
  return { ...state, stage: next, revision,
    reviewedRevision: event.action === 'review-history' ? revision :
      (revision !== state.revision ? null : state.reviewedRevision),
    signedBy: event.action === 'sign-history' ? event.actorRef : state.signedBy }
}

/** Clinical planning InterviewPlan: documented interface in the bounded PHOENIX clinical contract. */
export interface InterviewPlan {
  readonly mode: InterviewMode
  readonly specialty: string
  readonly pathway: string
  readonly nextQuestions: readonly { readonly key: string; readonly question: string }[]
  readonly requiresClinicianAssessment: true
  readonly emergencyScreeningRequired: true
  readonly patientDataPersisted: false
  readonly guidance: string
}
interface Question { key: string; question: string }
const GENERAL: readonly Question[] = [
  { key: 'onset', question: '¿Cuándo comenzaron los síntomas y cómo han evolucionado?' },
  { key: 'severity', question: '¿Qué intensidad tienen y qué impacto causan en sus actividades?' },
  { key: 'associated', question: '¿Qué otros síntomas se han presentado al mismo tiempo?' },
  { key: 'alarm', question: '¿Hay signos de alarma o síntomas de aparición brusca o gravedad?' },
  { key: 'background', question: '¿Cuáles son los antecedentes, medicamentos actuales y alergias relevantes?' },
]
const PATHWAYS: readonly { regex: RegExp; name: string; questions: readonly Question[] }[] = [
  { regex: /(?:dolor abdominal|abdomen|barriga)/u, name: 'abdominal',
    questions: [
      { key: 'location', question: '¿En qué zona del abdomen se localiza y hacia dónde se irradia?' },
      { key: 'digestive', question: '¿Presenta vómitos, cambios intestinales o síntomas urinarios?' },
      { key: 'abdominal_alarm', question: '¿Existe dolor intenso progresivo, sangrado, síncope o signos de inestabilidad?' },
    ] },
  { regex: /(?:cefalea|dolor de cabeza|migraña)/u, name: 'headache',
    questions: [
      { key: 'pattern', question: '¿Cómo comenzó el dolor, cuál es su patrón y se parece a episodios anteriores?' },
      { key: 'neurological', question: '¿Aparecieron déficits neurológicos, confusión o síntomas visuales nuevos?' },
      { key: 'headache_alarm', question: '¿Comenzó súbitamente con intensidad máxima o se acompaña de otros signos de alarma?' },
    ] },
  { regex: /(?:ansiedad|tristeza|depresion|depresión|angustia)/u, name: 'mental-health',
    questions: [
      { key: 'function', question: '¿Cómo afecta a su sueño, relaciones, trabajo y actividades cotidianas?' },
      { key: 'risk', question: '¿Existe riesgo actual para su seguridad o la de otras personas que exija evaluación inmediata?' },
      { key: 'support', question: '¿Con qué apoyos cuenta y qué tratamientos ha recibido antes?' },
    ] },
]
function normalize(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/gu, '')
}
/** One question set at a time; no inference that an unanswered item is negative. */
/** planInterview provides bounded, deterministic clinical workflow guidance.
 * @param complaint - Validated complaint used for this clinical workflow step.
 * @param specialty - Validated specialty used for this clinical workflow step.
 * @param mode - Validated mode used for this clinical workflow step.
 * @param answeredFields - Validated answeredFields used for this clinical workflow step.
 * @returns The derived clinical workflow state or planning result.
 */
export function planInterview(
  complaint: string, specialty = 'general', mode: InterviewMode = 'mixed',
  answeredFields: readonly string[] = [],
): InterviewPlan {
  required(complaint, 'Motivo', 500)
  required(specialty, 'Especialidad', 100)
  if (!['kira','professional','mixed'].includes(mode)) throw new TypeError('Modo no admitido.')
  if (!Array.isArray(answeredFields) || answeredFields.length > 50 ||
      answeredFields.some(field => typeof field !== 'string' || !/^[a-z_]{1,40}$/u.test(field))) {
    throw new TypeError('Campos respondidos inválidos.')
  }
  const selected = PATHWAYS.find(item => item.regex.test(normalize(complaint)))
  const answered = new Set(answeredFields)
  const questions = [...(selected?.questions ?? []), ...GENERAL]
    .filter(item => !answered.has(item.key)).slice(0, 4)
  return { mode, specialty, pathway: selected?.name ?? 'general', nextQuestions: questions,
    requiresClinicianAssessment: true, emergencyScreeningRequired: true, patientDataPersisted: false,
    guidance: 'Propuesta de interrogatorio, no diagnóstico ni cribado de urgencias validado. ' +
      'Ante inestabilidad o signos de alarma, evaluación inmediata por el profesional. ' +
      'No se registran pacientes, ni se presume negativa ninguna respuesta faltante.' }
}

/** Clinical planning KiraMailPreflight: documented interface in the bounded PHOENIX clinical contract. */
export interface KiraMailPreflight {
  readonly senderConnected: boolean
  readonly senderVerified: boolean
  readonly recipientVerified: boolean
  readonly patientConsent: boolean
  readonly clinicianSigned: boolean
  readonly clinicianAuthorizedSend: boolean
  readonly securePortalReady: boolean
  readonly idempotencyKeyPresent: boolean
}
/** Clinical planning KiraMailPlan: documented interface in the bounded PHOENIX clinical contract. */
export interface KiraMailPlan {
  readonly approvedForQueue: boolean
  readonly blockers: readonly string[]
  readonly subject: string
  readonly delivery: 'secure-portal-notification'
  readonly sendsNow: false
  readonly requiredEvidence: readonly string[]
}
/** The transport adapter, *not* the model, must recheck evidence at send time. */
/** planKiraMail provides bounded, deterministic clinical workflow guidance.
 * @param input - Validated input used for this clinical workflow step.
 * @returns The derived clinical workflow state or planning result.
 */
export function planKiraMail(input: KiraMailPreflight): KiraMailPlan {
  const preflight: unknown = input
  if (preflight === null || typeof preflight !== 'object') throw new TypeError('Preflight inválido.')
  const rules: readonly [keyof KiraMailPreflight, string][] = [
    ['senderConnected', 'La cuenta institucional de Kira no está conectada.'],
    ['senderVerified', 'La identidad remitente de Kira no está verificada.'],
    ['recipientVerified', 'Debe verificarse la dirección del paciente.'],
    ['patientConsent', 'Falta consentimiento para comunicaciones electrónicas.'],
    ['clinicianSigned', 'El documento clínico no está firmado.'],
    ['clinicianAuthorizedSend', 'El profesional no ha autorizado el envío.'],
    ['securePortalReady', 'No existe acceso seguro al documento.'],
    ['idempotencyKeyPresent', 'Falta la clave de idempotencia para evitar duplicados.'],
  ]
  const blockers = rules.filter(([key]) => !input[key]).map(([,msg]) => msg)
  return { approvedForQueue: blockers.length === 0, blockers,
    subject: 'Información de su atención médica',
    delivery: 'secure-portal-notification', sendsNow: false,
    requiredEvidence: rules.map(([key]) => key) }
}
