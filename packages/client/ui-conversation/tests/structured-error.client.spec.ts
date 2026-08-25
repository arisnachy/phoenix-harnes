import { describe, expect, it } from 'vitest'
import { parseStructuredFailure } from '../src/client/chat/structured-error.ts'

describe('parseStructuredFailure', () => {
  it('humanizes OpenRouter credit failures and preserves the complete JSON', () => {
    const raw = '402: {"message":"This request requires more credits, or fewer max_tokens. You requested up to 4096 tokens, but can only afford 1185.","code":402,"metadata":{"limit_source":"openrouter_credits","provider_name":null,"previous_errors":[{"code":402,"message":"credit failure"}]}}'
    const view = parseStructuredFailure(raw)

    expect(view.structured).toBe(true)
    expect(view.code).toBe('402')
    expect(view.summary).toContain('Créditos insuficientes')
    expect(view.summary).toContain('4096')
    expect(view.summary).toContain('1185')
    expect(view.remedy).toContain('max_tokens')
    expect(view.prettyJson).toContain('"previous_errors"')
    expect(JSON.parse(view.prettyJson ?? '{}')).toMatchObject({
      code: 402,
      metadata: { limit_source: 'openrouter_credits' },
    })
  })

  it('explains prompt-context limits in Spanish', () => {
    const raw = '402: {"message":"Prompt tokens limit exceeded: 53288 > 12040. To increase, visit account settings","code":402}'
    const view = parseStructuredFailure(raw)

    expect(view.summary).toBe('El contexto enviado es demasiado grande: 53288 tokens superan el límite disponible de 12040.')
    expect(view.remedy).toContain('compactar')
  })

  it('recognizes pure JSON rate limits and exposes provider metadata', () => {
    const raw = JSON.stringify({
      message: 'Provider returned error',
      code: 429,
      metadata: { provider_name: 'Stealth', limit_source: 'upstream_provider_shared_pool' },
    })
    const view = parseStructuredFailure(raw)

    expect(view.structured).toBe(true)
    expect(view.code).toBe('429')
    expect(view.provider).toBe('Stealth')
    expect(view.summary).toContain('limitado temporalmente')
    expect(view.prettyJson).toContain('upstream_provider_shared_pool')
  })

  it('leaves ordinary non-JSON failures untouched', () => {
    const view = parseStructuredFailure('socket closed unexpectedly', '500')

    expect(view).toEqual({
      structured: false,
      summary: 'socket closed unexpectedly',
      code: '500',
    })
  })
})
