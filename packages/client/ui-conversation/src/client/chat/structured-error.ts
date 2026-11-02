/** Presentation-only normalization for structured errors shown in chat. */

const MAX_INPUT_LENGTH = 64 * 1024
const MAX_FIELDS = 24
const MAX_DEPTH = 4
const MAX_VALUE_LENGTH = 4_096

/** One safe, user-facing field extracted from a structured error payload. */
export interface StructuredErrorField {
  readonly label: string
  readonly value: string
  readonly technical: boolean
}

/** Localized, bounded presentation of a structured provider error. */
export interface StructuredErrorPresentation {
  readonly title: string
  readonly message?: string
  readonly code?: string
  readonly fields: readonly StructuredErrorField[]
  readonly action?: string
  /** Complete provider payload, preserved semantically and pretty-printed only for opt-in inspection. */
  readonly rawJson: string
}

type JsonRecord = Record<string, unknown>

const LABELS: Readonly<Record<string, string>> = {
  code: 'Código',
  status: 'Estado',
  type: 'Tipo',
  provider_name: 'Proveedor',
  provider: 'Proveedor',
  model: 'Modelo',
  model_name: 'Modelo',
  raw: 'Detalle',
  detail: 'Detalle',
  details: 'Detalles',
  limit_source: 'Origen del límite',
  is_byok: 'BYOK',
  request_id: 'ID de solicitud',
  trace_id: 'ID de traza',
  error_id: 'ID de error',
  retry_after: 'Reintentar después de',
  retry_after_ms: 'Reintentar después de (ms)',
  endpoint: 'Endpoint',
  url: 'URL',
}

const PROSE_KEYS = new Set(['message', 'raw', 'detail', 'details', 'remedy_hint', 'hint', 'reason'])
// Verbose provider payloads belong in the opt-in raw JSON disclosure, not in the friendly summary.
const OMITTED_KEYS = new Set(['message', 'remedy_hint', 'raw', 'previous_errors'])

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bounded(value: string): string {
  return value.length <= MAX_VALUE_LENGTH ? value : `${value.slice(0, MAX_VALUE_LENGTH)}…`
}

/** Translate only generic error prose, never identifiers, provider/model names, enum values, IDs or URLs.
 * @param value - Error prose to translate.
 * @returns The translated prose, preserving unknown text.
 */
export function translateGenericErrorProse(value: string): string {
  return value
    .replace(/\bThis request requires more credits, or fewer max_tokens\b/giu, 'Esta solicitud requiere más créditos o un max_tokens menor')
    .replace(/\bYou requested up to ([\d,]+) tokens, but can only afford ([\d,]+)\b/giu, 'Solicitaste hasta $1 tokens, pero el saldo disponible solo cubre aproximadamente $2')
    .replace(/\bPrompt tokens limit exceeded:\s*([\d,]+)\s*>\s*([\d,]+)/giu, 'Límite de tokens del contexto superado: $1 > $2')
    .replace(/\bProvider returned error\b/giu, 'El proveedor devolvió un error')
    .replace(/\bis temporarily rate-limited upstream\b/giu, 'está temporalmente limitado por el proveedor upstream')
    .replace(/\btemporarily rate-limited\b/giu, 'temporalmente limitado')
    .replace(/\brate limit(?:ed)?\b/giu, 'límite de solicitudes')
    .replace(/\bPlease retry shortly\b/giu, 'Reintenta en unos momentos')
    .replace(/\bRetry shortly\b/giu, 'Reintenta en unos momentos')
    .replace(/\btry again later\b/giu, 'inténtalo de nuevo más tarde')
    .replace(/\btemporarily unavailable\b/giu, 'temporalmente no disponible')
    .replace(/\bservice unavailable\b/giu, 'servicio no disponible')
    .replace(/\brequest timed out\b/giu, 'la solicitud excedió el tiempo de espera')
    .replace(/\btimeout\b/giu, 'tiempo de espera agotado')
    .replace(/\bunauthorized\b/giu, 'no autorizado')
    .replace(/\bforbidden\b/giu, 'acceso denegado')
    .replace(/\bnot found\b/giu, 'no encontrado')
    .replace(/\binternal server error\b/giu, 'error interno del servidor')
    .replace(/\bAdd credits at\b/giu, 'Añade créditos en')
    .replace(/\bor lower max_tokens \/ prompt size to fit your remaining balance\b/giu, 'o reduce max_tokens / el tamaño del contexto para ajustarte al saldo restante')
    .replace(/\bTo increase, visit\b/giu, 'Para ampliarlo, visita')
    .replace(/\badd your own provider key\b/giu, 'añade tu propia clave del proveedor')
    .replace(/\bor route to another provider with provider routing\b/giu, 'o cambia a otro proveedor mediante provider routing')
}

