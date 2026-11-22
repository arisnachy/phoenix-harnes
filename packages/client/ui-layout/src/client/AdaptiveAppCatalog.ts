/**
 * PHOENIX Adaptive Harness: static, non-privileged application contracts.
 *
 * The catalog is an allowlist of UI templates, NOT evidence that a backend,
 * connector, medical service, model or permission is currently available.
 * Clinical records are never held in these manifests or form drafts.
 */
/** String ID allows safe, user-defined draft blueprints without modifying the harness. */
export type AdaptiveAppId = string
export type AdaptiveAppReadiness = 'shell-ready' | 'preview-only'
export type AdaptiveCapabilityState = 'ui-ready' | 'requires-authentication' | 'not-connected' | 'disabled'
export type AdaptiveInputKind = 'text' | 'number' | 'date' | 'select' | 'textarea'
export type AdaptiveDestination = 'local' | 'api' | 'chat' | 'ai'
export type AdaptiveOutput = 'inline' | 'table' | 'document' | 'chat'
export interface AdaptiveCapability {
  readonly id: string
  readonly label: string
  readonly state: AdaptiveCapabilityState
  readonly explanation: string
  readonly sensitive: boolean
}
export interface AdaptiveAppPreset {
  readonly id: AdaptiveAppId
  readonly label: string
  readonly readiness: AdaptiveAppReadiness
  readonly roles: readonly string[]
  readonly surfaces: readonly string[]
  readonly capabilities: readonly AdaptiveCapability[]
}
export interface AdaptiveFieldBinding {
  readonly destination: AdaptiveDestination
  readonly output: AdaptiveOutput
  readonly capabilityId?: string
}
export interface AdaptiveFormField {
  readonly id: string
  readonly label: string
  readonly kind: AdaptiveInputKind
  readonly required: boolean
  /** The form editor cannot delete protected identity/clinical fields. */
  readonly protected: boolean
  readonly binding: AdaptiveFieldBinding
}
export interface AdaptiveFormDraft {
  readonly version: 1
  readonly appId: AdaptiveAppId
  readonly templateId: string
  readonly revision: number
  readonly state: 'local-draft'
  readonly fields: readonly AdaptiveFormField[]
}

const HEALTHIA_CAPABILITIES: readonly AdaptiveCapability[] = [
  { id: 'phoenix.chat', label: 'Chat y modelos de PHOENIX', state: 'ui-ready', explanation: 'Conserva la conversación general; los datos clínicos no se insertan automáticamente en el contexto.', sensitive: false },
  { id: 'phoenix.adaptive-ui', label: 'Interfaz y formularios declarativos', state: 'ui-ready', explanation: 'Vista adaptativa y edición de estructura en borrador local.', sensitive: false },
  { id: 'healthia.clinical-ui', label: 'Historia clínica protegida', state: 'requires-authentication', explanation: 'El Host clínico local cifrado permite registro de pacientes, consultas y borradores tras autenticación. La interfaz comprueba disponibilidad, permisos y sesión en ejecución.', sensitive: true },
  { id: 'healthia.patient-portal', label: 'Acceso del paciente', state: 'not-connected', explanation: 'No hay portal del paciente autenticado vinculado a este espacio.', sensitive: true },
  { id: 'healthia.api-actions', label: 'Acciones clínicas y conectores', state: 'requires-authentication', explanation: 'Paciente, consulta y nota nativa utilizan únicamente el Host clínico con rol, relación asistencial, CSRF y control de versiones. El chat no recibe estos permisos ni datos.', sensitive: true },
  { id: 'healthia.phoenix-exchange', label: 'Intercambio PHOENIX a PHOENIX', state: 'disabled', explanation: 'Contrato de intenciones solamente; no existe transmisión de expedientes.', sensitive: true },
]
export const ADAPTIVE_APP_PRESETS: readonly AdaptiveAppPreset[] = [
  {
    id: 'general', label: 'PHOENIX · General', readiness: 'shell-ready',
    roles: ['general'], surfaces: ['chat', 'tools', 'agents', 'sessions'],
    capabilities: [{ id: 'phoenix.chat', label: 'Conversación universal', state: 'ui-ready', explanation: 'Modo base y restauración de interfaz.', sensitive: false }],
  },
  {
    id: 'healthia', label: 'Healthia · Médico y paciente', readiness: 'shell-ready',
    roles: ['doctor', 'patient'], surfaces: ['chat', 'sidebar', 'forms', 'clinical-entry'],
    capabilities: HEALTHIA_CAPABILITIES,
  },
  {
    id: 'inventory', label: 'Inventario · Plantilla', readiness: 'preview-only',
    roles: ['manager'], surfaces: ['forms', 'table', 'reports'],
    capabilities: [{ id: 'inventory.backend', label: 'Inventario persistente', state: 'not-connected', explanation: 'Plantilla disponible para construir, sin almacén de datos integrado.', sensitive: false }],
  },
]

