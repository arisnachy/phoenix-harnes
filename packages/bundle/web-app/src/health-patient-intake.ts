/**
 * Safe, operator-editable patient intake contracts for the local encrypted clinic.
 * This deliberately cannot execute JS or call external identity providers.
 * The professional /health record remains separate from conversational demos.
 */
export type PatientInputKind = 'text' | 'number' | 'date' | 'email' | 'tel' | 'select'
export interface PatientInputField {
  readonly id: string
  readonly label: string
  readonly kind: PatientInputKind
  readonly required: boolean
  readonly choices?: readonly string[]
}
export interface PatientIntakeTemplate {
  readonly version: 1
  readonly revision: number
  readonly fields: readonly PatientInputField[]
}
export interface CandidateIdentity {
  readonly name?: unknown
  readonly dateOfBirth?: unknown
  readonly documentNumber?: unknown
  readonly documentType?: unknown
  readonly phone?: unknown
  readonly email?: unknown
}
export type IdentityMatch = 'document' | 'name-and-birth' | 'contact-and-birth' | null

export const DEFAULT_PATIENT_INTAKE: PatientIntakeTemplate = Object.freeze({
  version: 1, revision: 0,
  fields: Object.freeze([
    { id: 'custom_sexo_registrado', label: 'Sexo registrado al nacimiento', kind: 'text', required: false },
    { id: 'custom_nacionalidad', label: 'Nacionalidad', kind: 'text', required: false },
    { id: 'custom_direccion', label: 'Dirección y referencia de domicilio', kind: 'text', required: false },
    { id: 'custom_municipio', label: 'Municipio / localidad', kind: 'text', required: false },
    { id: 'custom_provincia', label: 'Provincia', kind: 'text', required: false },
    { id: 'custom_ocupacion', label: 'Ocupación', kind: 'text', required: false },
    { id: 'custom_estado_civil', label: 'Estado civil', kind: 'text', required: false },
    { id: 'custom_ars', label: 'ARS / Seguro', kind: 'text', required: false },
    { id: 'custom_numero_poliza', label: 'Número de póliza o afiliación', kind: 'text', required: false },
    { id: 'custom_contacto_emergencia', label: 'Contacto de emergencia y parentesco', kind: 'text', required: false },
    { id: 'custom_telefono_emergencia', label: 'Teléfono de emergencia', kind: 'tel', required: false },
    { id: 'custom_datos_adicionales', label: 'Otros datos de admisión', kind: 'text', required: false },
  ]),
})
const KINDS = new Set<PatientInputKind>(['text', 'number', 'date', 'email', 'tel', 'select'])
const MAX_FIELDS = 64
const clean = (value: string): string =>
  value.trim().normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
const nameKey = (value: unknown): string =>
  typeof value === 'string' ? clean(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : ''
const documentKey = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toUpperCase().replace(/[^A-Z0-9]/gu, '') : ''
const phoneKey = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/[^\d]/gu, '').replace(/^1(?=\d{10}$)/u, '') : ''
const emailKey = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : ''

function formError(message: string): never { throw new Error('Plantilla de pacientes: ' + message) }
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    formError('objeto inválido')
  return value as Record<string, unknown>
}
function validText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
    && !/[\u0000-\u001f\u007f]/u.test(value)
}

/** Validate a schema authored by a clinic administrator; no custom executable callbacks. */
export function parsePatientIntakeTemplate(value: unknown, revision: number): PatientIntakeTemplate {
  const input = record(value)
  if (input.version !== 1 || !Array.isArray(input.fields) || input.fields.length > MAX_FIELDS)
    formError('versión o cantidad de campos inválida')
  if (!Number.isSafeInteger(revision) || revision < 0) formError('revisión inválida')
  const keys = new Set<string>()
  const fields: PatientInputField[] = input.fields.map((entry: unknown) => {
    const field = record(entry)
    if (Object.keys(field).some(key => !['id','label','kind','required','choices'].includes(key)))
      formError('propiedad desconocida')
    if (typeof field.id !== 'string' || !/^custom_[a-z][a-z0-9_]{0,30}$/u.test(field.id)
      || keys.has(field.id)) formError('identificador de campo inválido o repetido')
    keys.add(field.id)
    if (!validText(field.label,80) || !KINDS.has(field.kind as PatientInputKind)
      || field.required !== true && field.required !== false) formError('etiqueta, tipo o requisito inválido')
    const choices=field.choices
    if (field.kind === 'select') {
      if (!Array.isArray(choices) || choices.length < 2 || choices.length > 20
        || choices.some(option => !validText(option,60))) formError('opciones de selección inválidas')
      if (new Set(choices).size !== choices.length) formError('opciones duplicadas')
    } else if (choices !== undefined) formError('las opciones solo se permiten en selección')
    return {
      id: field.id, label: field.label.trim(), kind: field.kind as PatientInputKind,
      required: field.required as boolean,
      ...(field.kind === 'select' ? { choices: [...(choices as string[])] } : {}),
    }
  })
  return { version: 1, revision, fields }
}

