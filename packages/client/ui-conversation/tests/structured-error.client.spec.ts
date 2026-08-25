import { describe, expect, it } from 'vitest'
import { formatStructuredError } from '../src/client/chat/structured-error.ts'

describe('structured error presentation', () => {
  it('formats provider JSON in Spanish while preserving technical identities', () => {
    const input = '429: {"message":"Provider returned error","code":429,"metadata":{"raw":"stealth/ox-alpha is temporarily rate-limited upstream. Please retry shortly.","provider_name":"Stealth","is_byok":false,"limit_source":"upstream_provider_shared_pool","remedy_hint":"Retry shortly, add your own provider key (https://openrouter.ai/settings/integrations), or route to another provider with provider routing: https://openrouter.ai/docs/features/provider-routing"}}'
    const formatted = formatStructuredError(input)

    expect(formatted).toBeDefined()
    expect(formatted?.title).toBe('Límite temporal de solicitudes')
    expect(formatted?.code).toBe('429')
    expect(formatted?.message).toBe('El proveedor devolvió un error')
    expect(formatted?.fields).toContainEqual({ label: 'Proveedor', value: 'Stealth', technical: true })
    expect(formatted?.fields).toContainEqual({
      label: 'Origen del límite',
      value: 'upstream_provider_shared_pool',
      technical: true,
    })
    expect(formatted?.fields.find(field => field.label === 'Detalle')?.value).toContain('stealth/ox-alpha')
    expect(formatted?.fields.find(field => field.label === 'Detalle')?.value).toContain('Reintenta en unos momentos')
    expect(formatted?.action).toContain('https://openrouter.ai/settings/integrations')
    expect(formatted?.action).toContain('https://openrouter.ai/docs/features/provider-routing')
    expect(formatted?.action).toContain('provider routing')
  })

  it('handles generic nested JSON and keeps unknown keys instead of discarding them', () => {
    const formatted = formatStructuredError('Error: {"error":{"message":"service unavailable","type":"gateway_error","trace_id":"tr_ABC123","vendor_blob":{"region":"us-east-1","attempt":3}}}')

    expect(formatted?.title).toBe('Error de la solicitud')
    expect(formatted?.message).toBe('servicio no disponible')
    expect(formatted?.fields).toContainEqual({ label: 'Tipo', value: 'gateway_error', technical: true })
    expect(formatted?.fields).toContainEqual({ label: 'ID de traza', value: 'tr_ABC123', technical: true })
    expect(formatted?.fields).toContainEqual({ label: 'error.vendor_blob.region', value: 'us-east-1', technical: true })
    expect(formatted?.fields).toContainEqual({ label: 'error.vendor_blob.attempt', value: '3', technical: true })
  })

  it('accepts JSON arrays in error context without emitting raw JSON', () => {
    const formatted = formatStructuredError('[{"type":"validation_error","field":"temperature"},{"field":"max_tokens","reason":"not found"}]')

    expect(formatted).toBeDefined()
    expect(formatted?.fields).toContainEqual({ label: 'Tipo', value: 'validation_error', technical: true })
    expect(formatted?.fields).toContainEqual({ label: '1.field', value: 'temperature', technical: true })
    expect(formatted?.fields).toContainEqual({ label: '2.field', value: 'max_tokens', technical: true })
    expect(formatted?.fields).toContainEqual({ label: '2.reason', value: 'no encontrado', technical: false })
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
