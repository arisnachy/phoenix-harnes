import { describe, expect, it } from 'vitest'
import { formatStructuredError } from '../src/client/chat/structured-error.ts'

describe('structured error presentation', () => {
  it('formats provider JSON in Spanish while preserving technical identities in raw JSON', () => {
    const input = '429: {"message":"Provider returned error","code":429,"metadata":{"raw":"stealth/ox-alpha is temporarily rate-limited upstream. Please retry shortly.","provider_name":"Stealth","is_byok":false,"limit_source":"upstream_provider_shared_pool","remedy_hint":"Retry shortly, add your own provider key (https://openrouter.ai/settings/integrations), or route to another provider with provider routing: https://openrouter.ai/docs/features/provider-routing"}}'
    const formatted = formatStructuredError(input)

    expect(formatted).toBeDefined()
    expect(formatted?.title).toBe('Límite temporal de solicitudes')
    expect(formatted?.code).toBe('429')
    expect(formatted?.message).toBe('El proveedor devolvió un error')
    expect(formatted?.fields).toContainEqual({ label: 'Proveedor', value: 'Stealth', technical: true })
    expect(formatted?.fields).toContainEqual({
      label: 'Origen del límite', value: 'upstream_provider_shared_pool', technical: true,
    })
    expect(formatted?.fields.find(field => field.label === 'Detalle')).toBeUndefined()
    expect(formatted?.action).toContain('https://openrouter.ai/settings/integrations')
    expect(formatted?.rawJson).toContain('stealth/ox-alpha')
  })

  it('humanizes the OpenRouter 402 credit error that previously flooded the chat', () => {
    const input = '402: {"message":"This request requires more credits, or fewer max_tokens. You requested up to 4096 tokens, but can only afford 1185. To increase, visit https://openrouter.ai/settings/credits and upgrade to a paid account","code":402,"metadata":{"limit_source":"openrouter_credits","remedy_hint":"Add credits at https://openrouter.ai/settings/credits, or lower max_tokens / prompt size to fit your remaining balance.","provider_name":null,"previous_errors":[{"code":402,"message":"credit failure"}]}}'
    const formatted = formatStructuredError(input)

    expect(formatted?.title).toBe('Créditos insuficientes')
    expect(formatted?.code).toBe('402')
    expect(formatted?.message).toContain('Solicitaste hasta 4096 tokens')
    expect(formatted?.message).toContain('solo cubre aproximadamente 1185')
    expect(formatted?.action).toContain('reduce max_tokens')
    expect(formatted?.fields.some(field => field.label.includes('previous_errors'))).toBe(false)
    expect(JSON.parse(formatted?.rawJson ?? '{}')).toMatchObject({
      code: 402,
      metadata: {
        limit_source: 'openrouter_credits',
        previous_errors: [{ code: 402, message: 'credit failure' }],
      },
    })
  })

  it('translates prompt-token limits while keeping the provider payload untouched in raw JSON', () => {
    const input = '402: {"message":"Prompt tokens limit exceeded: 53288 > 12040. To increase, visit account settings","code":402}'
    const formatted = formatStructuredError(input)

    expect(formatted?.title).toBe('Créditos insuficientes')
    expect(formatted?.message).toContain('Límite de tokens del contexto superado: 53288 > 12040')
    expect(formatted?.rawJson).toContain('Prompt tokens limit exceeded: 53288 > 12040')
  })

  it('handles generic nested JSON and keeps useful unknown keys', () => {
    const formatted = formatStructuredError('Error: {"error":{"message":"service unavailable","type":"gateway_error","trace_id":"tr_ABC123","vendor_blob":{"region":"us-east-1","attempt":3}}}')

    expect(formatted?.title).toBe('Error de la solicitud')
    expect(formatted?.message).toBe('servicio no disponible')
    expect(formatted?.fields).toContainEqual({ label: 'Tipo', value: 'gateway_error', technical: true })
    expect(formatted?.fields).toContainEqual({ label: 'ID de traza', value: 'tr_ABC123', technical: true })
    expect(formatted?.fields).toContainEqual({ label: 'error.vendor_blob.region', value: 'us-east-1', technical: true })
    expect(formatted?.rawJson).toContain('"vendor_blob"')
  })

  it('accepts JSON arrays in error context and preserves them for disclosure', () => {
    const formatted = formatStructuredError('[{"type":"validation_error","field":"temperature"},{"field":"max_tokens","reason":"not found"}]')

    expect(formatted).toBeDefined()
    expect(formatted?.fields).toContainEqual({ label: 'Tipo', value: 'validation_error', technical: true })
    expect(formatted?.fields).toContainEqual({ label: '1.field', value: 'temperature', technical: true })
    expect(formatted?.fields).toContainEqual({ label: '2.field', value: 'max_tokens', technical: true })
    expect(formatted?.fields).toContainEqual({ label: '2.reason', value: 'no encontrado', technical: false })
    expect(JSON.parse(formatted?.rawJson ?? '[]')).toHaveLength(2)
  })

  it('leaves ordinary non-JSON errors untouched by declining to format them', () => {
    expect(formatStructuredError('Connection closed before the provider replied.')).toBeUndefined()
    expect(formatStructuredError('Error: {not valid JSON}')).toBeUndefined()
  })

  it('prefers an explicit durable error code without mutating identifiers', () => {
    const formatted = formatStructuredError('{"message":"unauthorized","request_id":"req_XYZ","model":"vendor/model-v2"}', '401')

    expect(formatted?.title).toBe('Autenticación requerida')
    expect(formatted?.code).toBe('401')
    expect(formatted?.message).toBe('no autorizado')
    expect(formatted?.fields).toContainEqual({ label: 'ID de solicitud', value: 'req_XYZ', technical: true })
    expect(formatted?.fields).toContainEqual({ label: 'Modelo', value: 'vendor/model-v2', technical: true })
  })
})
