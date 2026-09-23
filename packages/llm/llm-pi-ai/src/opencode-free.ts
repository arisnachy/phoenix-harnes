import { once } from 'node:events'
import { createServer } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import type { PiAiModelProfile, PiAiProviderProfile } from './config.ts'

/** Stable Phoenix route for no-account OpenCode inference. */
export const OPENCODE_FREE_PROVIDER = 'opencode-free'
/** Public OpenCode model catalog used only for rotating free-model discovery. */
export const OPENCODE_FREE_CATALOG_URL = 'https://opencode.ai/zen/v1/models'
/** Public OpenCode OpenAI-compatible inference root. */
export const OPENCODE_FREE_BASE_URL = 'https://opencode.ai/inference/openai/v1'
/** Loopback seam that strips Phoenix's local-only auth marker before egress. */
export const OPENCODE_FREE_PROXY_BASE_URL = 'http://127.0.0.1:17843/v1'
/** Refresh cadence for the rotating free catalog. */
export const OPENCODE_FREE_REFRESH_MS = 15 * 60 * 1000

const MAX_PROXY_REQUEST_BYTES = 16 * 1024 * 1024
const FALLBACK_FREE_IDS = ['big-pickle', 'mimo-v2.5-free'] as const
const LOCAL_AUTHORIZATION = 'Bearer phoenix-opencode-free'

/** Models known to use another OpenCode wire are excluded from this chat-completions route. */
const RESPONSE_ONLY_FREE_PREFIXES = ['muse-spark-'] as const

/**
 * Whether a Zen catalog id is eligible for the no-account chat-completions route.
 * @param id - The id value.
 * @returns The resulting value.
 */
export function isOpenCodeFreeCandidate(id: string): boolean {
  if (RESPONSE_ONLY_FREE_PREFIXES.some(prefix => id.startsWith(prefix))) return false
  return id === 'big-pickle' || id.endsWith('-free')
}

