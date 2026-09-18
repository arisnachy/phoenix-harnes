import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { LivingCreationId, livingControlForManifest } from '@phoenix-ai/dsh-living'
import type {
  LivingCreationId as LivingCreationIdType,
  LivingCreationManifest,
  LivingCreationProvider,
  LivingCreationSnapshot,
  LivingJson,
  LivingState,
} from '@phoenix-ai/dsh-living'

const MAX_BODY_BYTES = 1024 * 1024
const DEFAULT_ACTION_TIMEOUT_MS = 30_000
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 20_000
const DEFAULT_SWEEP_MS = 5_000

interface BridgeRegistry {
  inspect(id: LivingCreationIdType): LivingCreationSnapshot
  attach(id: LivingCreationIdType, provider: LivingCreationProvider): () => void
}

interface RemoteCapabilities {
  readonly state: readonly string[]
  readonly actions: readonly string[]
  readonly events: readonly string[]
  readonly actors: readonly string[]
}

interface RemoteCommand {
  readonly id: string
  readonly action: string
  readonly input: LivingJson
}

interface PendingCommand {
  readonly timer: ReturnType<typeof setTimeout>
  readonly resolve: (value: LivingJson) => void
  readonly reject: (error: Error) => void
}

interface RemoteConnection {
  readonly id: LivingCreationIdType
  readonly sessionId: string
  readonly token: string
  readonly endpoint: string
  readonly capabilities: RemoteCapabilities
  readonly commands: RemoteCommand[]
  readonly pending: Map<string, PendingCommand>
  state: LivingState
  lastSeen: number
  emit: ((name: string, data: LivingJson) => void) | undefined
  disposeProvider: () => void
}

/** Binding and liveness limits for the built-in owner-local living HTTP bridge. */
export interface LivingHttpBridgeConfig {
  readonly host: string
  readonly port: number
  readonly actionTimeoutMs?: number
  readonly heartbeatTimeoutMs?: number
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new TypeError(`${label} must be an array of strings`)
  }
  return value as string[]
}

function assertExact(label: string, actual: readonly string[], expected: readonly string[]): void {
  const left = [...actual].sort()
  const right = [...expected].sort()
  if (left.length !== right.length || left.some((item, index) => item !== right[index])) {
    throw new Error(`${label} mismatch: runtime declared [${left.join(', ')}], manifest requires [${right.join(', ')}]`)
  }
}

function validateState(manifest: LivingCreationManifest, value: unknown): LivingState {
  const raw = asRecord(value, 'state')
  const keys = Object.keys(raw)
  assertExact('state keys', keys, manifest.state)
  return clone(raw) as LivingState
}

function parseCapabilities(value: unknown): RemoteCapabilities {
  const raw = asRecord(value, 'capabilities')
  return {
    state: stringArray(raw.state, 'capabilities.state'),
    actions: stringArray(raw.actions, 'capabilities.actions'),
    events: stringArray(raw.events, 'capabilities.events'),
    actors: stringArray(raw.actors, 'capabilities.actors'),
  }
}

function assertCapabilities(manifest: LivingCreationManifest, capabilities: RemoteCapabilities): void {
  assertExact('state capability', capabilities.state, manifest.state)
  assertExact('action capability', capabilities.actions, manifest.actions)
  assertExact('event capability', capabilities.events, manifest.events)
  assertExact('actor capability', capabilities.actors, manifest.actors)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_BODY_BYTES) throw new Error('living control request body exceeds 1 MiB')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return asRecord(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown, 'request body')
}

function setCors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'authorization, content-type')
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
  res.setHeader('cache-control', 'no-store')
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  setCors(res)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(`${JSON.stringify(value)}\n`)
}

function bearer(req: IncomingMessage): string {
  const value = req.headers.authorization
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) throw new Error('missing living control bearer token')
  const token = value.slice('Bearer '.length).trim()
  if (token.length === 0) throw new Error('missing living control bearer token')
  return token
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function loopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1'
}

/**
 * Owner-local HTTP transport for Phoenix-created runtimes.
 *
 * The durable manifest carries a per-creation bearer token. A runtime proves
 * its exact declared capability surface during connect; only then does this
 * bridge attach a real LivingCreationProvider to ctx.living.
 */
export class LivingHttpBridge {
  private readonly server: Server
  private readonly connections = new Map<LivingCreationIdType, RemoteConnection>()
  private readonly actionTimeoutMs: number
  private readonly heartbeatTimeoutMs: number
  private readonly sweep: ReturnType<typeof setInterval>
  private readonly readyPromise: Promise<string>
  private disposed = false

