export interface StructuredFailureView {
  readonly structured: boolean
  readonly code?: string
  readonly provider?: string
  readonly summary: string
  readonly remedy?: string
  readonly prettyJson?: string
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function recordAt(record: JsonRecord, key: string): JsonRecord | undefined {
  const value = record[key]
  return isRecord(value) ? value : undefined
}

function jsonCandidate(raw: string): { status?: string; source: string; value: unknown } | undefined {
  const trimmed = raw.trim()
  const prefixed = /^(\d{3})\s*:\s*([\s\S]+)$/u.exec(trimmed)
  const status = prefixed?.[1]
  const source = (prefixed?.[2] ?? trimmed).trim()

  try {
    return { status, source, value: JSON.parse(source) as unknown }
  } catch {
    // Some adapters prepend a short textual label before the response body.
    // Only accept a suffix when it is itself a complete JSON object/array.
    const objectAt = source.indexOf('{')
    const arrayAt = source.indexOf('[')
    const starts = [objectAt, arrayAt].filter(index => index >= 0)
    if (starts.length === 0) return undefined
    const start = Math.min(...starts)
    const suffix = source.slice(start).trim()
    try {
      return { status, source: suffix, value: JSON.parse(suffix) as unknown }
    } catch {
      return undefined
    }
  }
}

function primaryRecord(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined
  const nested = recordAt(value, 'error')
  return nested ?? value
}

function metadataOf(root: JsonRecord, primary: JsonRecord): JsonRecord | undefined {
  return recordAt(primary, 'metadata') ?? recordAt(root, 'metadata')
}

function humanSummary(code: string | undefined, providerMessage: string, metadata: JsonRecord | undefined): string {
  const promptLimit = /prompt tokens limit exceeded:\s*([\d,]+)\s*>\s*([\d,]+)/iu.exec(providerMessage)
  if (promptLimit !== null) {
    return `El contexto enviado es demasiado grande: ${promptLimit[1]} tokens superan el límite disponible de ${promptLimit[2]}.`
  }

  const creditLimit = /requested up to\s*([\d,]+)\s*tokens,\s*but can only afford\s*([\d,]+)/iu.exec(providerMessage)
  if (code === '402' && creditLimit !== null) {
    return `Créditos insuficientes: se solicitaron hasta ${creditLimit[1]} tokens de salida, pero el saldo disponible alcanza aproximadamente para ${creditLimit[2]}.`
  }

  switch (code) {
    case '400': return 'El proveedor rechazó la solicitud porque alguno de sus parámetros o datos no es válido.'
    case '401': return 'La autenticación con el proveedor falló o las credenciales ya no son válidas.'
    case '402': return 'No hay créditos suficientes en la ruta seleccionada para completar esta solicitud.'
    case '403': return 'El proveedor rechazó el acceso a este modelo o recurso.'
    case '404': return 'El modelo o recurso solicitado no está disponible en esta ruta.'
    case '408': return 'La solicitud agotó el tiempo de espera antes de completarse.'
    case '413': return 'La solicitud es demasiado grande para el límite aceptado por el proveedor.'
    case '422': return 'El proveedor recibió la solicitud, pero no pudo procesarla con esos datos.'
    case '429': return 'El proveedor está limitado temporalmente por tasa o capacidad. La solicitud puede reintentarse por otra ruta compatible.'
    case '500':
    case '502':
    case '503':
    case '504': return 'El proveedor tuvo un fallo temporal o no está disponible en este momento.'
    default: {
      const limitSource = asString(metadata?.limit_source)
      if (limitSource?.includes('credits') === true) {
        return 'La ruta seleccionada no dispone de crédito suficiente para completar la solicitud.'
      }
      return providerMessage
    }
  }
}

function humanRemedy(code: string | undefined, providerMessage: string): string | undefined {
  if (/prompt tokens limit exceeded/iu.test(providerMessage)) {
    return 'PHOENIX debe compactar o reducir el contexto y volver a intentarlo sin perder el historial útil.'
  }
  switch (code) {
    case '401':
    case '403': return 'Revisa la autenticación o los permisos de esta ruta antes de reintentar.'
    case '402': return 'Reduce max_tokens o el contexto; después intenta una ruta gratuita compatible antes de usar crédito de pago.'
    case '404': return 'Cambia automáticamente a otro modelo o proveedor compatible configurado para esta capacidad.'
    case '408':
    case '429':
    case '500':
    case '502':
    case '503':
    case '504': return 'Reintenta con espera controlada y, si persiste, usa failover hacia otra ruta gratuita compatible.'
    default: return undefined
  }
}

/**
 * Convert provider/adapter failures into a compact human view while preserving
 * the complete structured response for an opt-in technical disclosure.
 * Supports pure JSON and common `HTTP_STATUS: {json}` adapter messages.
 */
export function parseStructuredFailure(raw: string, explicitCode?: string): StructuredFailureView {
  const parsed = jsonCandidate(raw)
  if (parsed === undefined) {
    return {
      structured: false,
      summary: raw,
      ...explicitCode === undefined ? {} : { code: explicitCode },
    }
  }

  const root = isRecord(parsed.value) ? parsed.value : undefined
  const primary = primaryRecord(parsed.value)
  if (root === undefined || primary === undefined) {
    return {
      structured: true,
      summary: raw,
      code: explicitCode ?? parsed.status,
      prettyJson: JSON.stringify(parsed.value, null, 2),
    }
  }

  const metadata = metadataOf(root, primary)
  const providerMessage = asString(primary.message) ?? asString(root.message) ?? raw
  const code = explicitCode ?? parsed.status ?? asString(primary.code) ?? asString(root.code)
  const provider = asString(metadata?.provider_name)
    ?? asString(metadata?.provider)
    ?? asString(primary.provider)
    ?? asString(root.provider)

  return {
    structured: true,
    summary: humanSummary(code, providerMessage, metadata),
    remedy: humanRemedy(code, providerMessage),
    prettyJson: JSON.stringify(parsed.value, null, 2),
    ...code === undefined ? {} : { code },
    ...provider === undefined ? {} : { provider },
  }
}
