import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Durable lifecycle states for a proactive task. */
export type ProactivityTaskStatus = 'scheduled' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled'
/** Who originated the task. */
export type ProactivityTaskCreator = 'user' | 'harness' | 'system'
/** Catch-up behavior after Phoenix was not running at one or more due times. */
export type ProactivityCatchUp = 'latest' | 'all' | 'skip'
/** Whether the task is ordinary or intentionally hidden from ordinary listings until reveal time. */
export type ProactivityVisibility = 'visible' | 'surprise'
/** How Phoenix should carry out the delivery phase. */
export type ProactivityDelivery = 'chat' | 'email' | 'work'
/** Which configured mail identity should be used when delivery requires email. */
export type ProactivitySenderIdentity = 'user' | 'harness' | 'auto'
/** Which part of one scheduled occurrence is executing. */
export type ProactivityPhase = 'prepare' | 'deliver'
/** Terminal status of one attempted phase. */
export type ProactivityHistoryStatus = 'completed' | 'failed'

/** Supported recurrence forms. Interval schedules stay anchored; yearly schedules preserve local calendar time. */
export type ProactivityRecurrence =
  | { readonly kind: 'once' }
  | { readonly kind: 'interval'; readonly everyMs: number }
  | { readonly kind: 'yearly'; readonly everyYears: number; readonly timezone?: string }

/** One immutable execution-history row. */
export interface ProactivityHistoryEntry {
  readonly phase: ProactivityPhase
  readonly scheduledFor: string
  readonly idempotencyKey: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly status: ProactivityHistoryStatus
  readonly summary?: string
  readonly error?: string
}

/** Durable task record stored by the engine. */
export interface ProactivityTask {
  readonly id: string
  readonly title: string
  readonly instruction: string
  readonly createdBy: ProactivityTaskCreator
  readonly createdAt: string
  readonly updatedAt: string
  readonly nextRunAt: string
  readonly recurrence: ProactivityRecurrence
  readonly catchUp: ProactivityCatchUp
  readonly visibility: ProactivityVisibility
  readonly revealAt?: string
  readonly preparationInstruction?: string
  readonly prepareLeadMs?: number
  /** Optional condition evaluated privately before delivery; false checks stay silent. */
  readonly condition?: string
  readonly delivery: ProactivityDelivery
  readonly senderIdentity: ProactivitySenderIdentity
  readonly recipient?: string
  readonly targetAgentId?: string
  readonly status: ProactivityTaskStatus
  readonly history: readonly ProactivityHistoryEntry[]
}

/** User/model input for creating one proactive task. */
export interface CreateProactivityTaskInput {
  readonly title: string
  readonly instruction: string
  readonly runAt: string
  readonly createdBy: ProactivityTaskCreator
  readonly recurrence?: ProactivityRecurrence
  readonly catchUp?: ProactivityCatchUp
  readonly visibility?: ProactivityVisibility
  readonly revealAt?: string
  readonly preparationInstruction?: string
  readonly prepareLeadMs?: number
  /** Optional condition that must be verified true before delivery. */
  readonly condition?: string
  readonly delivery?: ProactivityDelivery
  readonly senderIdentity?: ProactivitySenderIdentity
  readonly recipient?: string
  readonly targetAgentId?: string
}

/** Input delivered to the host executor for one phase of one occurrence. */
export interface ProactivityExecution {
  readonly phase: ProactivityPhase
  readonly task: ProactivityTask
  readonly scheduledFor: string
  readonly idempotencyKey: string
  readonly instruction: string
  readonly preparationResult?: string
}

/** Safe execution result retained as history and optionally passed from preparation to delivery. */
export interface ProactivityExecutionResult {
  readonly summary?: string
  /** Complete a recurring task immediately after this successful occurrence. */
  readonly terminal?: boolean
}

/** Host seam used by the pure scheduler to perform work. */
export interface ProactivityExecutor {
  execute(input: ProactivityExecution): Promise<ProactivityExecutionResult>
}

/** Persistent snapshot format owned by this engine. */
export interface ProactivitySnapshot {
  readonly version: 1
  readonly tasks: readonly ProactivityTask[]
}

