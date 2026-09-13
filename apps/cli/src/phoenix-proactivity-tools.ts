import type { Context } from '@phoenix-ai/cordis'
import {
  createAppointmentSupportPlan,
  createBirthdaySurprisePlan,
  type CatchUpPolicy,
  type CreateTaskInput,
  type EmailIdentity,
  type PhoenixProactivityEngine,
  type TaskAction,
} from './phoenix-proactivity.ts'

interface ToolExecutionLike {
  readonly agent?: unknown
}

interface ToolsLike {
  register(definition: unknown): void
}

interface PromptLike {
  section(definition: { name: string; order: number; text: string }): void
}

interface ToolDefinitionLike<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly execute: (args: T, execution: ToolExecutionLike) => Promise<unknown>
}

function register(ctx: Context, definition: ToolDefinitionLike): void {
  const tools = (ctx as unknown as { tools?: ToolsLike }).tools
  if (tools === undefined) throw new Error('phoenix-proactivity: tools service is unavailable')
  tools.register(definition)
}

function requireNonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function catchUp(value: unknown): CatchUpPolicy {
  return value === 'all' || value === 'skip' ? value : 'latest'
}

function sender(value: unknown): EmailIdentity {
  return value === 'user' || value === 'auto' ? value : 'phoenix'
}

function actionFromArgs(args: Record<string, unknown>): TaskAction {
  const kind = args.action_type
  if (kind === 'email') {
    return {
      type: 'email',
      to: requireNonEmpty(args.email_to, 'email_to'),
      subject: requireNonEmpty(args.email_subject, 'email_subject'),
      body: requireNonEmpty(args.email_body, 'email_body'),
      sender: sender(args.email_sender),
    }
  }
  if (kind === 'agent_prompt') {
    return { type: 'agent_prompt', prompt: requireNonEmpty(args.prompt, 'prompt') }
  }
  return { type: 'notification', message: requireNonEmpty(args.prompt, 'prompt') }
}

function publicTask(task: Awaited<ReturnType<PhoenixProactivityEngine['listTasks']>>[number]): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    source: task.source,
    visibility: task.visibility,
    status: task.status,
    schedule: task.schedule,
    catchUp: task.catchUp,
    nextRunAt: task.nextRunAt,
    ...(task.revealAt === undefined ? {} : { revealAt: task.revealAt }),
    ...(task.lastRunAt === undefined ? {} : { lastRunAt: task.lastRunAt }),
    action: task.action,
  }
}

