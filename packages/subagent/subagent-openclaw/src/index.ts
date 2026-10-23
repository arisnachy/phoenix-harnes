import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import type {
  OpenClawAgentExecuteRequest,
  OpenClawAgentExecuteResult,
  OpenClawCapabilities,
  OpenClawClientIdentity,
  OpenClawEvent,
  OpenClawEventGap,
  OpenClawErrorOptions,
  OpenClawGatewayClientOptions,
  OpenClawGatewayCredentials,
  OpenClawHello,
  OpenClawJsonValue,
  OpenClawOperatorScope,
  OpenClawReconcileSnapshot,
  OpenClawRequestOptions,
  OpenClawSessionCreateRequest,
  OpenClawSessionExecuteRequest,
  OpenClawSessionExecuteResult,
  OpenClawSocket,
} from './types.ts'

const OPENCLAW_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_FRAME_BYTES = 1_048_576
const DEFAULT_MIN_PROTOCOL = 3
const DEFAULT_MAX_PROTOCOL = 4
const DEFAULT_SCOPES: readonly OpenClawOperatorScope[] = ['operator.read', 'operator.write']
const OPENCLAW_CREDENTIAL_KEYS = /token|password|secret|privatekey|signature/i
const OPENCLAW_PUBLIC_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/
const REDACTED_TEXT = '[redacted]'

/** Error raised by an OpenClaw transport, Gateway RPC, timeout, or cancellation. */
export class OpenClawGatewayError extends Error {
  /** Stable public error code safe to expose to callers. */
  readonly code: string
  /** Whether retrying the same public operation may be safe. */
  readonly retryable: boolean
  /** Optional server-provided retry delay in milliseconds. */
  readonly retryAfterMs?: number
  /** Credential-free structured error details. */
  readonly details?: OpenClawJsonValue

  /** @param message - Safe, credential-free diagnostic text. @param options - Public error metadata. */
  constructor(message: string, options: OpenClawErrorOptions = {}) {
    super(message)
    this.name = 'OpenClawGatewayError'
    this.code = options.code ?? 'OPENCLAW_GATEWAY_ERROR'
    this.retryable = options.retryable ?? false
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs
    if (options.details !== undefined) this.details = options.details
  }
}

interface RequestFrame {
  readonly type: 'req'
  readonly id: string
  readonly method: string
  readonly params?: OpenClawJsonValue
}

interface ResponseFrame {
  readonly type: 'res'
  readonly id: string
  readonly ok: boolean
  readonly payload?: OpenClawJsonValue
  readonly error?: {
    readonly code?: string
    readonly message?: string
    readonly details?: OpenClawJsonValue
    readonly retryable?: boolean
    readonly retryAfterMs?: number
  }
}

interface PendingRequest {
  readonly resolve: (value: OpenClawJsonValue) => void
  readonly reject: (error: unknown) => void
  readonly timer: ReturnType<typeof setTimeout>
  readonly signal: AbortSignal | undefined
  onAbort: (() => void) | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is OpenClawJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function safeJson(value: unknown, forbiddenValues: readonly string[] = []): OpenClawJsonValue | undefined {
  if (!isJsonValue(value)) return undefined
  if (typeof value === 'string') return redactText(value, forbiddenValues)
  if (Array.isArray(value)) return value.map(item => safeJson(item,
    forbiddenValues)).filter((item): item is OpenClawJsonValue => item !== undefined)
  if (isRecord(value)) {
    const entries: [string, OpenClawJsonValue][] = []
    for (const [key, item] of Object.entries(value)) {
      const sanitizedKey = redactText(key, forbiddenValues)
      // Preserve the existing removal of credential-named fields. If the key
      // itself contains a credential value, retain only its redacted spelling
      // so no secret-bearing key is silently forwarded or exposed.
      if (OPENCLAW_CREDENTIAL_KEYS.test(key) && sanitizedKey === key) continue
      const sanitized = safeJson(item, forbiddenValues)
      if (sanitized !== undefined) entries.push([sanitizedKey, sanitized])
    }
    return Object.fromEntries(entries)
  }
  return value
}

function redactText(value: string, forbiddenValues: readonly string[]): string {
  return forbiddenValues.reduce((current,
    forbidden) => forbidden.length === 0 ? current : current.split(forbidden).join(REDACTED_TEXT),
  value)
}

function gatewayRpcError(error: Record<string, unknown>, fallback: string, forbiddenValues: readonly string[] = []): OpenClawGatewayError {
  const details = safeJson(error.details, forbiddenValues)
  const candidateCode = typeof error.code === 'string' ? redactText(error.code, forbiddenValues) : undefined
  const code = candidateCode !== undefined && OPENCLAW_PUBLIC_ERROR_CODE.test(candidateCode) ? candidateCode : 'OPENCLAW_GATEWAY_ERROR'
  const options: { readonly code?: string
    readonly retryable?: boolean
    readonly retryAfterMs?: number
    readonly details?: OpenClawJsonValue } = {
    code,
    ...(error.retryable === true ? { retryable: true } : {}),
    ...(typeof error.retryAfterMs === 'number' ? { retryAfterMs: error.retryAfterMs } : {}),
    ...(details === undefined ? {} : { details }),
  }
  return new OpenClawGatewayError(typeof error.message === 'string' ? redactText(error.message, forbiddenValues) : fallback, options)
}

function textBytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function rawDataToText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8')
  if (Array.isArray(value) && value.every(item => Buffer.isBuffer(item))) return Buffer.concat(value).toString('utf8')
  return undefined
}

