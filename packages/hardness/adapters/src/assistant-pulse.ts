import type { ProactivityEngine, ProactivityTask } from './proactivity-engine.ts'

export const ASSISTANT_PULSE_TITLE = 'KIRA Assistant Pulse'
export const DEFAULT_ASSISTANT_PULSE_MS = 30 * 60 * 1_000
export const MIN_ASSISTANT_PULSE_MS = 5 * 60 * 1_000

export interface AssistantPulseOptions {
  readonly enabled: boolean
  readonly intervalMs: number
  readonly now?: Date
}

/**
 * A quiet ambient-assistant pass inspired by OpenClaw's heartbeat, implemented
 * on Phoenix's existing durable proactivity engine rather than a second scheduler.
 *
 * The pulse is intentionally read/analysis first: it may inspect already-authorized
 * sources and current Phoenix state, but it does not turn ambient presence into
 * standing permission for consequential external writes.
 */
export const ASSISTANT_PULSE_INSTRUCTION = [
  'Act as KIRA, Phoenix\'s ambient personal assistant.',
  'Perform one quiet assistant pulse using current Phoenix state and already-authorized connectors only.',
  'Prioritize material signals that could change what the user should know or do now: failed or completed background work, blocked tasks, upcoming calendar commitments, urgent or clearly actionable inbox items, connector events, expiring obligations, and explicit standing missions.',
  'Prefer event-driven and durable Phoenix state over broad polling. Do not install or authenticate connectors merely for this pulse.',
  'Do not infer recurring work from old conversation history and do not recreate tasks that already exist in the durable task or wake systems.',
  'Do not repeat an item that the user already reviewed unless there is a meaningful new change.',
  'Ambient presence is not standing permission for purchases, wagers, trades, transfers, messages, bookings, account changes, or other consequential external writes.',
  'If there is no material update, return exactly NO_MATERIAL_UPDATE.',
  'If there is a material update, return a concise, actionable assistant brief suitable for Phoenix home attention.',
].join(' ')

function validInterval(value: number): number {
  if (!Number.isSafeInteger(value) || value < MIN_ASSISTANT_PULSE_MS) {
    throw new Error(`assistant pulse interval must be a safe integer >= ${MIN_ASSISTANT_PULSE_MS}ms`)
  }
  return value
}

/**
 * Ensure exactly one system-owned ambient assistant pulse exists.
 *
 * A cancelled or paused pulse is deliberately respected and is not recreated:
 * explicit user control wins over startup reconciliation.
 */
export async function ensureAssistantPulse(
  engine: Pick<ProactivityEngine, 'list' | 'create'>,
  options: AssistantPulseOptions,
): Promise<ProactivityTask | undefined> {
  if (!options.enabled) return undefined

  const intervalMs = validInterval(options.intervalMs)
  const existing = (await engine.list({ includeHidden: true }))
    .find(task => task.createdBy === 'system' && task.title === ASSISTANT_PULSE_TITLE)
  if (existing !== undefined) return existing

  const now = options.now ?? new Date()
  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs)) throw new Error('assistant pulse now must be a valid Date')

  return engine.create({
    title: ASSISTANT_PULSE_TITLE,
    instruction: ASSISTANT_PULSE_INSTRUCTION,
    runAt: new Date(nowMs + intervalMs).toISOString(),
    createdBy: 'system',
    recurrence: { kind: 'interval', everyMs: intervalMs },
    catchUp: 'skip',
    visibility: 'visible',
    delivery: 'work',
    senderIdentity: 'harness',
    attentionMode: 'result',
    attentionPriority: 'normal',
  })
}
