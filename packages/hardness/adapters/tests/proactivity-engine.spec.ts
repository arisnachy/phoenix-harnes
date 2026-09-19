import { describe, expect, it, vi } from 'vitest'
import {
  MemoryProactivityStore,
  ProactivityDeferredError,
  ProactivityEngine,
  type ProactivityExecution,
} from '../src/proactivity-engine.ts'

function fixedIds(...ids: string[]) {
  let index = 0
  return () => ids[index++] ?? `task-${index}`
}

describe('HARDNESS ProactivityEngine', () => {
  it('runs an overdue one-shot once after restart and records completion', async () => {
    const store = new MemoryProactivityStore()
    const firstExecutor = { execute: vi.fn(async () => ({ summary: 'sent' })) }
    const first = new ProactivityEngine(store, firstExecutor, { id: fixedIds('t-1') })
    await first.create({
      title: 'Appointment reminder',
      instruction: 'Remind the user about the appointment.',
      runAt: '2026-09-13T15:00:00.000Z',
      createdBy: 'user',
    })

    const secondExecutor = { execute: vi.fn(async () => ({ summary: 'sent after restart' })) }
    const restarted = new ProactivityEngine(store, secondExecutor)
    await restarted.runDue(new Date('2026-09-13T16:00:00.000Z'))
    await restarted.runDue(new Date('2026-09-13T17:00:00.000Z'))

    expect(secondExecutor.execute).toHaveBeenCalledTimes(1)
    const [task] = await restarted.list({ includeHidden: true, now: new Date('2026-09-13T17:00:00.000Z') })
    expect(task?.status).toBe('completed')
    expect(task?.history).toMatchObject([{ phase: 'deliver', status: 'completed' }])
  })

  it('collapses missed recurring occurrences to the latest slot by default', async () => {
    const store = new MemoryProactivityStore()
    const seen: ProactivityExecution[] = []
    const engine = new ProactivityEngine(store, { execute: async input => { seen.push(input); return {} } }, { id: fixedIds('daily') })
    await engine.create({
      title: 'Daily check',
      instruction: 'Perform the daily check.',
      runAt: '2026-09-10T12:00:00.000Z',
      createdBy: 'harness',
      recurrence: { kind: 'interval', everyMs: 86_400_000 },
    })

    await engine.runDue(new Date('2026-09-13T13:00:00.000Z'))

    expect(seen.map(item => item.scheduledFor)).toEqual(['2026-09-13T12:00:00.000Z'])
    const [task] = await engine.list({ includeHidden: true, now: new Date('2026-09-13T13:00:00.000Z') })
    expect(task?.nextRunAt).toBe('2026-09-14T12:00:00.000Z')
    expect(task?.status).toBe('scheduled')
  })

  it('supports all and skip catch-up policies without drifting the anchor', async () => {
    const allSeen: string[] = []
    const all = new ProactivityEngine(new MemoryProactivityStore(), {
      execute: async input => { allSeen.push(input.scheduledFor); return {} },
    }, { id: fixedIds('all'), maxCatchUpOccurrences: 10 })
    await all.create({
      title: 'Every day', instruction: 'Run.', runAt: '2026-09-10T12:00:00.000Z', createdBy: 'user',
      recurrence: { kind: 'interval', everyMs: 86_400_000 }, catchUp: 'all',
    })
    await all.runDue(new Date('2026-09-13T13:00:00.000Z'))
    expect(allSeen).toEqual([
      '2026-09-10T12:00:00.000Z',
      '2026-09-11T12:00:00.000Z',
      '2026-09-12T12:00:00.000Z',
      '2026-09-13T12:00:00.000Z',
    ])

    const skipSeen: string[] = []
    const skip = new ProactivityEngine(new MemoryProactivityStore(), {
      execute: async input => { skipSeen.push(input.scheduledFor); return {} },
    }, { id: fixedIds('skip') })
    await skip.create({
      title: 'Every day', instruction: 'Run.', runAt: '2026-09-10T12:00:00.000Z', createdBy: 'user',
      recurrence: { kind: 'interval', everyMs: 86_400_000 }, catchUp: 'skip',
    })
    await skip.runDue(new Date('2026-09-13T13:00:00.000Z'))
    expect(skipSeen).toEqual([])
    const [skipped] = await skip.list({ includeHidden: true, now: new Date('2026-09-13T13:00:00.000Z') })
    expect(skipped?.nextRunAt).toBe('2026-09-14T12:00:00.000Z')
  })

  it('keeps surprise details out of ordinary listings until reveal time', async () => {
    const engine = new ProactivityEngine(new MemoryProactivityStore(), { execute: async () => ({}) }, { id: fixedIds('surprise') })
    await engine.create({
      title: 'Birthday surprise',
      instruction: 'Reveal the prepared birthday surprise.',
      runAt: '2027-02-20T12:00:00.000Z',
      createdBy: 'harness',
      visibility: 'surprise',
      revealAt: '2027-02-20T12:00:00.000Z',
      preparationInstruction: 'Prepare a thoughtful birthday artifact.',
      prepareLeadMs: 14 * 86_400_000,
    })

    expect(await engine.list({ now: new Date('2027-02-01T12:00:00.000Z') })).toEqual([])
    const audit = await engine.list({ includeHidden: true, now: new Date('2027-02-01T12:00:00.000Z') })
    expect(audit[0]?.title).toBe('Birthday surprise')
    const revealed = await engine.list({ now: new Date('2027-02-20T12:00:00.000Z') })
    expect(revealed[0]?.title).toBe('Birthday surprise')
  })

  it('prepares a surprise privately before delivery and passes the prepared result forward', async () => {
    const phases: ProactivityExecution[] = []
    const engine = new ProactivityEngine(new MemoryProactivityStore(), {
      execute: async input => {
        phases.push(input)
        return input.phase === 'prepare' ? { summary: 'artifact://birthday-card' } : { summary: 'revealed' }
      },
    }, { id: fixedIds('surprise') })
    await engine.create({
      title: 'Birthday surprise', instruction: 'Reveal it.', runAt: '2027-02-20T12:00:00.000Z', createdBy: 'harness',
      visibility: 'surprise', preparationInstruction: 'Prepare it.', prepareLeadMs: 7 * 86_400_000,
    })

    await engine.runDue(new Date('2027-02-13T12:00:00.000Z'))
    expect(phases.map(item => item.phase)).toEqual(['prepare'])
    await engine.runDue(new Date('2027-02-20T12:00:00.000Z'))
    expect(phases.map(item => item.phase)).toEqual(['prepare', 'deliver'])
    expect(phases[1]?.preparationResult).toBe('artifact://birthday-card')
  })

  it('defers without consuming the occurrence when no live execution target exists', async () => {
    const execute = vi.fn(async () => { throw new ProactivityDeferredError('no live agent') })
    const engine = new ProactivityEngine(new MemoryProactivityStore(), { execute }, { id: fixedIds('deferred') })
    await engine.create({ title: 'Follow up', instruction: 'Ask the user.', runAt: '2026-09-13T15:00:00.000Z', createdBy: 'harness' })

    await engine.runDue(new Date('2026-09-13T16:00:00.000Z'))
    const [task] = await engine.list({ includeHidden: true, now: new Date('2026-09-13T16:00:00.000Z') })
    expect(task?.status).toBe('scheduled')
    expect(task?.history).toEqual([])
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('keeps a recurring condition watch scheduled while false and completes after the first true notification', async () => {
    const seen: ProactivityExecution[] = []
    let met = false
    const engine = new ProactivityEngine(new MemoryProactivityStore(), {
      execute: async input => {
        seen.push(input)
        return met
          ? { summary: 'condition met', terminal: true }
          : { summary: 'condition not met' }
      },
    }, { id: fixedIds('watch') })
    const created = await engine.create({
      title: 'Release watch',
      condition: 'The release is publicly available.',
      instruction: 'Notify the user that the release is available.',
      runAt: '2026-09-18T12:00:00.000Z',
      createdBy: 'user',
      recurrence: { kind: 'interval', everyMs: 3_600_000 },
      catchUp: 'latest',
    })

    await engine.runDue(new Date('2026-09-18T12:05:00.000Z'))
    const falseCheck = await engine.get(created.id)
    expect(falseCheck?.status).toBe('scheduled')
    expect(falseCheck?.nextRunAt).toBe('2026-09-18T13:00:00.000Z')
    expect(falseCheck?.history).toHaveLength(1)
    expect(falseCheck?.history[0]?.summary).toBe('condition not met')

    met = true
    await engine.runDue(new Date('2026-09-18T13:05:00.000Z'))
    const trueCheck = await engine.get(created.id)
    expect(trueCheck?.status).toBe('completed')
    expect(trueCheck?.history).toHaveLength(2)
    expect(trueCheck?.history[1]?.summary).toBe('condition met')

    await engine.runDue(new Date('2026-09-18T14:05:00.000Z'))
    expect(seen.map(item => item.scheduledFor)).toEqual([
      '2026-09-18T12:00:00.000Z',
      '2026-09-18T13:00:00.000Z',
    ])
  })

  it('records failures and permits an explicit resume to retry the same occurrence', async () => {
    let fail = true
    const engine = new ProactivityEngine(new MemoryProactivityStore(), {
      execute: async () => {
        if (fail) throw new Error('delivery failed')
        return { summary: 'ok' }
      },
    }, { id: fixedIds('retry') })
    const created = await engine.create({ title: 'Retry me', instruction: 'Run.', runAt: '2026-09-13T15:00:00.000Z', createdBy: 'user' })
    await engine.runDue(new Date('2026-09-13T16:00:00.000Z'))
    expect((await engine.get(created.id))?.status).toBe('failed')

    fail = false
    await engine.resume(created.id)
    await engine.runDue(new Date('2026-09-13T16:01:00.000Z'))
    const task = await engine.get(created.id)
    expect(task?.status).toBe('completed')
    expect(task?.history.map(item => item.status)).toEqual(['failed', 'completed'])
  })
})
