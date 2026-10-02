/** Authenticated Codex CLI realtime speech transport for PHOENIX Kira Live.
 *
 * The browser negotiates WebRTC through this Host-only adapter. Phoenix remains
 * the reasoning/execution authority; Codex realtime receives only assistant
 * prose through appendSpeech and renders it as audio.
 * @module @phoenix-ai/dsh-voice-codex
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type {
  VoiceRealtimeProvider,
  VoiceRealtimeProviderOpenRequest,
  VoiceRealtimeProviderOpenResult,
  VoiceRealtimeProviderStatus,
} from '@phoenix-ai/dsh-voice'

interface WireError {
  readonly code?: unknown
  readonly message?: unknown
}

interface WireMessage {
  readonly id?: unknown
  readonly method?: unknown
  readonly params?: unknown
  readonly result?: unknown
  readonly error?: WireError | null
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

interface NotificationWaiter {
  readonly method: string
  readonly predicate: (params: unknown) => boolean
  readonly resolve: (params: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

interface RealtimeSession {
  readonly threadId: string
  readonly voice?: string
  tail: Promise<void>
}

/** Injectable Codex process factory used by deterministic tests. */
export type CodexRealtimeSpawn = () => ChildProcessWithoutNullStreams

/** Construction options for the realtime provider. */
export interface CodexRealtimeProviderOptions {
  readonly enabled?: boolean
  readonly command?: string
  readonly model?: string
  readonly voice?: string
  readonly requestTimeoutMs?: number
  readonly spawnProcess?: CodexRealtimeSpawn
}

/** Loader configuration. */
export interface Config {
  readonly enabled?: boolean
  readonly command?: string
  readonly model?: string
  readonly voice?: string
  readonly requestTimeoutMs?: number
}

