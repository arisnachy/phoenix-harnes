import { describe, expect, it } from 'vitest'
import { parseGoogleModels, parseGoogleResult, GOOGLE_ACCOUNT_PROVIDER } from '../src/antigravity-cli.ts'

describe('Google account Antigravity CLI adapter', () => {
  it('uses an account route separate from Gemini API keys', () => {
    expect(GOOGLE_ACCOUNT_PROVIDER).toBe('google-account')
  })

  it('discovers unique Gemini slugs without guessing a fixed account catalog', () => {
    const result = parseGoogleModels([
      'Available models:',
      'Gemini 4 Carbon High      gemini-4-carbon-high',
      'Gemini 3.8 Flash Medium  gemini-3.8-flash-medium',
      'Gemini 4 Carbon High      gemini-4-carbon-high',
      'Claude Sonnet            claude-sonnet-5',
    ].join('\n'))
    expect(result).toEqual(['gemini-4-carbon-high', 'gemini-3.8-flash-medium'])
    expect(parseGoogleModels('No models available')).toEqual([])
  })

  it('reads only the authoritative result event, ignoring progress and diagnostics', () => {
    const result = parseGoogleResult([
      '{"event":"init","conversation_id":"a"}',
      '{"event":"step_update","step_update":{"text_delta":"temporary"}}',
      '{"event":"result","result":{"status":"SUCCESS","response":"OK","usage":{"input_tokens":12,"output_tokens":3,"cache_read_tokens":2}}}',
    ].join('\n'))
    expect(result).toMatchObject({
      status: 'SUCCESS',
      response: 'OK',
      usage: { input_tokens: 12, output_tokens: 3, cache_read_tokens: 2 },
    })
  })

  it('does not treat failures or missing native result as authenticated responses', () => {
    expect(() => parseGoogleResult('{"event":"result","result":{"status":"ERROR","error":"authentication required"}}'))
      .toThrow(/authentication required/u)
    expect(() => parseGoogleResult('{"event":"step_update"}'))
      .toThrow(/sin respuesta/u)
  })
})
