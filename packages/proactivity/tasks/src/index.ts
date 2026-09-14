/**
 * Durable global task/proactivity service. Unlike session-local Schedule, this
 * state survives process shutdown and intentionally performs restart catch-up.
 * @module @phoenix-ai/dsh-tasks
 */
import { Context, Service } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { defineTool } from '@phoenix-ai/dsh-tools'
import { advanceAfter, dueOccurrences, initialNextRunAt, nextAnnualEpoch, userView } from './domain.ts'
import type {
  CatchUpPolicy, SenderIdentity, TaskDelivery, TaskOrigin, TaskRecord, TaskRunRecord,
  TaskSchedule, TaskState, TaskStoreDocument, TaskVisibility, UserTaskView,
} from './types.ts'

export * from './domain.ts'
export type * from './types.ts'

declare module '@phoenix-ai/cordis' {
  interface Context { tasks: TaskService }
}

export interface Config {
  path: string
  pollMs?: number
  historyLimit?: number
}

export const Config: z<Config> = z.object({
  path: z.string().required(),
  pollMs: z.number().step(1).min(250).default(5_000),
  historyLimit: z.number().step(1).min(100).default(5_000),
})

export interface CreateTaskInput {
  title: string
  prompt: string
  schedule: TaskSchedule
  origin?: TaskOrigin
  visibility?: TaskVisibility
  revealAt?: string
  catchUp?: CatchUpPolicy
  delivery?: TaskDelivery
  senderIdentity?: SenderIdentity
  emailTo?: string
  emailSubject?: string
  parentTaskId?: string
  tags?: string[]
}

const EMPTY: TaskStoreDocument = { version: 1, sequence: 0, tasks: [], runs: [] }
const MAX_TIMER = 2_147_483_647

function cloneStore(value: TaskStoreDocument): TaskStoreDocument {
  return structuredClone(value)
}

function cleanText(value: string, name: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new TypeError(`${name} must be non-empty`)
  return trimmed
}

function parseFutureIso(value: string, name: string): string {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) throw new TypeError(`${name} must be an RFC 3339 date-time`)
  return new Date(ms).toISOString()
}

function taskPublicJson(value: UserTaskView | undefined): unknown {
  return value ?? { hidden: true }
}

function jsonOutput(_args: unknown, value: unknown) {
  return [{ type: 'text' as const, text: JSON.stringify(value) }]
}

/** One owner-local durable task service. */
export class TaskService extends Service {
  static inject = ['agents', 'tools']
  static Config = Config

  private readonly path: string
  private readonly pollMs: number
  private readonly historyLimit: number
  private store: TaskStoreDocument = cloneStore(EMPTY)
  private readyPromise: Promise<void> = Promise.resolve()
  private mutationTail: Promise<void> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | undefined
  private agents = new Set<Agent>()
  private stopped = false

  constructor(ctx: Context, config: Config) {
    super(ctx, 'tasks')
    this.path = config.path
    this.pollMs = config.pollMs ?? 5_000
    this.historyLimit = config.historyLimit ?? 5_000
  }

  protected async [Service.init](): Promise<void> {
    this.readyPromise = this.load()
    await this.readyPromise
    for (const agent of this.ctx.agents.roots()) this.attachAgent(agent)
    const stopCreated = this.ctx.on('agent/created', ({ agent }) => {
      if (this.ctx.agents.roots().includes(agent)) this.attachAgent(agent)
    })
    this.ctx.effect(() => async () => {
      this.stopped = true
      stopCreated()
      if (this.timer !== undefined) clearTimeout(this.timer)
      await this.mutationTail
    }, 'tasks.lifecycle')
    this.requestDrive(0)
  }

  async ready(): Promise<void> { await this.readyPromise; await this.mutationTail }

  list(options: { includeInternal?: boolean; now?: number } = {}): UserTaskView[] {
    const now = options.now ?? Date.now()
    if (options.includeInternal) {
      return this.store.tasks.map(task => ({
        id: task.id, title: task.title, prompt: task.prompt, state: task.state, origin: task.origin,
        nextRunAt: task.nextRunAt, schedule: task.schedule, delivery: task.delivery, hidden: false,
        senderIdentity: task.senderIdentity,
        ...(task.revealAt === undefined ? {} : { revealAt: task.revealAt }),
        ...(task.emailTo === undefined ? {} : { emailTo: task.emailTo }),
        ...(task.tags === undefined ? {} : { tags: [...task.tags] }),
      }))
    }
    return this.store.tasks.map(task => userView(task, now)).filter((value): value is UserTaskView => value !== undefined)
  }

  history(taskId?: string): TaskRunRecord[] {
    return this.store.runs.filter(run => taskId === undefined || run.taskId === taskId).map(run => ({ ...run }))
  }

