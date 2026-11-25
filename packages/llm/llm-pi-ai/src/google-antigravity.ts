/**
 * Google Antigravity (Cloud Code Assist) provider, OAuth 2.0 PKCE login flow,
 * and SSE streaming adapter for `@phoenix-ai/dsh-llm-pi-ai`.
 *
 * Authentication uses standard Google OAuth 2.0 PKCE with a loopback callback
 * and optional manual code/URL paste fallback, storing the resulting grant
 * under `llm-pi-ai/google-antigravity` via `ctx.credentials`.
 *
 * @module dsh-llm-pi-ai/google-antigravity
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import {
  convertMessages,
  convertTools,
  isThinkingPart,
  mapStopReasonString,
  requiresToolCallId,
  resolveGoogleFunctionCallingMode,
  retainThoughtSignature,
  supportsGoogleStrictToolSampling,
} from '@earendil-works/pi-ai/api/google-shared'
import { buildBaseOptions, clampReasoning } from '@earendil-works/pi-ai/api/simple-options'
import type {
  Api,
  AssistantMessage,
  AuthContext,
  AuthInteraction,
  Context as PiContext,
  Model,
  ModelAuth,
  ModelCost,
  OAuthCredential,
  Provider,
  SimpleStreamOptions,
  StopReason,
  StreamOptions,
  TextContent,
  ThinkingContent,
  ToolCall,
  Usage,
} from '@earendil-works/pi-ai'

/** Stable route id for the Google Antigravity provider. */
export const GOOGLE_ANTIGRAVITY_PROVIDER = 'google-antigravity'

/** Human-facing display name for Settings -> Models and the model picker. */
export const GOOGLE_ANTIGRAVITY_DISPLAY_NAME = 'Google Antigravity'

/** Primary Cloud Code Assist sandbox endpoint used by Antigravity. */
export const GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT = 'https://daily-cloudcode-pa.sandbox.googleapis.com'

/** Production Cloud Code Assist endpoint used as fallback and for project discovery. */
export const GOOGLE_ANTIGRAVITY_FALLBACK_ENDPOINT = 'https://cloudcode-pa.googleapis.com'

const ANTIGRAVITY_ENDPOINTS = [
  GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT,
  GOOGLE_ANTIGRAVITY_FALLBACK_ENDPOINT,
] as const

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json'
const CALLBACK_PATH = '/oauth2/callback'
const DEFAULT_ANTIGRAVITY_PROJECT_ID = 'rising-fact-p41fc'
const EXPIRY_SKEW_MS = 5 * 60_000
const LOGIN_TIMEOUT_MS = 5 * 60_000

const GOOGLE_ANTIGRAVITY_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
] as const

const CLIENT_ID_ENV_NAMES = [
  'PHOENIX_ANTIGRAVITY_OAUTH_CLIENT_ID',
  'GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_ID',
  'PHOENIX_GOOGLE_OAUTH_CLIENT_ID',
] as const

const CLIENT_SECRET_ENV_NAMES = [
  'PHOENIX_ANTIGRAVITY_OAUTH_CLIENT_SECRET',
  'GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_SECRET',
  'PHOENIX_GOOGLE_OAUTH_CLIENT_SECRET',
] as const

const ANTIGRAVITY_HEADERS = {
  'User-Agent': 'google-api-nodejs-client/9.15.1',
  'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
  'Client-Metadata': JSON.stringify({
    ideType: 'IDE_UNSPECIFIED',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
  }),
} as const

