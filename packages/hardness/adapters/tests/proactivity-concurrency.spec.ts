import { describe, expect, it } from 'vitest'
import { MemoryProactivityStore, ProactivityEngine } from '../src/proactivity-engine.ts'

describe('HARDNESS proactivity concurrency', () => {
  it('releases the ledger mutex while scheduled work is executing', async () => {
    let engine!: ProactivityEngine
    engine = new ProactivityEngine(new MemoryProactivityStore(), {
      execute: async () => {
        const visible = await Promise.race([
          engine.list({ includeHidden: true }),
          new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('ledger stayed locked during execution')), 100)),
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
