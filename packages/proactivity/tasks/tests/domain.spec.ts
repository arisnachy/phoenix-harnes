import { describe, expect, it } from 'vitest'
import { advanceAfter, dueOccurrences, initialNextRunAt, nextAnnualEpoch, userView } from '../src/domain.ts'
import type { TaskRecord } from '../src/types.ts'

const base = Date.parse('2026-09-10T15:00:00.000Z')

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1', title: 'Remember', prompt: 'Do it', state: 'scheduled', origin: 'phoenix',
    visibility: 'normal', catchUp: 'latest', delivery: 'chat', senderIdentity: 'auto',
    schedule: { kind: 'interval', anchorAt: '2026-09-10T15:00:00.000Z', everySeconds: 86_400 },
    nextRunAt: '2026-09-10T15:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z', consecutiveFailures: 0, ...overrides,
  }
}

describe('durable task recurrence', () => {
  it('runs only the latest missed occurrence after the PC returns', () => {
    const due = dueOccurrences(task(), [], base + 3 * 86_400_000 + 10_000)
    expect(due.map(item => item.dueAt)).toEqual(['2026-09-13T15:00:00.000Z'])
  })

  it('never repeats a terminal occurrence', () => {
    const record = task({ schedule: { kind: 'once', at: '2026-09-10T15:00:00.000Z' } })
    const first = dueOccurrences(record, [], base + 1_000)[0]!
    expect(dueOccurrences(record, [{ taskId: record.id, occurrenceId: first.occurrenceId, dueAt: first.dueAt, status: 'completed', startedAt: first.dueAt, finishedAt: first.dueAt }], base + 1_000)).toEqual([])
  })

  it('keeps interval recurrence anchored instead of drifting from completion time', () => {
    const next = advanceAfter(task(), '2026-09-10T15:00:00.000Z', base + 20_000)
    expect(next.nextRunAt).toBe('2026-09-11T15:00:00.000Z')
  })

  it('redacts a surprise before reveal and exposes it afterwards', () => {
    const surprise = task({ title: 'Birthday video', prompt: 'Reveal the video', visibility: 'hidden_until_reveal', revealAt: '2026-09-20T12:00:00.000Z' })
    expect(userView(surprise, Date.parse('2026-09-19T12:00:00Z'))).toMatchObject({ title: 'Sorpresa de Phoenix', hidden: true })
    expect(userView(surprise, Date.parse('2026-09-20T12:00:01Z'))).toMatchObject({ title: 'Birthday video', hidden: false })
  })

  it('resolves annual birthdays in an IANA time zone', () => {
    const schedule = { kind: 'annual' as const, month: 2, day: 20, hour: 8, minute: 0, timeZone: 'America/Santo_Domingo' }
    const next = nextAnnualEpoch(schedule, Date.parse('2026-09-13T00:00:00Z'))
    expect(new Date(next).toISOString()).toBe('2027-02-20T12:00:00.000Z')
    expect(initialNextRunAt(schedule, Date.parse('2026-09-13T00:00:00Z'))).toBe('2027-02-20T12:00:00.000Z')
  })
})
