import {
  defineTool,
  ToolArgsError,
  type JsonValue,
  type ToolDefinition,
  type ToolRunContext,
} from '@phoenix-ai/dsh-tools'
import type { ProactivityEngine, ProactivityRecurrence, ProactivityTask } from './proactivity-engine.ts'

/** Optional integrations used by the model-facing proactivity tools. */
export interface ProactivityToolOptions {
  readonly resolveDefaultEmailRecipient?: () => Promise<string | undefined>
}

function minutesToMs(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value <= 0) throw new ToolArgsError([`${field} must be greater than zero`])
  const ms = Math.round(value * 60_000)
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new ToolArgsError([`${field} is outside the supported range`])
  return ms
}

function positiveInteger(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value <= 0) throw new ToolArgsError([`${field} must be a positive integer`])
  return value
}

function recurrenceView(recurrence: ProactivityRecurrence): JsonValue {
  if (recurrence.kind === 'once') return { kind: 'once' }
  if (recurrence.kind === 'interval') return { kind: 'interval', every_ms: recurrence.everyMs }
  return {
    kind: 'yearly',
    every_years: recurrence.everyYears,
    ...(recurrence.timezone === undefined ? {} : { timezone: recurrence.timezone }),
  }
}

function taskView(task: ProactivityTask): Record<string, JsonValue> {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    next_run_at: task.nextRunAt,
    recurrence: recurrenceView(task.recurrence),
    catch_up: task.catchUp,
    visibility: task.visibility,
    delivery: task.delivery,
    ...(task.condition === undefined ? {} : { condition: task.condition }),
    sender_identity: task.senderIdentity,
    created_by: task.createdBy,
    ...(task.attentionMode === undefined ? {} : { attention_mode: task.attentionMode }),
    ...(task.attentionPriority === undefined ? {} : { attention_priority: task.attentionPriority }),
    ...(task.attentionText === undefined ? {} : { attention_text: task.attentionText }),
    resource_policy: task.resourcePolicy,
    ...(task.maxRunsPerDay === undefined ? {} : { max_runs_per_day: task.maxRunsPerDay }),
    artifact_delivery: task.artifactDelivery,
    side_effect_policy: task.sideEffectPolicy,
    history: task.history.slice(-5).map(row => ({
      phase: row.phase,
      scheduled_for: row.scheduledFor,
      idempotency_key: row.idempotencyKey,
      started_at: row.startedAt,
      finished_at: row.finishedAt,
      status: row.status,
      ...(row.summary === undefined ? {} : { summary: row.summary }),
      ...(row.error === undefined ? {} : { error: row.error }),
    })),
  }
}

function targetAgent(exec: ToolRunContext): string | undefined {
  return exec.agent?.id
}

function normalizedEmail(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 320 || !trimmed.includes('@') || /\s/u.test(trimmed)) return undefined
  return trimmed
}

async function emailRecipient(
  delivery: 'chat' | 'email' | 'work' | undefined,
  explicit: string | undefined,
  options: ProactivityToolOptions,
): Promise<string | undefined> {
  const direct = normalizedEmail(explicit)
  if (delivery !== 'email') return explicit
  if (explicit !== undefined && direct === undefined) {
    throw new ToolArgsError(['recipient must be a valid email address for email delivery'])
  }
  if (direct !== undefined) return direct
  const resolved = normalizedEmail(await options.resolveDefaultEmailRecipient?.())
  if (resolved === undefined) {
    throw new ToolArgsError([
      'email delivery requires a recipient or a connected Google account whose email address can be resolved',
    ])
  }
  return resolved
}

