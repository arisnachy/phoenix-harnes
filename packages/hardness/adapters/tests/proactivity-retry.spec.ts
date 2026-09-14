import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryProactivityStore, ProactivityEngine } from '../src/proactivity-engine.ts'
import { retryFailedProactivityTasks } from '../src/proactivity-runtime.ts'

describe('proactivity automatic retry', () => {
  afterEach(() => { vi.useRealTimers() })

  it('waits for exponential backoff, survives a recreated engine, and retries the same occurrence', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T16:00:00.000Z'))

    const store = new MemoryProactivityStore()
    const failed = new ProactivityEngine(store, {
      execute: async () => { throw new Error('temporary delivery failure') },
    }, { id: () => 'retryable' })
    await failed.create({
      title: 'Retryable reminder',
      instruction: 'Deliver the reminder.',
      runAt: '2026-09-13T15:00:00.000Z',
      createdBy: 'user',
    })
    await failed.runDue(new Date())
    expect((await failed.get('retryable'))?.status).toBe('failed')

    const execute = vi.fn(async () => ({ summary: 'delivered after restart' }))
    const restarted = new ProactivityEngine(store, { execute })

    vi.setSystemTime(new Date('2026-09-13T16:00:59.000Z'))
    expect(await retryFailedProactivityTasks(restarted, new Date(), {
      maxAttempts: 5,
      retryBaseMs: 60_000,
      retryMaxMs: 3_600_000,
    })).toBe(0)
    await restarted.runDue(new Date())
    expect(execute).not.toHaveBeenCalled()

    vi.setSystemTime(new Date('2026-09-13T16:01:00.000Z'))
    expect(await retryFailedProactivityTasks(restarted, new Date(), {
      maxAttempts: 5,
      retryBaseMs: 60_000,
      retryMaxMs: 3_600_000,
    })).toBe(1)
    await restarted.runDue(new Date())

    expect(execute).toHaveBeenCalledTimes(1)
    expect((await restarted.get('retryable'))?.status).toBe('completed')
  })

  it('stops retrying after the configured attempt ceiling', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T16:00:00.000Z'))

    const store = new MemoryProactivityStore()
    const engine = new ProactivityEngine(store, {
      execute: async () => { throw new Error('still failing') },
    }, { id: () => 'bounded' })
    await engine.create({
      title: 'Bounded retry',
      instruction: 'Run.',
      runAt: '2026-09-13T15:00:00.000Z',
      createdBy: 'harness',
    })
    await engine.runDue(new Date())

    vi.setSystemTime(new Date('2026-09-13T16:10:00.000Z'))
    expect(await retryFailedProactivityTasks(engine, new Date(), {
      maxAttempts: 1,
      retryBaseMs: 1_000,
      retryMaxMs: 60_000,
    })).toBe(0)
    expect((await engine.get('bounded'))?.status).toBe('failed')
  })
})
