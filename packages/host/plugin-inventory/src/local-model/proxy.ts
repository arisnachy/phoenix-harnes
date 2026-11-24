import { availableParallelism, freemem, totalmem } from 'node:os'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { LocalModelRuntimeManager } from './manager.js'
import { getLocalModel } from './catalog.js'
import type { LocalModelCatalogEntry, LocalThinking } from './types.js'
import { NativeOllamaChatError, localResourcePolicy, relayNativeOllamaChat, toNativeOllamaChat } from './ollama-native-chat.js'

/** Stable loopback port exposed to the normal Phoenix LLM provider. */
export const PHOENIX_LOCAL_PROXY_PORT = 17_842

/** Stable OpenAI-compatible base URL used by the `phoenix-local` provider. */
export const PHOENIX_LOCAL_PROXY_BASE_URL = `http://127.0.0.1:${String(PHOENIX_LOCAL_PROXY_PORT)}/v1`

/** Internal route metadata header emitted by the Phoenix Local adapter. */
export const PHOENIX_LOCAL_MODEL_HEADER = 'x-phoenix-local-model-id'
/** Loopback-only endpoint that reports the selected model without starting it. */
export const PHOENIX_LOCAL_METADATA_PATH = '/phoenix-local/metadata'
/** Marker required by the built-in Phoenix Local provider on loopback. */
export const PHOENIX_LOCAL_PROXY_AUTHORIZATION = 'Bearer phoenix-local'

const MAX_REQUEST_BYTES = 16 * 1024 * 1024
/** Abort a silent streaming Ollama connection, not an actively generating CPU model. */
const OLLAMA_STREAM_IDLE_TIMEOUT_MS = 8 * 60_000
/** Bound entire local requests, including non-streaming CPU inference. */
const LOCAL_REQUEST_MAX_MS = 10 * 60_000

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
    if (name.toLowerCase() === 'host' || name.toLowerCase() === 'content-length'
      || name.toLowerCase() === 'x-phoenix-local-auto-continue'
      || name.toLowerCase() === PHOENIX_LOCAL_MODEL_HEADER) continue
    if (Array.isArray(value)) value.forEach((item) =>{  headers.append(name, item) })
    else headers.set(name, value)
  }
  return headers
}

function jsonResponse(response: ServerResponse, statusCode: number, payload: unknown): void {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8')
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('content-length', encoded.byteLength)
  response.end(encoded)
}

/**
 * Adapt Phoenix's stable provider model name to the model already in Ollama.
 * Preserve explicitly configured Ollama thinking levels while capping CPU
 * replies and retaining caller tool declarations and streaming flags.
 * The rewritten request never leaves 127.0.0.1.
 */
export function rewriteOllamaOpenAiBody(
  suffix: string,
  body: Uint8Array<ArrayBuffer> | undefined,
  model: LocalModelCatalogEntry | undefined,
  thinking: LocalThinking = false,
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
  const requested = request[limitField] ?? (route === '/chat/completions' ? request['max_completion_tokens'] : undefined)
  const maxTokens = typeof requested === 'number' && Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), model.maxTokens)
    : model.maxTokens
  const adapted: Record<string, unknown> = {
    ...request,
    model: model.ollamaModel,
    [limitField]: maxTokens,
  }
  if (route === '/chat/completions') {
    // The Ollama OpenAI-compatible endpoint documents max_tokens, not
    // max_completion_tokens. Do not send two conflicting output budgets.
    delete adapted['max_completion_tokens']
    delete adapted['max_output_tokens']
    if (thinking === false) adapted['reasoning_effort'] = 'none'
    else if (typeof thinking === 'string') adapted['reasoning_effort'] = thinking
    else delete adapted['reasoning_effort']
    delete adapted['reasoning']
  } else {
    if (thinking === null) {
      delete adapted['think']
      delete adapted['reasoning']
    } else {
      adapted['think'] = thinking
      adapted['reasoning'] = { effort: thinking === false ? 'none' : thinking === true ? 'high' : thinking }
    }
  }
  const encoded = Buffer.from(JSON.stringify(adapted), 'utf8')
  const copy = new Uint8Array(new ArrayBuffer(encoded.length))
  copy.set(encoded)
  return copy
}

