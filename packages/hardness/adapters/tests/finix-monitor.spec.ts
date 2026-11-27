import { describe, expect, it, vi } from 'vitest'
import { type ProactivityEngine } from '../src/proactivity-engine.ts'
import { ensureFinixMonitor, finixMonitorTools, FINIX_MONITOR_INTERVAL_MS } from '../src/finix-monitor.ts'
describe('Finix resident monitoring', () => {
  it('creates one persistent local task and respects cancellation', async () => {
    const list = vi.fn<Parameters<typeof ensureFinixMonitor>[0]['list']>().mockResolvedValue([])
    const create = vi.fn<Parameters<typeof ensureFinixMonitor>[0]['create']>()
    const now = new Date('2026-11-27T12:00:00Z')
    await ensureFinixMonitor({ list, create }, now)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      executionPolicy: 'companion-local', delivery: 'work', createdBy: 'system',
      recurrence: { kind: 'interval', everyMs: FINIX_MONITOR_INTERVAL_MS },
      catchUp: 'latest', runAt: '2026-11-27T12:01:00.000Z',
    }))
    const saved = create.mock.calls[0]![0]
    list.mockResolvedValue([{ ...saved, status: 'cancelled' }] as Awaited<ReturnType<ProactivityEngine['list']>>)
    await ensureFinixMonitor({ list, create }, now)
    expect(create).toHaveBeenCalledTimes(1)
  })
  it('only exposes registered read-only diagnostics for unprompted checks', () => {
    expect(finixMonitorTools(['read', 'bash', 'system_environment_inspect', 'codex_quota_inspect']).allow).toEqual(['system_environment_inspect'])
  })
})