function isLoopbackWsUrl(url: URL): boolean {
  return url.protocol === 'ws:' && OPENCLAW_LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
}

function validateUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new OpenClawGatewayError('OpenClaw Gateway URL is invalid.', { code: 'INVALID_URL' })
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new OpenClawGatewayError('OpenClaw Gateway URL must use ws: or wss:.', { code: 'UNSUPPORTED_URL' })
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new OpenClawGatewayError('OpenClaw Gateway URL must not embed credentials.', { code: 'EMBEDDED_CREDENTIALS' })
  }
  if (url.protocol === 'ws:' && !isLoopbackWsUrl(url)) {
    throw new OpenClawGatewayError('Plain WebSocket transport is restricted to loopback.', { code: 'REMOTE_PLAINTEXT_REJECTED' })
  }
  return url
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function isSafeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function requireIdempotencyKey(value: string): string {
  if (value.trim().length === 0
    || value.length > 256) throw new OpenClawGatewayError('A bounded native idempotency key is required.',
    { code: 'INVALID_IDEMPOTENCY_KEY' })
  return value
}

function abortError(): OpenClawGatewayError {
  return new OpenClawGatewayError('OpenClaw Gateway request was cancelled.', { code: 'ABORTED', retryable: true })
}

/**
 * Portable public-protocol client for an OpenClaw Gateway WebSocket.
 *
 * Credentials are retained only by the host-side instance, loopback `ws:` is
 * the supported plaintext transport, and all public payloads are sanitized.
 */
export class OpenClawGatewayClient {
  private readonly url: URL
  private readonly options: OpenClawGatewayClientOptions
  private readonly timeoutMs: number
  private readonly maxFrameBytes: number
  private readonly minProtocol: number
  private readonly maxProtocol: number
  private readonly scopes: readonly OpenClawOperatorScope[]
  private readonly client: OpenClawClientIdentity
  private readonly credentials: OpenClawGatewayCredentials | undefined
  private readonly credentialValues: readonly string[]
  private negotiatedMaxFrameBytes: number
  private socket: OpenClawSocket | undefined
  private hello: OpenClawHello | undefined
  private disposed = false
  private connecting: Promise<OpenClawHello> | undefined
  private readonly pending = new Map<string, PendingRequest>()
  private readonly eventListeners = new Set<(event: OpenClawEvent) => void>()
  private readonly gapListeners = new Set<(gap: OpenClawEventGap) => void>()
  private lastEventSeq: number | undefined
  private gapDetected = false

