import {
  defineTool,
  ToolArgsError,
  type JsonValue,
  type ToolDefinition,
} from '@phoenix-ai/dsh-tools'
import type { ProactivityEngine, ProactivityTask } from './proactivity-engine.ts'
import {
  createProactivityCreateTool,
  createProactivityListTool,
  createProactivityWatchTool,
} from './proactivity-tools.ts'
import type { WakeEngine, WakeTrigger } from './wake-engine.ts'
import {
  createWakeTriggerListTool,
  createWakeTriggerTool,
} from './wake-tools.ts'

type RoutineKind = 'time' | 'interval' | 'condition' | 'event'
type RoutinePrefix = 'task' | 'event'

function requiredText(value: string | undefined, field: string): string {
  const text = value?.trim()
  if (text === undefined || text.length === 0) throw new ToolArgsError([`${field} is required`])
  return text
}

function checkedMinutes(value: number | undefined, minimum: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    throw new ToolArgsError([`everyMinutes must be greater than zero`])
  }
  if (value < minimum) throw new ToolArgsError([`everyMinutes must be greater than or equal to ${minimum}`])
  const milliseconds = Math.round(value * 60_000)
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new ToolArgsError(['everyMinutes is outside the supported range'])
  }
  return value
}

function tagged(prefix: RoutinePrefix, kind: RoutineKind, value: unknown): Record<string, JsonValue> {
  const row = value as Record<string, JsonValue>
  const nativeId = String(row.id)
  return { ...row, id: `${prefix}:${nativeId}`, native_id: nativeId, kind }
}

function taskViewKind(row: Record<string, JsonValue>): RoutineKind {
  if (row.condition !== undefined) return 'condition'
  const recurrence = row.recurrence as Record<string, JsonValue> | undefined
  return recurrence?.kind === 'interval' ? 'interval' : 'time'
}

function routineId(value: string): { kind: RoutinePrefix; id: string } {
  const split = value.indexOf(':')
  if (split <= 0 || split === value.length - 1) {
    throw new ToolArgsError(['routine id must come from phoenix_routine_list/create'])
  }
  const kind = value.slice(0, split)
  if (kind !== 'task' && kind !== 'event') throw new ToolArgsError(['unknown routine id kind'])
  return { kind, id: value.slice(split + 1) }
}

async function manageRoutine(
  value: string,
  taskOperation: (id: string) => Promise<ProactivityTask>,
  wakeOperation: (id: string) => Promise<WakeTrigger>,
): Promise<Record<string, JsonValue>> {
  const parsed = routineId(value)
  if (parsed.kind === 'task') {
    const task = await taskOperation(parsed.id)
    const kind: RoutineKind = task.condition === undefined
      ? task.recurrence.kind === 'interval' ? 'interval' : 'time'
      : 'condition'
    return tagged('task', kind, task)
  }
  return tagged('event', 'event', await wakeOperation(parsed.id))
}

/**
 * Build the unified Phoenix Routine tool family over the existing task, watch,
 * and event-driven wake engines. The facade delegates creation and listing to
 * the established tools instead of duplicating scheduler or matcher logic.
 * @param proactivity - Existing durable time/condition task engine.
 * @param wake - Existing durable event-driven wake engine.
 * @returns Model-facing Routine create/list/management tools.
 */