/** Storage seam for the durable global task ledger. */
export interface ProactivityStore {
  load(): Promise<ProactivitySnapshot>
  save(snapshot: ProactivitySnapshot): Promise<void>
}

/** Options controlling deterministic engine behavior. */
export interface ProactivityEngineOptions {
  readonly id?: () => string
  readonly maxCatchUpOccurrences?: number
}

/** Options for projecting tasks to a caller. */
export interface ProactivityListOptions {
  readonly includeHidden?: boolean
  readonly now?: Date
}

/** Runtime dependency is temporarily unavailable; keep the occurrence scheduled. */
export class ProactivityDeferredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProactivityDeferredError'
  }
}

const EMPTY_SNAPSHOT: ProactivitySnapshot = { version: 1, tasks: [] }
const YEARLY_SEARCH_LIMIT = 10_000

function iso(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a valid ISO date-time`)
  return new Date(parsed).toISOString()
}

function nonEmpty(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`${field} must be a non-empty string`)
  return trimmed
}

function finitePositive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive safe integer`)
  return value
}

function canonicalTimezone(value: string, field: string): string {
  const timezone = nonEmpty(value, field)
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone
  } catch {
    throw new Error(`${field} must be a valid IANA timezone`)
  }
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const zonedFormatters = new Map<string, Intl.DateTimeFormat>()

function zonedParts(epochMs: number, timezone: string): ZonedParts {
  let formatter = zonedFormatters.get(timezone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    zonedFormatters.set(timezone, formatter)
  }
  const parts = new Map(formatter.formatToParts(new Date(epochMs)).map(part => [part.type, part.value]))
  const read = (name: keyof ZonedParts): number => {
    const value = Number(parts.get(name))
    if (!Number.isFinite(value)) throw new Error(`could not resolve ${name} in timezone ${timezone}`)
    return value
  }
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  }
}

function timezoneOffsetMs(epochMs: number, timezone: string): number {
  const parts = zonedParts(epochMs, timezone)
  const rounded = Math.floor(epochMs / 1000) * 1000
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - rounded
}

function zonedLocalToEpoch(parts: ZonedParts, milliseconds: number, timezone: string): number {
  const wallClock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, milliseconds)
  let candidate = wallClock
  for (let iteration = 0; iteration < 4; iteration++) {
    const next = wallClock - timezoneOffsetMs(candidate, timezone)
    if (next === candidate) return next
    candidate = next
  }
  return candidate
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function addYears(scheduledFor: string, everyYears: number, timezone?: string): string {
  const sourceMs = Date.parse(scheduledFor)
  if (timezone === undefined) {
    const source = new Date(sourceMs)
    const year = source.getUTCFullYear() + everyYears
    const month = source.getUTCMonth() + 1
    const day = Math.min(source.getUTCDate(), daysInMonth(year, month))
    return new Date(Date.UTC(
      year,
      month - 1,
      day,
      source.getUTCHours(),
      source.getUTCMinutes(),
      source.getUTCSeconds(),
      source.getUTCMilliseconds(),
    )).toISOString()
  }

  const source = zonedParts(sourceMs, timezone)
  const year = source.year + everyYears
  const target: ZonedParts = {
    ...source,
    year,
    day: Math.min(source.day, daysInMonth(year, source.month)),
  }
  return new Date(zonedLocalToEpoch(target, new Date(sourceMs).getUTCMilliseconds(), timezone)).toISOString()
}