function scalarText(value: unknown, prose: boolean): string | undefined {
  if (typeof value === 'string') return bounded(prose ? translateGenericErrorProse(value) : value)
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (value === null) return '—'
  return undefined
}

function labelFor(key: string, path: readonly string[]): string {
  const known = LABELS[key]
  if (known !== undefined) return known
  return path.length <= 1 ? key : path.join('.')
}

function flatten(
  value: unknown,
  fields: StructuredErrorField[],
  path: string[] = [],
  depth = 0,
): void {
  if (fields.length >= MAX_FIELDS || depth > MAX_DEPTH) return

  if (Array.isArray(value)) {
    if (value.every(entry => scalarText(entry, false) !== undefined)) {
      const text = value.map(entry => scalarText(entry, false)).filter((entry): entry is string => entry !== undefined).join(' · ')
      if (text !== '' && path.length > 0) {
        const key = path.at(-1) ?? 'items'
        fields.push({ label: labelFor(key, path), value: bounded(text), technical: true })
      }
      return
    }
    value.forEach((entry, index) =>{  flatten(entry, fields, [...path, String(index + 1)], depth + 1) })
    return
  }

  if (!isRecord(value)) {
    const key = path.at(-1)
    const text = scalarText(value, key !== undefined && PROSE_KEYS.has(key))
    if (key !== undefined && text !== undefined) {
      fields.push({ label: labelFor(key, path), value: text, technical: !PROSE_KEYS.has(key) })
    }
    return
  }

  for (const [key, entry] of Object.entries(value)) {
    if (fields.length >= MAX_FIELDS) break
    if (OMITTED_KEYS.has(key)) continue
    if (key === 'metadata') {
      flatten(entry, fields, path, depth + 1)
      continue
    }
    if (isRecord(entry) || Array.isArray(entry)) {
      flatten(entry, fields, [...path, key], depth + 1)
      continue
    }
    const text = scalarText(entry, PROSE_KEYS.has(key))
    if (text !== undefined) {
      fields.push({
        label: labelFor(key, [...path, key]),
        value: text,
        technical: !PROSE_KEYS.has(key),
      })
    }
  }
}

