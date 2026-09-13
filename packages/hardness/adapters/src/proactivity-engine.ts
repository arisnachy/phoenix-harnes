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

/** Supported recurrence forms. Interval schedules stay anchored to the original due-time sequence. */
export type ProactivityRecurrence =
  | { readonly kind: 'once' }
  | { readonly kind: 'interval'; readonly everyMs: number }

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
}

/** Host seam used by the pure scheduler to perform work. */
export interface ProactivityExecutor {
  /**
   * Execute one phase. Providers should treat `idempotencyKey` as the stable
   * occurrence identity when their downstream action supports deduplication.
   * @param input - task, phase, occurrence and prior preparation result.
   * @returns secret-free summary safe to persist.
   */
  execute(input: ProactivityExecution): Promise<ProactivityExecutionResult>
}

/** Persistent snapshot format owned by this engine. */
export interface ProactivitySnapshot {
  readonly version: 1
  readonly tasks: readonly ProactivityTask[]
}

/** Storage seam for the durable global task ledger. */
export interface ProactivityStore {
  /** @returns the last committed task snapshot. */
  load(): Promise<ProactivitySnapshot>
  /** @param snapshot - complete next committed task snapshot. */
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

/**
 * Signal that execution cannot proceed yet because its live runtime dependency
 * is absent. The occurrence remains scheduled and accumulates no failure row.
 */
export class ProactivityDeferredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProactivityDeferredError'
  }
}

const EMPTY_SNAPSHOT: ProactivitySnapshot = { version: 1, tasks: [] }

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

function cloneTask(task: ProactivityTask): ProactivityTask {
  return {
    ...task,
    recurrence: { ...task.recurrence },
    history: task.history.map(entry => ({ ...entry })),
  }
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
  const recurrence: ProactivityRecurrence = raw.recurrence.kind === 'once'
    ? { kind: 'once' }
    : raw.recurrence.kind === 'interval' && typeof raw.recurrence.everyMs === 'number'
      ? { kind: 'interval', everyMs: finitePositive(raw.recurrence.everyMs, 'recurrence.everyMs') }
      : (() => { throw new Error('invalid proactivity recurrence') })()
  if (raw.revealAt !== undefined && typeof raw.revealAt !== 'string') throw new Error('invalid revealAt')
  if (raw.preparationInstruction !== undefined && typeof raw.preparationInstruction !== 'string') throw new Error('invalid preparationInstruction')
  if (raw.prepareLeadMs !== undefined && typeof raw.prepareLeadMs !== 'number') throw new Error('invalid prepareLeadMs')
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

  /** @returns a defensive copy of the committed snapshot. */
  async load(): Promise<ProactivitySnapshot> {
    return { version: 1, tasks: this.snapshot.tasks.map(cloneTask) }
  }

  /** @param snapshot - snapshot to retain defensively. */
  async save(snapshot: ProactivitySnapshot): Promise<void> {
    this.snapshot = { version: 1, tasks: snapshot.tasks.map(cloneTask) }
  }
}

/** Atomic JSON-file store for the harness-global task ledger. */
export class JsonProactivityStore implements ProactivityStore {
  constructor(private readonly path: string) {
    nonEmpty(path, 'path')
  }

  /** @returns validated persisted state, or an empty ledger when the file has never existed. */
  async load(): Promise<ProactivitySnapshot> {
    try {
      const text = await readFile(this.path, 'utf8')
      return parseSnapshot(JSON.parse(text) as unknown)
    } catch (error: unknown) {
      if (isRecord(error) && error.code === 'ENOENT') return EMPTY_SNAPSHOT
      throw error
    }
  }

  /** Persist with write-then-rename so a crash cannot expose a partial JSON document. */
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
  return new Date(Date.parse(scheduledFor) + task.recurrence.everyMs).toISOString()
}

/** Durable global scheduler used by Phoenix for user-created and autonomous tasks. */
export class ProactivityEngine {
  private state: ProactivitySnapshot | undefined
  private tail: Promise<void> = Promise.resolve()
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