  /** @param options - Public endpoint and host-owned transport settings. */
  constructor(options: OpenClawGatewayClientOptions) {
    this.url = validateUrl(options.url)
    this.options = options
    this.timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS)
    this.maxFrameBytes = positiveInteger(options.maxFrameBytes, DEFAULT_MAX_FRAME_BYTES)
    this.minProtocol = positiveInteger(options.minProtocol, DEFAULT_MIN_PROTOCOL)
    this.maxProtocol = positiveInteger(options.maxProtocol, DEFAULT_MAX_PROTOCOL)
    if (this.minProtocol > this.maxProtocol) throw new OpenClawGatewayError('OpenClaw protocol range is invalid.',
      { code: 'INVALID_PROTOCOL_RANGE' })
    this.scopes = [...(options.scopes ?? DEFAULT_SCOPES)]
    this.client = options.client === undefined ? {} : { ...options.client }
    this.credentials = options.credentials === undefined ? undefined : { ...options.credentials }
    this.credentialValues = [this.credentials?.token,
      this.credentials?.password].filter((value): value is string => value !== undefined
      && value.length > 0)
    this.negotiatedMaxFrameBytes = this.maxFrameBytes
    for (const scope of this.scopes) {
      if (scope !== 'operator.read'
        && scope !== 'operator.write') throw new OpenClawGatewayError('OpenClaw client only permits read/write operator scopes.',
        { code: 'UNSAFE_SCOPE' })
    }
  }

  /**
   * Connects once and returns the credential-free handshake snapshot.
   * @returns Sanitized Gateway handshake metadata.
   */
  async connect(): Promise<OpenClawHello> {
    if (this.disposed) throw new OpenClawGatewayError('OpenClaw Gateway client is disposed.', { code: 'DISPOSED' })
    if (this.hello !== undefined) return this.hello
    if (this.connecting !== undefined) return this.connecting
    this.connecting = this.openConnection().finally(() => { this.connecting = undefined })
    return this.connecting
  }

  /**
   * Returns the discovered public protocol capabilities after connecting.
   * @returns Sanitized protocol, method, event, scope, and server metadata.
   */
  async capabilities(): Promise<OpenClawCapabilities> {
    const hello = await this.connect()
    return {
      protocol: hello.protocol,
      serverVersion: hello.server.version,
      methods: [...hello.features.methods],
      events: [...hello.features.events],
      scopes: [...hello.auth.scopes],
    }
  }

  /**
   * Adds an event listener and returns a disposer.
   * @param listener - Callback for sanitized Gateway events.
   * @returns Function that removes this listener.
   */
  onEvent(listener: (event: OpenClawEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  /**
   * Adds a sequence-gap listener and returns a disposer.
   * @param listener - Callback for detected event sequence gaps.
   * @returns Function that removes this listener.
   */
  onEventGap(listener: (gap: OpenClawEventGap) => void): () => void {
    this.gapListeners.add(listener)
    return () => { this.gapListeners.delete(listener) }
  }

  /**
   * Calls a public Gateway RPC with bounded framing, timeout, and cancellation.
   * @param method - Public Gateway RPC method name.
   * @param params - JSON-safe RPC parameters, if any.
   * @param options - Optional timeout and cancellation settings.
   * @returns Sanitized JSON-safe RPC response.
   */
  async request<T extends OpenClawJsonValue = OpenClawJsonValue>(method: string,
    params?: OpenClawJsonValue,
    options: OpenClawRequestOptions = {}): Promise<T> {
    if (method.trim().length === 0) throw new OpenClawGatewayError('OpenClaw RPC method is required.', { code: 'INVALID_METHOD' })
    if (options.signal?.aborted === true) throw abortError()
    await this.connect()
    if (this.disposed) throw new OpenClawGatewayError('OpenClaw Gateway client is disposed.', { code: 'DISPOSED' })
    const socket = this.socket
    if (socket === undefined
      || socket.readyState !== WebSocket.OPEN) throw new OpenClawGatewayError('OpenClaw Gateway is not connected.',
      { code: 'NOT_CONNECTED',
        retryable: true })
    const id = randomUUID()
    const frame: RequestFrame = params === undefined ? { type: 'req', id, method } : { type: 'req', id, method, params }
    const serialized = JSON.stringify(frame)
    this.assertFrameSize(serialized)
    const timeoutMs = positiveInteger(options.timeoutMs, this.timeoutMs)
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        if (onAbort !== undefined) options.signal?.removeEventListener('abort', onAbort)
        reject(new OpenClawGatewayError(`OpenClaw RPC timed out: ${method}.`, { code: 'TIMEOUT', retryable: true }))
      }, timeoutMs)
      const pending: PendingRequest = {
        timer,
        resolve: value => resolve(value as T),
        reject,
        signal: options.signal,
        onAbort: undefined,
      }
      const onAbort = () => {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(abortError())
      }
      pending.onAbort = onAbort
      this.pending.set(id, pending)
      if (options.signal?.aborted === true) {
        onAbort()
        return
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      this.sendFrame(socket, serialized).catch((error) => {
        clearTimeout(timer)
        this.pending.delete(id)
        if (onAbort !== undefined) options.signal?.removeEventListener('abort', onAbort)
        reject(error)
      })
    })
  }

  /**
   * Returns the Gateway health snapshot.
   * @param signal - Optional cancellation signal.
   * @returns Sanitized Gateway health response.
   */
  async health(signal?: AbortSignal): Promise<OpenClawJsonValue> {
    return this.request('health', undefined, signal === undefined ? {} : { signal })
  }

  /**
   * Lists visible sessions for reconciliation and status inspection.
   * @param signal - Optional cancellation signal.
   * @returns Sanitized session roster.
   */
  async listSessions(signal?: AbortSignal): Promise<OpenClawJsonValue> {
    return this.request('sessions.list', {}, signal === undefined ? {} : { signal })
  }

  /**
   * Creates one Phoenix-owned Gateway session without starting a model turn.
   * @param request - Exact agent, session, workspace, model, and idempotency settings.
   * @returns Sanitized Gateway session creation response.
   */
  async createSession(request: OpenClawSessionCreateRequest): Promise<OpenClawJsonValue> {
    const params: OpenClawJsonValue = {
      key: request.sessionKey,
      agentId: request.agentId,
      model: request.model,
      cwd: request.cwd,
      idempotencyKey: requireIdempotencyKey(request.idempotencyKey),
    }
    return this.request('sessions.create', params, request.signal === undefined ? {} : { signal: request.signal })
  }

  /**
   * Executes an agent turn with the caller's native idempotency key.
   * @param request - Agent message and bounded native execution identity.
   * @returns Sanitized native agent acknowledgement.
   */
  async executeAgent(request: OpenClawAgentExecuteRequest): Promise<OpenClawAgentExecuteResult> {
    const params: OpenClawJsonValue = {
      message: request.message,
      idempotencyKey: requireIdempotencyKey(request.idempotencyKey),
      ...(request.agentId === undefined ? {} : { agentId: request.agentId }),
      ...(request.sessionKey === undefined ? {} : { sessionKey: request.sessionKey }),
      ...(request.deliver === undefined ? {} : { deliver: request.deliver }),
    }
    return this.request('agent', params, request.signal === undefined ? {} : { signal: request.signal })
  }

  /**
   * Sends a message to an existing session with the caller's native idempotency key.
   * @param request - Existing session message and bounded native identity.
   * @returns Sanitized session acknowledgement.
   */
  async executeSession(request: OpenClawSessionExecuteRequest): Promise<OpenClawSessionExecuteResult> {
    const params: OpenClawJsonValue = {
      sessionKey: request.sessionKey,
      message: request.message,
      idempotencyKey: requireIdempotencyKey(request.idempotencyKey),
      deliver: false,
    }
    return this.request('chat.send', params, request.signal === undefined ? {} : { signal: request.signal })
  }

  /**
   * Aborts an active session run through the public Gateway session control RPC.
   * @param sessionKey - Exact Gateway session key owning the run.
   * @param runId - Exact native run identity, when known.
   * @param signal - Optional cancellation signal for the abort RPC.
   * @returns Sanitized Gateway abort response.
   */
  async cancel(sessionKey: string, runId?: string, signal?: AbortSignal): Promise<OpenClawJsonValue> {
    const params: OpenClawJsonValue = { key: sessionKey, ...(runId === undefined ? {} : { runId }) }
    return this.request('sessions.abort', params, signal === undefined ? {} : { signal })
  }

  /**
   * Lists cron jobs without mutating Gateway automation state.
   * @param signal - Optional cancellation signal.
   * @returns Sanitized cron roster.
   */
  async listCron(signal?: AbortSignal): Promise<OpenClawJsonValue> {
    return this.request('cron.list', {}, signal === undefined ? {} : { signal })
  }

  /**
   * Lists sanitized, eligible skills without installing or changing one.
   * @param agentId - Optional exact agent whose skills are inspected.
   * @param signal - Optional cancellation signal.
   * @returns Sanitized skills status.
   */
  async listSkills(agentId?: string, signal?: AbortSignal): Promise<OpenClawJsonValue> {
    const params: OpenClawJsonValue = agentId === undefined ? {} : { agentId }
    return this.request('skills.status', params, signal === undefined ? {} : { signal })
  }

  /**
   * Reads channel status without pairing, login, or delivery side effects.
   * @param signal - Optional cancellation signal.
   * @returns Sanitized channel status.
   */
  async listChannels(signal?: AbortSignal): Promise<OpenClawJsonValue> {
    return this.request('channels.status', {}, signal === undefined ? {} : { signal })
  }

  /**
   * Reconciles health and session state after reconnect or an event sequence gap.
   * @param signal - Optional cancellation signal.
   * @returns Sanitized health, session, and event-gap snapshot.
   */
  async reconcile(signal?: AbortSignal): Promise<OpenClawReconcileSnapshot> {
    const [health, sessions] = await Promise.all([this.health(signal), this.listSessions(signal)])
    const snapshot: OpenClawReconcileSnapshot = {
      health,
      sessions,
      gapDetected: this.gapDetected,
      ...(this.lastEventSeq === undefined ? {} : { lastEventSeq: this.lastEventSeq }),
    }
    this.gapDetected = false
    return snapshot
  }

  /** Closes the WebSocket and waits for owned transport work to quiesce. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.hello = undefined
    this.eventListeners.clear()
    this.gapListeners.clear()
    const socket = this.socket
    this.socket = undefined
    this.rejectPending(new OpenClawGatewayError('OpenClaw Gateway client was disposed.', { code: 'DISPOSED' }))
    if (socket === undefined) return
    if (socket.readyState === WebSocket.CLOSED) { socket.removeAllListeners?.(); return }
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.removeAllListeners?.()
        resolve()
      }
      const timer = setTimeout(finish, Math.min(this.timeoutMs, 2_000))
      socket.once('close', finish)
      try {
        socket.close(1000, 'disposed')
      } catch {
        socket.terminate?.()
      }
    })
  }

  private async openConnection(): Promise<OpenClawHello> {
    const socket = this.options.socketFactory?.(this.url.toString()) ?? new WebSocket(this.url.toString()) as unknown as OpenClawSocket
    this.socket = socket
    try {
      // Attach before waiting for `open`: a Gateway may send its challenge in
      // the same turn as the server-side connection event.
      const challenge = this.waitForChallenge(socket)
      // Observe both promises immediately: the challenge deadline can expire
      // before the HTTP upgrade settles, and must not escape as an unhandled rejection.
      const [opened] = await Promise.all([this.waitForOpen(socket), challenge])
      if (!opened) {
        throw new OpenClawGatewayError('OpenClaw Gateway WebSocket did not open.', { code: 'CONNECT_FAILED', retryable: true })
      }
      const params: OpenClawJsonValue = {
        minProtocol: this.minProtocol,
        maxProtocol: this.maxProtocol,
        client: {
          id: this.client.id ?? 'gateway-client',
          version: this.client.version ?? '0.1.0',
          platform: this.client.platform ?? 'node',
          mode: this.client.mode ?? 'backend',
        },
        role: 'operator',
        scopes: [...this.scopes],
        caps: [],
        commands: [],
        permissions: {},
        ...(this.credentials?.token === undefined && this.credentials?.password === undefined
          ? {}
          : { auth: { ...(this.credentials.token === undefined ? {} : { token: this.credentials.token }),
            ...(this.credentials.password === undefined ? {} : { password: this.credentials.password }) } }),
        locale: 'en-US',
        userAgent: 'phoenix-openclaw-gateway-client/0.1.0',
      }
      const response = await this.requestConnect(socket, params)
      const hello = parseHello(this.sanitize(response) ?? null)
      if (hello.protocol < this.minProtocol
        || hello.protocol > this.maxProtocol) throw new OpenClawGatewayError('OpenClaw Gateway protocol is outside the requested range.',
        { code: 'UNSUPPORTED_PROTOCOL' })
      if (this.disposed) throw new OpenClawGatewayError('OpenClaw Gateway client is disposed.', { code: 'DISPOSED' })
      this.negotiatedMaxFrameBytes = Math.min(this.maxFrameBytes, hello.policy.maxPayload)
      this.hello = hello
      this.attachTransport(socket)
      return hello
    } catch (error) {
      if (this.socket === socket) {
        this.socket = undefined
        this.hello = undefined
      }
      try {
        // Closing a CONNECTING ws emits a later error. Keep that owned cleanup
        // error observed after the handshake listeners have been detached.
        socket.once('error', () => {})
        socket.once('close', () => { socket.removeAllListeners?.() })
        if (socket.readyState !== WebSocket.CLOSED) socket.close(1000, 'connect failed')
      } catch {
        socket.terminate?.()
      }
      throw error
    }
  }

  private waitForOpen(socket: OpenClawSocket): Promise<boolean> {
    if (socket.readyState === WebSocket.OPEN) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      let settled = false
      const timer = setTimeout(() => finish(false), this.timeoutMs)
      const finish = (opened: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.detach(socket, 'open', onOpen)
        this.detach(socket, 'error', onError)
        this.detach(socket, 'close', onClose)
        resolve(opened)
      }
      const onOpen = (): void => { finish(true) }
      const onError = (): void => { finish(false) }
      const onClose = (): void => { finish(false) }
      socket.once('open', onOpen)
      socket.once('error', onError)
      socket.once('close', onClose)
    })
  }

  private waitForChallenge(socket: OpenClawSocket): Promise<{ readonly nonce: string; readonly ts: number }> {
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => finishReject(new OpenClawGatewayError('OpenClaw Gateway challenge timed out.',
        { code: 'CHALLENGE_TIMEOUT',
          retryable: true })),
      this.timeoutMs)
      const finishResolve = (value: { readonly nonce: string; readonly ts: number }): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.detach(socket, 'message', onMessage)
        this.detach(socket, 'close', onClose)
        this.detach(socket, 'error', onError)
        resolve(value)
      }
      const finishReject = (error: OpenClawGatewayError): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.detach(socket, 'message', onMessage)
        this.detach(socket, 'close', onClose)
        this.detach(socket, 'error', onError)
        reject(error)
      }
      const onMessage = (raw: unknown) => {
        const text = rawDataToText(raw)
        if (text === undefined || textBytes(text) > Math.min(65_536, this.maxFrameBytes)) {
          finishReject(new OpenClawGatewayError('OpenClaw pre-connect frame exceeded the bound.', { code: 'FRAME_TOO_LARGE' }))
          return
        }
        let parsed: unknown
        try { parsed = JSON.parse(text) } catch { finishReject(new OpenClawGatewayError('OpenClaw Gateway sent invalid JSON.',
          { code: 'INVALID_JSON' })); return }
        if (!isRecord(parsed) || parsed.type !== 'event' || parsed.event !== 'connect.challenge' || !isRecord(parsed.payload)) return
        const nonce = parsed.payload.nonce
        const ts = parsed.payload.ts
        if (typeof nonce !== 'string' || nonce.length === 0 || typeof ts !== 'number' || !Number.isSafeInteger(ts) || ts < 0) {
          finishReject(new OpenClawGatewayError('OpenClaw Gateway challenge is invalid.', { code: 'INVALID_CHALLENGE' }))
          return
        }
        finishResolve({ nonce, ts })
      }
      const onClose = (): void => { finishReject(new OpenClawGatewayError('OpenClaw Gateway closed during challenge.',
        { code: 'CONNECT_FAILED',
          retryable: true })) }
      const onError = (): void => { finishReject(new OpenClawGatewayError('OpenClaw Gateway socket error.',
        { code: 'CONNECT_FAILED',
          retryable: true })) }
      socket.on('message', onMessage)
      socket.once('close', onClose)
      socket.once('error', onError)
    })
  }

  private requestConnect(socket: OpenClawSocket, params: OpenClawJsonValue): Promise<OpenClawJsonValue> {
    const id = randomUUID()
    const frame: RequestFrame = { type: 'req', id, method: 'connect', params }
    const serialized = JSON.stringify(frame)
    this.assertFrameSize(serialized)
    return new Promise<OpenClawJsonValue>((resolve, reject) => {
      const timer = setTimeout(() => { this.detach(socket,
        'message',
        onMessage); reject(new OpenClawGatewayError('OpenClaw Gateway handshake timed out.',
        { code: 'HANDSHAKE_TIMEOUT',
          retryable: true })) },
      this.timeoutMs)
      const onMessage = (raw: unknown) => {
        const text = rawDataToText(raw)
        if (text === undefined
          || textBytes(text) > this.negotiatedMaxFrameBytes) { clearTimeout(timer); reject(new OpenClawGatewayError('OpenClaw frame exceeded the configured bound.',
          { code: 'FRAME_TOO_LARGE' })); return }
        let parsed: unknown
        try { parsed = JSON.parse(text) } catch { clearTimeout(timer); reject(new OpenClawGatewayError('OpenClaw Gateway sent invalid JSON.',
          { code: 'INVALID_JSON' })); return }
        if (!isRecord(parsed) || parsed.type !== 'res' || parsed.id !== id) return
        clearTimeout(timer)
        this.detach(socket, 'message', onMessage)
        const response = parsed as unknown as ResponseFrame
        if (response.ok !== true) {
          const error = response.error ?? {}
          reject(gatewayRpcError(error as unknown as Record<string, unknown>, 'OpenClaw Gateway handshake failed.', this.credentialValues))
          return
        }
        if (response.payload === undefined) { reject(new OpenClawGatewayError('OpenClaw Gateway handshake response is empty.',
          { code: 'INVALID_HELLO' })); return }
        resolve(response.payload)
      }
      socket.on('message', onMessage)
      this.sendFrame(socket, serialized).catch((error) => { clearTimeout(timer); this.detach(socket, 'message', onMessage); reject(error) })
    })
  }

  private sendFrame(socket: OpenClawSocket, serialized: string): Promise<void> {
    this.assertFrameSize(serialized)
    return new Promise<void>((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) { reject(new OpenClawGatewayError('OpenClaw Gateway socket is closed.',
        { code: 'NOT_CONNECTED',
          retryable: true })); return }
      if (socket.bufferedAmount > this.negotiatedMaxFrameBytes) { reject(new OpenClawGatewayError('OpenClaw Gateway outbound buffer exceeded the configured bound.',
        { code: 'BACKPRESSURE',
          retryable: true })); return }
      socket.send(serialized,
        (error) => { if (error == null) resolve(); else reject(new OpenClawGatewayError('OpenClaw Gateway frame delivery failed.',
          { code: 'SEND_FAILED',
            retryable: true })) })
    })
  }

  private assertFrameSize(serialized: string): void {
    if (textBytes(serialized) > this.negotiatedMaxFrameBytes) throw new OpenClawGatewayError('OpenClaw frame exceeds the configured byte bound.',
      { code: 'FRAME_TOO_LARGE' })
  }

  private attachTransport(socket: OpenClawSocket): void {
    socket.on('message', (raw) => { this.handleMessage(socket, raw) })
    socket.on('close',
      () => { if (this.socket === socket) { this.socket = undefined; this.hello = undefined; this.rejectPending(new OpenClawGatewayError('OpenClaw Gateway connection closed.',
        { code: 'CONNECTION_CLOSED',
          retryable: true })) } })
    socket.on('error', () => {})
  }

  private handleMessage(socket: OpenClawSocket, raw: unknown): void {
    if (this.disposed || this.socket !== socket) return
    const text = rawDataToText(raw)
    if (text === undefined || textBytes(text) > this.negotiatedMaxFrameBytes) { socket.close(1009, 'frame too large'); return }
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { socket.close(1007, 'invalid JSON'); return }
    if (!isRecord(parsed)) return
    if (parsed.type === 'res' && typeof parsed.id === 'string') {
      const pending = this.pending.get(parsed.id)
      if (pending === undefined) return
      this.pending.delete(parsed.id)
      clearTimeout(pending.timer)
      if (pending.signal !== undefined && pending.onAbort !== undefined) pending.signal.removeEventListener('abort', pending.onAbort)
      if (parsed.ok !== true) {
        const error = isRecord(parsed.error) ? parsed.error : {}
        pending.reject(gatewayRpcError(error, 'OpenClaw Gateway RPC failed.', this.credentialValues))
      } else {
        pending.resolve(this.sanitize(parsed.payload) ?? null)
      }
      return
    }
    if (parsed.type !== 'event' || typeof parsed.event !== 'string') return
    const event = this.sanitize(parsed)
    if (!isRecord(event)) return
    const publicEvent = event as unknown as OpenClawEvent
    if (publicEvent.seq !== undefined && !isSafeInteger(publicEvent.seq)) return
    if (publicEvent.seq !== undefined) {
      if (this.lastEventSeq !== undefined && publicEvent.seq !== this.lastEventSeq + 1) {
        const gap: OpenClawEventGap = { expected: this.lastEventSeq + 1, received: publicEvent.seq }
        this.gapDetected = true
        for (const listener of [...this.gapListeners]) { try { listener(gap) } catch { /* one observer cannot break transport */ } }
      }
      this.lastEventSeq = publicEvent.seq
    }
    for (const listener of [...this.eventListeners]) { try { listener(publicEvent) } catch { /* one observer cannot break transport */ } }
  }

  private rejectPending(error: OpenClawGatewayError): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      if (pending.signal !== undefined && pending.onAbort !== undefined) pending.signal.removeEventListener('abort', pending.onAbort)
      pending.reject(error)
      this.pending.delete(id)
    }
  }

  private sanitize(value: unknown): OpenClawJsonValue | undefined {
    return safeJson(value, this.credentialValues)
  }

  private detach(socket: OpenClawSocket, event: string, listener: (...args: unknown[]) => void): void {
    socket.off?.(event, listener)
  }
}