function findFirst(value: unknown, keys: ReadonlySet<string>, depth = 0): unknown {
  if (depth > MAX_DEPTH) return undefined
  if (isRecord(value)) {
    for (const key of keys) {
      if (value[key] !== undefined) return value[key]
    }
    for (const entry of Object.values(value)) {
      const found = findFirst(entry, keys, depth + 1)
      if (found !== undefined) return found
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findFirst(entry, keys, depth + 1)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function parseEnvelope(input: string): { payload: unknown; prefixCode?: string } | undefined {
  const text = input.trim()
  if (text === '' || text.length > MAX_INPUT_LENGTH) return undefined

  const firstObject = text.indexOf('{')
  const firstArray = text.indexOf('[')
  const candidates = [firstObject, firstArray].filter(index => index >= 0)
  if (candidates.length === 0) return undefined
  const start = Math.min(...candidates)
  const json = text.slice(start)
  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!isRecord(payload) && !Array.isArray(payload)) return undefined

  const prefix = text.slice(0, start)
  const code = prefix.match(/(?:^|\D)([1-5]\d{2})(?:\D|$)/u)?.[1]
  return { payload, ...(code === undefined ? {} : { prefixCode: code }) }
}

function titleFor(code: string | undefined, provider: string | undefined): string {
  if (code === '400') return 'Solicitud no válida'
  if (code === '401') return 'Autenticación requerida'
  if (code === '402') return 'Créditos insuficientes'
  if (code === '403') return 'Acceso denegado'
  if (code === '404') return 'Recurso no encontrado'
  if (code === '408' || code === '504') return 'La solicitud tardó demasiado'
  if (code === '413') return 'Solicitud demasiado grande'
  if (code === '422') return 'La solicitud no pudo procesarse'
  if (code === '429') return 'Límite temporal de solicitudes'
  if (code !== undefined && /^5\d\d$/u.test(code)) return 'Error temporal del servicio'
  if (provider !== undefined) return 'Error del proveedor'
  return 'Error de la solicitud'
}

function fallbackAction(code: string | undefined): string | undefined {
  if (code === '402') return 'Reduce max_tokens o el tamaño del contexto, o cambia a una ruta gratuita compatible antes de usar crédito de pago.'
  if (code === '429') return 'Reintenta de forma controlada y, si persiste, cambia a otra ruta compatible disponible.'
  if (code === '401' || code === '403') return 'Revisa las credenciales y permisos de esta ruta antes de reintentar.'
  if (code === '404') return 'Usa otro modelo o proveedor compatible configurado para esta capacidad.'
  if (code === '408' || code === '504' || (code !== undefined && /^5\d\d$/u.test(code))) {
    return 'Reintenta de forma controlada y usa failover si el proveedor continúa sin responder.'
  }
  return undefined
}

/**
 * Convert a JSON-bearing error string into safe Spanish presentation data.
 * Arbitrary chat JSON is unaffected because callers use this only on error nodes.
 * @param input - JSON-bearing error text.
 * @param explicitCode - Optional code supplied by the transport envelope.
 * @returns Safe presentation data, or undefined for non-error JSON.
 */
export function formatStructuredError(
  input: string,
  explicitCode?: string | number,
): StructuredErrorPresentation | undefined {
  const envelope = parseEnvelope(input)
  if (envelope === undefined) return undefined

  const messageValue = findFirst(envelope.payload, new Set(['message']))
  const actionValue = findFirst(envelope.payload, new Set(['remedy_hint', 'hint']))
  const providerValue = findFirst(envelope.payload, new Set(['provider_name', 'provider']))
  const payloadCode = findFirst(envelope.payload, new Set(['code', 'status']))

  const code = explicitCode === undefined
    ? scalarText(payloadCode, false) ?? envelope.prefixCode
    : String(explicitCode)
  const provider = typeof providerValue === 'string' ? providerValue : undefined
  const message = typeof messageValue === 'string'
    ? bounded(translateGenericErrorProse(messageValue))
    : undefined
  const providerAction = typeof actionValue === 'string'
    ? bounded(translateGenericErrorProse(actionValue))
    : undefined
  const action = providerAction ?? fallbackAction(code)

  const fields: StructuredErrorField[] = []
  flatten(envelope.payload, fields)

  // The top-level code is already promoted to the compact code seat.
  const filtered = fields.filter(field => !(field.label === 'Código' && field.value === code))

  return {
    title: titleFor(code, provider),
    ...(message === undefined ? {} : { message }),
    ...(code === undefined ? {} : { code }),
    fields: filtered,
    ...(action === undefined ? {} : { action }),
    rawJson: JSON.stringify(envelope.payload, null, 2),
  }
}
