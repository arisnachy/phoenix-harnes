import { describe, expect, it, vi } from 'vitest'
import { createRealitySnapshotTool, measureInternetDownload } from '../src/reality-tool.ts'

describe('phoenix_reality_now tool', () => {
  it('measures a completed 2 MB download, not the negotiated link or upload', async () => {
    const request = vi.fn(async () => new Response(new Uint8Array(2_000_000)))
    const result = await measureInternetDownload(undefined, request as typeof fetch)
    expect(result).toMatchObject({ status: 'measured', bytes: 2_000_000, uploadMbps: null })
    expect(Number(result.downloadMbps)).toBeGreaterThan(0)
    expect(request).toHaveBeenCalledOnce()
  })
  it('rejects incomplete download samples', async () => {
    const request = vi.fn(async () => new Response(new Uint8Array(12)))
    expect(await measureInternetDownload(undefined, request as typeof fetch)).toMatchObject({ status: 'unavailable', downloadMbps: null })
  })
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
    expect(result).toEqual(expected)
    expect(result).not.toBe(expected)
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

describe('Reality Context field reads', () => {
  it('preserves legacy full output and reads exact fields or properties', async () => {
    const data = { schema: 1, generatedAt: 'now', network: { adapters: ['eth0'], status: 'observed' }, ai: { large: 'x'.repeat(50_000) } }
    const tool = createRealitySnapshotTool({ refreshNow: vi.fn(async () => undefined), snapshot: vi.fn(() => data) } as never, {} as never)
    expect(await tool.execute({}, {} as never)).toEqual(data)
    expect(await tool.execute({ mode: 'fresh', field: 'network' }, {} as never)).toEqual({
      schema: 1, generatedAt: 'now', field: 'network', value: data.network,
    })
    expect(await tool.execute({ mode: 'fresh', field: 'network', key: 'adapters' }, {} as never)).toEqual({
      schema: 1, generatedAt: 'now', field: 'network', key: 'adapters', status: 'available', value: ['eth0'],
    })
    expect(await tool.execute({ field: 'network', key: '__proto__' }, {} as never)).toMatchObject({ status: 'unknown-key', value: null })
  })
})
