/** Owner-only direct conversation, with bounded SSE and a persistent thread.
 * Remote installations use an owner-managed SSH tunnel to loopback.
 * No browser credential, arbitrary URL, redirect, or automatic retry.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, mkdirSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHomePath } from '@phoenix-ai/dsh-home-paths'
import type { OpenClawEngineConfig, OpenClawConversationSnapshot, OpenClawConversationSend, OpenClawConversationMessage } from './types.ts'

const DEFAULT: OpenClawEngineConfig = { mode: 'native', agent: 'phoenix-worker', port: 18789 }
const AGENT = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u
const THREAD = /^[a-f0-9-]{36}$/u
const MAX_BYTES = 1024 * 1024

export function validOpenClawEngine(value: OpenClawEngineConfig): boolean {
  return ['native', 'direct', 'hybrid'].includes(value.mode) && AGENT.test(value.agent)
    && value.agent !== 'default' && Number.isInteger(value.port) && value.port >= 1024 && value.port <= 65535
}

function atomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = path + '.' + randomUUID() + '.tmp'
  try { writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); renameSync(tmp, path) }
  finally { try { unlinkSync(tmp) } catch { /* already replaced */ } }
}

function read<T>(path: string): T | undefined {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { return undefined }
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function redact(text: string, token: string): string {
  // Suppress partial credential prefixes at the end of a streaming chunk too.
  let safe = text.split(token).join('[REDACTED]')
  for (let n = Math.min(token.length - 1, safe.length); n > 0; n--) {
    if (safe.endsWith(token.slice(0, n))) { safe = safe.slice(0, -n); break }
  }
  return safe
}

/** SSE completion is authoritative only after finish_reason=stop AND [DONE]. */
export async function readOpenClawStream(response: Response, onText: (text: string) => void): Promise<string> {
  if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('OpenClaw did not open a valid event stream')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('OpenClaw returned no stream')
  const decoder = new TextDecoder()
  let buffer = '', text = '', bytes = 0, stopped = false, done = false
  const line = (raw: string): void => {
    if (!raw.startsWith('data:')) return
    const data = raw.slice(5).trim()
    if (data === '[DONE]') { done = true; return }
    if (!data || done) return
    const event = object(JSON.parse(data) as unknown)
    if (event.error !== undefined) throw new Error('OpenClaw reported an unsuccessful run')
    const choice = Array.isArray(event.choices) ? object(event.choices[0]) : {}
    const delta = object(choice.delta)
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) throw new Error('Unexpected client-side tool calls')
    if (typeof delta.content === 'string') {
      text += delta.content
      if (text.length > 48000) throw new Error('OpenClaw response exceeded the display limit')
      onText(text)
    }
    if (choice.finish_reason === 'stop') stopped = true
    else if (choice.finish_reason != null) throw new Error('OpenClaw returned an incomplete result')
  }
  try {
    while (!done) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > MAX_BYTES) throw new Error('OpenClaw stream exceeded the safe size limit')
      buffer += decoder.decode(part.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const raw of lines) line(raw.trimEnd())
    }
    if (!done && buffer.trim()) line(buffer.trimEnd())
    if (!done || !stopped || !text.trim()) throw new Error('OpenClaw completion was not confirmed')
    return text
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}

export class OpenClawConversation {
  private readonly configPath: string
  private readonly conversationPath: string
  private config: OpenClawEngineConfig
  private thread: string
  private messages: OpenClawConversationMessage[]
  private phase: OpenClawConversationSnapshot['phase']
  private partial = ''
  private running: AbortController | undefined

  constructor(private readonly token: () => Promise<string | undefined>, private readonly fetcher: typeof fetch = fetch,
    root = dshHomePath('toolchains')) {
    this.configPath = join(root, 'openclaw-engine.json')
    this.conversationPath = join(root, 'openclaw-conversation.json')
    const config = read<OpenClawEngineConfig>(this.configPath)
    this.config = config && validOpenClawEngine(config) ? config : DEFAULT
    const state = read<OpenClawConversationSnapshot>(this.conversationPath)
    this.thread = state && THREAD.test(state.thread) ? state.thread : randomUUID()
    this.messages = state && Array.isArray(state.messages) ? state.messages.filter(item =>
      (item.role === 'user' || item.role === 'assistant') && typeof item.text === 'string').slice(-100) : []
    this.phase = state?.phase === 'running' || state?.phase === 'unconfirmed' ? 'unconfirmed' : 'idle'
  }