function modelDisplayName(id: string): string {
  if (id === 'big-pickle') return 'Big Pickle · Gratis'
  return `${id
    .replace(/-free$/, '')
    .split('-')
    .map(part => part.length <= 3 ? part.toUpperCase() : `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join(' ')} · Gratis`
}

/**
 * Convert OpenCode's OpenAI-style catalog payload into Phoenix model descriptors.
 * @param payload - The payload value.
 * @returns The resulting value.
 */
export function parseOpenCodeFreeModels(payload: unknown): PiAiModelProfile[] {
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []

  const ids = new Set<string>()
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null || !('id' in entry)) continue
    const id = (entry as { id?: unknown }).id
    if (typeof id === 'string' && isOpenCodeFreeCandidate(id)) ids.add(id)
  }

  return [...ids].sort().map(id => ({
    id,
    name: modelDisplayName(id),
    contextWindow: 65_536,
    maxTokens: 4_096,
    input: ['text'],
  }))
}

function fallbackModels(): PiAiModelProfile[] {
  return parseOpenCodeFreeModels({ data: FALLBACK_FREE_IDS.map(id => ({ id })) })
}

/** Clone a model without materializing absent optional fields as explicit undefined values. */
function cloneModel(model: PiAiModelProfile): PiAiModelProfile {
  const { input, ...rest } = model
  return input === undefined ? rest : { ...rest, input: [...input] }
}

/**
 * Built-in Phoenix provider profile shown in the normal model selector.
 * @param models - The models value.
 * @returns The resulting value.
 */
export function opencodeFreeProfile(models: readonly PiAiModelProfile[]): PiAiProviderProfile {
  return {
    displayName: '🟢 OpenCode · Gratis',
    api: 'openai-completions',
    baseURL: OPENCODE_FREE_PROXY_BASE_URL,
    defaultContextWindow: 65_536,
    defaultMaxTokens: 4_096,
    defaultInput: ['text'],
    // pi-ai requires a local authorization marker for OpenAI-compatible routes.
    // The loopback proxy strips it, so OpenCode itself receives no credential.
    headers: { Authorization: LOCAL_AUTHORIZATION },
    models: models.map(cloneModel),
  }
}

/**
 * Public open code free catalog shape.
 */
export interface OpenCodeFreeCatalog {
  /** Last known-good free models; always non-empty because a conservative fallback ships with Phoenix. */
  models(): readonly PiAiModelProfile[]
  /** Refresh from OpenCode when stale, retaining the last good list on any network/schema failure. */
  refresh(force?: boolean): Promise<boolean>
}

/**
 * Public open code free catalog options shape.
 */
export interface OpenCodeFreeCatalogOptions {
  fetchImpl?: typeof fetch
  now?: () => number
  refreshMs?: number
}

/**
 * Stateful, failure-tolerant cache for OpenCode's rotating free model ids.
 * @param options - The options value.
 * @returns The resulting value.
 */
export function createOpenCodeFreeCatalog(options: OpenCodeFreeCatalogOptions = {}): OpenCodeFreeCatalog {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  const refreshMs = options.refreshMs ?? OPENCODE_FREE_REFRESH_MS
  let current = fallbackModels()
  let nextRefreshAt = 0
  let inFlight: Promise<boolean> | undefined

  const refresh = async (force = false): Promise<boolean> => {
    if (!force && now() < nextRefreshAt) return false
    if (inFlight !== undefined) return inFlight

    inFlight = (async () => {
      try {
        const response = await fetchImpl(OPENCODE_FREE_CATALOG_URL, {
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) throw new Error(`OpenCode catalog returned HTTP ${response.status}`)
        const discovered = parseOpenCodeFreeModels(await response.json())
        if (discovered.length === 0) throw new Error('OpenCode catalog contained no free chat models')
        const before = current.map(model => model.id).join('\n')
        const after = discovered.map(model => model.id).join('\n')
        current = discovered
        nextRefreshAt = now() + refreshMs
        return before !== after
      } catch {
        // Fail open to the last known-good catalog, but retry sooner than the normal cadence.
        nextRefreshAt = now() + Math.min(refreshMs, 60_000)
        return false
      } finally {
        inFlight = undefined
      }
    })()
    return inFlight
  }

  return {
    models: () => current.map(cloneModel),
    refresh,
  }
}

/**
 * Copy safe request headers to OpenCode while removing all hop-by-hop and authorization data.
 * @param headers - The headers value.
 * @returns The resulting value.
 */
export function openCodeUpstreamHeaders(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): Record<string, string> {
  const blocked = new Set(['authorization', 'host', 'connection', 'content-length', 'transfer-encoding'])
  const output: Record<string, string> = {}
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase()
    if (blocked.has(name) || rawValue === undefined) continue
    output[name] = typeof rawValue === 'string' ? rawValue : rawValue.join(', ')
  }
  if (output['content-type'] === undefined) output['content-type'] = 'application/json'
  return output
}

function incomingHeaders(headers: IncomingHttpHeaders): Record<string, string | readonly string[] | undefined> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, value]))
}

async function readRequestBody(request: IncomingMessage): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of request) {
    const value = typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk)
    bytes += value.byteLength
    if (bytes > MAX_PROXY_REQUEST_BYTES) throw new Error('OpenCode free proxy request exceeded 16 MiB')
    chunks.push(value)
  }
  const body = new ArrayBuffer(bytes)
  const view = new Uint8Array(body)
  let offset = 0
  for (const chunk of chunks) {
    view.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

async function pipeResponse(upstream: Response, response: ServerResponse): Promise<void> {
  response.statusCode = upstream.status
  for (const name of ['content-type', 'cache-control', 'x-request-id']) {
    const value = upstream.headers.get(name)
    if (value !== null) response.setHeader(name, value)
  }
  if (upstream.body === null) {
    response.end()
    return
  }

  const reader = upstream.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!response.write(Buffer.from(value))) await once(response, 'drain')
    }
    response.end()
  } finally {
    reader.releaseLock()
  }
}

async function handleProxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  fetchImpl: typeof fetch,
): Promise<void> {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.statusCode = 404
    response.end('Not found')
    return
  }

  const body = await readRequestBody(request)
  const upstream = await fetchImpl(`${OPENCODE_FREE_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: openCodeUpstreamHeaders(incomingHeaders(request.headers)),
    body,
  })
  await pipeResponse(upstream, response)
}

/**
 * Start the loopback-only OpenCode bridge. Upstream requests carry no Authorization header.
 * @param fetchImpl - The fetch impl value.
 * @returns The resulting value.
 */
export async function startOpenCodeFreeProxy(fetchImpl: typeof fetch = fetch): Promise<Server> {
  const server = createServer((request, response) => {
    void handleProxyRequest(request, response, fetchImpl).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error(String(error)))
        return
      }
      response.statusCode = 502
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }))
    })
  })
  server.unref()
  server.listen(17_843, '127.0.0.1')
  await once(server, 'listening')
  return server
}