  create(input: CreateTaskInput): Promise<TaskRecord> {
    return this.serial(async () => {
      const now = Date.now()
      const createdAt = new Date(now).toISOString()
      const title = cleanText(input.title, 'title')
      const prompt = cleanText(input.prompt, 'prompt')
      const revealAt = input.revealAt === undefined ? undefined : parseFutureIso(input.revealAt, 'revealAt')
      const schedule = structuredClone(input.schedule)
      const nextRunAt = initialNextRunAt(schedule, now)
      this.store.sequence += 1
      const task: TaskRecord = {
        id: `task-${this.store.sequence}`, title, prompt, state: 'scheduled', origin: input.origin ?? 'user',
        visibility: input.visibility ?? 'normal', catchUp: input.catchUp ?? 'latest',
        delivery: input.delivery ?? 'chat', senderIdentity: input.senderIdentity ?? 'auto',
        schedule, nextRunAt, createdAt, updatedAt: createdAt, consecutiveFailures: 0,
        ...(revealAt === undefined ? {} : { revealAt }),
        ...(input.emailTo === undefined ? {} : { emailTo: cleanText(input.emailTo, 'emailTo') }),
        ...(input.emailSubject === undefined ? {} : { emailSubject: cleanText(input.emailSubject, 'emailSubject') }),
        ...(input.parentTaskId === undefined ? {} : { parentTaskId: input.parentTaskId }),
        ...(input.tags === undefined ? {} : { tags: [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))] }),
      }
      this.store.tasks.push(task)
      await this.persist()
      this.requestDrive(0)
      return structuredClone(task)
    })
  }

  createSurprise(input: Omit<CreateTaskInput, 'visibility' | 'origin' | 'schedule'> & { revealAt: string; prepareBeforeDays?: number[] }): Promise<TaskRecord[]> {
    return this.serial(async () => {
      const revealAt = parseFutureIso(input.revealAt, 'revealAt')
      const revealMs = Date.parse(revealAt)
      const records: TaskRecord[] = []
      const days = [...new Set(input.prepareBeforeDays ?? [14, 7, 1])]
        .filter(day => Number.isSafeInteger(day) && day > 0).sort((a, b) => b - a)
      let parentId: string | undefined
      for (const day of days) {
        const at = revealMs - day * 86_400_000
        if (at <= Date.now()) continue
        const record = await this.createUnsafe({
          title: `Preparar sorpresa: ${input.title}`,
          prompt: `Trabaja en segundo plano en la sorpresa "${input.title}". ${input.prompt}`,
          schedule: { kind: 'once', at: new Date(at).toISOString() }, origin: 'phoenix', visibility: 'internal',
          catchUp: 'latest', delivery: 'chat', senderIdentity: input.senderIdentity ?? 'phoenix',
          ...(parentId === undefined ? {} : { parentTaskId: parentId }), tags: ['surprise', 'preparation'],
        })
        parentId ??= record.id
        records.push(record)
      }
      const reveal = await this.createUnsafe({
        ...input, schedule: { kind: 'once', at: revealAt }, origin: 'phoenix', visibility: 'hidden_until_reveal',
        revealAt, parentTaskId: parentId, tags: [...(input.tags ?? []), 'surprise', 'reveal'],
      })
      records.push(reveal)
      await this.persist()
      this.requestDrive(0)
      return records.map(record => structuredClone(record))
    })
  }

  setState(id: string, state: Extract<TaskState, 'paused' | 'scheduled'>): Promise<boolean> {
    return this.serial(async () => {
      const task = this.store.tasks.find(candidate => candidate.id === id)
      if (task === undefined) return false
      task.state = state
      task.updatedAt = new Date().toISOString()
      await this.persist(); this.requestDrive(0); return true
    })
  }

  cancel(id: string): Promise<boolean> {
    return this.serial(async () => {
      const before = this.store.tasks.length
      this.store.tasks = this.store.tasks.filter(task => task.id !== id && task.parentTaskId !== id)
      if (this.store.tasks.length === before) return false
      await this.persist(); this.requestDrive(0); return true
    })
  }

  private async createUnsafe(input: CreateTaskInput): Promise<TaskRecord> {
    const now = Date.now(); const createdAt = new Date(now).toISOString()
    this.store.sequence += 1
    const record: TaskRecord = {
      id: `task-${this.store.sequence}`, title: cleanText(input.title, 'title'), prompt: cleanText(input.prompt, 'prompt'),
      state: 'scheduled', origin: input.origin ?? 'user', visibility: input.visibility ?? 'normal',
      catchUp: input.catchUp ?? 'latest', delivery: input.delivery ?? 'chat', senderIdentity: input.senderIdentity ?? 'auto',
      schedule: structuredClone(input.schedule), nextRunAt: initialNextRunAt(input.schedule, now), createdAt, updatedAt: createdAt,
      consecutiveFailures: 0,
      ...(input.revealAt === undefined ? {} : { revealAt: parseFutureIso(input.revealAt, 'revealAt') }),
      ...(input.emailTo === undefined ? {} : { emailTo: input.emailTo }),
      ...(input.emailSubject === undefined ? {} : { emailSubject: input.emailSubject }),
      ...(input.parentTaskId === undefined ? {} : { parentTaskId: input.parentTaskId }),
      ...(input.tags === undefined ? {} : { tags: [...input.tags] }),
    }
    this.store.tasks.push(record); return record
  }

  private attachAgent(agent: Agent): void {
    if (this.agents.has(agent)) return
    this.agents.add(agent)
    agent.ctx.effect(() => {
      const dispose = this.registerTools(agent)
      this.requestDrive(0)
      return () => { dispose(); this.agents.delete(agent) }
    }, 'tasks.agent')
  }

  private registerTools(agent: Agent): () => void {
    const disposers: Array<() => void> = []
    const present = (title: string) => ({ card: 'generic' as const, title, kind: 'other' as const })
    const schema = { type: 'object', additionalProperties: true } as const
    const arraySchema = { type: 'array', items: schema } as const
    disposers.push(agent.ctx.tools.register(defineTool({
      name: 'task_create',
      description: 'Create a durable Phoenix task that survives shutdown. Use exactly one of at, every_seconds, or annual. Catch-up defaults to latest after an offline period.',
      parameters: {
        title: { type: 'string', required: true }, prompt: { type: 'string', required: true },
        at: { type: 'string' }, every_seconds: { type: 'number' },
        annual: { type: 'object', additionalProperties: false, properties: {
          month: { type: 'number', required: true }, day: { type: 'number', required: true }, hour: { type: 'number', required: true }, minute: { type: 'number', required: true }, time_zone: { type: 'string', required: true },
        } },
        catch_up: { type: 'string', enum: ['latest', 'all', 'skip'] },
        delivery: { type: 'string', enum: ['chat', 'email', 'chat_and_email'] },
        sender_identity: { type: 'string', enum: ['user', 'phoenix', 'auto'] }, email_to: { type: 'string' }, email_subject: { type: 'string' },
      }, output: { schema, render: jsonOutput },
      execute: async (args) => {
        const selectors = Number(args.at !== undefined) + Number(args.every_seconds !== undefined) + Number(args.annual !== undefined)
        if (selectors !== 1) return { error: 'exactly one schedule selector is required' }
        let schedule: TaskSchedule
        if (args.at !== undefined) schedule = { kind: 'once', at: args.at }
        else if (args.every_seconds !== undefined) schedule = { kind: 'interval', anchorAt: new Date().toISOString(), everySeconds: args.every_seconds }
        else schedule = { kind: 'annual', month: args.annual!.month, day: args.annual!.day, hour: args.annual!.hour, minute: args.annual!.minute, timeZone: args.annual!.time_zone }
        try {
          const record = await this.create({ title: args.title, prompt: args.prompt, schedule, origin: 'phoenix', catchUp: args.catch_up as CatchUpPolicy | undefined, delivery: args.delivery as TaskDelivery | undefined, senderIdentity: args.sender_identity as SenderIdentity | undefined, emailTo: args.email_to, emailSubject: args.email_subject })
          return taskPublicJson(userView(record, Date.now()))
        } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
      }, presentCall: () => present('Create durable task'),
    })))
    disposers.push(agent.ctx.tools.register(defineTool({
      name: 'task_create_surprise',
      description: 'Privately prepare a Phoenix surprise before reveal_at, then reveal it at the requested time. Preparation details stay out of the user-facing task list.',
      parameters: { title: { type: 'string', required: true }, prompt: { type: 'string', required: true }, reveal_at: { type: 'string', required: true }, email_to: { type: 'string' }, delivery: { type: 'string', enum: ['chat', 'email', 'chat_and_email'] } },
      output: { schema: arraySchema, render: jsonOutput },
      execute: async (args) => (await this.createSurprise({ title: args.title, prompt: args.prompt, revealAt: args.reveal_at, delivery: args.delivery as TaskDelivery | undefined, emailTo: args.email_to, senderIdentity: 'phoenix' })).map(record => taskPublicJson(userView(record, Date.now()))),
      presentCall: () => present('Prepare surprise'),
    })))
    disposers.push(agent.ctx.tools.register(defineTool({
      name: 'task_list', description: 'List durable Phoenix tasks. Internal preparation tasks are omitted and unrevealed surprises are redacted.', parameters: {},
      output: { schema: arraySchema, render: jsonOutput }, execute: async () => this.list(), presentCall: () => ({ card: 'generic', title: 'List tasks', kind: 'read' }),
    })))
    disposers.push(agent.ctx.tools.register(defineTool({
      name: 'task_history', description: 'Read durable task execution history.', parameters: { task_id: { type: 'string' } },
      output: { schema: arraySchema, render: jsonOutput }, execute: async args => this.history(args.task_id), presentCall: () => ({ card: 'generic', title: 'Task history', kind: 'read' }),
    })))
    disposers.push(agent.ctx.tools.register(defineTool({
      name: 'task_cancel', description: 'Cancel a durable task and its direct child preparation tasks.', parameters: { id: { type: 'string', required: true } },
      output: { schema, render: jsonOutput }, execute: async args => ({ id: args.id, cancelled: await this.cancel(args.id) }), presentCall: () => present('Cancel task'),
    })))
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }

  private async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as TaskStoreDocument
      if (parsed.version !== 1 || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.runs)) throw new Error('unsupported task store')
      this.store = parsed
      const now = new Date().toISOString()
      for (const run of this.store.runs) if (run.status === 'running') { run.status = 'failed'; run.finishedAt = now; run.error = 'Phoenix restarted before the occurrence settled; eligible for retry.' }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.ctx.logger.warn(`tasks: could not load durable store: ${String(error)}`)
      this.store = cloneStore(EMPTY)
    }
    await this.persist()
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation)
    this.mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    this.store.runs = this.store.runs.slice(-this.historyLimit)
    const temporary = `${this.path}.tmp-${process.pid}`
    await writeFile(temporary, `${JSON.stringify(this.store, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.path)
  }

  private requestDrive(delay: number): void {
    if (this.stopped) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = undefined; void this.drive() }, Math.max(0, Math.min(delay, MAX_TIMER)))
  }

  private async drive(): Promise<void> {
    if (this.stopped) return
    await this.serial(async () => {
      const now = Date.now()
      const scheduled = this.store.tasks.filter(task => task.state === 'scheduled')
      const due = scheduled.flatMap(task => dueOccurrences(task, this.store.runs, now)).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
      if (due.length > 0) {
        const target = due[0]!
        const agent = [...this.agents].find(candidate => this.ctx.agents.get(candidate.id) === candidate && this.ctx.agents.roots().includes(candidate))
        if (agent === undefined) return
        const task = this.store.tasks.find(candidate => candidate.id === target.task.id)
        if (task === undefined || task.state !== 'scheduled') return
        task.state = 'running'; task.updatedAt = new Date().toISOString()
        const run: TaskRunRecord = { occurrenceId: target.occurrenceId, taskId: task.id, dueAt: target.dueAt, status: 'running', startedAt: new Date().toISOString() }
        this.store.runs.push(run); await this.persist()
        try {
          await agent.runMaintenance(async () => {
            const channel = task.delivery === 'chat' ? 'Tell the user in Phoenix chat.' : task.delivery === 'email' ? 'Send the user an email using the configured mail tools.' : 'Tell the user in chat and also send an email using the configured mail tools.'
            const identity = task.senderIdentity === 'user' ? 'Use the user mail identity.' : task.senderIdentity === 'phoenix' ? 'Use the Phoenix/harness mail identity.' : 'Choose the configured identity appropriate to the task.'
            const email = task.emailTo === undefined ? '' : ` Email recipient: ${task.emailTo}.`
            const subject = task.emailSubject === undefined ? '' : ` Email subject: ${task.emailSubject}.`
            const message = createUserMessage({ content: [{ type: 'text', text: `[PHOENIX DURABLE TASK]\nTask: ${task.title}\nDue occurrence: ${target.dueAt}\n${task.prompt}\nDelivery: ${channel} ${identity}${email}${subject}\nUse only currently authorized tools and permissions. If an external action requires approval or credentials, explain the block instead of bypassing it.` }], source: { kind: 'plugin', plugin: 'tasks' } })
            agent.followup(message)
          })
          run.status = 'completed'; run.finishedAt = new Date().toISOString()
          Object.assign(task, advanceAfter({ ...task, state: 'scheduled' }, target.dueAt, Date.now()), { consecutiveFailures: 0 })
        } catch (error: unknown) {
          run.status = 'failed'; run.finishedAt = new Date().toISOString(); run.error = error instanceof Error ? error.message : String(error)
          task.state = 'scheduled'; task.consecutiveFailures += 1; task.updatedAt = new Date().toISOString()
        }
        await this.persist()
      }
    })
    const now = Date.now()
    const next = this.store.tasks.filter(task => task.state === 'scheduled').reduce<number | undefined>((best, task) => {
      const at = Date.parse(task.nextRunAt); return Number.isFinite(at) && (best === undefined || at < best) ? at : best
    }, undefined)
    const delay = next === undefined ? this.pollMs : next <= now ? this.pollMs : Math.min(next - now, this.pollMs)
    this.requestDrive(delay)
  }
}

export default TaskService
