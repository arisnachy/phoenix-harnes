import type { CatchUpPolicy, DueOccurrence, TaskRecord, TaskRunRecord, TaskSchedule, UserTaskView } from './types.ts'

export const MAX_CATCH_UP_OCCURRENCES = 100
export const MIN_INTERVAL_SECONDS = 300

function iso(ms: number): string { return new Date(ms).toISOString() }

export function occurrenceId(taskId: string, dueAt: string): string {
  return `${taskId}@${dueAt}`
}

function partsInZone(ms: number, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const out: Record<string, number> = {}
  for (const part of parts) if (part.type !== 'literal') out[part.type] = Number(part.value)
  return out
}

/** Convert a wall time in an IANA zone to an epoch, rejecting DST gaps. */
export function zonedEpoch(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0)
  let candidate = desired
  for (let i = 0; i < 4; i += 1) {
    const p = partsInZone(candidate, timeZone)
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    candidate += desired - seen
  }
  const p = partsInZone(candidate, timeZone)
  if (p.year !== year || p.month !== month || p.day !== day || p.hour !== hour || p.minute !== minute) {
    throw new RangeError('annual task wall time does not exist in the requested time zone')
  }
  return candidate
}

export function nextAnnualEpoch(schedule: Extract<TaskSchedule, { kind: 'annual' }>, afterMs: number): number {
  new Intl.DateTimeFormat('en', { timeZone: schedule.timeZone }).format(new Date(afterMs))
  const localYear = partsInZone(afterMs, schedule.timeZone).year
  for (let year = localYear; year <= localYear + 8; year += 1) {
    const days = new Date(Date.UTC(year, schedule.month, 0)).getUTCDate()
    if (schedule.day > days) continue
    const candidate = zonedEpoch(year, schedule.month, schedule.day, schedule.hour, schedule.minute, schedule.timeZone)
    if (candidate > afterMs) return candidate
  }
  throw new RangeError('could not resolve next annual occurrence')
}

export function initialNextRunAt(schedule: TaskSchedule, nowMs: number): string {
  if (schedule.kind === 'once') {
    const value = Date.parse(schedule.at)
    if (!Number.isFinite(value)) throw new TypeError('once.at must be an RFC 3339 date-time')
    return iso(value)
  }
  if (schedule.kind === 'interval') {
    const anchor = Date.parse(schedule.anchorAt)
    if (!Number.isFinite(anchor)) throw new TypeError('interval.anchorAt must be an RFC 3339 date-time')
    if (!Number.isSafeInteger(schedule.everySeconds) || schedule.everySeconds < MIN_INTERVAL_SECONDS) {
      throw new RangeError(`interval.everySeconds must be at least ${MIN_INTERVAL_SECONDS}`)
    }
    if (anchor > nowMs) return iso(anchor)
    const step = schedule.everySeconds * 1000
    return iso(anchor + Math.ceil((nowMs - anchor) / step) * step)
  }
  return iso(nextAnnualEpoch(schedule, nowMs - 1))
}

function intervalMissed(task: TaskRecord, nowMs: number, policy: CatchUpPolicy): string[] {
  const schedule = task.schedule
  if (schedule.kind !== 'interval') return []
  const first = Date.parse(task.nextRunAt)
  if (first > nowMs) return []
  const step = schedule.everySeconds * 1000
  const count = Math.floor((nowMs - first) / step) + 1
  if (policy === 'skip') return []
  if (policy === 'latest') return [iso(first + (count - 1) * step)]
  const bounded = Math.min(count, MAX_CATCH_UP_OCCURRENCES)
  return Array.from({ length: bounded }, (_, index) => iso(first + (count - bounded + index) * step))
}

function annualMissed(task: TaskRecord, nowMs: number, policy: CatchUpPolicy): string[] {
  if (task.schedule.kind !== 'annual') return []
  let cursor = Date.parse(task.nextRunAt)
  if (cursor > nowMs) return []
  const values: string[] = []
  while (cursor <= nowMs && values.length < MAX_CATCH_UP_OCCURRENCES) {
    values.push(iso(cursor))
    cursor = nextAnnualEpoch(task.schedule, cursor)
  }
  if (policy === 'skip') return []
  if (policy === 'latest') return values.length === 0 ? [] : [values.at(-1)!]
  return values
}