/** Register Phoenix-global durable task controls on the live model tool surface. */
export function installPhoenixProactivityTools(ctx: Context, engine: PhoenixProactivityEngine): void {
  const systemPrompt = (ctx as unknown as { systemPrompt?: PromptLike }).systemPrompt
  systemPrompt?.section({
    name: 'tool:phoenix-proactivity',
    order: 107,
    text: [
      'Use Phoenix proactivity tools for durable future work that must survive app/PC shutdown, proactive check-ins, recurring duties, birthday surprises, appointments, or communication the user expects later.',
      'Prefer proactivity_task_create over session-local schedule tools when the task must survive a cold session or reboot.',
      'Phoenix may create useful low-risk tasks autonomously when they directly support an established user goal. Do not silently escalate permissions, spend money, disclose secrets, or send sensitive external messages without the permissions the user has configured.',
      'Surprise preparation may be hidden_until_reveal in normal listings but remains auditable internally.',
      'For email actions choose email_sender=phoenix for Phoenix-to-user communication, user for office work sent as the user, or auto when either configured identity is acceptable.',
    ].join(' '),
  })

  register(ctx, {
    name: 'proactivity_task_create',
    description: 'Create a Phoenix-global durable task. It survives Phoenix shutdown/restart and catches up according to catch_up. Use one of at or every_seconds.',
    parameters: {
      title: { type: 'string', required: true },
      prompt: { type: 'string', description: 'Notification text or agent prompt.' },
      at: { type: 'string', description: 'Absolute RFC3339/ISO instant for a one-shot task.' },
      every_seconds: { type: 'number', description: 'Fixed recurring interval in seconds (>= 60). Anchor is at when supplied, otherwise now.' },
      catch_up: { type: 'string', enum: ['latest', 'all', 'skip'], description: 'Missed-run policy; latest is default.' },
      source: { type: 'string', enum: ['user', 'phoenix'] },
      hidden_until_reveal: { type: 'boolean' },
      reveal_at: { type: 'string', description: 'Required when hidden_until_reveal is true.' },
      action_type: { type: 'string', enum: ['notification', 'agent_prompt', 'email'] },
      email_to: { type: 'string' },
      email_subject: { type: 'string' },
      email_body: { type: 'string' },
      email_sender: { type: 'string', enum: ['user', 'phoenix', 'auto'] },
    },
    async execute(args) {
      const at = optionalString(args.at)
      const everySeconds = typeof args.every_seconds === 'number' ? args.every_seconds : undefined
      if ((at === undefined) === (everySeconds === undefined)) {
        throw new Error('Provide exactly one of at or every_seconds')
      }
      if (everySeconds !== undefined && (!Number.isSafeInteger(everySeconds) || everySeconds < 60)) {
        throw new Error('every_seconds must be a safe integer >= 60')
      }
      const now = new Date().toISOString()
      const schedule: CreateTaskInput['schedule'] = everySeconds === undefined
        ? { kind: 'once', at: at as string }
        : { kind: 'interval', anchorAt: at ?? now, everyMs: everySeconds * 1000 }
      const hidden = args.hidden_until_reveal === true
      const revealAt = optionalString(args.reveal_at)
      const task = await engine.createTask({
        title: requireNonEmpty(args.title, 'title'),
        source: args.source === 'phoenix' ? 'phoenix' : 'user',
        visibility: hidden ? 'hidden_until_reveal' : 'normal',
        ...(revealAt === undefined ? {} : { revealAt }),
        schedule,
        catchUp: catchUp(args.catch_up),
        action: actionFromArgs(args),
      })
      return publicTask(task)
    },
  })

  register(ctx, {
    name: 'proactivity_task_list',
    description: 'List Phoenix-global durable tasks. Hidden surprise preparation is omitted unless include_hidden is explicitly true.',
    parameters: {
      include_hidden: { type: 'boolean' },
      include_terminal: { type: 'boolean' },
    },
    async execute(args) {
      const tasks = await engine.listTasks({
        includeHidden: args.include_hidden === true,
        includeTerminal: args.include_terminal === true,
      })
      return tasks.map(publicTask)
    },
  })

  register(ctx, {
    name: 'proactivity_task_pause',
    description: 'Pause a durable Phoenix task by id.',
    parameters: { id: { type: 'string', required: true } },
    async execute(args) {
      const id = requireNonEmpty(args.id, 'id')
      return { id, paused: await engine.pauseTask(id) }
    },
  })

  register(ctx, {
    name: 'proactivity_task_resume',
    description: 'Resume a paused durable Phoenix task by id.',
    parameters: { id: { type: 'string', required: true } },
    async execute(args) {
      const id = requireNonEmpty(args.id, 'id')
      return { id, resumed: await engine.resumeTask(id) }
    },
  })

  register(ctx, {
    name: 'proactivity_task_cancel',
    description: 'Cancel a durable Phoenix task by id.',
    parameters: { id: { type: 'string', required: true } },
    async execute(args) {
      const id = requireNonEmpty(args.id, 'id')
      return { id, cancelled: await engine.cancelTask(id) }
    },
  })

  register(ctx, {
    name: 'proactivity_plan_birthday',
    description: 'Create a hidden birthday-surprise preparation plan plus the reveal task. Preparation begins before the birthday instead of on the same day.',
    parameters: {
      person: { type: 'string', required: true },
      birthday_at: { type: 'string', required: true },
      reveal_message: { type: 'string' },
      email_to: { type: 'string' },
      email_sender: { type: 'string', enum: ['user', 'phoenix', 'auto'] },
    },
    async execute(args) {
      const tasks = await createBirthdaySurprisePlan(engine, {
        person: requireNonEmpty(args.person, 'person'),
        birthdayAt: requireNonEmpty(args.birthday_at, 'birthday_at'),
        ...(optionalString(args.reveal_message) === undefined ? {} : { revealMessage: optionalString(args.reveal_message) }),
        ...(optionalString(args.email_to) === undefined ? {} : { emailTo: optionalString(args.email_to) }),
        sender: sender(args.email_sender),
      })
      return tasks.map(publicTask)
    },
  })

  register(ctx, {
    name: 'proactivity_plan_appointment',
    description: 'Create proactive appointment support: an offer to help two days before and a same-day reminder, optionally through email.',
    parameters: {
      person: { type: 'string', required: true },
      appointment_at: { type: 'string', required: true },
      email_to: { type: 'string' },
      email_sender: { type: 'string', enum: ['user', 'phoenix', 'auto'] },
    },
    async execute(args) {
      const tasks = await createAppointmentSupportPlan(engine, {
        person: requireNonEmpty(args.person, 'person'),
        appointmentAt: requireNonEmpty(args.appointment_at, 'appointment_at'),
        ...(optionalString(args.email_to) === undefined ? {} : { emailTo: optionalString(args.email_to) }),
        sender: sender(args.email_sender),
      })
      return tasks.map(publicTask)
    },
  })
}
