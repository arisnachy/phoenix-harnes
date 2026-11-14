import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { LocalModelRuntimeManager } from './manager.js'
import { getLocalModel } from './catalog.js'
import type { LocalModelCatalogEntry } from './types.js'

/** Stable loopback port exposed to the normal Phoenix LLM provider. */
export const PHOENIX_LOCAL_PROXY_PORT = 17_842

/** Stable OpenAI-compatible base URL used by the `phoenix-local` provider. */
export const PHOENIX_LOCAL_PROXY_BASE_URL = `http://127.0.0.1:${String(PHOENIX_LOCAL_PROXY_PORT)}/v1`

const MAX_REQUEST_BYTES = 16 * 1024 * 1024

async function readBody(request: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) throw new Error('Phoenix Local request is larger than 16 MiB.')
    chunks.push(buffer)
  }
  const body = Buffer.concat(chunks)
  const copy = new Uint8Array(new ArrayBuffer(body.length))
  copy.set(body)
  return copy
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    if (name.toLowerCase() === 'host' || name.toLowerCase() === 'content-length') continue
    if (Array.isArray(value)) value.forEach((item) =>{  headers.append(name, item) })
    else headers.set(name, value)
  }
  return headers
}

/**
 * Adapt Phoenix's stable provider model name to the model already in Ollama.
 * Disable explicit thinking and cap verbose CPU-first answers, preserving a
 * smaller caller-supplied limit and all tool declarations and streaming flags.
 * The rewritten request never leaves 127.0.0.1.
 */
export function rewriteOllamaOpenAiBody(
  suffix: string,
  body: Uint8Array<ArrayBuffer> | undefined,
  model: LocalModelCatalogEntry | undefined,
): Uint8Array<ArrayBuffer> | undefined {
  if (body === undefined || model?.backend !== 'ollama' || !model.ollamaModel) return body
  const route = suffix.split('?')[0]
  if (route !== '/chat/completions' && route !== '/responses') return body
  const original = JSON.parse(Buffer.from(body).toString('utf8')) as unknown
  if (typeof original !== 'object' || original === null || Array.isArray(original)) {
    throw new Error('Invalid Phoenix Local JSON request.')
  }
  const request = original as Record<string, unknown>
  const limitField = route === '/responses' ? 'max_output_tokens' : 'max_tokens'
  const requested = request[limitField]
  const maxTokens = typeof requested === 'number' && Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), model.maxTokens)
    : model.maxTokens
  const adapted: Record<string, unknown> = {
    ...request,
    model: model.ollamaModel,
    [limitField]: maxTokens,
  }
  if (route === '/chat/completions') {
    adapted['reasoning_effort'] = 'none'
    delete adapted['reasoning']
  } else {
    adapted['think'] = false
    adapted['reasoning'] = { effort: 'none' }
  }
  const encoded = Buffer.from(JSON.stringify(adapted), 'utf8')
  const copy = new Uint8Array(new ArrayBuffer(encoded.length))
  copy.set(encoded)
  return copy
}

function responseHeaders(source: Headers, target: ServerResponse): void {
  source.forEach((value, name) => {
    if (name.toLowerCase() === 'content-encoding' || name.toLowerCase() === 'content-length') return
    target.setHeader(name, value)
  })
}

async function forward(
  manager: LocalModelRuntimeManager,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const backendBaseUrl = await manager.ensureRunning()
    const incomingPath = request.url ?? '/v1'
    const suffix = incomingPath.startsWith('/v1') ? incomingPath.slice(3) : incomingPath
    const body = await readBody(request)
    const forwardedBody = request.method === 'POST'
      ? rewriteOllamaOpenAiBody(suffix, body, getLocalModel(manager.snapshot().selectedModelId))
      : body
    const upstream = await fetch(`${backendBaseUrl}${suffix}`, {
      method: request.method ?? 'POST',
      headers: requestHeaders(request),
      ...(forwardedBody === undefined ? {} : { body: forwardedBody }),
      signal: AbortSignal.timeout(10 * 60_000),
    })
    response.statusCode = upstream.status
    responseHeaders(upstream.headers, response)
    if (upstream.body === null) {
      response.end()
      return
    }
    const reader = upstream.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        response.write(Buffer.from(value))
      }
    } finally {
      reader.releaseLock()
    }
    response.end()
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : new Error(String(error)))
      return
    }
    response.statusCode = 503
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({
      error: {
        message: error instanceof Error ? error.message : String(error),
        type: 'phoenix_local_unavailable',
      },
    }))
  }
}

/**
 * Start the lightweight loopback gateway that lazily wakes the heavy model.
 * @param managerPromise - host-owned runtime manager promise.
 * @returns the listening unreferenced HTTP server.
 */
export async function startPhoenixLocalProxy(
  managerPromise: Promise<LocalModelRuntimeManager>,
): Promise<Server> {
  const manager = await managerPromise
  const server = createServer((request, response) => {
    void forward(manager, request, response)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(PHOENIX_LOCAL_PROXY_PORT, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  server.unref()
  return server
}