const NO_COST: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** Default catalog of models served by Google Antigravity. */
export const GOOGLE_ANTIGRAVITY_DEFAULT_MODELS: readonly Model<'google-generative-ai'>[] = [
  {
    id: 'gemini-3.1-pro-high',
    name: 'Gemini 3.1 Pro (High)',
    api: 'google-generative-ai',
    provider: GOOGLE_ANTIGRAVITY_PROVIDER,
    baseUrl: GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT,
    reasoning: true,
    input: ['text', 'image'],
    cost: NO_COST,
    contextWindow: 1_048_576,
    maxTokens: 65_535,
  },
  {
    id: 'gemini-3.1-pro-low',
    name: 'Gemini 3.1 Pro (Low)',
    api: 'google-generative-ai',
    provider: GOOGLE_ANTIGRAVITY_PROVIDER,
    baseUrl: GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT,
    reasoning: true,
    input: ['text', 'image'],
    cost: NO_COST,
    contextWindow: 1_048_576,
    maxTokens: 65_535,
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    api: 'google-generative-ai',
    provider: GOOGLE_ANTIGRAVITY_PROVIDER,
    baseUrl: GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT,
    reasoning: true,
    input: ['text', 'image'],
    cost: NO_COST,
    contextWindow: 1_048_576,
    maxTokens: 65_535,
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    api: 'google-generative-ai',
    provider: GOOGLE_ANTIGRAVITY_PROVIDER,
    baseUrl: GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT,
    reasoning: true,
    input: ['text', 'image'],
    cost: NO_COST,
    contextWindow: 1_048_576,
    maxTokens: 65_535,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    api: 'google-generative-ai',
    provider: GOOGLE_ANTIGRAVITY_PROVIDER,
    baseUrl: GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT,
    reasoning: true,
    input: ['text', 'image'],
    cost: NO_COST,
    contextWindow: 1_048_576,
    maxTokens: 65_535,
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5 (Antigravity)',
    api: 'google-generative-ai',
    provider: GOOGLE_ANTIGRAVITY_PROVIDER,
    baseUrl: GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT,
    reasoning: false,
    input: ['text', 'image'],
    cost: NO_COST,
    contextWindow: 200_000,
    maxTokens: 64_000,
  },
  {
    id: 'claude-sonnet-4-5-thinking',
    name: 'Claude Sonnet 4.5 Thinking (Antigravity)',
    api: 'google-generative-ai',
    provider: GOOGLE_ANTIGRAVITY_PROVIDER,
    baseUrl: GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT,
    reasoning: true,
    input: ['text', 'image'],
    cost: NO_COST,
    contextWindow: 200_000,
    maxTokens: 64_000,
  },
  {
    id: 'claude-opus-4-5-thinking',
    name: 'Claude Opus 4.5 Thinking (Antigravity)',
    api: 'google-generative-ai',
    provider: GOOGLE_ANTIGRAVITY_PROVIDER,
    baseUrl: GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT,
    reasoning: true,
    input: ['text', 'image'],
    cost: NO_COST,
    contextWindow: 200_000,
    maxTokens: 64_000,
  },
  {
    id: 'claude-opus-4-6-thinking',
    name: 'Claude Opus 4.6 Thinking (Antigravity)',
    api: 'google-generative-ai',
    provider: GOOGLE_ANTIGRAVITY_PROVIDER,
    baseUrl: GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT,
    reasoning: true,
    input: ['text', 'image'],
    cost: NO_COST,
    contextWindow: 200_000,
    maxTokens: 64_000,
  },
]

/** Stored OAuth credential fields for Google Antigravity. */
export interface AntigravityOAuthCredential extends OAuthCredential {
  projectId: string
  email?: string
  clientId?: string
  clientSecret?: string
}