function cloneTask(task: ProactivityTask): ProactivityTask {
  return { ...task, recurrence: { ...task.recurrence }, history: task.history.map(entry => ({ ...entry })) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseHistory(value: unknown): ProactivityHistoryEntry[] {
  if (!Array.isArray(value)) throw new Error('proactivity history must be an array')
  return value.map((raw) => {
    if (!isRecord(raw)
      || (raw.phase !== 'prepare' && raw.phase !== 'deliver')
      || typeof raw.scheduledFor !== 'string'
      || typeof raw.idempotencyKey !== 'string'
      || typeof raw.startedAt !== 'string'
      || typeof raw.finishedAt !== 'string'
      || (raw.status !== 'completed' && raw.status !== 'failed')
      || (raw.summary !== undefined && typeof raw.summary !== 'string')
      || (raw.error !== undefined && typeof raw.error !== 'string')) {
      throw new Error('invalid proactivity history row')
    }
    return {
      phase: raw.phase,
      scheduledFor: iso(raw.scheduledFor, 'history.scheduledFor'),
      idempotencyKey: nonEmpty(raw.idempotencyKey, 'history.idempotencyKey'),
      startedAt: iso(raw.startedAt, 'history.startedAt'),
      finishedAt: iso(raw.finishedAt, 'history.finishedAt'),
      status: raw.status,
      ...(raw.summary === undefined ? {} : { summary: raw.summary }),
      ...(raw.error === undefined ? {} : { error: raw.error }),
    }
  })
}

function parseRecurrence(raw: Record<string, unknown>): ProactivityRecurrence {
  if (raw.kind === 'once') return { kind: 'once' }
  if (raw.kind === 'interval' && typeof raw.everyMs === 'number') {
    return { kind: 'interval', everyMs: finitePositive(raw.everyMs, 'recurrence.everyMs') }
  }
  if (raw.kind === 'yearly' && typeof raw.everyYears === 'number'
    && (raw.timezone === undefined || typeof raw.timezone === 'string')) {
    return {
      kind: 'yearly',
      everyYears: finitePositive(raw.everyYears, 'recurrence.everyYears'),
      ...(raw.timezone === undefined ? {} : { timezone: canonicalTimezone(raw.timezone, 'recurrence.timezone') }),
    }
  }
  throw new Error('invalid proactivity recurrence')
}

function parseTask(raw: unknown): ProactivityTask {
  if (!isRecord(raw)
    || typeof raw.id !== 'string'
    || typeof raw.title !== 'string'
    || typeof raw.instruction !== 'string'
    || (raw.createdBy !== 'user' && raw.createdBy !== 'harness' && raw.createdBy !== 'system')
    || typeof raw.createdAt !== 'string'
    || typeof raw.updatedAt !== 'string'
    || typeof raw.nextRunAt !== 'string'
    || !isRecord(raw.recurrence)
    || (raw.catchUp !== 'latest' && raw.catchUp !== 'all' && raw.catchUp !== 'skip')
    || (raw.visibility !== 'visible' && raw.visibility !== 'surprise')
    || (raw.delivery !== 'chat' && raw.delivery !== 'email' && raw.delivery !== 'work')
    || (raw.senderIdentity !== 'user' && raw.senderIdentity !== 'harness' && raw.senderIdentity !== 'auto')
    || (raw.status !== 'scheduled' && raw.status !== 'running' && raw.status !== 'completed'
      && raw.status !== 'failed' && raw.status !== 'paused' && raw.status !== 'cancelled')) {
    throw new Error('invalid proactivity task')
  }
  const recurrence = parseRecurrence(raw.recurrence)
  if (raw.revealAt !== undefined && typeof raw.revealAt !== 'string') throw new Error('invalid revealAt')
  if (raw.preparationInstruction !== undefined && typeof raw.preparationInstruction !== 'string') throw new Error('invalid preparationInstruction')
  if (raw.prepareLeadMs !== undefined && typeof raw.prepareLeadMs !== 'number') throw new Error('invalid prepareLeadMs')
  if (raw.condition !== undefined && typeof raw.condition !== 'string') throw new Error('invalid condition')
  if (raw.recipient !== undefined && typeof raw.recipient !== 'string') throw new Error('invalid recipient')
  if (raw.targetAgentId !== undefined && typeof raw.targetAgentId !== 'string') throw new Error('invalid targetAgentId')
  return {
    id: nonEmpty(raw.id, 'id'),
    title: nonEmpty(raw.title, 'title'),
    instruction: nonEmpty(raw.instruction, 'instruction'),
    createdBy: raw.createdBy,
    createdAt: iso(raw.createdAt, 'createdAt'),
    updatedAt: iso(raw.updatedAt, 'updatedAt'),
    nextRunAt: iso(raw.nextRunAt, 'nextRunAt'),
    recurrence,
    catchUp: raw.catchUp,
    visibility: raw.visibility,
    ...(raw.revealAt === undefined ? {} : { revealAt: iso(raw.revealAt, 'revealAt') }),
    ...(raw.preparationInstruction === undefined ? {} : { preparationInstruction: nonEmpty(raw.preparationInstruction, 'preparationInstruction') }),
    ...(raw.prepareLeadMs === undefined ? {} : { prepareLeadMs: finitePositive(raw.prepareLeadMs, 'prepareLeadMs') }),
    ...(raw.condition === undefined ? {} : { condition: nonEmpty(raw.condition, 'condition') }),
    delivery: raw.delivery,
    senderIdentity: raw.senderIdentity,
    ...(raw.recipient === undefined ? {} : { recipient: nonEmpty(raw.recipient, 'recipient') }),
    ...(raw.targetAgentId === undefined ? {} : { targetAgentId: nonEmpty(raw.targetAgentId, 'targetAgentId') }),
    status: raw.status,
    history: parseHistory(raw.history),
  }
}

function parseSnapshot(value: unknown): ProactivitySnapshot {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.tasks)) throw new Error('invalid proactivity snapshot')
  const tasks = value.tasks.map(parseTask)
  const ids = new Set<string>()
  for (const task of tasks) {
    if (ids.has(task.id)) throw new Error(`duplicate proactivity task id: ${task.id}`)
    ids.add(task.id)
  }
  return { version: 1, tasks }
}

