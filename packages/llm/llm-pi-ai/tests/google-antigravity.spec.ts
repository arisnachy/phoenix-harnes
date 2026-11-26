import { describe, expect, it } from 'vitest'
import {
  GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT,
  GOOGLE_ANTIGRAVITY_DEFAULT_MODELS,
  GOOGLE_ANTIGRAVITY_DISPLAY_NAME,
  GOOGLE_ANTIGRAVITY_PROVIDER,
  buildAntigravityRequestBody,
  googleAntigravityProvider,
  parseAntigravityAuth,
} from '../src/google-antigravity.ts'
import { catalogModels, catalogProvider, catalogProviderIds } from '../src/catalog.ts'
import { registerPiAiFlows } from '../src/login.ts'
import { recordKeyFor } from '../src/auth.ts'

describe('google-antigravity provider & catalog', () => {
  it('registers google-antigravity in the built-in catalog with OAuth-only auth', () => {
    expect(catalogProviderIds()).toContain(GOOGLE_ANTIGRAVITY_PROVIDER)
    const provider = catalogProvider(GOOGLE_ANTIGRAVITY_PROVIDER)
    expect(provider).toBeDefined()
    expect(provider?.name).toBe(GOOGLE_ANTIGRAVITY_DISPLAY_NAME)
    expect(provider?.auth.oauth).toBeDefined()
    expect(provider?.auth.apiKey).toBeUndefined()

    const models = catalogModels(GOOGLE_ANTIGRAVITY_PROVIDER)
    expect(models.size).toBe(GOOGLE_ANTIGRAVITY_DEFAULT_MODELS.length)
    expect(models.get('gemini-3.1-pro-high')?.input).toEqual(['text', 'image'])
    expect(models.get('claude-opus-4-6-thinking')?.reasoning).toBe(true)
  })

  it('registers an OAuth-only authorization flow for Settings -> Models', async () => {
    const flows = new Map<string, {
      key: string
      label: string
      methods: ReadonlyArray<{ id: string; label: string }>
      inspect: () => Promise<unknown>
    }>()
    const fakeCtx = {
      logger: { info: () => undefined, warn: () => undefined },
      authorization: {
        registerFlow: (flow: {
          key: string
          label: string
          methods: ReadonlyArray<{ id: string; label: string }>
          inspect: () => Promise<unknown>
        }) => {
          flows.set(flow.key, flow)
        },
      },
      get: (service: string) => {
        if (service !== 'credentials') return undefined
        return {
          listRecords: async () => [{ key: recordKeyFor(GOOGLE_ANTIGRAVITY_PROVIDER), kind: 'grant' }],
        }
      },
    }

    registerPiAiFlows(fakeCtx as never, {
      credentials: { read: async () => undefined, list: async () => [], modify: async () => undefined, delete: async () => undefined },
      authContext: { env: async () => undefined, fileExists: async () => false },
    })

    const flow = flows.get('llm-pi-ai/google-antigravity')
    expect(flow).toBeDefined()
    expect(flow?.label).toBe('Google Antigravity')
    expect(flow?.methods).toEqual([{ id: 'oauth', label: 'Google Antigravity OAuth' }])
    expect(await flow?.inspect()).toEqual({
      kind: 'account',
      provider: 'Google Antigravity',
      accountType: 'oauth',
    })
  })

  it('completes PKCE loopback OAuth login, project discovery, refresh, and toAuth', async () => {
    const fetchMock: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === 'https://oauth2.googleapis.com/token') {
        const bodyText = typeof init?.body === 'string'
          ? init.body
          : init?.body instanceof URLSearchParams
            ? init.body.toString()
            : ''
        if (bodyText.includes('grant_type=refresh_token')) {
          return new Response(JSON.stringify({
            access_token: 'refreshed-access-token',
            expires_in: 3600,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(JSON.stringify({
          access_token: 'initial-access-token',
          refresh_token: 'initial-refresh-token',
          expires_in: 3600,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('v1internal:loadCodeAssist')) {
        return new Response(JSON.stringify({
          cloudaicompanionProject: { id: 'my-antigravity-project' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('oauth2/v1/userinfo')) {
        return new Response(JSON.stringify({ email: 'dev@example.com' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    }

    const provider = googleAntigravityProvider({
      fetch: fetchMock,
      authContext: {
        env: async name => name === 'PHOENIX_ANTIGRAVITY_OAUTH_CLIENT_ID' ? 'test-client-id' : undefined,
        fileExists: async () => false,
      },
    })

    const oauth = provider.auth.oauth!
    const credential = await oauth.login({
      notify: (event) => {
        if (event.type === 'auth_url') {
          const authUrl = new URL(event.url)
          const redirectUri = authUrl.searchParams.get('redirect_uri')!
          const state = authUrl.searchParams.get('state')!
          void fetch(`${redirectUri}?code=test-auth-code&state=${state}`)
        }
      },
      prompt: async () => '',
    })

    expect(credential.type).toBe('oauth')
    expect(credential.access).toBe('initial-access-token')
    expect(credential.refresh).toBe('initial-refresh-token')
    expect((credential as { projectId?: string }).projectId).toBe('my-antigravity-project')
    expect((credential as { email?: string }).email).toBe('dev@example.com')

    const auth = await oauth.toAuth(credential)
    expect(parseAntigravityAuth(auth.apiKey)).toEqual({
      token: 'initial-access-token',
      projectId: 'my-antigravity-project',
    })

    const refreshed = await oauth.refresh(credential)
    expect(refreshed.access).toBe('refreshed-access-token')
    expect(refreshed.refresh).toBe('initial-refresh-token')
    expect((refreshed as { projectId?: string }).projectId).toBe('my-antigravity-project')
  })

  it('builds Cloud Code Assist request bodies and streams SSE text, thinking, and tool calls', async () => {
    const model = GOOGLE_ANTIGRAVITY_DEFAULT_MODELS.find(m => m.id === 'claude-sonnet-4-5-thinking')!
    const body = buildAntigravityRequestBody(
      model,
      {
        systemPrompt: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hi', timestamp: Date.now() }],
        tools: [{
          name: 'echo',
          description: 'Echo text',
          parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        }],
      },
      'proj-123',
      { reasoning: 'medium', maxTokens: 4096 },
    )
    expect(body.project).toBe('proj-123')
    expect(body.model).toBe('claude-sonnet-4-5-thinking')
    expect(body.userAgent).toBe('antigravity')
    const req = body.request as Record<string, unknown>
    expect(req.systemInstruction).toEqual({ parts: [{ text: 'You are helpful.' }] })
    expect((req.generationConfig as Record<string, unknown>).thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingBudget: 8192,
    })

    const ssePayload = [
      `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'Let me think...', thought: true, thoughtSignature: 'sig-1' }] } }] } })}`,
      `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'Hello from Antigravity!' }] } }] } })}`,
      `data: ${JSON.stringify({
        response: {
          candidates: [{
            content: { parts: [{ functionCall: { id: 'call_1', name: 'echo', args: { text: 'ok' } } }] },
            finishReason: 'STOP',
          }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 3, totalTokenCount: 18 },
        },
      })}`,
      'data: [DONE]',
      '',
    ].join('\n')

    const fetchMock: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      expect(url).toBe(`${GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT}/v1internal:streamGenerateContent?alt=sse`)
      return new Response(ssePayload, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }

    const provider = googleAntigravityProvider({ fetch: fetchMock })
    const stream = provider.streamSimple(
      model,
      { messages: [{ role: 'user', content: 'Hi', timestamp: Date.now() }] },
      { apiKey: JSON.stringify({ token: 'tok', projectId: 'proj-123' }) },
    )
    const message = await stream.result()
    expect(message.stopReason).toBe('toolUse')
    expect(message.content).toEqual([
      { type: 'thinking', thinking: 'Let me think...', thinkingSignature: 'sig-1' },
      { type: 'text', text: 'Hello from Antigravity!' },
      { type: 'toolCall', id: 'call_1', name: 'echo', arguments: { text: 'ok' } },
    ])
    expect(message.usage.input).toBe(10)
    expect(message.usage.output).toBe(8)
  })
})