function responseHeaders(source: Headers, target: ServerResponse): void {
  source.forEach((value, name) => {
    if (name.toLowerCase() === 'content-encoding'
      || name.toLowerCase() === 'content-length'
      || name.toLowerCase() === 'transfer-encoding'
      || name.toLowerCase() === 'connection') return
    target.setHeader(name, value)
  })
}

async function forward(
  manager: LocalModelRuntimeManager,
  request: IncomingMessage,
  response: ServerResponse,
  ollamaDeadlineMs = OLLAMA_STREAM_IDLE_TIMEOUT_MS,
): Promise<void> {
  let clearIdleTimer: (() => void) | undefined
  try {
    const incomingPath = request.url ?? '/v1'
    const suffix = incomingPath.startsWith('/v1') ? incomingPath.slice(3) : incomingPath
    // The adapter asks for metadata before fitting a request. Keep this path
    // independent from the backend lifecycle so a stopped model remains
    // inspectable and a context switch cannot wake the wrong process.
    if (request.method === 'GET' && suffix.split('?')[0] === PHOENIX_LOCAL_METADATA_PATH) {
      if (request.headers.authorization !== PHOENIX_LOCAL_PROXY_AUTHORIZATION) {
        jsonResponse(response, 401, {
          error: { message: 'Phoenix Local metadata requires the loopback provider authorization.', type: 'phoenix_local_unauthorized' },
        })
        return
      }
      const selected = getLocalModel(manager.snapshot().selectedModelId)
      if (selected === undefined) {
        jsonResponse(response, 409, { error: { message: 'Phoenix Local no reconoce el modelo seleccionado.' } })
        return
      }
      jsonResponse(response, 200, {
        selectedModelId: selected.id,
        contextWindow: selected.contextWindow,
        maxTokens: selected.maxTokens,
      })
      return
    }
    const body = await readBody(request)
    const runtime = manager.snapshot()
    const selected = getLocalModel(runtime.selectedModelId)
    const requestedModel = request.headers[PHOENIX_LOCAL_MODEL_HEADER]
    const requestedModelId = Array.isArray(requestedModel) ? requestedModel[0] : requestedModel
    if (requestedModelId !== undefined && requestedModelId !== runtime.selectedModelId) {
      jsonResponse(response, 409, {
        error: {
          message: `Phoenix Local cambió de modelo durante la solicitud. Reintenta con el modelo seleccionado (${runtime.selectedModelId}).`,
          type: 'phoenix_local_model_mismatch',
          expected_model: runtime.selectedModelId,
          requested_model: requestedModelId,
        },
      })
      return
    }
    if (selected === undefined) {
      jsonResponse(response, 409, {
        error: {
          message: `Phoenix Local no reconoce el modelo seleccionado: ${runtime.selectedModelId}.`,
          type: 'phoenix_local_unknown_model',
        },
      })
      return
    }
    const backendBaseUrl = await manager.ensureRunning()
    // Starting a managed backend can await a download/process health check.
    // Re-read the selection before rewriting or forwarding so a concurrent
    // Settings switch cannot send a request fitted for the previous model to
    // the new backend.
    const startedRuntime = manager.snapshot()
    if (startedRuntime.selectedModelId !== runtime.selectedModelId) {
      jsonResponse(response, 409, {
        error: {
          message: 'Phoenix Local cambió de modelo mientras se iniciaba. Reintenta la solicitud.',
          type: 'phoenix_local_model_mismatch',
          expected_model: startedRuntime.selectedModelId,
          requested_model: runtime.selectedModelId,
        },
      })
      return
    }
    const thinking = startedRuntime.thinking === undefined ? false : startedRuntime.thinking
    const isOllama = selected.backend === 'ollama'
    // Native Ollama /api/chat is the authoritative way to disable Qwen
    // reasoning. Its /v1 compatibility route has produced 64/64 hidden
    // reasoning tokens with an empty visible answer on some Ollama versions.
    const nativeChat = request.method === 'POST' && suffix.split('?')[0] === '/chat/completions'
      && selected.backend === 'ollama'
      ? toNativeOllamaChat(body, selected, request.headers['x-phoenix-local-auto-continue'] === '1', thinking,
        localResourcePolicy(startedRuntime.mode, freemem(), totalmem(), availableParallelism()))
      : undefined
    const forwardedBody = nativeChat === undefined
      ? request.method === 'POST' ? rewriteOllamaOpenAiBody(suffix, body, selected, thinking) : body
      : (() => {
        const encoded = Buffer.from(JSON.stringify(nativeChat.payload), 'utf8')
        const copy = new Uint8Array(new ArrayBuffer(encoded.length))
        copy.set(encoded)
        return copy
      })()
    const clientClosed = new AbortController()
    response.once('close', () => { clientClosed.abort() })
    // Slow local prefill may need several minutes without visible chunks. Refresh
    // the idle timer on each native Ollama byte while retaining the finite
    // request-wide 10-minute cap and caller cancellation.
    // Non-streaming /api/chat cannot emit progress; allow its full CPU budget.
    const useStreamIdle = isOllama && nativeChat?.stream === true
    const streamIdle = new AbortController()
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const markActivity = (): void => {
      if (!useStreamIdle || streamIdle.signal.aborted) return
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        streamIdle.abort(new DOMException('Ollama stopped streaming', 'TimeoutError'))
      }, ollamaDeadlineMs)
      idleTimer.unref()
    }
    clearIdleTimer = () => { if (idleTimer !== undefined) clearTimeout(idleTimer) }
    markActivity()
    const deadline = AbortSignal.timeout(LOCAL_REQUEST_MAX_MS)
    const signal = AbortSignal.any([
      clientClosed.signal, deadline,
      ...(useStreamIdle ? [streamIdle.signal] : []),
    ])
    const started = Date.now()
    const upstream = await fetch(nativeChat === undefined
      ? `${backendBaseUrl}${suffix}`
      : new URL('/api/chat', backendBaseUrl), {
      method: request.method ?? 'POST',
      headers: requestHeaders(request),
      ...(forwardedBody === undefined ? {} : { body: forwardedBody }),
      signal,
    })
    markActivity()
    if (nativeChat !== undefined) {
      await relayNativeOllamaChat(upstream, response, nativeChat, async payload => fetch(
        new URL('/api/chat', backendBaseUrl), {
          method: 'POST',
          headers: requestHeaders(request),
          body: JSON.stringify(payload),
          signal,
        },
      ), markActivity)
      return
    }
    response.statusCode = upstream.status
    responseHeaders(upstream.headers, response)
    if (upstream.body === null) {
      response.end()
      return
    }
    const reader = upstream.body.getReader()
    let firstByte = true
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.byteLength > 0) markActivity()
        if (firstByte) {
          firstByte = false
          // The request text, tool schemas, and model context are never logged.
          if (isOllama) response.setHeader('x-phoenix-local-first-byte-ms', String(Date.now() - started))
        }
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
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    const nativeError = error instanceof NativeOllamaChatError ? error : undefined
    response.statusCode = nativeError?.statusCode ?? (timedOut ? 504 : 503)
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({
      error: {
        message: timedOut
          ? 'PHOENIX Local: Ollama dejó de transmitir o superó el límite máximo de tiempo. Comprueba /api/chat directamente y ollama ps.'
          : error instanceof Error ? error.message : String(error),
        type: nativeError?.code ?? (timedOut ? 'phoenix_local_timeout' : 'phoenix_local_unavailable'),
      },
    }))
  } finally {
    clearIdleTimer?.()
  }
}

/**
 * Start the lightweight loopback gateway that lazily wakes the heavy model.
 * @param managerPromise - host-owned runtime manager promise.
 * @param options - Optional loopback port/deadline injection for integration tests.
 * @returns the listening unreferenced HTTP server.
 */
export async function startPhoenixLocalProxy(
  managerPromise: Promise<LocalModelRuntimeManager>,
  options: { port?: number; ollamaDeadlineMs?: number } = {},
): Promise<Server> {
  const manager = await managerPromise
  const server = createServer((request, response) => {
    void forward(manager, request, response, options.ollamaDeadlineMs)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? PHOENIX_LOCAL_PROXY_PORT, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  server.unref()
  return server
}