/** Select due occurrences after a restart without replaying completed/skipped occurrence ids. Failed runs remain retryable after retryAt. */
export function dueOccurrences(task: TaskRecord, runs: readonly TaskRunRecord[], nowMs: number): DueOccurrence[] {
  if (task.state !== 'scheduled') return []
  const next = Date.parse(task.nextRunAt)
  if (!Number.isFinite(next) || next > nowMs) return []
  let due: string[]
  if (task.schedule.kind === 'once') due = task.catchUp === 'skip' && next < nowMs ? [] : [task.nextRunAt]
  else if (task.schedule.kind === 'interval') due = intervalMissed(task, nowMs, task.catchUp)
  else due = annualMissed(task, nowMs, task.catchUp)

  const terminal = new Set(runs.filter(run => run.status === 'completed' || run.status === 'skipped').map(run => run.occurrenceId))
  const retryBlocked = new Set(runs
    .filter(run => run.status === 'failed' && run.retryAt !== undefined && Date.parse(run.retryAt) > nowMs)
    .map(run => run.occurrenceId))

  return due
    .map(dueAt => ({ task, dueAt, occurrenceId: occurrenceId(task.id, dueAt) }))
    .filter(item => !terminal.has(item.occurrenceId) && !retryBlocked.has(item.occurrenceId))
}

/** Advance a task from its scheduled target, never from completion time, so recurrence cannot drift. */
export function advanceAfter(task: TaskRecord, acceptedDueAt: string, nowMs: number): TaskRecord {
  const updatedAt = iso(nowMs)
  if (task.schedule.kind === 'once') return { ...task, state: 'completed', updatedAt }
  if (task.schedule.kind === 'interval') {
    const step = task.schedule.everySeconds * 1000
    const anchor = Date.parse(task.schedule.anchorAt)
    const after = task.catchUp === 'all' ? Date.parse(acceptedDueAt) : Math.max(Date.parse(acceptedDueAt), nowMs)
    const n = Math.floor((after - anchor) / step) + 1
    return { ...task, state: 'scheduled', nextRunAt: iso(anchor + Math.max(0, n) * step), updatedAt }
  }
  const after = task.catchUp === 'all' ? Date.parse(acceptedDueAt) : Math.max(Date.parse(acceptedDueAt), nowMs)
  return { ...task, state: 'scheduled', nextRunAt: iso(nextAnnualEpoch(task.schedule, after)), updatedAt }
}

/** Settle an overdue task that explicitly chose catch_up=skip, moving its cursor beyond now. */
export function advanceSkipped(task: TaskRecord, nowMs: number): TaskRecord {
  const updatedAt = iso(nowMs)
  if (task.schedule.kind === 'once') return { ...task, state: 'completed', updatedAt }
  if (task.schedule.kind === 'interval') {
    const step = task.schedule.everySeconds * 1000
    const anchor = Date.parse(task.schedule.anchorAt)
    const n = Math.floor((nowMs - anchor) / step) + 1
    return { ...task, state: 'scheduled', nextRunAt: iso(anchor + Math.max(0, n) * step), updatedAt }
  }
  return { ...task, state: 'scheduled', nextRunAt: iso(nextAnnualEpoch(task.schedule, nowMs)), updatedAt }
}

export function userView(task: TaskRecord, nowMs: number): UserTaskView | undefined {
  if (task.visibility === 'internal') return undefined
  const hidden = task.visibility === 'hidden_until_reveal'
    && (task.revealAt === undefined || Date.parse(task.revealAt) > nowMs)
  if (hidden) {
    return {
      id: task.id, title: 'Sorpresa de Phoenix', state: task.state, origin: task.origin,
      nextRunAt: task.revealAt ?? task.nextRunAt, schedule: task.schedule, delivery: task.delivery, hidden: true,
      ...(task.revealAt === undefined ? {} : { revealAt: task.revealAt }),
    }
  }
  return {
    id: task.id, title: task.title, prompt: task.prompt, state: task.state, origin: task.origin,
    nextRunAt: task.nextRunAt, schedule: task.schedule, delivery: task.delivery, hidden: false,
    senderIdentity: task.senderIdentity,
    ...(task.revealAt === undefined ? {} : { revealAt: task.revealAt }),
    ...(task.emailTo === undefined ? {} : { emailTo: task.emailTo }),
    ...(task.tags === undefined ? {} : { tags: [...task.tags] }),
  }
}