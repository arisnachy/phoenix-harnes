import type { CreateProactivityTaskInput, ProactivityRecurrence } from './proactivity-engine.ts'

function record(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`invalid ${context}`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, names: readonly string[]): void {
  if (Object.keys(value).some(key => !names.includes(key))) throw new Error('unsupported scheduled task field')
}

function boundedString(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > max) {
    throw new Error(`invalid ${name}`)
  }
  return value.trim()
}

function positiveInteger(value: unknown, name: string, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`invalid ${name}`)
  }
  return value
}

function timezone(value: unknown): string {
  const zone = boundedString(value, 'timezone', 100)
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone
  } catch {
    throw new Error('invalid timezone')
  }
}

function parseRecurrence(value: unknown): ProactivityRecurrence | undefined {
  if (value === undefined) return undefined
  const row = record(value, 'recurrence')
  if (row.kind === 'once') {
    exactKeys(row, ['kind'])
    return { kind: 'once' }
  }
  if (row.kind === 'interval') {
    exactKeys(row, ['kind', 'everyMs'])
    const everyMs = positiveInteger(row.everyMs, 'interval', 365 * 24 * 60 * 60 * 1000)
    if (everyMs < 300_000) throw new Error('interval must be at least five minutes')
    return { kind: 'interval', everyMs }
  }
  if (row.kind === 'calendar' && (row.unit === 'week' || row.unit === 'month')) {
    exactKeys(row, ['kind', 'unit', 'every', 'timezone'])
    const every = positiveInteger(row.every, 'calendar interval', row.unit === 'week' ? 52 : 120)
    const zone = row.timezone === undefined ? undefined : timezone(row.timezone)
    return { kind: 'calendar', unit: row.unit, every, ...(zone === undefined ? {} : { timezone: zone }) }
  }
  if (row.kind === 'yearly') {
    exactKeys(row, ['kind', 'everyYears', 'timezone'])
    const everyYears = positiveInteger(row.everyYears, 'yearly interval', 100)
    const zone = row.timezone === undefined ? undefined : timezone(row.timezone)
    return { kind: 'yearly', everyYears, ...(zone === undefined ? {} : { timezone: zone }) }
  }
  throw new Error('invalid recurrence')
}

/**
 * Parse the locally authenticated task form independently of model tool inputs.
 * Never accept caller-selected creator, hidden visibility, agent id or permissions.
 * @param value - Untrusted JSON-RPC input from the browser.
 * @param now - Clock used to reject past scheduling.
 * @returns Safe user-origin task creation values.
 */
export function parseScheduledTaskCreation(value: unknown, now = Date.now()): CreateProactivityTaskInput {
  const raw = record(value, 'scheduled task')
  exactKeys(raw, ['title', 'instruction', 'runAt', 'recurrence', 'catchUp', 'delivery', 'recipient'])
  const title = boundedString(raw.title, 'title', 120)
  const instruction = boundedString(raw.instruction, 'instruction', 6000)
  const runAt = boundedString(raw.runAt, 'runAt', 40)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(runAt)) {
    throw new Error('runAt must include a timezone offset')
  }
  const timestamp = Date.parse(runAt)
  if (!Number.isFinite(timestamp) || timestamp < now - 1000) throw new Error('runAt must be now or in the future')
  const recurrence = parseRecurrence(raw.recurrence)
  const catchUp = raw.catchUp === undefined ? 'latest' : raw.catchUp
  if (catchUp !== 'latest' && catchUp !== 'skip' && catchUp !== 'all') throw new Error('invalid catchUp')
  const delivery = raw.delivery === undefined ? 'chat' : raw.delivery
  if (delivery !== 'chat' && delivery !== 'work' && delivery !== 'email') throw new Error('invalid delivery')
  const recipient = raw.recipient === undefined ? undefined : boundedString(raw.recipient, 'recipient', 320)
  if (delivery === 'email' && (recipient === undefined || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))) {
    throw new Error('email delivery requires an explicit valid recipient')
  }
  if (delivery !== 'email' && recipient !== undefined) throw new Error('recipient is only valid for email delivery')
  return {
    title, instruction, runAt: new Date(timestamp).toISOString(), createdBy: 'user',
    visibility: 'visible', senderIdentity: 'harness', attentionMode: 'auto',
    ...(recurrence === undefined ? {} : { recurrence }),
    catchUp, delivery,
    ...(recipient === undefined ? {} : { recipient }),
  }
}

/**
 * Validate a browser-visible task id before a state transition.
 * @param input - RPC control payload.
 * @returns Validated task identifier.
 */
export function parseScheduledTaskId(input: unknown): string {
  const row = record(input, 'task action')
  exactKeys(row, ['id'])
  const id = boundedString(row.id, 'id', 128)
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('invalid task id')
  return id
}
