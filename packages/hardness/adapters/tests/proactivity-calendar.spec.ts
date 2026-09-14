import { describe, expect, it } from 'vitest'
import { MemoryProactivityStore, ProactivityEngine, type ProactivityExecution } from '../src/proactivity-engine.ts'

describe('HARDNESS proactive calendar recurrence', () => {
  it('keeps an annual birthday on February 20 across a leap year', async () => {
    const seen: ProactivityExecution[] = []
    const engine = new ProactivityEngine(new MemoryProactivityStore(), {
      execute: async input => { seen.push(input); return {} },
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

  it('collapses several missed annual occurrences to the latest one', async () => {
    const seen: string[] = []
    const engine = new ProactivityEngine(new MemoryProactivityStore(), {
      execute: async input => { seen.push(input.scheduledFor); return {} },
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