function parseHello(value: OpenClawJsonValue): OpenClawHello {
  if (!isRecord(value)
    || value.type !== 'hello-ok'
    || !isSafeInteger(value.protocol,
      1)
    || !isRecord(value.server)
    || !isRecord(value.features)
    || !isRecord(value.auth)
    || !isRecord(value.policy)) throw new OpenClawGatewayError('OpenClaw Gateway hello-ok is invalid.',
    { code: 'INVALID_HELLO' })
  const methods = value.features.methods
  const events = value.features.events
  const scopes = value.auth.scopes
  const maxPayload = value.policy.maxPayload
  const maxBufferedBytes = value.policy.maxBufferedBytes
  const tickIntervalMs = value.policy.tickIntervalMs
  if (typeof value.server.version !== 'string'
    || typeof value.server.connId !== 'string'
    || !Array.isArray(methods)
    || !methods.every(item => typeof item === 'string')
    || !Array.isArray(events)
    || !events.every(item => typeof item === 'string')
    || typeof value.auth.role !== 'string'
    || !Array.isArray(scopes)
    || !scopes.every(item => typeof item === 'string')
    || !isSafeInteger(maxPayload,
      1)
    || !isSafeInteger(maxBufferedBytes,
      1)
    || !isSafeInteger(tickIntervalMs)) throw new OpenClawGatewayError('OpenClaw Gateway hello-ok fields are invalid.',
    { code: 'INVALID_HELLO' })
  return {
    type: 'hello-ok',
    protocol: value.protocol,
    server: { version: value.server.version, connId: value.server.connId },
    features: { methods: [...methods], events: [...events] },
    auth: { role: value.auth.role, scopes: [...scopes] },
    policy: { maxPayload, maxBufferedBytes, tickIntervalMs },
  }
}

