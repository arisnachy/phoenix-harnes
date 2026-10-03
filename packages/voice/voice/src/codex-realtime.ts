/** Native ChatGPT/Codex realtime bridge for PHOENIX conversational voice.
 *
 * The bridge talks only to the locally authenticated Codex app-server. It
 * deliberately forces ChatGPT login and removes OPENAI_API_KEY from the child
 * environment so voice can never silently fall onto separately billed API
 * credentials.
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'

interface RpcPending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

interface NotificationWaiter {
  readonly predicate: (params: unknown) => boolean
  readonly resolve: (params: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

interface UnknownRecord {
  readonly [key: string]: unknown
}

/** One compact role-bearing Phoenix message used to seed Realtime V3. */
export interface CodexRealtimeInitialItem {
  /** Realtime text role accepted by Codex. */
  readonly role: 'user' | 'developer' | 'assistant'
  /** Plain visible text only; no tools, images, reasoning, or secrets. */
  readonly text: string
}

/** Inputs for one authenticated Codex WebRTC negotiation. */
export interface CodexRealtimeStartOptions {
  /** Stable Phoenix session key owning this voice call. */
  readonly key: string
  /** Browser-generated WebRTC SDP offer. */
  readonly offerSdp: string
  /** Current Codex text model used by delegated work, when direct. */
  readonly model?: string
  /** Small recent Phoenix transcript used instead of the full startup prompt. */
  readonly initialItems?: readonly CodexRealtimeInitialItem[]
}

/** Successful Codex app-server WebRTC negotiation. */
export interface CodexRealtimeStartResult {
  /** Ephemeral Codex thread created for the live conversation. */
  readonly threadId: string
  /** Remote SDP answer to apply to the browser peer connection. */
  readonly answerSdp: string
}

/** Readiness of subscription-backed Codex realtime voice. */
export interface CodexRealtimeProbe {
  /** Whether the local Codex binary and experimental realtime API are usable. */
  readonly available: boolean
  /** Whether app-server reports an active ChatGPT account. */
  readonly authenticated: boolean
  /** Stable unavailability reason for client fallback. */
  readonly reason?: 'codex-unavailable' | 'codex-login-required' | 'experimental-unavailable'
}

const RPC_TIMEOUT_MS = 30_000
const SDP_TIMEOUT_MS = 30_000
const IDLE_CLOSE_MS = 60_000

/** Small JSON-RPC client around `codex app-server --listen stdio://`. */
export class CodexRealtimeBridge {
  private child: ChildProcessWithoutNullStreams | undefined
  private startup: Promise<void> | undefined
  private stdoutBuffer = ''
  private readonly pending = new Map<string, RpcPending>()
  private readonly notifications = new Map<string, Set<NotificationWaiter>>()
  private readonly sessions = new Map<string, string>()
  private readonly stderrTail: string[] = []
  private nextRequestId = 1
  private idleTimer: ReturnType<typeof setTimeout> | undefined

  /** Start app-server and verify that its active account is ChatGPT OAuth. */
  async probe(): Promise<CodexRealtimeProbe> {
    try {
      await this.ensureStarted()
      this.armIdleClose()
      return { available: true, authenticated: true }
    } catch (error) {
      const message = errorText(error)
      if (/not found|enoent|could not start|spawn/i.test(message)) {
        return { available: false, authenticated: false, reason: 'codex-unavailable' }
      }
      if (/chatgpt login|required|not authenticated|account/i.test(message)) {
        return { available: true, authenticated: false, reason: 'codex-login-required' }
      }
      return { available: false, authenticated: false, reason: 'experimental-unavailable' }
    }
  }

  /** Negotiate one browser WebRTC call through the authenticated Codex backend. */
  async start(options: CodexRealtimeStartOptions): Promise<CodexRealtimeStartResult> {
    await this.ensureStarted()
    await this.stop(options.key).catch(() => {})
    // stop() arms the idle reap when there was no previous call; this start
    // is now active negotiation and must own the sidecar until it settles.
    this.clearIdleClose()

    const threadParams: Record<string, unknown> = { ephemeral: true }
    const model = normalizeCodexModel(options.model)
    if (model !== undefined) threadParams.model = model

    const started = await this.request('thread/start', threadParams)
    const threadId = readThreadId(started)
    if (threadId === undefined) throw new Error('Codex realtime thread/start returned no thread id')

    const sdpWait = this.waitForNotification(
      'thread/realtime/sdp',
      params => isRecord(params) && params.threadId === threadId && typeof params.sdp === 'string',
      SDP_TIMEOUT_MS,
    )

    try {
      await this.request('thread/realtime/start', {
        threadId,
        clientManagedHandoffs: false,
        flushTranscriptTailOnSessionEnd: true,
        backendReasoningStatus: false,
        outputModality: 'audio',
        // The Phoenix transcript below supplies only the recent useful context.
        // Avoid replaying Codex's much larger startup context into every short
        // voice session: the normal Codex thread still owns delegated work.
        includeStartupContext: false,
        ...(options.initialItems === undefined || options.initialItems.length === 0
          ? {}
          : { initialItems: options.initialItems }),
        realtimeStartInstructions:
          'Speak naturally and concisely. This is a continuation of the Phoenix conversation represented by the compact initial history. Do not repeat that history. Hand substantive work to Codex when needed.',
        transport: { type: 'webrtc', sdp: options.offerSdp },
        version: 'v3',
      })
      const params = await sdpWait
      if (!isRecord(params) || typeof params.sdp !== 'string') {
        throw new Error('Codex realtime returned an invalid SDP answer')
      }
      this.sessions.set(options.key, threadId)
      return { threadId, answerSdp: params.sdp }
    } catch (error) {
      await this.request('thread/realtime/stop', { threadId }).catch(() => {})
      throw error
    }
  }