  snapshot(): OpenClawConversationSnapshot {
    return { config: { ...this.config }, thread: this.thread, messages: [...this.messages], phase: this.phase, partial: this.partial }
  }
  private save(): void { atomic(this.conversationPath, { ...this.snapshot(), partial: '' }) }

  configure(config: OpenClawEngineConfig): OpenClawConversationSnapshot {
    if (this.running) throw new Error('Stop the current OpenClaw run before changing engines')
    if (!validOpenClawEngine(config)) throw new Error('Invalid OpenClaw engine configuration')
    const changed = this.config.agent !== config.agent || this.config.port !== config.port
    atomic(this.configPath, { version: 1, ...config })
    this.config = { ...config }
    if (changed) { this.thread = randomUUID(); this.messages = []; this.phase = 'idle'; this.partial = '' }
    this.save()
    return this.snapshot()
  }
  newThread(): OpenClawConversationSnapshot {
    if (this.running) throw new Error('Stop the current OpenClaw run first')
    this.thread = randomUUID(); this.messages = []; this.phase = 'idle'; this.partial = ''
    this.save()
    return this.snapshot()
  }
  cancel(): OpenClawConversationSnapshot {
    this.running?.abort()
    return this.snapshot()
  }
  private async credential(): Promise<string> {
    const token = await this.token()
    if (!token || token.length < 16 || token.length > 2048 || /[\s\u0000-\u001f\u007f]/u.test(token)) throw new Error('Configure the private Gateway credential first')
    return token
  }
  private async verify(token: string, signal?: AbortSignal): Promise<boolean> {
    const timeout = AbortSignal.timeout(8000)
    const response = await this.fetcher('http://127.0.0.1:' + this.config.port + '/v1/models', {
      headers: { authorization: 'Bearer ' + token }, redirect: 'error',
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    })
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); return false }
    // Inventory is small in normal operation; bound it before parsing.
    const reader = response.body?.getReader()
    if (!reader) return false
    let size = 0, raw = ''
    const decoder = new TextDecoder()
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > MAX_BYTES) return false
        raw += decoder.decode(chunk.value, { stream: true })
      }
      const payload = object(JSON.parse(raw + decoder.decode()) as unknown)
      return Array.isArray(payload.data) && payload.data.some(item => object(item).id === 'openclaw/' + this.config.agent)
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  }
  async available(): Promise<boolean> {
    try { return this.config.mode !== 'native' && await this.verify(await this.credential()) } catch { return false }
  }
  start(request: OpenClawConversationSend): OpenClawConversationSnapshot {
    if (this.config.mode !== 'direct') throw new Error('Select the direct OpenClaw engine first')
    if (this.running || this.phase === 'unconfirmed') throw new Error('Resolve the unconfirmed run in OpenClaw or start a new thread')
    const text = request.text.trim()
    if (request.thread !== this.thread || !text || text.length > 16000 || text.includes('\u0000')) throw new Error('Invalid conversation message')
    const controller = new AbortController()
    this.running = controller
    this.phase = 'running'
    this.partial = ''
    try { this.save() } catch { this.running = undefined; this.phase = 'idle'; throw new Error('Cannot persist the OpenClaw conversation') }
    void this.run(text, controller)
    return this.snapshot()
  }
  private async run(text: string, controller: AbortController): Promise<void> {
    let submitted = false
    try {
      const token = await this.credential()
      if (text.includes(token)) throw new Error('Do not send the Gateway credential')
      if (!await this.verify(token, controller.signal)) throw new Error('Configured agent is not available')
      if (controller.signal.aborted) throw new Error('Cancelled before execution')
      this.messages = [...this.messages, { role: 'user', text }].slice(-100) as OpenClawConversationMessage[]
      this.save()
      submitted = true
      const response = await this.fetcher('http://127.0.0.1:' + this.config.port + '/v1/chat/completions', {
        method: 'POST', redirect: 'error',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'openclaw/' + this.config.agent, user: 'phoenix-' + this.thread,
          messages: [{ role: 'user', content: text }], stream: true }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]),
      })
      const reply = await readOpenClawStream(response, value => { this.partial = redact(value, token) })
      this.messages = [...this.messages, { role: 'assistant', text: reply.split(token).join('[REDACTED]') }].slice(-100) as OpenClawConversationMessage[]
      this.phase = 'idle'
    } catch { this.phase = submitted ? 'unconfirmed' : 'idle' }
    finally {
      this.partial = ''; this.running = undefined
      try { this.save() } catch { this.phase = 'unconfirmed' }
    }
  }
}