  /** Create and durably commit a task before returning it. */
  async create(input: CreateProactivityTaskInput): Promise<ProactivityTask> {
    return this.exclusive(async () => {
      const snapshot = await this.snapshot()
      const now = new Date().toISOString()
      const nextRunAt = iso(input.runAt, 'runAt')
      const recurrence = input.recurrence ?? { kind: 'once' as const }
      if (recurrence.kind === 'interval') finitePositive(recurrence.everyMs, 'recurrence.everyMs')
      if (input.prepareLeadMs !== undefined && input.preparationInstruction === undefined) {
        throw new Error('prepareLeadMs requires preparationInstruction')
      }
      if (input.preparationInstruction !== undefined && input.prepareLeadMs === undefined) {
        throw new Error('preparationInstruction requires prepareLeadMs')
      }
      const task: ProactivityTask = {
        id: nonEmpty(this.id(), 'id'),
        title: nonEmpty(input.title, 'title'),
        instruction: nonEmpty(input.instruction, 'instruction'),
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
        nextRunAt,
        recurrence: { ...recurrence },
        catchUp: input.catchUp ?? 'latest',
        visibility: input.visibility ?? 'visible',
        ...(input.revealAt === undefined ? {} : { revealAt: iso(input.revealAt, 'revealAt') }),
        ...(input.preparationInstruction === undefined ? {} : { preparationInstruction: nonEmpty(input.preparationInstruction, 'preparationInstruction') }),
        ...(input.prepareLeadMs === undefined ? {} : { prepareLeadMs: finitePositive(input.prepareLeadMs, 'prepareLeadMs') }),
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

  /** Return one task, including private details for host-side management. */
  async get(id: string): Promise<ProactivityTask | undefined> {
    return this.exclusive(async () => cloneTask((await this.snapshot()).tasks.find(task => task.id === id) ?? undefined as never))
      .catch((error: unknown) => {
        if (error instanceof TypeError) return undefined
        throw error
      })
  }

  /** List tasks, omitting unrevealed surprises unless the caller explicitly requests host-audit visibility. */
  async list(options: ProactivityListOptions = {}): Promise<ProactivityTask[]> {
    return this.exclusive(async () => {
      const now = (options.now ?? new Date()).getTime()
      return (await this.snapshot()).tasks
        .filter((task) => options.includeHidden === true
          || task.visibility !== 'surprise'
          || now >= Date.parse(task.revealAt ?? task.nextRunAt))
        .map(cloneTask)
    })
  }

  private async setStatus(id: string, status: 'paused' | 'cancelled' | 'scheduled'): Promise<ProactivityTask> {
    return this.exclusive(async () => {
      const snapshot = await this.snapshot()
      const index = snapshot.tasks.findIndex(task => task.id === id)
      if (index < 0) throw new Error(`unknown proactivity task: ${id}`)
      const current = snapshot.tasks[index]!
      if (current.status === 'completed' || current.status === 'cancelled') {
        if (status !== 'cancelled') throw new Error(`task ${id} is terminal: ${current.status}`)
      }
      const next: ProactivityTask = { ...current, status, updatedAt: new Date().toISOString() }
      const tasks = [...snapshot.tasks]
      tasks[index] = next
      await this.commit(tasks)
      return cloneTask(next)
    })
  }

  /** Pause future execution without changing the schedule anchor. */
  pause(id: string): Promise<ProactivityTask> { return this.setStatus(id, 'paused') }
  /** Resume a paused or failed task at its existing occurrence. */
  resume(id: string): Promise<ProactivityTask> { return this.setStatus(id, 'scheduled') }
  /** Cancel a task permanently. */
  cancel(id: string): Promise<ProactivityTask> { return this.setStatus(id, 'cancelled') }

  private dueOccurrences(task: ProactivityTask, nowMs: number): string[] {
    const nextMs = Date.parse(task.nextRunAt)
    if (nowMs < nextMs) return []
    if (task.recurrence.kind === 'once') return [task.nextRunAt]
    const missed = Math.floor((nowMs - nextMs) / task.recurrence.everyMs)
    if (task.catchUp === 'skip' && missed > 0) return []
    if (task.catchUp === 'latest') return [new Date(nextMs + missed * task.recurrence.everyMs).toISOString()]
    const count = Math.min(missed + 1, this.maxCatchUpOccurrences)
    return Array.from({ length: count }, (_, index) => new Date(nextMs + index * task.recurrence.everyMs).toISOString())
  }

  private skippedNextRun(task: ProactivityTask, nowMs: number): string | undefined {
    if (task.recurrence.kind !== 'interval' || task.catchUp !== 'skip') return undefined
    const nextMs = Date.parse(task.nextRunAt)
    const missed = Math.floor((nowMs - nextMs) / task.recurrence.everyMs)
    if (missed <= 0) return undefined
    return new Date(nextMs + (missed + 1) * task.recurrence.everyMs).toISOString()
  }

  private async executePhase(task: ProactivityTask, phase: ProactivityPhase, scheduledFor: string): Promise<ProactivityTask> {
    if (hasCompleted(task, phase, scheduledFor)) return task
    const startedAt = new Date().toISOString()
    const idempotencyKey = occurrenceKey(task.id, phase, scheduledFor)
    const running: ProactivityTask = { ...task, status: 'running', updatedAt: startedAt }
    const state = await this.snapshot()
    await this.commit(state.tasks.map(item => item.id === task.id ? running : item))
    try {
      const preparationResult = phase === 'deliver' ? completedSummary(running, 'prepare', scheduledFor) : undefined
      const result = await this.executor.execute({
        phase,
        task: cloneTask(running),
        scheduledFor,
        idempotencyKey,
        instruction: phase === 'prepare' ? running.preparationInstruction! : running.instruction,
        ...(preparationResult === undefined ? {} : { preparationResult }),
      })
      const finishedAt = new Date().toISOString()
      return {
        ...running,
        status: 'scheduled',
        updatedAt: finishedAt,
        history: [...running.history, {
          phase,
          scheduledFor,
          idempotencyKey,
          startedAt,
          finishedAt,
          status: 'completed',
          ...(result.summary === undefined ? {} : { summary: result.summary }),
        }],
      }
    } catch (error: unknown) {
      if (error instanceof ProactivityDeferredError) return { ...task, status: 'scheduled' }
      const finishedAt = new Date().toISOString()
      const message = error instanceof Error ? error.message : String(error)
      return {
        ...running,
        status: 'failed',
        updatedAt: finishedAt,
        history: [...running.history, {
          phase,
          scheduledFor,
          idempotencyKey,
          startedAt,
          finishedAt,
          status: 'failed',
          error: message,
        }],
      }
    }
  }

  private async persistTask(task: ProactivityTask): Promise<void> {
    const state = await this.snapshot()
    await this.commit(state.tasks.map(item => item.id === task.id ? task : item))
  }

  private async prepareIfDue(task: ProactivityTask, scheduledFor: string, nowMs: number): Promise<ProactivityTask> {
    if (task.preparationInstruction === undefined || task.prepareLeadMs === undefined) return task
    if (nowMs < Date.parse(scheduledFor) - task.prepareLeadMs) return task
    const prepared = await this.executePhase(task, 'prepare', scheduledFor)
    await this.persistTask(prepared)
    return prepared
  }

  /**
   * Execute every currently due task under a single engine transaction. Running
   * rows left by a process crash are treated as at-least-once retries with the
   * same idempotency key; downstream providers can therefore suppress duplicates.
   * @param now - wall-clock instant used for due/catch-up decisions.
   */
  async runDue(now: Date = new Date()): Promise<void> {
    return this.exclusive(async () => {
      let snapshot = await this.snapshot()
      const nowMs = now.getTime()
      if (!Number.isFinite(nowMs)) throw new Error('now must be a valid date')

      const recovered = snapshot.tasks.map(task => task.status === 'running'
        ? { ...task, status: 'scheduled' as const, updatedAt: now.toISOString() }
        : task)
      if (recovered.some((task, index) => task !== snapshot.tasks[index])) {
        await this.commit(recovered)
        snapshot = await this.snapshot()
      }

      for (const initial of snapshot.tasks) {
        let task = (await this.snapshot()).tasks.find(candidate => candidate.id === initial.id)!
        if (task.status !== 'scheduled') continue

        const skipped = this.skippedNextRun(task, nowMs)
        if (skipped !== undefined) {
          task = { ...task, nextRunAt: skipped, updatedAt: now.toISOString() }
          await this.persistTask(task)
          continue
        }

        const due = this.dueOccurrences(task, nowMs)
        if (due.length === 0) {
          task = await this.prepareIfDue(task, task.nextRunAt, nowMs)
          if (task.status !== 'scheduled') await this.persistTask(task)
          continue
        }

        for (const scheduledFor of due) {
          task = await this.prepareIfDue(task, scheduledFor, nowMs)
          if (task.status !== 'scheduled') break
          task = await this.executePhase(task, 'deliver', scheduledFor)
          if (task.status !== 'scheduled') {
            await this.persistTask(task)
            break
          }
          const next = nextAfter(task, scheduledFor)
          task = next === undefined
            ? { ...task, status: 'completed', updatedAt: now.toISOString() }
            : { ...task, nextRunAt: next, updatedAt: now.toISOString() }
          await this.persistTask(task)
          if (task.status === 'completed') break
        }
      }
    })
  }
}
