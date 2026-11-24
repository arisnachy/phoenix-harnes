import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { LocalModelCatalogEntry, LocalThinking } from './types.js'

/**
 * Ollama Qwen 3.5 is more reliable using its native /api/chat than the
 * OpenAI-compatible endpoint: native `think` respects the user's selection
 * and only uses named levels explicitly advertised by /api/show.
 *
 * Keep the Phoenix/pi-ai contract OpenAI-compatible at the loopback proxy.
 * Never send content to a cloud model, and never silently discard nontext
 * content, tool calls or previous tool results.
 */

interface NativeToolCall {
  function?: { name?: string; index?: number; arguments?: unknown }
  type?: string
}

interface NativeChatChunk {
  message?: {
    role?: string
    content?: string
    thinking?: string
    tool_calls?: NativeToolCall[]
  }
  done?: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
}

interface NativeBridgeRequest {
  readonly payload: Record<string, unknown>
  readonly stream: boolean
  readonly model: string
  /** Only an ordinary Phoenix Local chat turn may get one extra native pass. */
  readonly allowContinuation: boolean
}

/** Classified native Ollama conversion error with an HTTP status and stable code. */
export class NativeOllamaChatError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
    readonly code = 'ollama_native_chat_error',
  ) {
    super(message)
    this.name = 'NativeOllamaChatError'
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (!Array.isArray(value)) {
    throw new NativeOllamaChatError('Phoenix Local requiere mensajes de texto.', 400, 'unsupported_content')
  }
  const parts: string[] = []
  for (const item of value) {
    const part = record(item)
    if (part?.['type'] !== 'text' || typeof part['text'] !== 'string') {
      throw new NativeOllamaChatError('El Qwen local seleccionado no admite este contenido multimodal.', 400, 'unsupported_content')
    }
    parts.push(part['text'])
  }
  return parts.join('\n')
}

function toolCallsOf(value: unknown): Array<Record<string, unknown>> {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new NativeOllamaChatError('Lista de herramientas inválida.', 400, 'invalid_tools')
  }
  return value.map((item, index) => {
    const call = record(item)
    const fn = record(call?.['function'])
    if (typeof fn?.['name'] !== 'string' || fn['name'].length === 0) {
      throw new NativeOllamaChatError('Nombre de herramienta inválido.', 400, 'invalid_tools')
    }
    let args: unknown = fn['arguments'] ?? {}
    if (typeof args === 'string') {
      try { args = JSON.parse(args) as unknown } catch {
        throw new NativeOllamaChatError('Argumentos de herramienta inválidos.', 400, 'invalid_tools')
      }
    }
    if (record(args) === undefined) {
      throw new NativeOllamaChatError('La herramienta necesita argumentos JSON de objeto.', 400, 'invalid_tools')
    }
    return {
      type: 'function',
      function: { index, name: fn['name'], arguments: args },
    }
  })
}

/**
 * Convert the stable OpenAI chat envelope to the native Ollama wire.
 * @param raw - Incoming JSON bytes from pi-ai.
 * @param model - Selected locally installed Ollama catalog entry.
 * @returns Validated native Ollama chat request honoring the selected thinking mode.
 */