/** In-memory store used by deterministic tests and ephemeral compositions. */
export class MemoryProactivityStore implements ProactivityStore {
  private snapshot: ProactivitySnapshot = EMPTY_SNAPSHOT
  async load(): Promise<ProactivitySnapshot> {
    return { version: 1, tasks: this.snapshot.tasks.map(cloneTask) }
  }
  async save(snapshot: ProactivitySnapshot): Promise<void> {
    this.snapshot = { version: 1, tasks: snapshot.tasks.map(cloneTask) }
  }
}

/** Atomic JSON-file store for the harness-global task ledger. */
export class JsonProactivityStore implements ProactivityStore {
  constructor(private readonly path: string) { nonEmpty(path, 'path') }
  async load(): Promise<ProactivitySnapshot> {
    try {
      return parseSnapshot(JSON.parse(await readFile(this.path, 'utf8')) as unknown)
    } catch (error: unknown) {
      if (isRecord(error) && error.code === 'ENOENT') return EMPTY_SNAPSHOT
      throw error
    }
  }
  async save(snapshot: ProactivitySnapshot): Promise<void> {
    const validated = parseSnapshot(snapshot)
    await mkdir(dirname(this.path), { recursive: true })
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temp, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, this.path)
  }
}

function occurrenceKey(taskId: string, phase: ProactivityPhase, scheduledFor: string): string {
  return `${taskId}:${phase}:${scheduledFor}`
}

function completedSummary(task: ProactivityTask, phase: ProactivityPhase, scheduledFor: string): string | undefined {
  return [...task.history].reverse().find(row => row.phase === phase && row.scheduledFor === scheduledFor && row.status === 'completed')?.summary
}

function hasCompleted(task: ProactivityTask, phase: ProactivityPhase, scheduledFor: string): boolean {
  return task.history.some(row => row.phase === phase && row.scheduledFor === scheduledFor && row.status === 'completed')
}

function nextAfter(task: ProactivityTask, scheduledFor: string): string | undefined {
  if (task.recurrence.kind === 'once') return undefined
  if (task.recurrence.kind === 'interval') {
    return new Date(Date.parse(scheduledFor) + task.recurrence.everyMs).toISOString()
  }
  return addYears(scheduledFor, task.recurrence.everyYears, task.recurrence.timezone)
}