function recurrence(args: { everyMinutes?: number; everyYears?: number; timezone?: string }): ProactivityRecurrence | undefined {
  const everyMs = minutesToMs(args.everyMinutes, 'everyMinutes')
  const everyYears = positiveInteger(args.everyYears, 'everyYears')
  if (everyMs !== undefined && everyYears !== undefined) {
    throw new ToolArgsError(['everyMinutes and everyYears are mutually exclusive'])
  }
  // One-shot and interval tasks are anchored by runAt itself. If runAt already
  // carries an explicit UTC offset, a supplied timezone is harmless context
  // and must not make an otherwise valid task fail. Calendar timezone semantics
  // are only persisted for yearly recurrence, where local wall-clock time must
  // survive DST/rule changes.
  if (everyMs !== undefined) return { kind: 'interval', everyMs }
  if (everyYears !== undefined) {
    return { kind: 'yearly', everyYears, ...(args.timezone === undefined ? {} : { timezone: args.timezone }) }
  }
  return undefined
}

/**
 * Create the model-facing tool that schedules durable proactive work.
 * @param engine - Host-owned proactivity engine that persists and executes scheduled tasks.
 * @param options - Optional integrations used while resolving delivery defaults.
 * @returns Tool definition exposed to the model for durable task creation.
 */