/** Schemastery loader schema. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  command: z.string().default('codex'),
  model: z.string(),
  voice: z.string(),
  requestTimeoutMs: z.number().default(15_000),
})

class CodexWireClient {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly timeoutMs: number
  private readonly pending = new Map<number, PendingRequest>()
  private readonly waiters = new Set<NotificationWaiter>()
  private nextId = 1
  private failed = false

  constructor(child: ChildProcessWithoutNullStreams, timeoutMs: number) {
    this.child = child
    this.timeoutMs = timeoutMs
    const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY })
    lines.on('line', line => { this.acceptLine(line) })
    child.stderr.resume()
    child.stdin.on('error', error => { this.fail(error) })
    child.on('error', error => { this.fail(error) })
    child.once('close', code => {
      lines.close()
      if (!this.failed) this.fail(new Error(`voice-codex: app-server exited with ${String(code)}`))
    })
  }

  get alive(): boolean {
    return !this.failed && this.child.exitCode === null && this.child.signalCode === null
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      clientInfo: { name: 'phoenix-kira-live', version: '0.1.1' },
      capabilities: { experimentalApi: true },
    })
    this.notify('initialized')
  }

  request(method: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (!this.alive) return Promise.reject(new Error('voice-codex: app-server is not available'))
    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`voice-codex: ${method} timed out`))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ id, method, params }, (error) => {
        if (error === undefined) return
        const pending = this.pending.get(id)
        if (pending === undefined) return
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.reject(error)
      })
    })
  }

  notify(method: string, params?: Readonly<Record<string, unknown>>): void {
    if (!this.alive) return
    this.write(params === undefined ? { method } : { method, params })
  }

  waitFor(method: string, predicate: (params: unknown) => boolean): Promise<unknown> {
    if (!this.alive) return Promise.reject(new Error('voice-codex: app-server is not available'))
    return new Promise<unknown>((resolve, reject) => {
      const waiter: NotificationWaiter = {
        method,
        predicate,
        resolve: (params) => {
          clearTimeout(waiter.timer)
          this.waiters.delete(waiter)
          resolve(params)
        },
        reject: (error) => {
          clearTimeout(waiter.timer)
          this.waiters.delete(waiter)
          reject(error)
        },
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          reject(new Error(`voice-codex: ${method} notification timed out`))
        }, this.timeoutMs),
      }
      this.waiters.add(waiter)
    })
  }

  close(): void {
    if (!this.failed) this.failed = true
    this.rejectPending(new Error('voice-codex: app-server closed'))
    try {
      if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded) this.child.stdin.end()
    } catch {
      // Child won the pipe-close race.
    }
    if (this.child.exitCode !== null || this.child.signalCode !== null) return
    if (process.platform === 'win32' && this.child.pid !== undefined) {
      spawnSync('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
    } else {
      this.child.kill()
    }
  }

  private write(frame: Readonly<Record<string, unknown>>, done?: (error?: Error) => void): void {
    this.child.stdin.write(`${JSON.stringify(frame)}\n`, error => {
      if (done !== undefined) done(error === null || error === undefined ? undefined : error)
    })
  }

  private acceptLine(line: string): void {
    const source = line.trim()
    if (source === '') return
    let message: WireMessage
    try {
      message = JSON.parse(source) as WireMessage
    } catch {
      this.fail(new Error('voice-codex: app-server emitted invalid JSON'))
      return
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error !== undefined && message.error !== null) {
        const detail = typeof message.error.message === 'string'
          ? message.error.message
          : `RPC error ${String(message.error.code ?? 'unknown')}`
        pending.reject(new Error(`voice-codex: ${detail}`))
      } else {
        pending.resolve(message.result)
      }
      return
    }
    if (typeof message.method !== 'string') return
    for (const waiter of [...this.waiters]) {
      if (waiter.method === message.method && waiter.predicate(message.params)) waiter.resolve(message.params)
    }
  }

  private fail(error: Error): void {
    if (this.failed) return
    this.failed = true
    this.rejectPending(error)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    for (const waiter of [...this.waiters]) waiter.reject(error)
    this.waiters.clear()
  }
}

class CodexRealtimeProvider implements VoiceRealtimeProvider {
  readonly id = 'codex-realtime'
  readonly priority = 500
  private readonly enabled: boolean
  private readonly model?: string
  private readonly configuredVoice?: string
  private readonly timeoutMs: number
  private readonly spawnProcess: CodexRealtimeSpawn
  private client: CodexWireClient | undefined
  private openingClient: Promise<CodexWireClient> | undefined
  private readonly sessions = new Map<string, RealtimeSession>()

  constructor(options: CodexRealtimeProviderOptions = {}) {
    this.enabled = options.enabled !== false
    this.model = clean(options.model)
    this.configuredVoice = clean(options.voice)
    this.timeoutMs = positiveInteger(options.requestTimeoutMs ?? 15_000, 'requestTimeoutMs')
    const command = clean(options.command) ?? 'codex'
    this.spawnProcess = options.spawnProcess ?? (() => spawnCodex(command))
  }

  available(): boolean {
    return this.enabled
  }

  async status(): Promise<VoiceRealtimeProviderStatus> {
    if (!this.enabled) throw new Error('voice-codex: provider disabled')
    const client = await this.ensureClient()
    const result = record(await client.request('thread/realtime/listVoices', {}), 'listVoices result')
    const voices = record(result.voices, 'voices')
    const preferred = stringArray(voices.v2)
    const legacy = stringArray(voices.v1)
    const all = [...new Set([...preferred, ...legacy])]
    const defaultVoice = stringValue(voices.defaultV2) ?? stringValue(voices.defaultV1)
    return {
      ...(all.length === 0 ? {} : { voices: all }),
      ...defaultVoice === undefined ? {} : { defaultVoice },
    }
  }

  async open(request: VoiceRealtimeProviderOpenRequest): Promise<VoiceRealtimeProviderOpenResult> {
    if (!this.enabled) throw new Error('voice-codex: provider disabled')
    await this.close(request.key)
    const client = await this.ensureClient()
    const threadResult = record(await client.request('thread/start', { ephemeral: true }), 'thread/start result')
    const thread = record(threadResult.thread, 'thread/start thread')
    const threadId = stringValue(thread.id)
    if (threadId === undefined) throw new Error('voice-codex: thread/start returned no thread id')

    const selectedVoice = clean(request.voice) ?? this.configuredVoice
    const sdpWait = client.waitFor('thread/realtime/sdp', params => (
      isRecord(params) && params.threadId === threadId && typeof params.sdp === 'string'
    ))
    try {
      await client.request('thread/realtime/start', {
        threadId,
        clientManagedHandoffs: true,
        delegationAckFiller: false,
        flushTranscriptTailOnSessionEnd: false,
        codexResponsesAsItems: false,
        outputModality: 'audio',
        includeStartupContext: false,
        realtimeStartInstructions: 'You are the PHOENIX Kira speech renderer. Never answer, reason, call tools, or add content. Speak only text explicitly appended with appendSpeech, preserving its meaning and language.',
        transport: { type: 'webrtc', sdp: request.sdp },
        ...this.model === undefined ? {} : { model: this.model },
        ...selectedVoice === undefined ? {} : { voice: selectedVoice },
      })
      const sdpParams = record(await sdpWait, 'thread/realtime/sdp')
      const answer = stringValue(sdpParams.sdp)
      if (answer === undefined) throw new Error('voice-codex: realtime SDP notification had no answer')
      this.sessions.set(request.key, {
        threadId,
        ...selectedVoice === undefined ? {} : { voice: selectedVoice },
        tail: Promise.resolve(),
      })
      return {
        sdp: answer,
        ...selectedVoice === undefined ? {} : { voice: selectedVoice },
      }
    } catch (error) {
      void client.request('thread/realtime/stop', { threadId }).catch(() => {})
      throw error
    }
  }

  async speak(key: string, text: string): Promise<void> {
    const session = this.sessions.get(key)
    if (session === undefined) throw new Error('voice-codex: realtime session is not open')
    const client = await this.ensureClient()
    const task = session.tail.catch(() => {}).then(async () => {
      const spoken = client.waitFor('thread/realtime/transcript/done', params => (
        isRecord(params)
        && params.threadId === session.threadId
        && params.role === 'assistant'
        && typeof params.text === 'string'
      ))
      await client.request('thread/realtime/appendSpeech', { threadId: session.threadId, text })
      await spoken
    })
    session.tail = task
    await task
  }

  async close(key: string): Promise<boolean> {
    const session = this.sessions.get(key)
    if (session === undefined) return false
    this.sessions.delete(key)
    const client = this.client
    if (client?.alive === true) {
      await client.request('thread/realtime/stop', { threadId: session.threadId }).catch(() => {})
    }
    return true
  }

  async closeAll(): Promise<void> {
    const keys = [...this.sessions.keys()]
    await Promise.all(keys.map(key => this.close(key)))
    this.sessions.clear()
    this.client?.close()
    this.client = undefined
    this.openingClient = undefined
  }

  private async ensureClient(): Promise<CodexWireClient> {
    if (this.client?.alive === true) return this.client
    if (this.openingClient !== undefined) return this.openingClient
    this.sessions.clear()
    const pending = (async () => {
      const client = new CodexWireClient(this.spawnProcess(), this.timeoutMs)
      await client.initialize()
      this.client = client
      return client
    })()
    this.openingClient = pending
    try {
      return await pending
    } catch (error) {
      this.client?.close()
      this.client = undefined
      throw error
    } finally {
      if (this.openingClient === pending) this.openingClient = undefined
    }
  }
}

/** Build a Codex realtime provider without exposing authentication material to clients.
 * @param options - Provider command, model, voice, timeout, and injectable process seam.
 * @returns A host-only realtime provider registered by the voice plugin.
 */