/** Injectable dependencies for deterministic testing. */
export interface GoogleAntigravityDeps {
  fetch?: typeof fetch
  authContext?: AuthContext
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

async function resolveEnvCandidate(
  names: readonly string[],
  authContext?: AuthContext,
): Promise<string | undefined> {
  for (const name of names) {
    const fromCtx = authContext === undefined ? undefined : nonEmptyText(await authContext.env(name))
    if (fromCtx !== undefined) return fromCtx
    const fromProcess = nonEmptyText(process.env[name])
    if (fromProcess !== undefined) return fromProcess
  }
  return undefined
}

async function resolveOAuthClient(
  interaction: AuthInteraction,
  authContext?: AuthContext,
): Promise<{ clientId: string; clientSecret?: string }> {
  const envClientId = await resolveEnvCandidate(CLIENT_ID_ENV_NAMES, authContext)
  const envClientSecret = await resolveEnvCandidate(CLIENT_SECRET_ENV_NAMES, authContext)
  if (envClientId !== undefined) {
    return {
      clientId: envClientId,
      ...envClientSecret === undefined ? {} : { clientSecret: envClientSecret },
    }
  }
  const enteredId = nonEmptyText(await interaction.prompt({
    type: 'text',
    message: 'Enter your Google OAuth Desktop Client ID (or set PHOENIX_ANTIGRAVITY_OAUTH_CLIENT_ID).',
    placeholder: '123456789-abc.apps.googleusercontent.com',
    ...interaction.signal === undefined ? {} : { signal: interaction.signal },
  }))
  if (enteredId === undefined) {
    throw new Error('Google Antigravity OAuth Client ID is required to sign in.')
  }
  const enteredSecret = envClientSecret ?? nonEmptyText(await interaction.prompt({
    type: 'secret',
    message: 'Enter the Google OAuth Client Secret (leave blank if your client does not require one).',
    ...interaction.signal === undefined ? {} : { signal: interaction.signal },
  }))
  return {
    clientId: enteredId,
    ...enteredSecret === undefined ? {} : { clientSecret: enteredSecret },
  }
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

interface CallbackServer {
  redirectUri: string
  waitForCode: () => Promise<string>
  close: () => void
}

async function startCallbackServer(expectedState: string, signal?: AbortSignal): Promise<CallbackServer> {
  let resolveCode!: (code: string) => void
  let rejectCode!: (error: Error) => void
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  const server: Server = createServer((req, res) => {
    const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (reqUrl.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not found')
      return
    }
    const error = reqUrl.searchParams.get('error')
    if (error !== null && error !== '') {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h1>Google Antigravity sign-in failed</h1><p>You can close this tab and return to Phoenix.</p>')
      rejectCode(new Error(`Google OAuth error: ${error}`))
      return
    }
    const state = reqUrl.searchParams.get('state')
    const code = reqUrl.searchParams.get('code')
    if (state !== expectedState || code === null || code === '') {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h1>Invalid OAuth callback</h1><p>Missing or mismatched state/code.</p>')
      rejectCode(new Error('Google OAuth callback failed state or code validation.'))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<h1>Google Antigravity connected</h1><p>You can close this tab and return to Phoenix.</p>')
    resolveCode(code)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('Failed to bind local OAuth callback port')
  }

  const close = (): void => {
    server.closeAllConnections()
    server.close()
  }

  const timer = setTimeout(() => {
    rejectCode(new Error('Timed out waiting for Google OAuth callback'))
    close()
  }, LOGIN_TIMEOUT_MS)

  const onAbort = (): void => {
    clearTimeout(timer)
    rejectCode(new Error('Google Antigravity sign-in cancelled'))
    close()
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  return {
    redirectUri: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
    waitForCode: () => codePromise.finally(() => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      close()
    }),
    close: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      close()
    },
  }
}

interface GoogleTokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
}

async function exchangeAuthCode(
  fetchImpl: typeof fetch,
  params: {
    code: string
    codeVerifier: string
    redirectUri: string
    clientId: string
    clientSecret?: string
    signal?: AbortSignal
  },
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    code: params.code,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  })
  if (params.clientSecret !== undefined) {
    body.set('client_secret', params.clientSecret)
  }
  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    ...params.signal === undefined ? {} : { signal: params.signal },
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Google OAuth token exchange failed (${response.status}): ${text}`)
  }
  const data = await response.json() as Partial<GoogleTokenResponse>
  if (typeof data.access_token !== 'string' || data.access_token === '') {
    throw new Error('Google OAuth token exchange returned no access_token')
  }
  return {
    access_token: data.access_token,
    expires_in: typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600,
    ...typeof data.refresh_token === 'string' && data.refresh_token !== '' ? { refresh_token: data.refresh_token } : {},
  }
}

async function fetchUserEmail(
  fetchImpl: typeof fetch,
  accessToken: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const response = await fetchImpl(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
      ...signal === undefined ? {} : { signal },
    })
    if (!response.ok) return undefined
    const data = await response.json() as { email?: unknown }
    return typeof data.email === 'string' && data.email !== '' ? data.email : undefined
  } catch {
    return undefined
  }
}

interface LoadCodeAssistPayload {
  cloudaicompanionProject?: string | { id?: string } | null
  allowedTiers?: Array<{ id?: string; isDefault?: boolean }>
}

/**
 * Discover the Cloud Code Assist companion project for an authenticated Google
 * account, falling back to `DEFAULT_ANTIGRAVITY_PROJECT_ID` when needed.
 */
export async function discoverAntigravityProject(
  fetchImpl: typeof fetch,
  accessToken: string,
  signal?: AbortSignal,
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...ANTIGRAVITY_HEADERS,
  }

  for (const endpoint of [GOOGLE_ANTIGRAVITY_FALLBACK_ENDPOINT, GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT]) {
    try {
      const response = await fetchImpl(`${endpoint}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          metadata: {
            ideType: 'IDE_UNSPECIFIED',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI',
          },
        }),
        ...signal === undefined ? {} : { signal },
      })
      if (!response.ok) continue
      const data = await response.json() as LoadCodeAssistPayload
      if (typeof data.cloudaicompanionProject === 'string' && data.cloudaicompanionProject !== '') {
        return data.cloudaicompanionProject
      }
      if (
        typeof data.cloudaicompanionProject === 'object'
        && data.cloudaicompanionProject !== null
        && typeof data.cloudaicompanionProject.id === 'string'
        && data.cloudaicompanionProject.id !== ''
      ) {
        return data.cloudaicompanionProject.id
      }
    } catch {
      // Try next endpoint.
    }
  }
  return DEFAULT_ANTIGRAVITY_PROJECT_ID
}