/** Read-only capability discovery: never returns keys, patient data or machine details. */
export function describeAdaptiveApp(id: string): AdaptiveAppPreset | undefined {
  return ADAPTIVE_APP_PRESETS.find(preset => preset.id === id)
}

/** No dynamic execution: a binding is metadata until an authorized adapter exists. */
export function isBindingConnected(binding: AdaptiveFieldBinding, capabilities: readonly AdaptiveCapability[]): boolean {
  return binding.destination === 'local' && (
    binding.capabilityId === undefined
    || capabilities.some(cap => cap.id === binding.capabilityId && cap.state === 'ui-ready' && !cap.sensitive)
  )
}

function validLabel(label: unknown): label is string {
  return typeof label === 'string' && label === label.trim() && label.length >= 1
    && label.length <= 60 && !/[\x00-\x1f\x7f]/u.test(label)
}
function validId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z][a-z0-9-]{0,47}$/u.test(id)
}
const FORM_KEYS = new Set(['version', 'appId', 'templateId', 'revision', 'state', 'fields'])
const FIELD_KEYS = new Set(['id', 'label', 'kind', 'required', 'protected', 'binding'])
const BINDING_KEYS = new Set(['destination', 'output', 'capabilityId'])
const INPUT_KEYS = new Set(['label', 'kind', 'destination', 'output'])
function onlyKeys(value: object, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every(key => keys.has(key))
}
function validField(field: unknown): field is AdaptiveFormField {
  if (!field || typeof field !== 'object' || Array.isArray(field)) return false
  const item = field as Partial<AdaptiveFormField>
  const b = item.binding
  if (!onlyKeys(field, FIELD_KEYS) || !b || typeof b !== 'object' || Array.isArray(b)
    || !onlyKeys(b, BINDING_KEYS)) return false
  return validId(item.id) && validLabel(item.label)
    && (['text', 'number', 'date', 'select', 'textarea'] as unknown[]).includes(item.kind)
    && typeof item.required === 'boolean' && typeof item.protected === 'boolean'
    && !!b && (['local', 'api', 'chat', 'ai'] as unknown[]).includes(b.destination)
    && (['inline', 'table', 'document', 'chat'] as unknown[]).includes(b.output)
    && (b.capabilityId === undefined || validId(b.capabilityId))
}
export function validateAdaptiveDraft(value: unknown): value is AdaptiveFormDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const d = value as Partial<AdaptiveFormDraft>
  if (!onlyKeys(value, FORM_KEYS) || d.version !== 1 || d.state !== 'local-draft' || !validId(d.appId)
    || !validId(d.templateId) || !Number.isSafeInteger(d.revision) || (d.revision ?? -1) < 0
    || !Array.isArray(d.fields) || d.fields.length > 40 || !d.fields.every(validField)) return false
  return new Set(d.fields.map(field => field.id)).size === d.fields.length
}