function nextYearlyOccurrences(task: ProactivityTask, nowMs: number): { count: number; latest?: string; future: string; all: string[] } {
  if (task.recurrence.kind !== 'yearly') throw new Error('yearly recurrence required')
  let cursor = task.nextRunAt
  let count = 0
  let latest: string | undefined
  const all: string[] = []
  while (Date.parse(cursor) <= nowMs) {
    count += 1
    latest = cursor
    if (all.length < 32) all.push(cursor)
    const next = nextAfter(task, cursor)
    if (next === undefined || Date.parse(next) <= Date.parse(cursor)) throw new Error('yearly recurrence did not advance')
    cursor = next
    if (count >= YEARLY_SEARCH_LIMIT) throw new Error('yearly recurrence catch-up search exceeded safety limit')
  }
  return { count, ...(latest === undefined ? {} : { latest }), future: cursor, all }
}

/** Durable global scheduler used by Phoenix for user-created and autonomous tasks. */
export class ProactivityEngine {
  private state: ProactivitySnapshot | undefined
  private tail: Promise<void> = Promise.resolve()
  private runTail: Promise<void> = Promise.resolve()
  private recovered = false
  private readonly id: () => string
  private readonly maxCatchUpOccurrences: number

  constructor(
    private readonly store: ProactivityStore,
    private readonly executor: ProactivityExecutor,
    options: ProactivityEngineOptions = {},
  ) {
    this.id = options.id ?? randomUUID
    this.maxCatchUpOccurrences = finitePositive(options.maxCatchUpOccurrences ?? 32, 'maxCatchUpOccurrences')
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(operation, operation)
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }

  private async snapshot(): Promise<ProactivitySnapshot> {
    return (this.state ??= await this.store.load())
  }

  private async commit(tasks: readonly ProactivityTask[]): Promise<void> {
    const snapshot: ProactivitySnapshot = { version: 1, tasks: tasks.map(cloneTask) }
    await this.store.save(snapshot)
    this.state = snapshot
  }

  /**
   * Execute proactivity engine create.
   * @param input - The input value.
   * @returns The resulting value.
   */
  async create(input: CreateProactivityTaskInput): Promise<ProactivityTask> {
    return this.exclusive(async () => {
      const snapshot = await this.snapshot()
      const now = new Date().toISOString()
      const recurrence = input.recurrence ?? { kind: 'once' as const }
      if (recurrence.kind === 'interval') finitePositive(recurrence.everyMs, 'recurrence.everyMs')
      if (recurrence.kind === 'yearly') {
        finitePositive(recurrence.everyYears, 'recurrence.everyYears')
        if (recurrence.timezone !== undefined) canonicalTimezone(recurrence.timezone, 'recurrence.timezone')
      }
      if ((input.prepareLeadMs === undefined) !== (input.preparationInstruction === undefined)) {
        throw new Error('preparationInstruction and prepareLeadMs must be supplied together')
      }
      const normalizedRecurrence: ProactivityRecurrence = recurrence.kind === 'yearly'
        ? {
            kind: 'yearly',
            everyYears: recurrence.everyYears,
            ...(recurrence.timezone === undefined ? {} : { timezone: canonicalTimezone(recurrence.timezone, 'recurrence.timezone') }),
          }
        : { ...recurrence }
      const task: ProactivityTask = {
        id: nonEmpty(this.id(), 'id'),
        title: nonEmpty(input.title, 'title'),
        instruction: nonEmpty(input.instruction, 'instruction'),
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
        nextRunAt: iso(input.runAt, 'runAt'),
        recurrence: normalizedRecurrence,
        catchUp: input.catchUp ?? 'latest',
        visibility: input.visibility ?? 'visible',
        ...(input.revealAt === undefined ? {} : { revealAt: iso(input.revealAt, 'revealAt') }),
        ...(input.preparationInstruction === undefined ? {} : { preparationInstruction: nonEmpty(input.preparationInstruction, 'preparationInstruction') }),
        ...(input.prepareLeadMs === undefined ? {} : { prepareLeadMs: finitePositive(input.prepareLeadMs, 'prepareLeadMs') }),
        ...(input.condition === undefined ? {} : { condition: nonEmpty(input.condition, 'condition') }),
        delivery: input.delivery ?? 'chat',
        senderIdentity: input.senderIdentity ?? 'auto',
        ...(input.recipient === undefined ? {} : { recipient: nonEmpty(input.recipient, 'recipient') }),
        ...(input.targetAgentId === undefined ? {} : { targetAgentId: nonEmpty(input.targetAgentId, 'targetAgentId') }),
        status: 'scheduled',
        history: [],
      }
      if (snapshot.tasks.some(candidate => candidate.id === task.id)) throw new Error(`duplicate proactivity task id: ${task.id}`)
      await this.commit([...snapshot.tasks, task])
      return cloneTask(task)
    })
  }