  constructor(
    private readonly registry: BridgeRegistry,
    config: LivingHttpBridgeConfig,
    private readonly warn: (message: string) => void = () => undefined,
  ) {
    if (!loopbackHost(config.host)) {
      throw new Error(`living control bridge must bind loopback only, got ${JSON.stringify(config.host)}`)
    }
    if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
      throw new Error(`living control bridge port must be an integer from 0 to 65535, got ${String(config.port)}`)
    }
    this.actionTimeoutMs = config.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS
    this.heartbeatTimeoutMs = config.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS
    if (!Number.isFinite(this.actionTimeoutMs) || this.actionTimeoutMs <= 0) throw new Error('living control actionTimeoutMs must be positive')
    if (!Number.isFinite(this.heartbeatTimeoutMs) || this.heartbeatTimeoutMs <= 0) throw new Error('living control heartbeatTimeoutMs must be positive')

    this.server = createServer((req, res) => { void this.handle(req, res) })
    this.readyPromise = new Promise<string>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      this.server.once('error', onError)
      this.server.listen(config.port, config.host, () => {
        this.server.off('error', onError)
        const address = this.server.address()
        if (address === null || typeof address === 'string') {
          reject(new Error('living control bridge did not expose a TCP address'))
          return
        }
        const host = config.host === '::1' ? '[::1]' : config.host
        resolve(`http://${host}:${address.port}/v1/living`)
      })
    })
    void this.readyPromise.catch(error => this.warn(`living control bridge unavailable: ${messageOf(error)}`))

    this.sweep = setInterval(() => this.disconnectStale(), Math.min(DEFAULT_SWEEP_MS, this.heartbeatTimeoutMs))
    this.sweep.unref?.()
  }

  /**
   * Resolve the actual endpoint after the HTTP server has bound.
   * @returns Fully qualified base endpoint for generated runtimes.
   */
  endpoint(): Promise<string> {
    return this.readyPromise
  }

  /**
   * Reject a manifest mutation that no longer matches an attached runtime.
   * @param manifest - Candidate manifest about to become durable.
   */
  assertManifestCompatible(manifest: LivingCreationManifest): void {
    const connection = this.connections.get(manifest.id)
    if (connection === undefined) return
    assertCapabilities(manifest, connection.capabilities)
  }

  /**
   * Disconnect a runtime when its persisted control link changed.
   * @param manifest - Newly committed manifest for the creation.
   */
  reconcile(manifest: LivingCreationManifest): void {
    const connection = this.connections.get(manifest.id)
    if (connection === undefined) return
    const link = livingControlForManifest(manifest)
    if (link === undefined || link.endpoint !== connection.endpoint || !equalSecret(link.token, connection.token)) {
      this.disconnect(manifest.id, 'living control link changed')
    }
  }

  /**
   * Detach one remote runtime and reject all actions still waiting on it.
   * @param id - Creation whose runtime should be detached.
   * @param reason - Error propagated to pending action callers.
   */
  disconnect(id: LivingCreationIdType, reason = 'living runtime disconnected'): void {
    const connection = this.connections.get(id)
    if (connection === undefined) return
    this.connections.delete(id)
    for (const pending of connection.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    connection.pending.clear()
    connection.commands.length = 0
    try { connection.disposeProvider() } catch { /* provider cleanup is isolated */ }
  }

  /** Stop the control bridge and detach every connected generated runtime. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    clearInterval(this.sweep)
    for (const id of [...this.connections.keys()]) this.disconnect(id, 'living control bridge stopped')
    this.server.close()
  }

  private disconnectStale(): void {
    const now = Date.now()
    for (const [id, connection] of this.connections) {
      if (now - connection.lastSeen > this.heartbeatTimeoutMs) this.disconnect(id, 'living runtime heartbeat expired')
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'OPTIONS') {
      setCors(res)
      res.statusCode = 204
      res.end()
      return
    }
    if (req.method !== 'POST' || req.url === undefined) {
      sendJson(res, 404, { error: 'not_found' })
      return
    }

    try {
      const path = new URL(req.url, 'http://living.local').pathname
      const body = await readJson(req)
      switch (path) {
        case '/v1/living/connect':
          await this.connect(req, res, body)
          return
        case '/v1/living/state':
          this.state(req, res, body)
          return
        case '/v1/living/event':
          this.event(req, res, body)
          return
        case '/v1/living/poll':
          this.poll(req, res, body)
          return
        case '/v1/living/result':
          this.result(req, res, body)
          return
        case '/v1/living/disconnect':
          this.remoteDisconnect(req, res, body)
          return
        default:
          sendJson(res, 404, { error: 'not_found' })
      }
    } catch (error) {
      sendJson(res, 400, { error: 'living_control_error', message: messageOf(error) })
    }
  }

  private authorized(req: IncomingMessage, body: Record<string, unknown>): {
    id: LivingCreationIdType
    manifest: LivingCreationManifest
    token: string
    endpoint: string
  } {
    const rawId = body.creationId
    if (typeof rawId !== 'string' || rawId.length === 0) throw new Error('creationId is required')
    const id = LivingCreationId(rawId)
    const snapshot = this.registry.inspect(id)
    const link = livingControlForManifest(snapshot.manifest)
    if (link === undefined) throw new Error(`living creation ${rawId} has no provisioned control link`)
    const supplied = bearer(req)
    if (!equalSecret(supplied, link.token)) throw new Error('invalid living control bearer token')
    return { id, manifest: snapshot.manifest, token: link.token, endpoint: link.endpoint }
  }

  private connection(req: IncomingMessage, body: Record<string, unknown>): RemoteConnection {
    const { id } = this.authorized(req, body)
    const sessionId = body.sessionId
    if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('sessionId is required')
    const connection = this.connections.get(id)
    if (connection === undefined || connection.sessionId !== sessionId) throw new Error('living control session is not connected')
    connection.lastSeen = Date.now()
    return connection
  }

  private async connect(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>): Promise<void> {
    const { id, manifest, token, endpoint } = this.authorized(req, body)
    const capabilities = parseCapabilities(body.capabilities)
    assertCapabilities(manifest, capabilities)
    const state = validateState(manifest, body.state)

    this.disconnect(id, 'living runtime reconnected')
    const connection: RemoteConnection = {
      id,
      sessionId: randomUUID(),
      token,
      endpoint,
      capabilities,
      commands: [],
      pending: new Map(),
      state,
      lastSeen: Date.now(),
      emit: undefined,
      disposeProvider: () => undefined,
    }

    const provider: LivingCreationProvider = {
      readState: () => clone(connection.state),
      ...manifest.events.length === 0 ? {} : {
        subscribe: (emit: (name: string, data: LivingJson) => void) => {
          connection.emit = emit
          return () => {
            if (connection.emit === emit) connection.emit = undefined
          }
        },
      },
      ...manifest.actions.length === 0 ? {} : {
        act: (action: string, input: LivingJson) => this.remoteAction(connection, action, input),
      },
      ...manifest.actors.length === 0 ? {} : { actors: [...manifest.actors] },
    }

    connection.disposeProvider = this.registry.attach(id, provider)
    this.connections.set(id, connection)
    sendJson(res, 200, {
      protocol: 'phoenix-living-http-v1',
      sessionId: connection.sessionId,
      heartbeatTimeoutMs: this.heartbeatTimeoutMs,
      actionTimeoutMs: this.actionTimeoutMs,
    })
  }

  private state(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>): void {
    const connection = this.connection(req, body)
    const manifest = this.registry.inspect(connection.id).manifest
    connection.state = validateState(manifest, body.state)
    sendJson(res, 200, { ok: true })
  }

  private event(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>): void {
    const connection = this.connection(req, body)
    const name = body.name
    if (typeof name !== 'string' || name.length === 0) throw new Error('event name is required')
    const manifest = this.registry.inspect(connection.id).manifest
    if (!manifest.events.includes(name)) throw new Error(`undeclared living event ${JSON.stringify(name)}`)
    if (connection.emit === undefined) throw new Error('living creation is not event-capable')
    connection.emit(name, clone(body.data as LivingJson))
    sendJson(res, 200, { ok: true })
  }

  private poll(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>): void {
    const connection = this.connection(req, body)
    const command = connection.commands.shift() ?? null
    sendJson(res, 200, { command })
  }

  private result(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>): void {
    const connection = this.connection(req, body)
    const commandId = body.commandId
    if (typeof commandId !== 'string' || commandId.length === 0) throw new Error('commandId is required')
    const pending = connection.pending.get(commandId)
    if (pending === undefined) throw new Error('unknown or expired living command')
    connection.pending.delete(commandId)
    clearTimeout(pending.timer)
    if (body.ok === false) {
      const detail = typeof body.error === 'string' ? body.error : 'living runtime action failed'
      pending.reject(new Error(detail))
    } else {
      pending.resolve(clone(body.result as LivingJson))
    }
    sendJson(res, 200, { ok: true })
  }

  private remoteDisconnect(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>): void {
    const connection = this.connection(req, body)
    this.disconnect(connection.id)
    sendJson(res, 200, { ok: true })
  }

  private remoteAction(connection: RemoteConnection, action: string, input: LivingJson): Promise<LivingJson> {
    if (!connection.capabilities.actions.includes(action)) {
      return Promise.reject(new Error(`living runtime did not declare action ${JSON.stringify(action)}`))
    }
    const command: RemoteCommand = { id: randomUUID(), action, input: clone(input) }
    return new Promise<LivingJson>((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.pending.delete(command.id)
        const index = connection.commands.findIndex(item => item.id === command.id)
        if (index >= 0) connection.commands.splice(index, 1)
        reject(new Error(`living action ${action} timed out after ${this.actionTimeoutMs}ms`))
      }, this.actionTimeoutMs)
      timer.unref?.()
      connection.pending.set(command.id, { timer, resolve, reject })
      connection.commands.push(command)
    })
  }
}
