import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Action performed when a matching wake event fires. */
export type WakeMode = 'notify' | 'act'
/** Authority that created a durable wake trigger. */
export type WakeTriggerCreator = 'user' | 'harness'
/** Lifecycle state of a durable wake trigger. */
export type WakeTriggerStatus = 'active' | 'paused' | 'cancelled' | 'completed'
/** Supported scalar matching operator for event attributes. */
export type WakeMatchOperator = 'equals' | 'contains' | 'exists'
/** Scalar value admitted into normalized wake-event attributes. */
export type WakeEventAttribute = string | number | boolean | null

/** One predicate evaluated against a normalized wake event. */
export interface WakeMatcher {
  readonly field: string
  readonly operator: WakeMatchOperator
  readonly value?: WakeEventAttribute
}

/** Durable record of one trigger attempt for an event. */
export interface WakeTriggerHistoryEntry {
  readonly eventId: string
  readonly occurredAt: string
  readonly firedAt: string
  readonly status: 'completed' | 'failed'
  readonly summary?: string
  readonly error?: string
}

/** Persisted wake-trigger definition and execution history. */
export interface WakeTrigger {
  readonly id: string
  readonly title: string
  readonly source: string
  readonly eventType: string
  readonly instruction: string
  readonly mode: WakeMode
  readonly once: boolean
  readonly createdBy: WakeTriggerCreator
  readonly createdAt: string
  readonly updatedAt: string
  readonly matchers: readonly WakeMatcher[]
  readonly targetAgentId?: string
  readonly status: WakeTriggerStatus
  readonly fireCount: number
  readonly lastFiredAt?: string
  readonly history: readonly WakeTriggerHistoryEntry[]
}

/** User- or harness-supplied fields used to create a wake trigger. */
export interface CreateWakeTriggerInput {
  readonly title: string
  readonly source: string
  readonly eventType: string
  readonly instruction: string
  readonly mode?: WakeMode
  readonly once?: boolean
  readonly createdBy: WakeTriggerCreator
  readonly matchers?: readonly WakeMatcher[]
  readonly targetAgentId?: string
}

/** Normalized event admitted to the Phoenix wake runtime. */
export interface WakeEvent {
  readonly id: string
  readonly source: string
  readonly eventType: string
  readonly occurredAt: string
  readonly summary?: string
  readonly attributes: Readonly<Record<string, WakeEventAttribute>>
}

/** Matched trigger invocation handed to a wake executor. */
export interface WakeExecution {
  readonly trigger: WakeTrigger
  readonly event: WakeEvent
  readonly idempotencyKey: string
}

/** Optional executor result persisted into wake history. */
export interface WakeExecutionResult {
  readonly summary?: string
}

/** Runtime boundary that turns matched wake events into Phoenix work. */
export interface WakeExecutor {
  execute(input: WakeExecution): Promise<WakeExecutionResult>
}

/** Versioned durable wake-engine snapshot. */
export interface WakeSnapshot {
  readonly version: 1
  readonly triggers: readonly WakeTrigger[]
}

/** Persistence seam for wake-engine snapshots. */
export interface WakeStore {
  load(): Promise<WakeSnapshot>
  save(snapshot: WakeSnapshot): Promise<void>
}

/** Construction options for the durable wake engine. */
export interface WakeEngineOptions {
  readonly id?: () => string
  readonly historyLimit?: number
}

/** Aggregate outcome after dispatching one normalized event. */
export interface WakeDispatchResult {
  readonly eventId: string
  readonly matched: number
  readonly fired: number
  readonly failed: number
}

const EMPTY_SNAPSHOT: WakeSnapshot = { version: 1, triggers: [] }
const DEFAULT_HISTORY_LIMIT = 20
const MAX_MATCHERS = 12
const MAX_ATTRIBUTES = 64
const MAX_TEXT = 4_096
const MAX_ATTRIBUTE_TEXT = 2_048

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: string, field: string, max = MAX_TEXT): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new Error(`${field} must contain 1-${max} characters`)
  }
  return trimmed
}

function iso(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a valid ISO date-time`)
  return new Date(parsed).toISOString()
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive safe integer`)
  return value
}

function cloneMatcher(matcher: WakeMatcher): WakeMatcher {
  return { ...matcher }
}