export function createRoutineTools(
  proactivity: ProactivityEngine,
  wake: WakeEngine,
): readonly ToolDefinition[] {
  const taskCreate = createProactivityCreateTool(proactivity)
  const watchCreate = createProactivityWatchTool(proactivity)
  const taskList = createProactivityListTool(proactivity)
  const wakeCreate = createWakeTriggerTool(wake)
  const wakeList = createWakeTriggerListTool(wake)

  const create = defineTool({
    name: 'phoenix_routine_create',
    description: 'Create one durable Phoenix Routine. trigger=time runs once, interval runs repeatedly by time, condition checks privately until true, and event wakes only when a normalized connector/runtime event arrives. This facade reuses Phoenix Task/Watch/Wake; it does not create another scheduler.',
    parameters: {
      title: { type: 'string', required: true },
      instruction: { type: 'string', required: true },
      trigger: { type: 'string', required: true, enum: ['time', 'interval', 'condition', 'event'] },
      runAt: { type: 'string', description: 'ISO-8601 first/next run time for time, interval, or condition routines.' },
      everyMinutes: { type: 'number', description: 'Interval minutes for interval/condition. Condition routines require at least 60.' },
      condition: { type: 'string', description: 'Objective condition for condition routines. False checks stay silent.' },
      source: { type: 'string', description: 'Normalized event source for event routines, e.g. gmail, github, mcp, webhook.' },
      eventType: { type: 'string', description: 'Normalized event type for event routines.' },
      match: { type: 'string', description: 'Optional event attribute filters: field=value;field~contains;field?.' },
      eventMode: { type: 'string', enum: ['notify', 'act'], description: 'Event routines default to act within normal approval/authorization gates.' },
      once: { type: 'boolean', description: 'For event routines, complete after the first successful fire.' },
      delivery: { type: 'string', enum: ['chat', 'email', 'work'], description: 'Delivery for time/interval routines. Background standing objectives normally use work.' },
      requestedByUser: { type: 'boolean', description: 'True when the user explicitly requested the routine.' },
      attentionMode: { type: 'string', enum: ['auto', 'result', 'upcoming', 'off'] },
      attentionPriority: { type: 'string', enum: ['low', 'normal', 'high'] },
      attentionText: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (args.trigger === 'event') {
        const result = await wakeCreate.execute({
          title: args.title,
          source: requiredText(args.source, 'source'),
          eventType: requiredText(args.eventType, 'eventType'),
          instruction: args.instruction,
          ...(args.eventMode === undefined ? {} : { mode: args.eventMode }),
          ...(args.once === undefined ? {} : { once: args.once }),
          ...(args.match === undefined ? {} : { match: args.match }),
          ...(args.requestedByUser === undefined ? {} : { requestedByUser: args.requestedByUser }),
        }, exec)
        return tagged('event', 'event', result)
      }

      const runAt = requiredText(args.runAt, 'runAt')
      if (args.trigger === 'condition') {
        const result = await watchCreate.execute({
          title: args.title,
          condition: requiredText(args.condition, 'condition'),
          notificationInstruction: args.instruction,
          runAt,
          everyMinutes: checkedMinutes(args.everyMinutes, 60),
          ...(args.requestedByUser === undefined ? {} : { requestedByUser: args.requestedByUser }),
        }, exec)
        return tagged('task', 'condition', result)
      }

      if (args.condition !== undefined) throw new ToolArgsError(['time and interval routines do not accept condition'])
      if (args.trigger === 'time' && args.everyMinutes !== undefined) {
        throw new ToolArgsError(['time routines do not accept everyMinutes'])
      }
      const everyMinutes = args.trigger === 'interval'
        ? checkedMinutes(args.everyMinutes, Number.MIN_VALUE)
        : undefined
      const result = await taskCreate.execute({
        title: args.title,
        instruction: args.instruction,
        runAt,
        ...(everyMinutes === undefined ? {} : { everyMinutes }),
        ...(args.delivery === undefined ? {} : { delivery: args.delivery }),
        ...(args.requestedByUser === undefined ? {} : { requestedByUser: args.requestedByUser }),
        ...(args.attentionMode === undefined ? {} : { attentionMode: args.attentionMode }),
        ...(args.attentionPriority === undefined ? {} : { attentionPriority: args.attentionPriority }),
        ...(args.attentionText === undefined ? {} : { attentionText: args.attentionText }),
      }, exec)
      return tagged('task', args.trigger, result)
    },
    presentCall(args) {
      return { card: 'generic', title: `Routine: ${args.title}`, kind: 'execute', rawInput: args.trigger }
    },
  })

  const list = defineTool({
    name: 'phoenix_routine_list',
    description: 'List all visible Phoenix Routines across scheduled Task/Watch work and event-driven Wake triggers.',
    parameters: {},
    output: {
      schema: { type: 'array', items: { type: 'object', additionalProperties: true } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(_args, exec) {
      const [tasks, events] = await Promise.all([
        taskList.execute({}, exec) as Promise<Record<string, JsonValue>[]>,
        wakeList.execute({}, exec) as Promise<Record<string, JsonValue>[]>,
      ])
      return [
        ...tasks.map((row) => tagged('task', taskViewKind(row), row)),
        ...events.map((row) => tagged('event', 'event', row)),
      ]
    },
    presentCall() {
      return { card: 'generic', title: 'Phoenix routines', kind: 'read' }
    },
  })

  const management = (
    name: 'phoenix_routine_pause' | 'phoenix_routine_resume' | 'phoenix_routine_cancel',
    description: string,
    verb: string,
    taskOperation: (id: string) => Promise<ProactivityTask>,
    wakeOperation: (id: string) => Promise<WakeTrigger>,
  ): ToolDefinition => defineTool({
    name,
    description,
    parameters: { id: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) { return manageRoutine(args.id, taskOperation, wakeOperation) },
    presentCall(args) { return { card: 'generic', title: `${verb} routine`, kind: 'execute', rawInput: args.id } },
  })

  return [
    create,
    list,
    management('phoenix_routine_pause', 'Pause a Phoenix Routine regardless of whether it is time/condition/event driven.', 'Pause', (id) => proactivity.pause(id), (id) => wake.pause(id)),
    management('phoenix_routine_resume', 'Resume a paused Phoenix Routine.', 'Resume', (id) => proactivity.resume(id), (id) => wake.resume(id)),
    management('phoenix_routine_cancel', 'Permanently cancel a Phoenix Routine.', 'Cancel', (id) => proactivity.cancel(id), (id) => wake.cancel(id)),
  ]
}