  /**
   * Execute proactivity engine get.
   * @param id - The id value.
   * @returns The resulting value.
   */
  async get(id: string): Promise<ProactivityTask | undefined> {
    return this.exclusive(async () => {
      const task = (await this.snapshot()).tasks.find(candidate => candidate.id === id)
      return task === undefined ? undefined : cloneTask(task)
    })
  }

  /**
   * Execute proactivity engine list.
   * @param options - The options value.
   * @returns The resulting value.
   */
  async list(options: ProactivityListOptions = {}): Promise<ProactivityTask[]> {
    return this.exclusive(async () => {
      const now = (options.now ?? new Date()).getTime()
      return (await this.snapshot()).tasks
        .filter(task => options.includeHidden === true || task.visibility !== 'surprise' || now >= Date.parse(task.revealAt ?? task.nextRunAt))
        .map(cloneTask)
    })
  }

  private async setStatus(id: string, status: 'paused' | 'cancelled' | 'scheduled'): Promise<ProactivityTask> {
    return this.exclusive(async () => {
      const snapshot = await this.snapshot()
      const index = snapshot.tasks.findIndex(task => task.id === id)
      if (index < 0) throw new Error(`unknown proactivity task: ${id}`)
      const current = snapshot.tasks[index]!
      if ((current.status === 'completed' || current.status === 'cancelled') && status !== 'cancelled') {
        throw new Error(`task ${id} is terminal: ${current.status}`)
      }
      const next: ProactivityTask = { ...current, status, updatedAt: new Date().toISOString() }
      const tasks = [...snapshot.tasks]
      tasks[index] = next
      await this.commit(tasks)
      return cloneTask(next)
    })
  }

  /**
   * Execute proactivity engine pause.
   * @param id - The id value.
   * @returns The resulting value.
   */
  pause(id: string): Promise<ProactivityTask> { return this.setStatus(id, 'paused') }
  /**
   * Execute proactivity engine resume.
   * @param id - The id value.
   * @returns The resulting value.
   */
  resume(id: string): Promise<ProactivityTask> { return this.setStatus(id, 'scheduled') }
  /**
   * Execute proactivity engine cancel.
   * @param id - The id value.
   * @returns The resulting value.
   */
  cancel(id: string): Promise<ProactivityTask> { return this.setStatus(id, 'cancelled') }

  private dueOccurrences(task: ProactivityTask, nowMs: number): string[] {
    const nextMs = Date.parse(task.nextRunAt)
    if (nowMs < nextMs) return []
    const recurrence = task.recurrence
    if (recurrence.kind === 'once') return [task.nextRunAt]
    if (recurrence.kind === 'yearly') {
      const scan = nextYearlyOccurrences(task, nowMs)
      if (task.catchUp === 'skip' && scan.count > 1) return []
      if (task.catchUp === 'latest') return scan.latest === undefined ? [] : [scan.latest]
      return scan.all.slice(0, this.maxCatchUpOccurrences)
    }
    const everyMs = recurrence.everyMs
    const missed = Math.floor((nowMs - nextMs) / everyMs)
    if (task.catchUp === 'skip' && missed > 0) return []
    if (task.catchUp === 'latest') return [new Date(nextMs + missed * everyMs).toISOString()]
    const count = Math.min(missed + 1, this.maxCatchUpOccurrences)
    return Array.from({ length: count }, (_, index) => new Date(nextMs + index * everyMs).toISOString())
  }