export type {
  OpenClawAgentExecuteRequest,
  OpenClawAgentExecuteResult,
  OpenClawCapabilities,
  OpenClawClientIdentity,
  OpenClawEvent,
  OpenClawEventGap,
  OpenClawErrorOptions,
  OpenClawGatewayClientOptions,
  OpenClawGatewayCredentials,
  OpenClawHelloAuth,
  OpenClawHello,
  OpenClawJsonValue,
  OpenClawModelRoute,
  OpenClawNativePolicyAttestation,
  OpenClawOperatorScope,
  OpenClawPolicyAttester,
  OpenClawReconcileSnapshot,
  OpenClawRequestOptions,
  OpenClawSessionCreateRequest,
  OpenClawSessionExecuteRequest,
  OpenClawSessionExecuteResult,
  OpenClawSocket,
} from './types.ts'

export { OpenClawExecutionAdapter } from './execution-adapter.ts'
export type { OpenClawExecutionAdapterConfig } from './execution-adapter.ts'
export { Config, apply, inject, managedRuntimeService, name } from './plugin.ts'
export { createManagedOpenClawConfig, managedOpenClawConfigPath } from './managed-runtime.ts'
export type { ManagedOpenClawPolicyRequest, ManagedOpenClawRuntimeHost } from './managed-runtime.ts'
export type { Config as OpenClawPluginConfig } from './plugin.ts'