export function createProactivityCreateTool(
  engine: ProactivityEngine,
  options: ProactivityToolOptions = {},
): ToolDefinition {
  return defineTool({
    name: 'phoenix_task_create',
    description: 'Create durable scheduled work for Phoenix. Use it for reminders, follow-ups, recurring background intelligence, future office tasks, annual dates such as birthdays, and private surprise preparation. delivery=work can maintain an ongoing user objective in the background with explicit resource and run budgets. Tasks survive Phoenix restarts and catch up after the computer was off.',
    parameters: {
      title: { type: 'string', required: true },
      instruction: { type: 'string', required: true },
      runAt: { type: 'string', required: true, description: 'ISO-8601 date-time for the next delivery occurrence, including the intended UTC offset when known.' },
      requestedByUser: { type: 'boolean', description: 'True when the user explicitly requested this task; false/omitted for Phoenix-initiated work.' },
      everyMinutes: { type: 'number', description: 'Optional anchored recurrence interval in minutes, for example 1440 for daily or 21600 for every 15 days.' },
      everyYears: { type: 'number', description: 'Optional calendar recurrence in years. Use 1 for birthdays and anniversaries. Mutually exclusive with everyMinutes.' },
      timezone: { type: 'string', description: 'Optional IANA timezone, for example America/Santo_Domingo. Persisted for everyYears calendar recurrence; accepted but not required for one-shot/interval tasks because runAt defines the exact instant.' },
      catchUp: { type: 'string', enum: ['latest', 'all', 'skip'] },
      visibility: { type: 'string', enum: ['visible', 'surprise'] },
      revealAt: { type: 'string', description: 'Optional ISO-8601 time before which an unrevealed surprise is omitted from ordinary task listings. For recurring surprises, omit this to hide each occurrence until its own delivery time.' },
      preparationInstruction: { type: 'string', description: 'Private preparation work to run before each delivery occurrence.' },
      prepareLeadMinutes: { type: 'number', description: 'How many minutes before delivery private preparation starts.' },
      delivery: { type: 'string', enum: ['chat', 'email', 'work'] },
      senderIdentity: { type: 'string', enum: ['user', 'harness', 'auto'] },
      recipient: { type: 'string', description: 'Optional delivery recipient, normally an email address for email tasks.' },
      attentionMode: { type: 'string', enum: ['auto', 'result', 'upcoming', 'off'], description: 'Controls the quiet Phoenix home feed. auto surfaces material background results and useful one-shot/upcoming context; off never surfaces this task there.' },
      attentionPriority: { type: 'string', enum: ['low', 'normal', 'high'], description: 'Relative ranking for useful home-feed signals. Do not mark routine work high.' },
      attentionText: { type: 'string', description: 'Optional concise user-facing reason an upcoming occurrence matters. Keep it short and specific.' },
      resourcePolicy: { type: 'string', enum: ['free-first', 'balanced', 'unrestricted'], description: 'Autonomous cost posture. free-first prefers local, cached, bundled, or free-tier routes and never authorizes buying credits or plan upgrades.' },
      maxRunsPerDay: { type: 'number', description: 'Optional positive integer cap on delivery attempts in any rolling 24-hour window. Recurring delivery=work defaults to 12 unless explicitly set.' },
      artifactDelivery: { type: 'string', enum: ['inline', 'auto', 'drive-link'], description: 'Artifact destination policy. auto keeps concise results inline/local and may use an already-authorized Drive connector for useful file-like outputs.' },
      sideEffectPolicy: { type: 'string', enum: ['retry-safe', 'at-most-once'], description: 'Restart policy for an interrupted occurrence. at-most-once suppresses automatic replay when the external-write outcome is uncertain.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (args, value) => [{
        type: 'text',
        text: args.visibility === 'surprise'
          ? JSON.stringify({ id: value.id, status: value.status, next_run_at: value.next_run_at, visibility: 'surprise' })
          : JSON.stringify(value),
      }],
    },
    async execute(args, exec) {
      const schedule = recurrence(args)
      const prepareLeadMs = minutesToMs(args.prepareLeadMinutes, 'prepareLeadMinutes')
      const explicitMaxRunsPerDay = positiveInteger(args.maxRunsPerDay, 'maxRunsPerDay')
      const maxRunsPerDay = explicitMaxRunsPerDay
        ?? (args.delivery === 'work' && schedule?.kind !== 'once' ? 12 : undefined)
      if ((args.preparationInstruction === undefined) !== (prepareLeadMs === undefined)) {
        throw new ToolArgsError(['preparationInstruction and prepareLeadMinutes must be supplied together'])
      }
      const agentId = targetAgent(exec)
      const recipient = await emailRecipient(args.delivery, args.recipient, options)
      const task = await engine.create({
        title: args.title,
        instruction: args.instruction,
        runAt: args.runAt,
        createdBy: args.requestedByUser === true ? 'user' : 'harness',
        ...(schedule === undefined ? {} : { recurrence: schedule }),
        ...(args.catchUp === undefined ? {} : { catchUp: args.catchUp }),
        ...(args.visibility === undefined ? {} : { visibility: args.visibility }),
        ...(args.revealAt === undefined ? {} : { revealAt: args.revealAt }),
        ...(args.preparationInstruction === undefined ? {} : { preparationInstruction: args.preparationInstruction }),
        ...(prepareLeadMs === undefined ? {} : { prepareLeadMs }),
        ...(args.delivery === undefined ? {} : { delivery: args.delivery }),
        ...(args.senderIdentity === undefined ? {} : { senderIdentity: args.senderIdentity }),
        ...(recipient === undefined ? {} : { recipient }),
        ...(args.attentionMode === undefined ? {} : { attentionMode: args.attentionMode }),
        ...(args.attentionPriority === undefined ? {} : { attentionPriority: args.attentionPriority }),
        ...(args.attentionText === undefined ? {} : { attentionText: args.attentionText }),
        ...(args.resourcePolicy === undefined ? {} : { resourcePolicy: args.resourcePolicy }),
        ...(maxRunsPerDay === undefined ? {} : { maxRunsPerDay }),
        ...(args.artifactDelivery === undefined ? {} : { artifactDelivery: args.artifactDelivery }),
        ...(args.sideEffectPolicy === undefined ? {} : { sideEffectPolicy: args.sideEffectPolicy }),
        ...(agentId === undefined ? {} : { targetAgentId: agentId }),
      })
      return taskView(task)
    },
    presentCall(args) {
      if (args.visibility === 'surprise') return { card: 'generic', title: 'Phoenix private preparation', kind: 'execute' }
      return { card: 'generic', title: `Schedule: ${args.title}`, kind: 'execute', rawInput: args.runAt }
    },
  })
}

/**
 * Create a durable condition watch that stays silent until its condition is verified true.
 * @param engine - Host-owned proactivity engine that persists and executes condition watches.
 * @returns Tool definition exposed to the model for durable condition monitoring.
 */