export function toNativeOllamaChat(
  raw: Uint8Array<ArrayBuffer> | undefined,
  model: LocalModelCatalogEntry,
  allowContinuation = false,
  thinking: LocalThinking = false,
  resources?: { keepAlive: string; threads?: number },
): NativeBridgeRequest {
  if (raw === undefined || model.backend !== 'ollama') {
    throw new NativeOllamaChatError('Modelo local incompatible.', 400, 'invalid_model')
  }
  let decoded: unknown
  try { decoded = JSON.parse(Buffer.from(raw).toString('utf8')) as unknown } catch {
    throw new NativeOllamaChatError('Solicitud JSON inválida.', 400, 'invalid_request')
  }
  const request = record(decoded)
  if (request === undefined || !Array.isArray(request['messages'])) {
    throw new NativeOllamaChatError('Se requiere una lista de mensajes.', 400, 'invalid_request')
  }
  const toolIds = new Map<string, string>()
  const messages: Array<Record<string, unknown>> = []
  for (const item of request['messages']) {
    const message = record(item)
    const role = message?.['role']
    if (typeof role !== 'string' || !['system', 'developer', 'user', 'assistant', 'tool'].includes(role)) {
      throw new NativeOllamaChatError('Rol de mensaje no admitido por Ollama.', 400, 'invalid_role')
    }
    if (role === 'tool') {
      const id = message?.['tool_call_id']
      const name = typeof id === 'string' ? toolIds.get(id) : undefined
      if (!name) {
        throw new NativeOllamaChatError('Resultado de herramienta sin llamada previa asociada.', 400, 'invalid_tool_history')
      }
      messages.push({ role: 'tool', tool_name: name, content: textOf(message?.['content']) })
      continue
    }
    const projected: Record<string, unknown> = {
      role: role === 'developer' ? 'system' : role,
      content: textOf(message?.['content']),
    }
    const calls = toolCallsOf(message?.['tool_calls'])
    if (calls.length > 0) {
      projected['tool_calls'] = calls
      for (let index = 0; index < calls.length; index++) {
        const original = (message?.['tool_calls'] as unknown[])[index]
        const id = record(original)?.['id']
        const fn = record(calls[index]?.['function'])
        if (typeof id === 'string' && typeof fn?.['name'] === 'string') toolIds.set(id, fn['name'])
      }
    }
    messages.push(projected)
  }
  const requested = request['max_tokens'] ?? request['max_completion_tokens']
  const outputTokens = typeof requested === 'number' && Number.isFinite(requested) && requested > 0
    ? Math.min(model.maxTokens, Math.floor(requested))
    : model.maxTokens
  // Allocate only the prompt size that is actually needed, rounded upward
  // to 4K blocks. The pi-ai fitter retains authority over the maximum window.
  // This prevents both a wasteful full 256K CPU KV cache and a silent 4K clip.
  const promptChars = JSON.stringify(messages).length
    + (Array.isArray(request['tools']) ? JSON.stringify(request['tools']).length : 0)
  const framingReserve = Math.min(4_096, Math.floor(model.contextWindow / 8))
  const requiredTokens = Math.ceil(promptChars / 3.5) + outputTokens + framingReserve
  if (requiredTokens > model.contextWindow) {
    throw new NativeOllamaChatError(
      `El turno necesita aproximadamente ${requiredTokens} tokens pero ${model.ollamaModel} tiene ${model.contextWindow} asignados. Reduce historial/herramientas o selecciona un modelo con más contexto.`,
      413, 'local_context_exceeded',
    )
  }
  const adaptiveContext = Math.min(model.contextWindow, Math.max(
    Math.min(4_096, model.contextWindow), Math.ceil(requiredTokens / 4_096) * 4_096,
  ))
  const options: Record<string, unknown> = {
    num_ctx: adaptiveContext,
    num_predict: outputTokens,
    ...(resources?.threads === undefined ? {} : { num_thread: resources.threads }),
  }
  if (typeof request['temperature'] === 'number' && Number.isFinite(request['temperature'])) {
    options['temperature'] = request['temperature']
  }
  if (typeof request['top_p'] === 'number' && Number.isFinite(request['top_p'])) {
    options['top_p'] = request['top_p']
  }
  const stream = request['stream'] !== false
  return {
    model: model.ollamaModel,
    stream,
    allowContinuation,
    payload: {
      model: model.ollamaModel,
      messages,
      ...Array.isArray(request['tools']) && request['tools'].length > 0 ? { tools: request['tools'] } : {},
      stream,
      ...(thinking === null ? {} : { think: thinking }),
      options,
      keep_alive: resources?.keepAlive ?? '30m',
    },
  }
}