export function createCodexRealtimeProvider(options: CodexRealtimeProviderOptions = {}): VoiceRealtimeProvider {
  return new CodexRealtimeProvider(options)
}

/** Mount the Codex realtime transport behind the provider-neutral voice service. */
export function apply(ctx: Context, config: Config): void {
  const provider = createCodexRealtimeProvider({
    ...config.enabled === undefined ? {} : { enabled: config.enabled },
    ...config.command === undefined ? {} : { command: config.command },
    ...config.model === undefined ? {} : { model: config.model },
    ...config.voice === undefined ? {} : { voice: config.voice },
    ...config.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: config.requestTimeoutMs },
  })
  ctx.voice.registerRealtimeProvider(provider)
  ctx.effect(() => () => { void provider.closeAll() }, 'Codex realtime voice teardown')
}

/** Package name used by the Cordis loader. */
export const name = 'voice-codex'
/** This adapter needs the provider-neutral voice service. */
export const inject = ['voice']

function spawnCodex(command: string): ChildProcessWithoutNullStreams {
  const args = [
    '-c', 'features.plugins=false',
    '-c', 'skills.bundled.enabled=false',
    'app-server', '--listen', 'stdio://',
  ]
  const common = {
    cwd: process.cwd(),
    env: codexEnvironment(),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'] as const,
  }
  if (process.platform === 'win32' && command === 'codex') {
    const shell = process.env.ComSpec ?? 'cmd.exe'
    return spawn(shell, ['/d', '/s', '/c', `codex ${args.join(' ')}`], common)
  }
  return spawn(command, args, common)
}

function codexEnvironment(): NodeJS.ProcessEnv {
  const names = [
    'PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
    'CODEX_HOME', 'XDG_CONFIG_HOME', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP',
    'LANG', 'LC_ALL', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  ] as const
  const env: NodeJS.ProcessEnv = {}
  for (const name of names) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  const configuredHome = clean(process.env.CODEX_HOME)
  const home = configuredHome === undefined ? join(homedir(), '.codex') : resolve(configuredHome)
  const explicitSqlite = clean(process.env.PHOENIX_CODEX_SQLITE_HOME)
  const sqliteHome = explicitSqlite === undefined
    ? join(home, 'phoenix-runtime', 'sqlite', 'voice')
    : resolve(explicitSqlite, 'voice')
  mkdirSync(sqliteHome, { recursive: true })
  env.CODEX_HOME = home
  env.CODEX_SQLITE_HOME = sqliteHome
  return env
}

function clean(value: string | undefined): string | undefined {
  const cleaned = value?.trim()
  return cleaned === undefined || cleaned === '' ? undefined : cleaned
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`voice-codex: ${field} must be a positive integer`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`voice-codex: ${label} was not an object`)
  return value
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry !== '') : []
}