/**
 * Parse `options.apiKey` into `{ token, projectId }`. Supports both JSON
 * credentials produced by `toAuth()` and a raw bearer token string.
 */
export function parseAntigravityAuth(apiKey: string | undefined): { token: string; projectId: string } {
  if (apiKey === undefined || apiKey.trim() === '') {
    throw new Error('Google Antigravity requires OAuth sign-in. Open Settings -> Models and sign in with Google Antigravity.')
  }
  const trimmed = apiKey.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { token?: unknown; projectId?: unknown }
      if (typeof parsed.token === 'string' && parsed.token !== '') {
        return {
          token: parsed.token,
          projectId: typeof parsed.projectId === 'string' && parsed.projectId !== ''
            ? parsed.projectId
            : DEFAULT_ANTIGRAVITY_PROJECT_ID,
        }
      }
    } catch {
      // Fall through to raw token handling.
    }
  }
  return { token: trimmed, projectId: DEFAULT_ANTIGRAVITY_PROJECT_ID }
}

function isClaudeModel(modelId: string): boolean {
  return modelId.toLowerCase().includes('claude')
}

function isClaudeThinkingModel(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  return lower.includes('claude') && lower.includes('thinking')
}

function isGemini3Model(modelId: string): boolean {
  return modelId.toLowerCase().includes('gemini-3')
}

function mapReasoningToGoogleLevel(
  level: NonNullable<SimpleStreamOptions['reasoning']>,
): 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH' {
  switch (level) {
    case 'minimal': return 'MINIMAL'
    case 'low': return 'LOW'
    case 'medium': return 'MEDIUM'
    case 'high':
    case 'xhigh':
    case 'max':
      return 'HIGH'
  }
}

function mapReasoningToBudget(
  level: NonNullable<SimpleStreamOptions['reasoning']>,
): number {
  switch (level) {
    case 'minimal': return 1024
    case 'low': return 4096
    case 'medium': return 8192
    case 'high': return 16384
    case 'xhigh':
    case 'max':
      return 32768
  }
}