  private skippedNextRun(task: ProactivityTask, nowMs: number): string | undefined {
    if (task.catchUp !== 'skip') return undefined
    const recurrence = task.recurrence
    if (recurrence.kind === 'once') return undefined
    if (recurrence.kind === 'yearly') {
      const scan = nextYearlyOccurrences(task, nowMs)
      return scan.count > 1 ? scan.future : undefined
    }
    const nextMs = Date.parse(task.nextRunAt)
    const missed = Math.floor((nowMs - nextMs) / recurrence.everyMs)
    if (missed <= 0) return undefined
    return new Date(nextMs + (missed + 1) * recurrence.everyMs).toISOString()
  }

  private async recoverInterrupted(now: Date): Promise<void> {
    if (this.recovered) return
    await this.exclusive(async () => {
      if (this.recovered) return
      const snapshot = await this.snapshot()
      const recovered = snapshot.tasks.map(task => task.status === 'running'
        ? { ...task, status: 'scheduled' as const, updatedAt: now.toISOString() }
        : task)
      if (recovered.some((task, index) => task !== snapshot.tasks[index])) await this.commit(recovered)
      this.recovered = true
    })
  }

  private async executePhase(taskId: string, phase: ProactivityPhase, scheduledFor: string): Promise<ProactivityTask> {
    const startedAt = new Date().toISOString()
    const idempotencyKey = occurrenceKey(taskId, phase, scheduledFor)
    const leased = await this.exclusive(async () => {
      const state = await this.snapshot()
      const current = state.tasks.find(task => task.id === taskId)
      if (current === undefined) throw new Error(`unknown proactivity task: ${taskId}`)
      if (current.status !== 'scheduled' || hasCompleted(current, phase, scheduledFor)) return cloneTask(current)
      const running: ProactivityTask = { ...current, status: 'running', updatedAt: startedAt }
      await this.commit(state.tasks.map(item => item.id === taskId ? running : item))
      return cloneTask(running)
    })

    if (leased.status !== 'running') return leased
    const preparationResult = phase === 'deliver' ? completedSummary(leased, 'prepare', scheduledFor) : undefined

    try {
      const result = await this.executor.execute({
        phase,
        task: cloneTask(leased),
        scheduledFor,
        idempotencyKey,
        instruction: phase === 'prepare' ? leased.preparationInstruction! : leased.instruction,
        ...(preparationResult === undefined ? {} : { preparationResult }),
      })
      const finishedAt = new Date().toISOString()
      return this.exclusive(async () => {
        const state = await this.snapshot()
        const current = state.tasks.find(task => task.id === taskId)
        if (current === undefined) throw new Error(`unknown proactivity task: ${taskId}`)
        const externallyStopped = current.status === 'cancelled' || current.status === 'paused'
        const next: ProactivityTask = {
          ...current,
          status: externallyStopped ? current.status : result.terminal === true ? 'completed' : 'scheduled',
          updatedAt: finishedAt,
          history: [...current.history, {
            phase, scheduledFor, idempotencyKey, startedAt, finishedAt, status: 'completed',
            ...(result.summary === undefined ? {} : { summary: result.summary }),
          }],
        }
        await this.commit(state.tasks.map(item => item.id === taskId ? next : item))
        return cloneTask(next)
      })
    } catch (error: unknown) {
      if (error instanceof ProactivityDeferredError) {
        return this.exclusive(async () => {
          const state = await this.snapshot()
          const current = state.tasks.find(task => task.id === taskId)
          if (current === undefined) throw new Error(`unknown proactivity task: ${taskId}`)
          if (current.status !== 'running') return cloneTask(current)
          const next: ProactivityTask = { ...current, status: 'scheduled', updatedAt: new Date().toISOString() }
          await this.commit(state.tasks.map(item => item.id === taskId ? next : item))
          return cloneTask(next)
        })
      }
      const finishedAt = new Date().toISOString()
      const message = error instanceof Error ? error.message : String(error)
      return this.exclusive(async () => {
        const state = await this.snapshot()
        const current = state.tasks.find(task => task.id === taskId)
        if (current === undefined) throw new Error(`unknown proactivity task: ${taskId}`)
        const externallyStopped = current.status === 'cancelled' || current.status === 'paused'
        const next: ProactivityTask = {
          ...current,
          status: externallyStopped ? current.status : 'failed',
          updatedAt: finishedAt,
          history: [...current.history, {
            phase, scheduledFor, idempotencyKey, startedAt, finishedAt, status: 'failed', error: message,
          }],
        }
        await this.commit(state.tasks.map(item => item.id === taskId ? next : item))
        return cloneTask(next)
      })
    }
  }

