import { defineTool, ToolArgsError, type ToolDefinition, type ToolRunContext } from '@phoenix-ai/dsh-tools'
import type { ProactivityEngine, ProactivityTask } from './proactivity-engine.ts'

function minutesToMs(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value <= 0) throw new ToolArgsError([`${field} must be greater than zero`])
  const ms = Math.round(value * 60_000)
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new ToolArgsError([`${field} is outside the supported range`])
  return ms
}

function taskView(task: ProactivityTask) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    next_run_at: task.nextRunAt,
    recurrence: task.recurrence,
    catch_up: task.catchUp,
    delivery: task.delivery,
    sender_identity: task.senderIdentity,
    created_by: task.createdBy,
    history: task.history.slice(-5),
  }
}

function targetAgent(exec: ToolRunContext): string | undefined {
  return exec.agent?.id as string | undefined
}

/** Create the model-facing tool that schedules durable proactive work. */
export function createProactivityCreateTool(engine: ProactivityEngine): ToolDefinition {
  return defineTool({
    name: 'phoenix_task_create',
    description: 'Create durable scheduled work for Phoenix. Use it for reminders, follow-ups, recurring work, future office tasks, and private surprise preparation. Tasks survive Phoenix restarts and catch up after the computer was off.',
    parameters: {
      title: { type: 'string', required: true },
      instruction: { type: 'string', required: true },
      runAt: { type: 'string', required: true, description: 'ISO-8601 date-time for the next delivery occurrence.' },
      requestedByUser: { type: 'boolean', description: 'True when the user explicitly requested this task; false/omitted for Phoenix-initiated work.' },
      everyMinutes: { type: 'number', description: 'Optional anchored recurrence interval in minutes. Omit for one-shot work.' },
      catchUp: { type: 'string', enum: ['latest', 'all', 'skip'] },
      visibility: { type: 'string', enum: ['visible', 'surprise'] },
      revealAt: { type: 'string', description: 'Optional ISO-8601 time before which an unrevealed surprise is omitted from ordinary task listings.' },
      preparationInstruction: { type: 'string', description: 'Private preparation work to run before each delivery occurrence.' },
      prepareLeadMinutes: { type: 'number', description: 'How many minutes before delivery private preparation starts.' },
      delivery: { type: 'string', enum: ['chat', 'email', 'work'] },
      senderIdentity: { type: 'string', enum: ['user', 'harness', 'auto'] },
      recipient: { type: 'string', description: 'Optional delivery recipient, normally an email address for email tasks.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const everyMs = minutesToMs(args.everyMinutes, 'everyMinutes')
      const prepareLeadMs = minutesToMs(args.prepareLeadMinutes, 'prepareLeadMinutes')
      if ((args.preparationInstruction === undefined) !== (prepareLeadMs === undefined)) {
        throw new ToolArgsError(['preparationInstruction and prepareLeadMinutes must be supplied together'])
      }
      const task = await engine.create({
        title: args.title,
        instruction: args.instruction,
        runAt: args.runAt,
        createdBy: args.requestedByUser === true ? 'user' : 'harness',
        ...(everyMs === undefined ? {} : { recurrence: { kind: 'interval' as const, everyMs } }),
        ...(args.catchUp === undefined ? {} : { catchUp: args.catchUp }),
        ...(args.visibility === undefined ? {} : { visibility: args.visibility }),
        ...(args.revealAt === undefined ? {} : { revealAt: args.revealAt }),
        ...(args.preparationInstruction === undefined ? {} : { preparationInstruction: args.preparationInstruction }),
        ...(prepareLeadMs === undefined ? {} : { prepareLeadMs }),
        ...(args.delivery === undefined ? {} : { delivery: args.delivery }),
        ...(args.senderIdentity === undefined ? {} : { senderIdentity: args.senderIdentity }),
        ...(args.recipient === undefined ? {} : { recipient: args.recipient }),
        ...(targetAgent(exec) === undefined ? {} : { targetAgentId: targetAgent(exec)! }),
      })
      return taskView(task)
    },
    presentCall(args) {
      return { card: 'generic', title: `Schedule: ${args.title}`, kind: 'create', rawInput: args.runAt }
    },
  })
}

/** Create the ordinary task-list tool; unrevealed surprise tasks remain absent. */
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

/** Create all model-facing task tools backed by one host-owned engine. */
export function createProactivityTools(engine: ProactivityEngine): readonly ToolDefinition[] {
  return [
    createProactivityCreateTool(engine),
    createProactivityListTool(engine),
    managementTool('phoenix_task_pause', 'Pause a scheduled Phoenix task without changing its recurrence anchor.', 'Pause', id => engine.pause(id)),
    managementTool('phoenix_task_resume', 'Resume a paused or failed Phoenix task at its still-pending occurrence.', 'Resume', id => engine.resume(id)),
    managementTool('phoenix_task_cancel', 'Permanently cancel a Phoenix scheduled task.', 'Cancel', id => engine.cancel(id)),
  ]
}