/** Build the Cloud Code Assist `v1internal:streamGenerateContent` request body. */
export function buildAntigravityRequestBody(
  model: Model<Api>,
  context: PiContext,
  projectId: string,
  options?: SimpleStreamOptions,
): Record<string, unknown> {
  const googleModel = model as Model<'google-generative-ai'>
  const contents = convertMessages(googleModel, context)
  const generationConfig: Record<string, unknown> = {}
  if (options?.temperature !== undefined) generationConfig.temperature = options.temperature
  if (options?.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens

  const reasoning = clampReasoning(options?.reasoning)
  if (model.reasoning && reasoning !== undefined) {
    if (isGemini3Model(model.id)) {
      generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingLevel: mapReasoningToGoogleLevel(reasoning),
      }
    } else {
      const budget = mapReasoningToBudget(reasoning)
      generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: budget,
      }
      if (isClaudeThinkingModel(model.id) && typeof generationConfig.maxOutputTokens === 'number') {
        if (generationConfig.maxOutputTokens <= budget) {
          generationConfig.maxOutputTokens = budget + 4096
        }
      }
    }
  }

  const request: Record<string, unknown> = { contents }
  if (context.systemPrompt !== undefined && context.systemPrompt !== '') {
    request.systemInstruction = { parts: [{ text: context.systemPrompt }] }
  }
  if (Object.keys(generationConfig).length > 0) {
    request.generationConfig = generationConfig
  }
  if (context.tools !== undefined && context.tools.length > 0) {
    const convertedTools = convertTools(context.tools, isClaudeModel(model.id))
    if (convertedTools !== undefined) {
      request.tools = convertedTools
      const mode = resolveGoogleFunctionCallingMode(
        context.tools,
        undefined,
        supportsGoogleStrictToolSampling(model.id),
      )
      if (mode !== undefined) {
        request.toolConfig = { functionCallingConfig: { mode } }
      }
    }
  }

  return {
    project: projectId,
    model: model.id,
    request,
    requestType: 'agent',
    userAgent: 'antigravity',
    requestId: `agent-${randomUUID()}`,
  }
}

interface CloudCodePart {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: {
    name?: string
    args?: Record<string, unknown>
    id?: string
  }
}

interface CloudCodeChunk {
  response?: {
    responseId?: string
    modelVersion?: string
    candidates?: Array<{
      content?: { parts?: CloudCodePart[] }
      finishReason?: string
    }>
    usageMetadata?: {
      promptTokenCount?: number
      candidatesTokenCount?: number
      thoughtsTokenCount?: number
      cachedContentTokenCount?: number
      totalTokenCount?: number
    }
  }
}

/**
 * Stream a completion from Google Antigravity's Cloud Code Assist SSE endpoint,
 * translating Gemini/Claude parts and thought signatures into pi-ai events.
 */
