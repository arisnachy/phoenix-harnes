import { describe, expect, it, vi } from 'vitest'
import { executeCapabilityNeed } from '../src/execution-bridge.ts'

const surface = { id: 'tool:echo@1:visual', need: { kind: 'echo' }, capabilityId: 'tool:echo', capabilityVersion: '1', modality: 'visual', inputs: [], outputs: [], requiredPermissions: [], verification: 'verified' } as const

describe('HARDNESS execution bridge', () => {
  it('approves then delegates the verified tool route to ctx.tools.execute', async () => {
    const execute = vi.fn(async () => ({ content: [], isError: false }))
    const route = vi.fn(() => ({ kind: 'route', route: { need: surface.need, capability: { id: 'tool:echo', version: '1', status: 'verified' }, modality: 'visual', requiredPermissions: [] } }))
    const projectSurface = vi.fn(() => surface)
    const broker = { request: vi.fn(async () => ({ kind: 'approved', grants: [] })) }
    await expect(executeCapabilityNeed({ route, surface: projectSurface } as never, { execute } as never, broker as never, surface.need, { text: 'hi' }, { callId: 'c1' as never, signal: new AbortController().signal })).resolves.toMatchObject({ kind: 'executed' })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'echo', arguments: { text: 'hi' } }))
  })
})