function cloneHistory(row: WakeTriggerHistoryEntry): WakeTriggerHistoryEntry {
  return { ...row }
}

function cloneTrigger(trigger: WakeTrigger): WakeTrigger {
  return {
    ...trigger,
    matchers: trigger.matchers.map(cloneMatcher),
    history: trigger.history.map(cloneHistory),
  }
}

function normalizeAttribute(value: unknown, field: string): WakeEventAttribute {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`wake event attribute "${field}" must be finite`)
    return value
  }
  if (typeof value === 'string') {
    return nonEmpty(value, `wake event attribute "${field}"`, MAX_ATTRIBUTE_TEXT)
  }
  throw new Error(`wake event attribute "${field}" must be scalar`)
}

function normalizeAttributes(value: unknown): Readonly<Record<string, WakeEventAttribute>> {
  if (!isRecord(value)) throw new Error('wake event attributes must be an object')
  const entries = Object.entries(value)
  if (entries.length > MAX_ATTRIBUTES) throw new Error(`wake event attributes exceed ${MAX_ATTRIBUTES} fields`)
  return Object.fromEntries(entries.map(([rawKey, rawValue]) => {
    const key = nonEmpty(rawKey, 'wake event attribute name', 120)
    return [key, normalizeAttribute(rawValue, key)]
  }))
}

function normalizeMatcher(input: WakeMatcher): WakeMatcher {
  const field = nonEmpty(input.field, 'matcher.field', 120)
  if (input.operator !== 'equals' && input.operator !== 'contains' && input.operator !== 'exists') {
    throw new Error('matcher.operator is unsupported')
  }
  if (input.operator === 'exists') return { field, operator: 'exists' }
  if (input.value === undefined) throw new Error(`matcher.value is required for ${input.operator}`)
  return { field, operator: input.operator, value: normalizeAttribute(input.value, field) }
}

function normalizeEvent(input: WakeEvent): WakeEvent {
  return {
    id: nonEmpty(input.id, 'event.id', 256),
    source: nonEmpty(input.source, 'event.source', 120),
    eventType: nonEmpty(input.eventType, 'event.eventType', 160),
    occurredAt: iso(input.occurredAt, 'event.occurredAt'),
    ...(input.summary === undefined ? {} : { summary: nonEmpty(input.summary, 'event.summary', 2_000) }),
    attributes: normalizeAttributes(input.attributes),
  }
}

function scalarEqual(left: WakeEventAttribute | undefined, right: WakeEventAttribute | undefined): boolean {
  if (typeof left === 'string' && typeof right === 'string') {
    return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
  }
  return left === right
}

function matcherMatches(matcher: WakeMatcher, event: WakeEvent): boolean {
  const actual = event.attributes[matcher.field]
  if (matcher.operator === 'exists') return actual !== undefined
  if (matcher.operator === 'equals') return scalarEqual(actual, matcher.value)
  if (typeof actual !== 'string' || typeof matcher.value !== 'string') return false
  return actual.toLocaleLowerCase().includes(matcher.value.toLocaleLowerCase())
}

function triggerMatches(trigger: WakeTrigger, event: WakeEvent): boolean {
  if (trigger.status !== 'active') return false
  if (trigger.source !== '*' && trigger.source !== event.source) return false
  if (trigger.eventType !== '*' && trigger.eventType !== event.eventType) return false
  if (trigger.history.some(row => row.eventId === event.id && row.status === 'completed')) return false
  return trigger.matchers.every(matcher => matcherMatches(matcher, event))
}

function parseMatcher(value: unknown): WakeMatcher {
  if (!isRecord(value)) throw new Error('invalid wake matcher')
  const field = typeof value.field === 'string' ? value.field : ''
  const operator = value.operator
  if (operator !== 'equals' && operator !== 'contains' && operator !== 'exists') throw new Error('invalid wake matcher operator')
  return normalizeMatcher({
    field,
    operator,
    ...operator === 'exists' ? {} : { value: normalizeAttribute(value.value, field) },
  })
}

