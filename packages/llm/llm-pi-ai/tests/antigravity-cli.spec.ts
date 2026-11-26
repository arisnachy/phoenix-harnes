import { describe, expect, it } from 'vitest'
import { assertGoogleAccountSettings, googleAccountEnvironment, parseGoogleModels, parseGoogleResult, GOOGLE_ACCOUNT_PROVIDER, ANTIGRAVITY_MODEL_PROVIDER, GoogleAccountCliAdapter, isGoogleAccountRoute, registerGoogleAccountCli } from '../src/antigravity-cli.ts'

describe('Google account Antigravity CLI adapter', () => {
  it('refuses explicit modelProvider and malformed settings without switching to API billing', () => {
    expect(() => assertGoogleAccountSettings({})).not.toThrow()
    expect(() => assertGoogleAccountSettings({ modelProvider: 'gemini' })).toThrow(/modelProvider/u)
    expect(() => assertGoogleAccountSettings({ modelProvider: 'vertex' })).toThrow(/modelProvider/u)
    expect(() => assertGoogleAccountSettings(null)).toThrow(/inválida/u)
  })

  it('removes unrelated API credentials from the native CLI environment, including Windows casing', () => {
    expect(googleAccountEnvironment({ Path: 'bin', gemini_api_key: 'fake', GOOGLE_API_KEY: 'fake', AGY_ADC_AUTH: 'true', GOOGLE_APPLICATION_CREDENTIALS: 'fake', USERPROFILE: 'profile' })).toEqual({ Path: 'bin', USERPROFILE: 'profile' })
  })
  it('registers both selector IDs with native adapters and exposes an OAuth wizard backed by the CLI', () => {
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
    expect(flows[0]?.methods[0]?.id).toBe('oauth')
    expect(isGoogleAccountRoute('google-antigravity')).toBe(true)
    expect(isGoogleAccountRoute('google-account')).toBe(true)
    expect(isGoogleAccountRoute('google')).toBe(false)
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
      .toThrow(/authentication required/u)
    expect(() => parseGoogleResult('{"event":"step_update"}'))
      .toThrow(/sin respuesta/u)
  })
})