/** Enforce the configured schema at the encrypted EHR boundary. */
export function patientIntakeValues(template: PatientIntakeTemplate, value: unknown): Record<string,string> {
  if (value === undefined || value === null) value = {}
  const input = record(value)
  const declared = new Set(template.fields.map(field => field.id))
  if (Object.keys(input).some(key => !declared.has(key))) formError('campo no autorizado')
  const result: Record<string,string> = {}
  for (const field of template.fields) {
    const raw = input[field.id]
    if (raw === undefined || raw === null || raw === '') {
      if (field.required) formError(field.label + ' es obligatorio')
      continue
    }
    if (typeof raw !== 'string' || raw.length > 250 || /[\u0000-\u001f\u007f]/u.test(raw))
      formError('valor inválido para ' + field.label)
    const normalized = raw.trim()
    if (!normalized) {
      if (field.required) formError(field.label + ' es obligatorio')
      continue
    }
    if (field.kind === 'number' && (!Number.isFinite(Number(normalized)) || normalized.length > 24))
      formError('número inválido para ' + field.label)
    if (field.kind === 'date' && (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)
      || !Number.isFinite(Date.parse(normalized)))) formError('fecha inválida para ' + field.label)
    if (field.kind === 'email' && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/u.test(normalized))
      formError('correo inválido para ' + field.label)
    if (field.kind === 'tel' && !/^[+\d() .-]{7,30}$/u.test(normalized))
      formError('teléfono inválido para ' + field.label)
    if (field.kind === 'select' && !field.choices?.includes(normalized))
      formError('opción no autorizada para ' + field.label)
    result[field.id] = normalized
  }
  return result
}

/** Format-only document validation; it is NOT a JCE identity verification. */
export function validatePatientDocument(type: unknown, value: unknown): {
  documentType: 'cedula' | 'passport' | 'other'
  documentNumber: string
} | null {
  if (value === undefined || value === null || value === '') return null
  const documentType = type === 'cedula' || type === 'passport' || type === 'other'
    ? type : 'other'
  const documentNumber = documentKey(value)
  if (documentType === 'cedula') {
    if (!/^\d{11}$/u.test(documentNumber)) throw new Error('La cédula debe contener 11 dígitos (validación de formato, no de identidad)')
  } else if (!/^[A-Z0-9]{4,32}$/u.test(documentNumber))
    throw new Error('Documento de identidad inválido')
  return { documentType, documentNumber }
}

/** Conservative matching: a shared phone/email alone never proves identity. */
export function patientIdentityMatch(a: CandidateIdentity, b: CandidateIdentity): IdentityMatch {
  const ad = documentKey(a.documentNumber)
  const bd = documentKey(b.documentNumber)
  if (ad && bd && ad === bd && a.documentType === b.documentType) return 'document'
  const birth = typeof a.dateOfBirth === 'string' && a.dateOfBirth === b.dateOfBirth && a.dateOfBirth !== ''
  if (!birth) return null
  if (nameKey(a.name) && nameKey(a.name) === nameKey(b.name)) return 'name-and-birth'
  if (emailKey(a.email) && emailKey(a.email) === emailKey(b.email)) return 'contact-and-birth'
  const ap = phoneKey(a.phone), bp = phoneKey(b.phone)
  if (ap.length >= 10 && ap === bp) return 'contact-and-birth'
  return null
}