function parseHistory(value: unknown): WakeTriggerHistoryEntry[] {
  if (!Array.isArray(value)) throw new Error('invalid wake trigger history')
  return value.map((row): WakeTriggerHistoryEntry => {
    if (!isRecord(row)) throw new Error('invalid wake trigger history row')
    if (row.status !== 'completed' && row.status !== 'failed') throw new Error('invalid wake trigger history status')
    return {
      eventId: nonEmpty(String(row.eventId ?? ''), 'history.eventId', 256),
      occurredAt: iso(String(row.occurredAt ?? ''), 'history.occurredAt'),
      firedAt: iso(String(row.firedAt ?? ''), 'history.firedAt'),
      status: row.status,
      ...(typeof row.summary === 'string' ? { summary: nonEmpty(row.summary, 'history.summary', 2_000) } : {}),
      ...(typeof row.error === 'string' ? { error: nonEmpty(row.error, 'history.error', 2_000) } : {}),
    }
  })
}

function parseTrigger(value: unknown): WakeTrigger {
  if (!isRecord(value)) throw new Error('invalid wake trigger')
  if (value.mode !== 'notify' && value.mode !== 'act') throw new Error('invalid wake trigger mode')
  if (value.createdBy !== 'user' && value.createdBy !== 'harness') throw new Error('invalid wake trigger creator')
  if (value.status !== 'active' && value.status !== 'paused' && value.status !== 'cancelled' && value.status !== 'completed') {
    throw new Error('invalid wake trigger status')
  }
  if (!Array.isArray(value.matchers) || value.matchers.length > MAX_MATCHERS) throw new Error('invalid wake trigger matchers')
  const fireCount = Number(value.fireCount)
  if (!Number.isSafeInteger(fireCount) || fireCount < 0) throw new Error('invalid wake trigger fireCount')
  return {
    id: nonEmpty(String(value.id ?? ''), 'trigger.id', 256),
    title: nonEmpty(String(value.title ?? ''), 'trigger.title', 240),
    source: nonEmpty(String(value.source ?? ''), 'trigger.source', 120),
    eventType: nonEmpty(String(value.eventType ?? ''), 'trigger.eventType', 160),
    instruction: nonEmpty(String(value.instruction ?? ''), 'trigger.instruction'),
    mode: value.mode,
    once: value.once === true,
    createdBy: value.createdBy,
    createdAt: iso(String(value.createdAt ?? ''), 'trigger.createdAt'),
    updatedAt: iso(String(value.updatedAt ?? ''), 'trigger.updatedAt'),
    matchers: value.matchers.map(parseMatcher),
    ...(typeof value.targetAgentId === 'string' ? { targetAgentId: nonEmpty(value.targetAgentId, 'trigger.targetAgentId', 256) } : {}),
    status: value.status,
    fireCount,
    ...(typeof value.lastFiredAt === 'string' ? { lastFiredAt: iso(value.lastFiredAt, 'trigger.lastFiredAt') } : {}),
    history: parseHistory(value.history),
  }
}

function parseSnapshot(value: unknown): WakeSnapshot {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.triggers)) throw new Error('invalid wake snapshot')
  const triggers = value.triggers.map(parseTrigger)
  const ids = new Set<string>()
  for (const trigger of triggers) {
    if (ids.has(trigger.id)) throw new Error(`duplicate wake trigger id: ${trigger.id}`)
    ids.add(trigger.id)
  }
  return { version: 1, triggers }
}

/** In-memory wake store used by tests and ephemeral runtimes. */
export class MemoryWakeStore implements WakeStore {
  private snapshot: WakeSnapshot = EMPTY_SNAPSHOT

  load(): WakeSnapshot {
    return { version: 1, triggers: this.snapshot.triggers.map(cloneTrigger) }
  }

  save(snapshot: WakeSnapshot): void {
    this.snapshot = { version: 1, triggers: snapshot.triggers.map(cloneTrigger) }
  }
}

/** Owner-local JSON persistence backend for durable wake triggers. */
export class JsonWakeStore implements WakeStore {
  constructor(private readonly path: string) {
    nonEmpty(path, 'wake store path')
  }

  async load(): Promise<WakeSnapshot> {
    try {
      return parseSnapshot(JSON.parse(await readFile(this.path, 'utf8')) as unknown)
    } catch (error: unknown) {
      if (isRecord(error) && error.code === 'ENOENT') return EMPTY_SNAPSHOT
      throw error
    }
  }

