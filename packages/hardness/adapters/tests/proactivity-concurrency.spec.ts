import { describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import { installProactivityRuntime } from '../src/proactivity-runtime.ts'
import { MemoryProactivityStore, ProactivityEngine } from '../src/proactivity-engine.ts'

describe('HARDNESS proactivity concurrency', () => {
  it('releases the ledger mutex while scheduled work is executing', async () => {
    const engine = new ProactivityEngine(new MemoryProactivityStore(), {
      execute: async () => {
        const visible = await Promise.race([
          engine.list({ includeHidden: true }),
          new Promise<never>((_resolve, reject) => setTimeout(() =>{  reject(new Error('ledger stayed locked during execution')) }, 100)),
        ])
        expect(visible).toHaveLength(1)
        return { summary: 'ok' }
      },
    }, { id: () => 'nonblocking' })

    await engine.create({
      title: 'Non-blocking scheduled work',
      instruction: 'Run and inspect the task ledger.',
      runAt: '2026-09-13T15:00:00.000Z',
      createdBy: 'harness',
    })

    await engine.runDue(new Date('2026-09-13T16:00:00.000Z'))
    expect((await engine.get('nonblocking'))?.status).toBe('completed')
  })
})

describe('AUTONOMIC scheduling isolation', () => {
  it('samples local observations while due work is still running', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish=resolve })
    const engine = new ProactivityEngine(new MemoryProactivityStore(), { execute: async () => ({ summary: 'done' }) })
    const run = vi.spyOn(engine,'runDue').mockImplementation(() => pending)
    const observe = vi.fn()
    const dispose = installProactivityRuntime(ctx,engine,1000,undefined,undefined,observe)
    try {
      await vi.advanceTimersByTimeAsync(3500)
      expect(observe).toHaveBeenCalledTimes(4)
      expect(run).toHaveBeenCalledTimes(1)
      dispose()
      await vi.advanceTimersByTimeAsync(3000)
      expect(observe).toHaveBeenCalledTimes(4)
    } finally {
      dispose()
      finish()
      await pending
      await ctx.fiber.dispose()
      vi.useRealTimers()
    }
  })
})
