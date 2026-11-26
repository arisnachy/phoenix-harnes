import { describe, expect, it, vi } from 'vitest'
import type { GenerateOptions } from '@phoenix-ai/dsh-llm'
import { encodeGoogleUserEvent, buildPrompt, assertGoogleAccountSettings, googleAccountEnvironment, parseGoogleModels, parseGoogleResult, isGoogleCliAuthFailure, GOOGLE_ACCOUNT_PROVIDER, ANTIGRAVITY_MODEL_PROVIDER, GoogleAccountCliAdapter, isGoogleAccountRoute, registerGoogleAccountCli } from '../src/antigravity-cli.ts'

describe('Google account Antigravity CLI adapter', () => {
  it('uses documented typed content, preserves Unicode and newlines, and rejects empty prompts', () => {
    expect(JSON.parse(encodeGoogleUserEvent('hola\n¿Qué modelo eres?'))).toEqual({
      event: 'user', message: { content: [{ type: 'text', text: 'hola\n¿Qué modelo eres?' }] },
    })
    expect(() => encodeGoogleUserEvent(' ')).toThrow(/contenido/u)
  })

  it('sends the complete conversation and latest user turn through the actual adapter', async () => {
    const request = {
      provider: ANTIGRAVITY_MODEL_PROVIDER, model: 'gemini-4-hydrogen-low',
      system: 'Eres Kira.',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hola' }] },
        { role: 'assistant', content: [{ type: 'text', text: '¡Hola!' }] },
        { role: 'user', content: [{ type: 'text', text: '¿Qué modelo eres?' }] },
      ],
    } as GenerateOptions
    const execute = vi.fn(async (_args: readonly string[], input?: string) => {
      const event = JSON.parse(input ?? '')
      expect(event.message.content).toEqual([{ type: 'text', text: buildPrompt(request) }])
      const text = event.message.content[0].text as string
      expect(text).toContain('Eres Kira.')
      expect(text).toContain('USER:\nhola')
      expect(text).toContain('ASSISTANT:\n¡Hola!')
      expect(text).toContain('gemini-4-hydrogen-low')
      expect(text.endsWith('USER:\n¿Qué modelo eres?')).toBe(true)
      return JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Gemini' } })
    })
    const adapter = new GoogleAccountCliAdapter(ANTIGRAVITY_MODEL_PROVIDER, execute)
    const chunks = []
    for await (const chunk of adapter.stream(request)) chunks.push(chunk)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'Gemini' })
  })

  it('rejects missing conversation instead of generating an empty turn', () => {
    expect(() => buildPrompt({ model: 'gemini-a', messages: [] })).toThrow(/mensajes/u)
  })

  it('refuses explicit modelProvider and malformed settings without switching to API billing', () => {
    expect(() => assertGoogleAccountSettings({})).not.toThrow()
    expect(() => assertGoogleAccountSettings({ modelProvider: 'gemini' })).toThrow(/modelProvider/u)
    expect(() => assertGoogleAccountSettings({ modelProvider: 'vertex' })).toThrow(/modelProvider/u)
    expect(() => assertGoogleAccountSettings(null)).toThrow(/inválida/u)
  })

  it('removes unrelated API credentials from the native CLI environment, including Windows casing', () => {
    expect(googleAccountEnvironment({ Path: 'bin', gemini_api_key: 'fake', GOOGLE_API_KEY: 'fake', AGY_ADC_AUTH: 'true', GOOGLE_APPLICATION_CREDENTIALS: 'fake', USERPROFILE: 'profile' })).toEqual({ Path: 'bin', USERPROFILE: 'profile' })
  })
  it('registers both selector IDs with native adapters and exposes a native CLI wizard without a browser OAuth timeout', () => {
    const registrations = new Map<string, GoogleAccountCliAdapter>()
    const flows: Array<{ key: string; methods: ReadonlyArray<{ id: string }> }> = []
    const ctx = {
      llm: { registerAdapter: (routes: string[], adapter: GoogleAccountCliAdapter) => { for (const route of routes) registrations.set(route, adapter) } },
      inject: (_services: string[], callback: (ctx: unknown) => void) => callback({ authorization: { registerFlow: (flow: typeof flows[number]) => flows.push(flow) } }),
    }
    registerGoogleAccountCli(ctx as never)
    expect(registrations.get(ANTIGRAVITY_MODEL_PROVIDER)?.providerInfo().id).toBe('google-antigravity')
    expect(registrations.get(GOOGLE_ACCOUNT_PROVIDER)?.providerInfo().id).toBe('google-account')
    expect(flows).toHaveLength(1)
    expect(flows[0]?.key).toBe('llm-pi-ai/google-account')
    expect(flows[0]?.methods.map(method => method.id)).toEqual(['cli'])
    expect(isGoogleAccountRoute('google-antigravity')).toBe(true)
    expect(isGoogleAccountRoute('google-account')).toBe(true)
    expect(isGoogleAccountRoute('google')).toBe(false)
  })

  it('classifies API-key and native authentication errors without leaking provider text', () => {
    expect(isGoogleCliAuthFailure('API key is invalid')).toBe(true)
    expect(isGoogleCliAuthFailure('authentication required')).toBe(true)
    expect(isGoogleCliAuthFailure('model overloaded')).toBe(false)
    expect(() => parseGoogleResult(JSON.stringify({ event: 'result', result: { status: 'ERROR', error: 'API key is invalid: fake-secret' } }))).toThrow(/rechazó la sesión/u)
  })

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
      .toThrow(/rechazó la sesión/u)
    expect(() => parseGoogleResult('{"event":"step_update"}'))
      .toThrow(/sin respuesta/u)
  })
})