  async save(snapshot: WakeSnapshot): Promise<void> {
    const validated = parseSnapshot(snapshot)
    await mkdir(dirname(this.path), { recursive: true })
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temp, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, this.path)
  }
}

/** Durable trigger registry and serialized event dispatcher. */
export class WakeEngine {
  private state: WakeSnapshot | undefined
  private tail: Promise<void> = Promise.resolve()
  private runTail: Promise<void> = Promise.resolve()
  private readonly id: () => string
  private readonly historyLimit: number

  constructor(
    private readonly store: WakeStore,
    private readonly executor: WakeExecutor,
    options: WakeEngineOptions = {},
  ) {
    this.id = options.id ?? randomUUID
    this.historyLimit = positiveInteger(options.historyLimit ?? DEFAULT_HISTORY_LIMIT, 'historyLimit')
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(operation, operation)
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }

  private async snapshot(): Promise<WakeSnapshot> {
    return (this.state ??= await this.store.load())
  }

  private async commit(triggers: readonly WakeTrigger[]): Promise<void> {
    const snapshot: WakeSnapshot = { version: 1, triggers: triggers.map(cloneTrigger) }
    await this.store.save(snapshot)
    this.state = snapshot
  }

  /**
   * Create and persist a normalized active wake trigger.
   * @param input - Trigger definition supplied by the user or harness.
   * @returns Persisted trigger snapshot.
   */
  async create(input: CreateWakeTriggerInput): Promise<WakeTrigger> {
    return this.exclusive(async () => {
      const snapshot = await this.snapshot()
      const now = new Date().toISOString()
      const matchers = (input.matchers ?? []).map(normalizeMatcher)
      if (matchers.length > MAX_MATCHERS) throw new Error(`wake trigger matchers exceed ${MAX_MATCHERS}`)
      const trigger: WakeTrigger = {
        id: nonEmpty(this.id(), 'trigger.id', 256),
        title: nonEmpty(input.title, 'trigger.title', 240),
        source: nonEmpty(input.source, 'trigger.source', 120),
        eventType: nonEmpty(input.eventType, 'trigger.eventType', 160),
        instruction: nonEmpty(input.instruction, 'trigger.instruction'),
        mode: input.mode ?? 'act',
        once: input.once ?? false,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
        matchers,
        ...(input.targetAgentId === undefined ? {} : { targetAgentId: nonEmpty(input.targetAgentId, 'trigger.targetAgentId', 256) }),
        status: 'active',
        fireCount: 0,
        history: [],
      }
      if (snapshot.triggers.some(candidate => candidate.id === trigger.id)) throw new Error(`duplicate wake trigger id: ${trigger.id}`)
      await this.commit([...snapshot.triggers, trigger])
      return cloneTrigger(trigger)
    })
  }

  /**
   * List all persisted wake triggers.
   * @returns Detached trigger snapshots in storage order.
   */
  async list(): Promise<WakeTrigger[]> {
    return this.exclusive(async () => (await this.snapshot()).triggers.map(cloneTrigger))
  }

  /**
   * Read one persisted wake trigger.
   * @param id - Trigger identifier.
   * @returns Detached trigger snapshot, or undefined when absent.
   */
  async get(id: string): Promise<WakeTrigger | undefined> {
    return this.exclusive(async () => {
      const trigger = (await this.snapshot()).triggers.find(candidate => candidate.id === id)
      return trigger === undefined ? undefined : cloneTrigger(trigger)
    })
  }

  private async setStatus(id: string, status: 'active' | 'paused' | 'cancelled'): Promise<WakeTrigger> {
    return this.exclusive(async () => {
      const snapshot = await this.snapshot()
      const index = snapshot.triggers.findIndex(trigger => trigger.id === id)
      if (index < 0) throw new Error(`unknown wake trigger: ${id}`)
      const current = snapshot.triggers[index]!
      if ((current.status === 'completed' || current.status === 'cancelled') && status !== 'cancelled') {
        throw new Error(`wake trigger ${id} is terminal: ${current.status}`)
      }
      const next: WakeTrigger = { ...current, status, updatedAt: new Date().toISOString() }
      const triggers = [...snapshot.triggers]
      triggers[index] = next
      await this.commit(triggers)
      return cloneTrigger(next)
    })
  }