  /** Stop one active realtime conversation without affecting text Codex use. */
  async stop(key: string): Promise<boolean> {
    const threadId = this.sessions.get(key)
    if (threadId === undefined) {
      if (this.sessions.size === 0) this.armIdleClose()
      return false
    }
    this.sessions.delete(key)
    try {
      if (this.child !== undefined) await this.request('thread/realtime/stop', { threadId })
    } finally {
      if (this.sessions.size === 0) this.armIdleClose()
    }
    return true
  }

  /** Tear down the sidecar and reject outstanding RPC work. */
  close(): void {
    this.clearIdleClose()
    const child = this.child
    this.child = undefined
    this.startup = undefined
    this.sessions.clear()
    if (child !== undefined && !child.killed) {
      // On Windows the npm-installed Codex executable is normally a .cmd shim
      // launched through cmd.exe. Killing only the shell orphans app-server,
      // which keeps its stdio/SQLite workers alive and accumulates background
      // processes across voice sessions. Reap the entire process tree.
      if (process.platform === 'win32' && child.pid !== undefined) {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
      } else {
        child.kill()
      }
    }
    const error = new Error('Codex realtime app-server closed')
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    for (const waiters of this.notifications.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer)
        waiter.reject(error)
      }
    }
    this.notifications.clear()
  }

  private async ensureStarted(): Promise<void> {
    if (this.child !== undefined) return
    if (this.startup !== undefined) return this.startup
    const startup = this.startProcess()
    this.startup = startup
    try {
      await startup
    } finally {
      if (this.startup === startup) this.startup = undefined
    }
  }

  private async startProcess(): Promise<void> {
    const codexArgs = [
      '--config', "forced_login_method='chatgpt'",
      '--config', 'features.realtime_conversation=true',
      '--config', 'features.plugins=false',
      '--config', 'skills.bundled.enabled=false',
      'app-server', '--listen', 'stdio://',
    ]
    const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'codex'
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'codex', ...codexArgs]
      : codexArgs
    const env = { ...process.env }
    // Never allow this voice path to fall back to a separately billed API key.
    delete env.OPENAI_API_KEY

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(command, args, {
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      throw new Error(`Codex realtime could not start: ${errorText(error)}`)
    }
    this.child = child
    this.stdoutBuffer = ''
    this.stderrTail.length = 0

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    // Codex can exit between an RPC write and Node flushing the pipe. Own the
    // stream error so an EPIPE cannot become an uncaught Host-fatal event.
    child.stdin.on('error', () => {})
    child.stdout.on('data', (chunk) => { this.consumeStdout(String(chunk)) })
    child.stderr.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/u)) {
        const trimmed = line.trim()
        if (trimmed === '') continue
        this.stderrTail.push(trimmed)
        if (this.stderrTail.length > 30) this.stderrTail.shift()
      }
    })
    child.once('error', (error) => {
      this.failProcess(new Error(`Codex realtime process error: ${error.message}`))
    })
    child.once('exit', (code, signal) => {
      if (this.child !== child) return
      const diagnostic = this.stderrTail.slice(-4).join(' | ')
      this.failProcess(new Error(
        `Codex realtime app-server exited (${String(code ?? signal ?? 'unknown')})${diagnostic === '' ? '' : `: ${diagnostic}`}`,
      ))
    })

    try {
      await this.request('initialize', {
        clientInfo: {
          name: 'phoenix_voice',
          title: 'Phoenix Codex Voice',
          version: '1',
        },
        capabilities: { experimentalApi: true },
      })
      this.notify('initialized')

      const account = await this.request('account/read', { refreshToken: false })
      if (!isRecord(account) || !isRecord(account.account) || account.account.type !== 'chatgpt') {
        throw new Error('Codex ChatGPT login required for subscription-backed realtime voice')
      }
    } catch (error) {
      this.close()
      throw error
    }
  }

  private request(method: string, params?: unknown, timeoutMs = RPC_TIMEOUT_MS): Promise<unknown> {
    const child = this.child
    if (child === undefined || child.stdin.destroyed) {
      return Promise.reject(new Error('Codex realtime app-server is not running'))
    }
    const id = String(this.nextRequestId++)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex realtime RPC timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      const frame = `${JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) })}\n`
      try {
        child.stdin.write(frame, (error) => {
          if (error === null || error === undefined) return
          const active = this.pending.get(id)
          if (active === undefined) return
          clearTimeout(active.timer)
          this.pending.delete(id)
          active.reject(new Error(`Codex realtime RPC write failed: ${errorText(error)}`))
        })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error(`Codex realtime RPC write failed: ${errorText(error)}`))
      }
    })
  }

  private notify(method: string, params?: unknown): void {
    const child = this.child
    if (child === undefined || child.stdin.destroyed || child.stdin.writableEnded) return
    try {
      child.stdin.write(
        `${JSON.stringify({ method, ...(params === undefined ? {} : { params }) })}\n`,
        () => {},
      )
    } catch {
      // Notifications are best-effort during startup/teardown. Request RPCs
      // carry their own explicit failure path.
    }
  }

  private waitForNotification(
    method: string,
    predicate: (params: unknown) => boolean,
    timeoutMs: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const waiter: NotificationWaiter = {
        predicate,
        resolve: (params) => {
          clearTimeout(waiter.timer)
          this.notifications.get(method)?.delete(waiter)
          resolve(params)
        },
        reject: (error) => {
          clearTimeout(waiter.timer)
          this.notifications.get(method)?.delete(waiter)
          reject(error)
        },
        timer: setTimeout(() => {
          this.notifications.get(method)?.delete(waiter)
          reject(new Error(`Codex realtime notification timed out: ${method}`))
        }, timeoutMs),
      }
      let set = this.notifications.get(method)
      if (set === undefined) {
        set = new Set()
        this.notifications.set(method, set)
      }
      set.add(waiter)
    })
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    while (true) {
      const newline = this.stdoutBuffer.indexOf('\n')
      if (newline < 0) return
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (line === '') continue
      try {
        this.routeMessage(JSON.parse(line) as unknown)
      } catch {
        // App-server stdout is expected to be JSONL; one malformed diagnostic
        // must not poison the rest of the stream.
      }
    }
  }

  private routeMessage(value: unknown): void {
    if (!isRecord(value)) return
    if (value.id !== undefined && (value.result !== undefined || value.error !== undefined)) {
      if (typeof value.id !== 'string' && typeof value.id !== 'number') return
      const id = String(value.id)
      const pending = this.pending.get(id)
      if (pending === undefined) return
      this.pending.delete(id)
      clearTimeout(pending.timer)
      if (value.error !== undefined) {
        pending.reject(new Error(rpcErrorText(value.error)))
      } else {
        pending.resolve(value.result)
      }
      return
    }
    if (typeof value.method !== 'string') return
    const waiters = this.notifications.get(value.method)
    if (waiters === undefined || waiters.size === 0) return
    for (const waiter of [...waiters]) {
      if (waiter.predicate(value.params)) waiter.resolve(value.params)
    }
  }

  private failProcess(error: Error): void {
    if (this.child !== undefined) this.child = undefined
    this.startup = undefined
    this.sessions.clear()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    for (const waiters of this.notifications.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer)
        waiter.reject(error)
      }
    }
    this.notifications.clear()
  }

  private armIdleClose(): void {
    if (this.sessions.size > 0 || this.child === undefined) return
    this.clearIdleClose()
    this.idleTimer = setTimeout(() => { this.close() }, IDLE_CLOSE_MS)
  }

  private clearIdleClose(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }
}

function normalizeCodexModel(model: string | undefined): string | undefined {
  const value = model?.trim()
  if (value === undefined || value === '' || value === 'phoenix-auto') return undefined
  return value.length <= 128 ? value : undefined
}

function readThreadId(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.thread)) return undefined
  return typeof value.thread.id === 'string' && value.thread.id !== '' ? value.thread.id : undefined
}

function rpcErrorText(value: unknown): string {
  if (!isRecord(value)) return `Codex realtime RPC failed: ${String(value)}`
  const message = typeof value.message === 'string' ? value.message : 'Codex realtime RPC failed'
  const code = typeof value.code === 'number' || typeof value.code === 'string' ? String(value.code) : undefined
  return code === undefined ? message : `${code}: ${message}`
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