function openAiTools(calls: NativeToolCall[]): Array<Record<string, unknown>> {
  return calls.map((call, index) => ({
    id: `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    type: 'function',
    function: {
      name: call.function?.name ?? '',
      arguments: JSON.stringify(call.function?.arguments ?? {}),
    },
    index,
  }))
}

function usageOf(chunk: NativeChatChunk): Record<string, number> {
  const input = chunk.prompt_eval_count ?? 0
  const output = chunk.eval_count ?? 0
  return { prompt_tokens: input, completion_tokens: output, total_tokens: input + output }
}

function continuationPayload(request: NativeBridgeRequest, visibleText: string): Record<string, unknown> {
  const messages = request.payload['messages'] as Array<Record<string, unknown>>
  return {
    ...request.payload,
    // The ongoing answer stays visible in the same Phoenix turn. The extra
    // native pass is local-only and never alters the persisted conversation.
    messages: [
      ...messages,
      { role: 'assistant', content: visibleText },
      {
        role: 'user',
        content: 'Continue exactly where you stopped, without repeating completed text. Keep the same language and formatting; do not restart the answer.',
      },
    ],
  }
}

function finishReason(chunk: NativeChatChunk, hasTools: boolean): string {
  if (hasTools) return 'tool_calls'
  return chunk.done_reason === 'length' ? 'length' : 'stop'
}

function emptyResult(): never {
  throw new NativeOllamaChatError(
    'Ollama terminó sin texto visible ni llamadas a herramientas. Comprueba que el modelo admite think=false en /api/chat.',
    502,
    'ollama_no_visible_output',
  )
}

/** Build a non-streaming OpenAI-compatible response from native Ollama data. */
function nativeOllamaCompletion(chunk: NativeChatChunk, model: string): Record<string, unknown> {
  const calls = openAiTools(chunk.message?.tool_calls ?? [])
  const content = chunk.message?.content ?? ''
  if (!content.trim() && calls.length === 0) emptyResult()
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: content.length > 0 ? content : null,
        ...calls.length > 0 ? { tool_calls: calls.map(({ index: _index, ...call }) => call) } : {},
      },
      finish_reason: finishReason(chunk, calls.length > 0),
    }],
    usage: usageOf(chunk),
  }
}

function setSseHeaders(response: ServerResponse): void {
  if (response.headersSent) return
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream; charset=utf-8')
  response.setHeader('cache-control', 'no-cache')
  response.setHeader('x-accel-buffering', 'no')
}

function sendSse(response: ServerResponse, payload: unknown): void {
  setSseHeaders(response)
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

/**
 * Adapt Ollama native NDJSON stream to OpenAI SSE for pi-ai without holding
 * entire generation in memory. Empty reasoning-only results become explicit
 * errors rather than misleading max-token success.
 * @param upstream - Native Ollama HTTP response with JSON or NDJSON body.
 * @param downstream - Phoenix's OpenAI-compatible loopback HTTP response.
 * @param request - Validated request metadata and streaming preference.
 * @param sendContinuation - Same loopback Ollama transport for one bounded extra pass.
 * @returns Once the complete translated response has been sent.
 */
export async function relayNativeOllamaChat(
  upstream: Response,
  downstream: ServerResponse,
  request: NativeBridgeRequest,
  sendContinuation: (payload: Record<string, unknown>) => Promise<Response>,
  onUpstreamActivity?: () => void,
): Promise<void> {
  // Diagnostic marker: distinguish a freshly updated native bridge from an
  // old Phoenix runtime still forwarding to Ollama's /v1 endpoint.
  downstream.setHeader('x-phoenix-local-backend', 'ollama-native')
  if (!upstream.ok) {
    const detail = (await upstream.text()).slice(0, 800)
    throw new NativeOllamaChatError(
      `Ollama rechazó la solicitud (HTTP ${upstream.status}): ${detail}`,
      upstream.status >= 400 && upstream.status < 500 ? 400 : 502,
    )
  }

  if (!request.stream) {
    const initial = await upstream.json() as NativeChatChunk
    let raw = initial
    if (request.allowContinuation && initial.done_reason === 'length'
      && (initial.message?.content ?? '').trim()
      && (initial.message?.tool_calls?.length ?? 0) === 0) {
      try {
        const followUp = await sendContinuation(continuationPayload(request, initial.message?.content ?? ''))
        if (followUp.ok) {
          const next = await followUp.json() as NativeChatChunk
          if ((next.message?.content ?? '').trim() || (next.message?.tool_calls?.length ?? 0) > 0) {
            raw = {
              ...next,
              message: {
                ...next.message,
                content: (initial.message?.content ?? '') + (next.message?.content ?? ''),
              },
              prompt_eval_count: (initial.prompt_eval_count ?? 0) + (next.prompt_eval_count ?? 0),
              eval_count: (initial.eval_count ?? 0) + (next.eval_count ?? 0),
            }
          }
        }
      } catch {
        // Keep the first truthful length stop if the optional follow-up fails.
      }
    }
    const result = nativeOllamaCompletion(raw, request.model)
    downstream.statusCode = 200
    downstream.setHeader('content-type', 'application/json; charset=utf-8')
    downstream.end(JSON.stringify(result))
    return
  }
  if (upstream.body === null) {
    throw new NativeOllamaChatError('Ollama devolvió una transmisión vacía.', 502, 'ollama_empty_stream')
  }

  let started = false
  let visibleText = ''
  const toolCalls: NativeToolCall[] = []
  let terminal: NativeChatChunk | undefined
  const resetTerminal = (): void => { terminal = undefined }
  const responseId = `chatcmpl-${randomUUID()}`
  const created = Math.floor(Date.now() / 1000)
  const frame = (delta: Record<string, unknown>, reason: string | null) => ({
    id: responseId,
    object: 'chat.completion.chunk',
    created,
    model: request.model,
    choices: [{ index: 0, delta, finish_reason: reason }],
  })
  const start = (): void => {
    if (started) return
    started = true
    sendSse(downstream, frame({ role: 'assistant', content: '' }, null))
  }
  const onChunk = (chunk: NativeChatChunk): void => {
    if (typeof chunk.message?.content === 'string' && chunk.message.content.length > 0) {
      start()
      visibleText += chunk.message.content
      sendSse(downstream, frame({ content: chunk.message.content }, null))
    }
    for (const call of chunk.message?.tool_calls ?? []) {
      if (typeof call.function?.name !== 'string' || call.function.name.length === 0) continue
      start()
      const index = toolCalls.length
      toolCalls.push(call)
      sendSse(downstream, frame({
        tool_calls: [{
          index,
          id: `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
          type: 'function',
          function: { name: call.function.name, arguments: JSON.stringify(call.function.arguments ?? {}) },
        }],
      }, null))
    }
    if (chunk.done) terminal = chunk
  }
  let nativeResponse = upstream
  let totalInput = 0
  let totalOutput = 0
  for (let pass = 0; pass < 2; pass++) {
    const reader = nativeResponse.body?.getReader()
    if (reader === undefined) {
      throw new NativeOllamaChatError('Ollama devolvió una transmisión vacía.', 502, 'ollama_empty_stream')
    }
    const decoder = new TextDecoder()
    let buffer = ''
    resetTerminal()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.byteLength > 0) onUpstreamActivity?.()
        buffer += decoder.decode(value, { stream: true })
        if (buffer.length > 1_048_576) {
          throw new NativeOllamaChatError('Un evento de Ollama excedió el límite de tamaño.', 502, 'oversized_ollama_event')
        }
        while (true) {
          const newline = buffer.indexOf('\n')
          if (newline < 0) break
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (line.length > 0) onChunk(JSON.parse(line) as NativeChatChunk)
        }
      }
      const tail = (buffer + decoder.decode()).trim()
      if (tail.length > 0) onChunk(JSON.parse(tail) as NativeChatChunk)
    } finally {
      reader.releaseLock()
    }
    if (terminal === undefined) {
      throw new NativeOllamaChatError('La transmisión de Ollama terminó sin evento final.', 502, 'ollama_truncated_stream')
    }
    totalInput += terminal.prompt_eval_count ?? 0
    totalOutput += terminal.eval_count ?? 0
    if (pass === 0 && request.allowContinuation && terminal.done_reason === 'length'
      && visibleText.trim().length > 0 && toolCalls.length === 0) {
      try {
        const followUp = await sendContinuation(continuationPayload(request, visibleText))
        if (followUp.ok && followUp.body !== null) {
          nativeResponse = followUp
          continue
        }
      } catch {
        // An optional continuation must never erase already streamed text.
      }
    }
    break
  }

  if (terminal === undefined) {
    throw new NativeOllamaChatError('La transmisión de Ollama terminó sin evento final.', 502, 'ollama_truncated_stream')
  }
  if (!visibleText.trim() && toolCalls.length === 0) emptyResult()
  start()
  sendSse(downstream, frame({}, finishReason(terminal, toolCalls.length > 0)))
  sendSse(downstream, {
    id: responseId,
    object: 'chat.completion.chunk',
    created,
    model: request.model,
    choices: [],
    usage: { prompt_tokens: totalInput, completion_tokens: totalOutput, total_tokens: totalInput + totalOutput },
  })
  downstream.end('data: [DONE]\n\n')
}

/** Shorten residency only for on-demand requests, and leave a CPU reserve.
 * Ollama owns GPU allocation and unloading; never kill another process. */
export function localResourcePolicy(mode: 'off' | 'on-demand' | 'always-on', freeBytes: number, totalBytes: number, cores: number) {
  const pressure = freeBytes < Math.max(1_073_741_824, totalBytes * 0.12)
  return {
    keepAlive: mode === 'on-demand' ? (pressure ? '0s' : '2m') : '30m',
    ...(pressure ? { threads: Math.max(1, Math.floor(cores / 2)) } : {}),
  }
}
