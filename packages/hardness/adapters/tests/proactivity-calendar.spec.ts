import { describe, expect, it } from 'vitest'
import { MemoryProactivityStore, ProactivityEngine, type ProactivityExecution } from '../src/proactivity-engine.ts'

describe('HARDNESS proactive calendar recurrence', () => {
  it('keeps an annual birthday on February 20 across a leap year', async () => {
    const seen: ProactivityExecution[] = []
    const engine = new ProactivityEngine(new MemoryProactivityStore(), {
      execute: async (input) => { seen.push(input); return {} },
    }, { id: () => 'birthday' })

    await engine.create({
      title: 'Birthday',
      instruction: 'Celebrate the birthday.',
      runAt: '2027-02-20T13:00:00-04:00',
      createdBy: 'harness',
      recurrence: { kind: 'yearly', everyYears: 1, timezone: 'America/Santo_Domingo' },
    })

    await engine.runDue(new Date('2027-02-20T17:01:00.000Z'))
    expect(seen.map(item => item.scheduledFor)).toEqual(['2027-02-20T17:00:00.000Z'])
    expect((await engine.get('birthday'))?.nextRunAt).toBe('2028-02-20T17:00:00.000Z')

    await engine.runDue(new Date('2028-02-20T17:01:00.000Z'))
    expect(seen.map(item => item.scheduledFor)).toEqual([
      '2027-02-20T17:00:00.000Z',
      '2028-02-20T17:00:00.000Z',
    ])
    expect((await engine.get('birthday'))?.nextRunAt).toBe('2029-02-20T17:00:00.000Z')
  })

  it('preserves a weekly local start time across a daylight-saving transition', async () => {
    const seen: string[] = []
    const engine = new ProactivityEngine(new MemoryProactivityStore(), {
      execute: async (input) => { seen.push(input.scheduledFor); return {} },
    }, { id: () => 'weekly-class' })
    await engine.create({
      title: 'Prepare Monday class',
      instruction: 'Prepare lesson material in the background.',
      runAt: '2026-03-02T09:00:00-05:00',
      createdBy: 'harness',
      recurrence: { kind: 'calendar', unit: 'week', every: 1, timezone: 'America/New_York' },
      delivery: 'work',
    })
    await engine.runDue(new Date('2026-03-02T14:01:00.000Z'))
    expect((await engine.get('weekly-class'))?.nextRunAt).toBe('2026-03-09T13:00:00.000Z')
    await engine.runDue(new Date('2026-03-09T13:01:00.000Z'))
    expect(seen).toEqual(['2026-03-02T14:00:00.000Z', '2026-03-09T13:00:00.000Z'])
  })

  it('restores a monthly 31st anchor after a short month and a restart', async () => {
    const store = new MemoryProactivityStore()
    const seen: string[] = []
    const first = new ProactivityEngine(store, {
      execute: async (input) => { seen.push(input.scheduledFor); return {} },
    }, { id: () => 'monthly' })
    await first.create({
      title: 'Monthly review',
      instruction: 'Review the monthly report.',
      runAt: '2027-01-31T09:00:00-04:00',
      createdBy: 'harness',
      recurrence: { kind: 'calendar', unit: 'month', every: 1, timezone: 'America/Santo_Domingo' },
    })
    const second = new ProactivityEngine(store, {
      execute: async (input) => { seen.push(input.scheduledFor); return {} },
    })
    await second.runDue(new Date('2027-01-31T13:01:00.000Z'))
    expect((await second.get('monthly'))?.nextRunAt).toBe('2027-02-28T13:00:00.000Z')
    await second.runDue(new Date('2027-02-28T13:01:00.000Z'))
    expect((await second.get('monthly'))?.nextRunAt).toBe('2027-03-31T13:00:00.000Z')
    expect(seen).toHaveLength(2)
  })

  it('skips stale monthly checks instead of replaying an entire backlog', async () => {
    const execute = async () => { throw new Error('stale occurrence must not run') }
    const engine = new ProactivityEngine(new MemoryProactivityStore(), { execute }, { id: () => 'skipped' })
    await engine.create({
      title: 'Monthly check',
      instruction: 'Review once per month.',
      runAt: '2026-01-10T10:00:00-04:00',
      createdBy: 'harness',
      recurrence: { kind: 'calendar', unit: 'month', every: 1, timezone: 'America/Santo_Domingo' },
      catchUp: 'skip',
    })
    await engine.runDue(new Date('2026-05-11T14:00:00.000Z'))
    expect((await engine.get('skipped'))?.nextRunAt).toBe('2026-06-10T14:00:00.000Z')
  })

  it('collapses several missed annual occurrences to the latest one', async () => {
    const seen: string[] = []
    const engine = new ProactivityEngine(new MemoryProactivityStore(), {
      execute: async (input) => { seen.push(input.scheduledFor); return {} },
    }, { id: () => 'anniversary' })

    await engine.create({
      title: 'Anniversary',
      instruction: 'Send the anniversary message.',
      runAt: '2025-09-13T09:00:00-04:00',
      createdBy: 'harness',
      recurrence: { kind: 'yearly', everyYears: 1, timezone: 'America/Santo_Domingo' },
    })

    await engine.runDue(new Date('2028-09-13T14:00:00.000Z'))
    expect(seen).toEqual(['2028-09-13T13:00:00.000Z'])
    expect((await engine.get('anniversary'))?.nextRunAt).toBe('2029-09-13T13:00:00.000Z')
  })
})