/** Configuration, not patient values. No scripts, URLs or executable callbacks accepted. */
export function addAdaptiveField(
  draft: AdaptiveFormDraft, input: { label: string; kind: AdaptiveInputKind; destination: AdaptiveDestination; output: AdaptiveOutput },
  expectedRevision = draft.revision,
): AdaptiveFormDraft {
  if (!validateAdaptiveDraft(draft)) throw new Error('ADAPTIVE_INVALID_DRAFT')
  if (expectedRevision !== draft.revision) throw new Error('ADAPTIVE_REVISION_CONFLICT')
  if (!onlyKeys(input, INPUT_KEYS) || !validLabel(input.label) || !(['text','number','date','select','textarea'] as unknown[]).includes(input.kind)
    || !(['local','api','chat','ai'] as unknown[]).includes(input.destination)
    || !(['inline','table','document','chat'] as unknown[]).includes(input.output)) throw new Error('ADAPTIVE_INVALID_FIELD')
  if (draft.fields.some(field => field.label.toLowerCase() === input.label.toLowerCase())) throw new Error('ADAPTIVE_DUPLICATE_LABEL')
  if (draft.fields.length >= 40) throw new Error('ADAPTIVE_LIMIT')
  const id = `field-${String(draft.revision + 1)}`
  if (draft.fields.some(field => field.id === id)) throw new Error('ADAPTIVE_DUPLICATE_ID')
  const next: AdaptiveFormDraft = {
    ...draft, revision: draft.revision + 1,
    fields: [...draft.fields, {
      id, label: input.label, kind: input.kind, required: false, protected: false,
      binding: { destination: input.destination, output: input.output },
    }],
  }
  if (!validateAdaptiveDraft(next)) throw new Error('ADAPTIVE_INVALID_RESULT')
  return next
}
export function removeAdaptiveField(draft: AdaptiveFormDraft, id: string, expectedRevision = draft.revision): AdaptiveFormDraft {
  if (!validateAdaptiveDraft(draft)) throw new Error('ADAPTIVE_INVALID_DRAFT')
  if (expectedRevision !== draft.revision) throw new Error('ADAPTIVE_REVISION_CONFLICT')
  const field = draft.fields.find(item => item.id === id)
  if (!field || field.protected) throw new Error('ADAPTIVE_PROTECTED_OR_MISSING_FIELD')
  return { ...draft, revision: draft.revision + 1, fields: draft.fields.filter(item => item.id !== id) }
}
/** Deterministic fallback to previous validated configuration if a proposal is malformed. */
export function recoverAdaptiveDraft(previous: AdaptiveFormDraft, proposed: unknown): AdaptiveFormDraft {
  if (!validateAdaptiveDraft(previous)) throw new Error('ADAPTIVE_NO_SAFE_SNAPSHOT')
  if (!validateAdaptiveDraft(proposed) || proposed.appId !== previous.appId
    || proposed.templateId !== previous.templateId || proposed.revision !== previous.revision + 1) return previous
  const protectedPrior = previous.fields.filter(field => field.protected)
  if (protectedPrior.some(field => !proposed.fields.some(candidate =>
    candidate.id === field.id && candidate.label === field.label && candidate.protected === true))) return previous
  return proposed
}

/** Form metadata preview only; clinical values are never collected here. */
export const HEALTHIA_DOCTOR_FORM: AdaptiveFormDraft = {
  version: 1, appId: 'healthia', templateId: 'consultation', revision: 0, state: 'local-draft',
  fields: [
    { id: 'patient-reference', label: 'Referencia clínica protegida', kind: 'text', required: true, protected: true, binding: { destination: 'local', output: 'inline' } },
    { id: 'reason', label: 'Motivo de consulta', kind: 'textarea', required: true, protected: false, binding: { destination: 'local', output: 'inline' } },
    { id: 'history', label: 'Antecedentes', kind: 'textarea', required: false, protected: false, binding: { destination: 'local', output: 'inline' } },
    { id: 'vitals', label: 'Signos vitales', kind: 'text', required: false, protected: false, binding: { destination: 'local', output: 'inline' } },
  ],
}

/** Create a non-executable local app blueprint. No filesystem writes or network calls. */
export interface AdaptiveAppBlueprint {
  readonly version: 1
  readonly id: string
  readonly title: string
  readonly status: 'preview-only'
  readonly sections: readonly { readonly id: string; readonly label: string }[]
}
export function createAdaptiveAppBlueprint(title: string, sections: readonly string[]): AdaptiveAppBlueprint {
  if (!validLabel(title) || !Array.isArray(sections) || sections.length < 1 || sections.length > 12
    || sections.some(label => !validLabel(label))) throw new Error('ADAPTIVE_INVALID_APP')
  const slug = (text: string): string => text.toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '').replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '').slice(0, 38).replace(/-$/u, '')
  const id = `app-${slug(title)}`
  if (!validId(id) || id === 'app-' || describeAdaptiveApp(id)) throw new Error('ADAPTIVE_INVALID_APP_ID')
  const ids = new Set<string>()
  const safeSections = sections.map(label => {
    const sectionId = slug(label)
    if (!validId(sectionId) || ids.has(sectionId)) throw new Error('ADAPTIVE_DUPLICATE_SECTION')
    ids.add(sectionId)
    return { id: sectionId, label }
  })
  return { version: 1, id, title, status: 'preview-only', sections: safeSections }
}
