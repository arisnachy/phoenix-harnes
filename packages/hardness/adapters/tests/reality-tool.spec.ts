import { describe, expect, it, vi } from 'vitest'
import { createRealitySnapshotTool } from '../src/reality-tool.ts'

describe('phoenix_reality_now tool', () => {
  it('waits for a full refresh and keeps active-agent context in the returned snapshot', async () => {
    const ctx = { get() { return undefined } } as never
    const agent = { id: 'agent-1', options: {}, session: { id: 'agent-1' } }
    const expected = { schema: 1, generatedAt: 'now' }
    const refreshNow = vi.fn(async () => undefined)
    const snapshot = vi.fn(() => expected)
    const tool = createRealitySnapshotTool({ refreshNow, snapshot } as never, ctx)

    const result = await tool.execute({ mode: 'full' }, { agent } as never)

    expect(refreshNow).toHaveBeenCalledWith(ctx, true, { agent })
    expect(snapshot).toHaveBeenCalledWith(ctx, expect.any(Date), { agent })
    expect(result).toBe(expected)
  })

  it('uses TTL-aware refresh unless full mode is explicitly requested', async () => {
    const ctx = {} as never
    const refreshNow = vi.fn(async () => undefined)
    const snapshot = vi.fn(() => ({ schema: 1 }))
    const tool = createRealitySnapshotTool({ refreshNow, snapshot } as never, ctx)

    await tool.execute({}, {} as never)

    expect(refreshNow).toHaveBeenCalledWith(ctx, false, undefined)
  })
})
