import { describe, expect, it, vi } from 'vitest'
import { createUserMessage, type GenerateOptions } from '@phoenix-ai/dsh-llm'
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
        { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hola' }] },
        { role: 'assistant', content: [{ type: 'text', text: '¡Hola!' }] },
        { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'puedes leerme' }] },
        { role: 'user', source: { kind: 'plugin', plugin: '@phoenix-ai/dsh-system-prompt' }, content: [{ type: 'text', text: 'Contexto interno de Phoenix.' }] },
        { role: 'user', source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: 'Catálogo de habilidades.' }] },
      ],
    } as GenerateOptions
    const execute = vi.fn(async (_args: readonly string[], input?: string) => {
      const event = JSON.parse(input ?? '')
      expect(event.message.content).toEqual([{ type: 'text', text: buildPrompt(request) }])
      const text = event.message.content[0].text as string
      expect(text.startsWith('TURNO ACTUAL DE PHOENIX (responde a este contenido):\npuedes leerme')).toBe(true)
      expect(text).toContain('Eres Kira.')
      expect(text).toContain('USER:\nhola')
      expect(text).toContain('ASSISTANT:\n¡Hola!')
      expect(text).toContain('gemini-4-hydrogen-low')
      expect(text).toContain('CONTEXTO INTERNO DE PHOENIX:\nContexto interno de Phoenix.\n\nCatálogo de habilidades.')
      expect(text).not.toContain('USER:\nContexto interno de Phoenix.')
      expect(text).not.toContain('USER:\nCatálogo de habilidades.')
      expect(text.endsWith('USER:\npuedes leerme')).toBe(true)
      return JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Gemini' } })
    })
    const adapter = new GoogleAccountCliAdapter(ANTIGRAVITY_MODEL_PROVIDER, execute)
    const chunks = []
    for await (const chunk of adapter.stream(request)) chunks.push(chunk)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'Gemini' })
  })

  it('rejects missing conversation instead of generating an empty turn', () => {
    expect(() => buildPrompt({ model: 'gemini-a', messages: [] })).toThrow(/turno actual/u)
  })

  it('turns the web preview into a Phoenix canvas tool call', async () => {
    const request: GenerateOptions = {
      provider: ANTIGRAVITY_MODEL_PROVIDER,
      model: 'gemini-4-hydrogen-low',
      messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'crea una pagina web para verla' }] })],
      tools: [{ name: 'phoenix_canvas', description: 'Publish HTML', parameters: { type: 'object' } }],
    }
    const args = JSON.stringify({ title: 'Página', html: '<h1>Página</h1>' })
    const execute = vi.fn(async (flags: readonly string[], input?: string) => {
      expect(input).toContain('solicita phoenix_canvas')
      expect(JSON.parse(flags[flags.indexOf('--settings') + 1]!)).toMatchObject({
        permissions: { deny: expect.arrayContaining(['write_file(*)', 'command(*)']) },
      })
      expect(JSON.parse(flags[flags.indexOf('--json-schema') + 1]!)).toMatchObject({ required: ['kind'] })
      return JSON.stringify({ event: 'result', result: {
        status: 'SUCCESS', response: JSON.stringify({ kind: 'tools', calls: [{ name: 'phoenix_canvas', arguments: args }] }),
      } })
    })
    const chunks = []
    for await (const chunk of new GoogleAccountCliAdapter(ANTIGRAVITY_MODEL_PROVIDER, execute).stream(request)) chunks.push(chunk)
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'tool-call-delta', name: 'phoenix_canvas', argumentsDelta: args }))
  })

  it('does not present plain text as a completed action in a tool-enabled response', async () => {
    const request: GenerateOptions = {
      provider: ANTIGRAVITY_MODEL_PROVIDER,
      model: 'gemini-4-hydrogen-low',
      messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'crea una pagina web para verla' }] })],
      tools: [{ name: 'phoenix_canvas', description: 'Publish HTML', parameters: { type: 'object' } }],
    }
    const execute = async () => JSON.stringify({
      event: 'result', result: { status: 'SUCCESS', response: 'Ya creé index.html.' },
    })
    const stream = new GoogleAccountCliAdapter(ANTIGRAVITY_MODEL_PROVIDER, execute).stream(request)
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow(/respuesta estructurada/u)
  })

  it.each([
    'Puedo crear páginas.\n{"kind":"final","text":"Puedo crear páginas."}',
    '\x60\x60\x60json\n{"kind":"final","text":"Puedo crear páginas."}\n\x60\x60\x60',
    'Saludo preliminar.\n{"kind":"tools","calls":[{"name":"phoenix_canvas","arguments":"{}"}]}',
    'Puedo crear páginas.',
  ])('recovers a conversational reply with tools enabled (%s)', async response => {
    const request: GenerateOptions = {
      provider: ANTIGRAVITY_MODEL_PROVIDER,
      model: 'gemini-4-hydrogen-low',
      messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'que puedes crear' }] })],
      tools: [{ name: 'phoenix_canvas', description: 'Publish HTML', parameters: { type: 'object' } }],
    }
    const result = (text: string) => JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: text } })
    const execute = vi.fn(async () => result('{"kind":"final","text":"Puedo crear páginas."}'))
      .mockResolvedValueOnce(result(response))
    const chunks = []
    for await (const chunk of new GoogleAccountCliAdapter(ANTIGRAVITY_MODEL_PROVIDER, execute).stream(request)) chunks.push(chunk)
    expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'Puedo crear páginas.' })
    expect(chunks.some(chunk => chunk.type === 'tool-call-delta')).toBe(false)
    expect(execute).toHaveBeenCalledTimes(response.includes('kind":"final') ? 1 : 2)
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