export function createProactivityWatchTool(engine: ProactivityEngine): ToolDefinition {
  return defineTool({
    name: 'phoenix_watch_create',
    description: 'Create a durable condition watch. Phoenix checks privately on an anchored interval and sends one notification only when the condition is verified true; false checks remain silent. Use an event-driven connector/webhook instead when one already exists. Polling watches are limited to once per hour or slower.',
    parameters: {
      title: { type: 'string', required: true },
      condition: { type: 'string', required: true, description: 'Objective condition to verify from current read-only evidence.' },
      notificationInstruction: { type: 'string', required: true, description: 'What Phoenix should tell the user after the condition becomes true.' },
      runAt: { type: 'string', required: true, description: 'ISO-8601 date-time for the first check, including the intended UTC offset when known.' },
      everyMinutes: { type: 'number', required: true, description: 'Check interval in minutes. Must be at least 60.' },
      requestedByUser: { type: 'boolean', description: 'True when the user explicitly requested this watch.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const everyMs = minutesToMs(args.everyMinutes, 'everyMinutes')!
      if (everyMs < 60 * 60_000) {
        throw new ToolArgsError(['everyMinutes must be at least 60 for condition watches'])
      }
      const agentId = targetAgent(exec)
      const task = await engine.create({
        title: args.title,
        condition: args.condition,
        instruction: args.notificationInstruction,
        runAt: args.runAt,
        createdBy: args.requestedByUser === true ? 'user' : 'harness',
        recurrence: { kind: 'interval', everyMs },
        catchUp: 'latest',
        delivery: 'chat',
        attentionMode: 'off',
        ...(agentId === undefined ? {} : { targetAgentId: agentId }),
      })
      return taskView(task)
    },
    presentCall(args) {
      return { card: 'generic', title: `Watch: ${args.title}`, kind: 'execute', rawInput: args.condition }
    },
  })
}

/**
 * Create the ordinary task-list tool; unrevealed surprise tasks remain absent.
 * @param engine - Host-owned proactivity engine used to read scheduled task state.
 * @returns Tool definition exposed to the model for listing visible scheduled tasks.
 */
export function createProactivityListTool(engine: ProactivityEngine): ToolDefinition {
  return defineTool({
    name: 'phoenix_task_list',
    description: 'List Phoenix scheduled tasks and recent execution state. Unrevealed surprises are intentionally excluded.',
    parameters: {},
    output: {
      schema: { type: 'array', items: { type: 'object', additionalProperties: true } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute() {
      return (await engine.list()).map(taskView)
    },
    presentCall() {
      return { card: 'generic', title: 'Phoenix tasks', kind: 'read' }
    },
  })
}

function managementTool(
  name: 'phoenix_task_pause' | 'phoenix_task_resume' | 'phoenix_task_cancel',
  description: string,
  verb: string,
  operation: (id: string) => Promise<ProactivityTask>,
): ToolDefinition {
  return defineTool({
    name,
    description,
    parameters: { id: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) { return taskView(await operation(args.id)) },
    presentCall(args) { return { card: 'generic', title: `${verb} task`, kind: 'execute', rawInput: args.id } },
  })
}

/**
 * Create all model-facing task tools backed by one host-owned engine.
 * @param engine - Host-owned proactivity engine shared by the returned task tools.
 * @param options - Optional integrations shared by the returned task tools.
 * @returns Readonly collection of task-management tool definitions.
 */
export function createProactivityTools(
  engine: ProactivityEngine,
  options: ProactivityToolOptions = {},
): readonly ToolDefinition[] {
  return [
    createProactivityCreateTool(engine, options),
    createProactivityWatchTool(engine),
    createProactivityListTool(engine),
    managementTool('phoenix_task_pause', 'Pause a scheduled Phoenix task without changing its recurrence anchor.', 'Pause', id => engine.pause(id)),
    managementTool('phoenix_task_resume', 'Resume a paused or failed Phoenix task at its still-pending occurrence.', 'Resume', id => engine.resume(id)),
    managementTool('phoenix_task_cancel', 'Permanently cancel a Phoenix scheduled task.', 'Cancel', id => engine.cancel(id)),
  ]
}