export function streamGoogleAntigravity(
  model: Model<Api>,
  context: PiContext,
  options?: SimpleStreamOptions & StreamOptions,
  fetchImpl: typeof fetch = fetch,
): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream()

  void (async () => {
    const output: AssistantMessage = {
      role: 'assistant',
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: emptyUsage(),
      stopReason: 'stop',
      timestamp: Date.now(),
    }

    try {
      const { token, projectId } = parseAntigravityAuth(options?.apiKey)
      const body = buildAntigravityRequestBody(model, context, projectId, options)
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...ANTIGRAVITY_HEADERS,
        ...isClaudeThinkingModel(model.id) ? { 'anthropic-beta': 'interleave-thinking-2025-05-14' } : {},
        ...options?.headers,
      }

      let response: Response | undefined
      let lastErrorText = ''
      for (const endpoint of ANTIGRAVITY_ENDPOINTS) {
        const url = `${endpoint}/v1internal:streamGenerateContent?alt=sse`
        try {
          const candidate = await fetchImpl(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            ...options?.signal === undefined ? {} : { signal: options.signal },
          })
          if (candidate.ok) {
            response = candidate
            break
          }
          lastErrorText = await candidate.text().catch(() => `HTTP ${candidate.status}`)
          // Auth and invalid request errors won't succeed on fallback endpoints.
          if (candidate.status === 400 || candidate.status === 401 || candidate.status === 403) {
            throw new Error(`Cloud Code Assist API error (${candidate.status}): ${lastErrorText}`)
          }
        } catch (error) {
          if (options?.signal?.aborted) throw error
          lastErrorText = error instanceof Error ? error.message : String(error)
        }
      }

      if (response === undefined || !response.body) {
        throw new Error(lastErrorText || 'Google Antigravity request failed with no response body')
      }

      stream.push({ type: 'start', partial: output })

      let currentBlock: TextContent | ThinkingContent | null = null
      const blocks = output.content
      let toolCallCounter = 0

      const flushTextOrThinking = (): void => {
        if (currentBlock === null) return
        const contentIndex = blocks.length - 1
        if (currentBlock.type === 'text') {
          stream.push({ type: 'text_end', contentIndex, content: currentBlock.text, partial: output })
        } else {
          stream.push({ type: 'thinking_end', contentIndex, content: currentBlock.thinking, partial: output })
        }
        currentBlock = null
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (!line.startsWith('data:')) continue
          const jsonStr = line.slice(5).trim()
          if (jsonStr === '' || jsonStr === '[DONE]') continue

          let chunk: CloudCodeChunk
          try {
            chunk = JSON.parse(jsonStr) as CloudCodeChunk
          } catch {
            continue
          }

          const resp = chunk.response
          if (resp === undefined) continue
          if (typeof resp.responseId === 'string') output.responseId = resp.responseId
          if (typeof resp.modelVersion === 'string') output.responseModel = resp.modelVersion

          const candidate = resp.candidates?.[0]
          const parts = candidate?.content?.parts ?? []
          for (const part of parts) {
            if (part.text !== undefined) {
              const isThinking = isThinkingPart(part)
              if (
                currentBlock === null
                || (isThinking && currentBlock.type !== 'thinking')
                || (!isThinking && currentBlock.type !== 'text')
              ) {
                flushTextOrThinking()
                if (isThinking) {
                  currentBlock = { type: 'thinking', thinking: '' }
                  blocks.push(currentBlock)
                  stream.push({ type: 'thinking_start', contentIndex: blocks.length - 1, partial: output })
                } else {
                  currentBlock = { type: 'text', text: '' }
                  blocks.push(currentBlock)
                  stream.push({ type: 'text_start', contentIndex: blocks.length - 1, partial: output })
                }
              }

              const contentIndex = blocks.length - 1
              if (currentBlock.type === 'thinking') {
                currentBlock.thinking += part.text
                const nextSig = retainThoughtSignature(
                  currentBlock.thinkingSignature,
                  part.thoughtSignature,
                )
                if (nextSig !== undefined) currentBlock.thinkingSignature = nextSig
                stream.push({ type: 'thinking_delta', contentIndex, delta: part.text, partial: output })
              } else {
                currentBlock.text += part.text
                const nextSig = retainThoughtSignature(
                  currentBlock.textSignature,
                  part.thoughtSignature,
                )
                if (nextSig !== undefined) currentBlock.textSignature = nextSig
                stream.push({ type: 'text_delta', contentIndex, delta: part.text, partial: output })
              }
            }

            if (part.functionCall !== undefined) {
              flushTextOrThinking()
              const name = part.functionCall.name ?? ''
              const args = part.functionCall.args ?? {}
              const providedId = part.functionCall.id
              const needsId = requiresToolCallId(model.id)
              const id = typeof providedId === 'string' && providedId !== ''
                ? providedId
                : needsId
                  ? `${name}_${Date.now()}_${++toolCallCounter}`
                  : `${name}_${++toolCallCounter}`
              const toolCall: ToolCall = {
                type: 'toolCall',
                id,
                name,
                arguments: args,
                ...part.thoughtSignature === undefined ? {} : { thoughtSignature: part.thoughtSignature },
              }
              blocks.push(toolCall)
              const contentIndex = blocks.length - 1
              stream.push({ type: 'toolcall_start', contentIndex, partial: output })
              stream.push({ type: 'toolcall_delta', contentIndex, delta: JSON.stringify(args), partial: output })
              stream.push({ type: 'toolcall_end', contentIndex, toolCall, partial: output })
            }
          }

          if (candidate?.finishReason !== undefined) {
            output.stopReason = mapStopReasonString(candidate.finishReason)
          }

          if (resp.usageMetadata !== undefined) {
            const promptTokens = resp.usageMetadata.promptTokenCount ?? 0
            const cacheRead = resp.usageMetadata.cachedContentTokenCount ?? 0
            const candidatesTokens = resp.usageMetadata.candidatesTokenCount ?? 0
            const thoughtsTokens = resp.usageMetadata.thoughtsTokenCount ?? 0
            const outputTokens = candidatesTokens + thoughtsTokens
            output.usage = {
              input: Math.max(0, promptTokens - cacheRead),
              output: outputTokens,
              cacheRead,
              cacheWrite: 0,
              totalTokens: resp.usageMetadata.totalTokenCount ?? (promptTokens + outputTokens),
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            }
          }
        }
      }

      flushTextOrThinking()
      if (blocks.some(block => block.type === 'toolCall') && output.stopReason === 'stop') {
        output.stopReason = 'toolUse'
      }

      const doneReason: Extract<StopReason, 'stop' | 'length' | 'toolUse'> =
        output.stopReason === 'length' || output.stopReason === 'toolUse'
          ? output.stopReason
          : 'stop'
      stream.push({ type: 'done', reason: doneReason, message: output })
      stream.end(output)
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? 'aborted' : 'error'
      output.errorMessage = error instanceof Error ? error.message : String(error)
      stream.push({
        type: 'error',
        reason: output.stopReason,
        error: output,
      })
      stream.end(output)
    }
  })()

  return stream
}