  /**
   * Pause an active wake trigger.
   * @param id - Trigger identifier.
   * @returns Updated trigger snapshot.
   */
  pause(id: string): Promise<WakeTrigger> { return this.setStatus(id, 'paused') }
  /**
   * Resume a paused wake trigger.
   * @param id - Trigger identifier.
   * @returns Updated trigger snapshot.
   */
  resume(id: string): Promise<WakeTrigger> { return this.setStatus(id, 'active') }
  /**
   * Cancel a wake trigger permanently.
   * @param id - Trigger identifier.
   * @returns Updated terminal trigger snapshot.
   */
  cancel(id: string): Promise<WakeTrigger> { return this.setStatus(id, 'cancelled') }

  /**
   * Normalize and serialize dispatch of one wake event.
   * @param input - Event received from an authenticated internal or external producer.
   * @returns Aggregate matched, fired, and failed counts.
   */
  emit(input: WakeEvent): Promise<WakeDispatchResult> {
    const event = normalizeEvent(input)
    const run = this.runTail.then(() => this.dispatch(event), () => this.dispatch(event))
    this.runTail = run.then(() => undefined, () => undefined)
    return run
  }

  private async dispatch(event: WakeEvent): Promise<WakeDispatchResult> {
    const candidates = await this.exclusive(async () =>
      (await this.snapshot()).triggers.filter(trigger => triggerMatches(trigger, event)).map(cloneTrigger))
    let fired = 0
    let failed = 0

    for (const trigger of candidates) {
      const idempotencyKey = `${trigger.id}:${event.id}`
      try {
        const result = await this.executor.execute({ trigger, event, idempotencyKey })
        fired += 1
        const firedAt = new Date().toISOString()
        await this.exclusive(async () => {
          const snapshot = await this.snapshot()
          const current = snapshot.triggers.find(candidate => candidate.id === trigger.id)
          if (current === undefined) return
          if (current.history.some(row => row.eventId === event.id && row.status === 'completed')) return
          const entry: WakeTriggerHistoryEntry = {
            eventId: event.id,
            occurredAt: event.occurredAt,
            firedAt,
            status: 'completed',
            ...(result.summary === undefined ? {} : { summary: nonEmpty(result.summary, 'wake result summary', 2_000) }),
          }
          const history = [...current.history, entry].slice(-this.historyLimit)
          const next: WakeTrigger = {
            ...current,
            status: current.once ? 'completed' : current.status,
            fireCount: current.fireCount + 1,
            lastFiredAt: firedAt,
            updatedAt: firedAt,
            history,
          }
          await this.commit(snapshot.triggers.map(candidate => candidate.id === current.id ? next : candidate))
        })
      } catch (error: unknown) {
        failed += 1
        const firedAt = new Date().toISOString()
        const message = error instanceof Error ? error.message : String(error)
        await this.exclusive(async () => {
          const snapshot = await this.snapshot()
          const current = snapshot.triggers.find(candidate => candidate.id === trigger.id)
          if (current === undefined) return
          const entry: WakeTriggerHistoryEntry = {
            eventId: event.id,
            occurredAt: event.occurredAt,
            firedAt,
            status: 'failed',
            error: nonEmpty(message, 'wake error', 2_000),
          }
          const history = [...current.history, entry].slice(-this.historyLimit)
          const next: WakeTrigger = { ...current, updatedAt: firedAt, history }
          await this.commit(snapshot.triggers.map(candidate => candidate.id === current.id ? next : candidate))
        })
      }
    }

    return { eventId: event.id, matched: candidates.length, fired, failed }
  }
}

/**
 * Build and validate a normalized wake event.
 * @param input - Event identity, source, type, optional summary, and scalar attributes.
 * @returns Normalized wake event with an ISO occurrence timestamp.
 */
export function wakeEvent(input: {
  readonly id: string
  readonly source: string
  readonly eventType: string
  readonly occurredAt?: string
  readonly summary?: string
  readonly attributes?: Readonly<Record<string, WakeEventAttribute>>
}): WakeEvent {
  return normalizeEvent({
    id: input.id,
    source: input.source,
    eventType: input.eventType,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    attributes: input.attributes ?? {},
  })
}
