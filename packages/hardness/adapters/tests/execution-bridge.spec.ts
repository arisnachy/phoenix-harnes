import { describe, expect, it, vi } from 'vitest'
import { executeCapabilityNeed } from '../src/execution-bridge.ts'

const toolSurface = { id: 'tool:echo@1:visual', need: { kind: 'echo' }, capabilityId: 'tool:echo', capabilityVersion: '1', modality: 'visual', inputs: [], outputs: [], requiredPermissions: [], verification: 'verified' } as const
const openclawSurface = { id: 'openclaw:brave@2026.8.1:native', need: { kind: 'web-search' }, capabilityId: 'openclaw:brave', capabilityVersion: '2026.8.1', modality: 'native', inputs: [], outputs: ['web-search'], requiredPermissions: [], verification: 'testing' } as const

describe('HARDNESS execution bridge', () => {
  it('approves then delegates the verified tool route to ctx.tools.execute', async () => {
    const execute = vi.fn(async () => ({ content: [], isError: false }))
    const route = vi.fn(() => ({ kind: 'route', route: { need: toolSurface.need, capability: { id: 'tool:echo', version: '1', status: 'verified' }, modality: 'visual', requiredPermissions: [] } }))
    const projectSurface = vi.fn(() => toolSurface)
    const broker = { request: vi.fn(async () => ({ kind: 'approved', grants: [] })) }
    await expect(executeCapabilityNeed({ route, surface: projectSurface } as never, { execute } as never, broker as never, toolSurface.need, { text: 'hi' }, { callId: 'c1' as never, signal: new AbortController().signal })).resolves.toMatchObject({ kind: 'executed', surface: toolSurface })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'echo', arguments: { text: 'hi' } }))
  })

  it('approves then delegates a non-tool OpenClaw route to the external executor', async () => {
    const tools = { execute: vi.fn() }
    const route = vi.fn(() => ({ kind: 'route', route: { need: openclawSurface.need, capability: { id: 'openclaw:brave', version: '2026.8.1', status: 'testing' }, modality: 'native', requiredPermissions: [] } }))
    const projectSurface = vi.fn(() => openclawSurface)
    const approval = { request: vi.fn(async () => ({ kind: 'approved' as const, grants: [] })) }
    const external = {
      supports: vi.fn(() => true),
      execute: vi.fn(async () => ({ content: [], isError: false })),
    }

    await expect(executeCapabilityNeed(
      { route, surface: projectSurface } as never,
      tools as never,
      approval,
      openclawSurface.need,
      { query: 'phoenix' },
      { callId: 'c2' as never, signal: new AbortController().signal },
      external,
    )).resolves.toMatchObject({ kind: 'executed', surface: openclawSurface })

    expect(approval.request).toHaveBeenCalledTimes(1)
    expect(external.execute).toHaveBeenCalledWith(openclawSurface, { query: 'phoenix' }, expect.objectContaining({ callId: 'c2' }))
    expect(tools.execute).not.toHaveBeenCalled()
  })

  it('does not execute an OpenClaw side effect after approval is denied', async () => {
    const route = vi.fn(() => ({ kind: 'route', route: { need: openclawSurface.need, capability: { id: 'openclaw:brave', version: '2026.8.1', status: 'testing' }, modality: 'native', requiredPermissions: [] } }))
    const projectSurface = vi.fn(() => openclawSurface)
    const approval = { request: vi.fn(async () => ({ kind: 'denied' as const, reason: 'user denied' })) }
    const external = { supports: vi.fn(() => true), execute: vi.fn() }

    await expect(executeCapabilityNeed(
      { route, surface: projectSurface } as never,
      { execute: vi.fn() } as never,
      approval,
      openclawSurface.need,
      {},
      { callId: 'c3' as never, signal: new AbortController().signal },
      external,
    )).resolves.toEqual({ kind: 'denied', reason: 'user denied' })
    expect(external.execute).not.toHaveBeenCalled()
  })
})