  private async advanceAfterDelivery(taskId: string, scheduledFor: string, now: Date): Promise<ProactivityTask> {
    return this.exclusive(async () => {
      const state = await this.snapshot()
      const current = state.tasks.find(task => task.id === taskId)
      if (current === undefined) throw new Error(`unknown proactivity task: ${taskId}`)
      if (current.status !== 'scheduled' || !hasCompleted(current, 'deliver', scheduledFor)) return cloneTask(current)
      const nextRunAt = nextAfter(current, scheduledFor)
      const next: ProactivityTask = nextRunAt === undefined
        ? { ...current, status: 'completed', updatedAt: now.toISOString() }
        : { ...current, nextRunAt, updatedAt: now.toISOString() }
      await this.commit(state.tasks.map(item => item.id === taskId ? next : item))
      return cloneTask(next)
    })
  }

  private async skipMissed(taskId: string, nextRunAt: string, now: Date): Promise<void> {
    await this.exclusive(async () => {
      const state = await this.snapshot()
      const current = state.tasks.find(task => task.id === taskId)
      if (current === undefined || current.status !== 'scheduled') return
      const next: ProactivityTask = { ...current, nextRunAt, updatedAt: now.toISOString() }
      await this.commit(state.tasks.map(item => item.id === taskId ? next : item))
    })
  }

  private async prepareIfDue(task: ProactivityTask, scheduledFor: string, nowMs: number): Promise<ProactivityTask> {
    if (task.preparationInstruction === undefined || task.prepareLeadMs === undefined) return task
    if (nowMs < Date.parse(scheduledFor) - task.prepareLeadMs) return task
    return this.executePhase(task.id, 'prepare', scheduledFor)
  }

  private async runDuePass(now: Date): Promise<void> {
    const nowMs = now.getTime()
    if (!Number.isFinite(nowMs)) throw new Error('now must be a valid date')
    await this.recoverInterrupted(now)
    const ids = await this.exclusive(async () => (await this.snapshot()).tasks.map(task => task.id))

    for (const id of ids) {
      let task = await this.get(id)
      if (task === undefined || task.status !== 'scheduled') continue

      const skipped = this.skippedNextRun(task, nowMs)
      if (skipped !== undefined) {
        await this.skipMissed(id, skipped, now)
        continue
      }

      const due = this.dueOccurrences(task, nowMs)
      if (due.length === 0) {
        await this.prepareIfDue(task, task.nextRunAt, nowMs)
        continue
      }

      for (const scheduledFor of due) {
        task = await this.get(id)
        if (task === undefined || task.status !== 'scheduled') break
        task = await this.prepareIfDue(task, scheduledFor, nowMs)
        if (task.status !== 'scheduled') break
        task = await this.executePhase(id, 'deliver', scheduledFor)
        if (task.status !== 'scheduled') break
        task = await this.advanceAfterDelivery(id, scheduledFor, now)
        if (task.status === 'completed') break
      }
    }
  }

  /**
   * Execute currently due work. Due-pass serialization is separate from the
   * ledger mutex, so active agents can safely list/create/cancel tasks while a
   * scheduled execution is awaiting model/tool work.
   * @param now - The now value.
   */
  runDue(now: Date = new Date()): Promise<void> {
    const run = this.runTail.then(() => this.runDuePass(now), () => this.runDuePass(now))
    this.runTail = run.then(() => undefined, () => undefined)
    return run
  }
}