/**
 * Create the Google Antigravity `Provider` with OAuth 2.0 PKCE login, silent
 * token refresh, and Cloud Code Assist streaming.
 */
export function googleAntigravityProvider(deps: GoogleAntigravityDeps = {}): Provider<'google-generative-ai'> {
  const fetchImpl = deps.fetch ?? fetch

  return {
    id: GOOGLE_ANTIGRAVITY_PROVIDER,
    name: GOOGLE_ANTIGRAVITY_DISPLAY_NAME,
    baseUrl: GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT,
    auth: {
      oauth: {
        name: GOOGLE_ANTIGRAVITY_DISPLAY_NAME,
        loginLabel: 'Google Antigravity OAuth',
        async login(interaction: AuthInteraction): Promise<AntigravityOAuthCredential> {
          const { clientId, clientSecret } = await resolveOAuthClient(interaction, deps.authContext)
          const { verifier, challenge } = generatePkce()
          const state = randomBytes(16).toString('hex')
          const callbackServer = await startCallbackServer(state, interaction.signal)

          try {
            const authParams = new URLSearchParams({
              client_id: clientId,
              response_type: 'code',
              redirect_uri: callbackServer.redirectUri,
              scope: GOOGLE_ANTIGRAVITY_SCOPES.join(' '),
              code_challenge: challenge,
              code_challenge_method: 'S256',
              state,
              access_type: 'offline',
              prompt: 'consent',
            })
            const url = `${GOOGLE_AUTH_ENDPOINT}?${authParams.toString()}`
            interaction.notify({
              type: 'auth_url',
              url,
              instructions: 'Open this link in your browser and sign in with your Google Antigravity account.',
            })

            const code = await callbackServer.waitForCode()
            interaction.notify({ type: 'progress', message: 'Exchanging authorization code for tokens…' })
            const tokens = await exchangeAuthCode(fetchImpl, {
              code,
              codeVerifier: verifier,
              redirectUri: callbackServer.redirectUri,
              clientId,
              ...clientSecret === undefined ? {} : { clientSecret },
              ...interaction.signal === undefined ? {} : { signal: interaction.signal },
            })
            if (tokens.refresh_token === undefined) {
              throw new Error('Google OAuth did not return a refresh token. Revoke app access and try signing in again.')
            }

            interaction.notify({ type: 'progress', message: 'Discovering Cloud Code Assist project…' })
            const [projectId, email] = await Promise.all([
              discoverAntigravityProject(fetchImpl, tokens.access_token, interaction.signal),
              fetchUserEmail(fetchImpl, tokens.access_token, interaction.signal),
            ])

            return {
              type: 'oauth',
              access: tokens.access_token,
              refresh: tokens.refresh_token,
              expires: Date.now() + tokens.expires_in * 1000 - EXPIRY_SKEW_MS,
              projectId,
              ...email === undefined ? {} : { email },
              clientId,
              ...clientSecret === undefined ? {} : { clientSecret },
            }
          } catch (error) {
            callbackServer.close()
            throw error
          }
        },
        async refresh(credential: OAuthCredential, signal?: AbortSignal): Promise<AntigravityOAuthCredential> {
          const typed = credential as Partial<AntigravityOAuthCredential>
          const clientId = nonEmptyText(typed.clientId)
            ?? await resolveEnvCandidate(CLIENT_ID_ENV_NAMES, deps.authContext)
          if (clientId === undefined) {
            throw new Error('Google Antigravity OAuth Client ID is missing; sign in again.')
          }
          const clientSecret = nonEmptyText(typed.clientSecret)
            ?? await resolveEnvCandidate(CLIENT_SECRET_ENV_NAMES, deps.authContext)

          const body = new URLSearchParams({
            client_id: clientId,
            refresh_token: credential.refresh,
            grant_type: 'refresh_token',
          })
          if (clientSecret !== undefined) body.set('client_secret', clientSecret)

          const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            ...signal === undefined ? {} : { signal },
          })
          if (!response.ok) {
            const text = await response.text().catch(() => '')
            throw new Error(`Google Antigravity token refresh failed (${response.status}): ${text}`)
          }
          const data = await response.json() as Partial<GoogleTokenResponse>
          if (typeof data.access_token !== 'string' || data.access_token === '') {
            throw new Error('Google Antigravity token refresh returned no access_token')
          }
          const expiresIn = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600
          const projectId = nonEmptyText(typed.projectId)
            ?? await discoverAntigravityProject(fetchImpl, data.access_token, signal)
          return {
            type: 'oauth',
            access: data.access_token,
            refresh: nonEmptyText(data.refresh_token) ?? credential.refresh,
            expires: Date.now() + expiresIn * 1000 - EXPIRY_SKEW_MS,
            projectId,
            ...typed.email === undefined ? {} : { email: typed.email },
            clientId,
            ...clientSecret === undefined ? {} : { clientSecret },
          }
        },
        toAuth(credential: OAuthCredential): Promise<ModelAuth> {
          const typed = credential as Partial<AntigravityOAuthCredential>
          const projectId = nonEmptyText(typed.projectId) ?? DEFAULT_ANTIGRAVITY_PROJECT_ID
          return Promise.resolve({
            apiKey: JSON.stringify({ token: credential.access, projectId }),
          })
        },
      },
    },
    getModels: () => GOOGLE_ANTIGRAVITY_DEFAULT_MODELS,
    stream: (model, context, options) => streamGoogleAntigravity(model, context, options, fetchImpl),
    streamSimple: (model, context, options) => {
      const base = buildBaseOptions(model, context, options, options?.apiKey)
      return streamGoogleAntigravity(
        model,
        context,
        {
          ...base,
          ...options?.reasoning === undefined ? {} : { reasoning: options.reasoning },
          ...options?.thinkingBudgets === undefined ? {} : { thinkingBudgets: options.thinkingBudgets },
        },
        fetchImpl,
      )
    },
  }
}
