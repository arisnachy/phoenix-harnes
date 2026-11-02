import { describe, expect, it, vi } from 'vitest'
import type { ToolRuntime } from '@phoenix-ai/dsh-tools'
import type { HardnessService } from '@phoenix-ai/dsh-hardness'
import type { CapabilityApproval, CapabilityExecutor } from '../src/execution-bridge.ts'
import { executeCapabilityNeed } from '../src/execution-bridge.ts'

const toolSurface = { id: 'tool:echo@1:visual', need: { kind: 'echo' }, capabilityId: 'tool:echo', capabilityVersion: '1', modality: 'visual', inputs: [], outputs: [], requiredPermissions: [], verification: 'verified' } as const
const openclawSurface = { id: 'openclaw:brave@2026.8.1:native', need: { kind: 'web-search' }, capabilityId: 'openclaw:brave', capabilityVersion: '2026.8.1', modality: 'native', inputs: [], outputs: ['web-search'], requiredPermissions: [], verification: 'testing' } as const

describe('HARDNESS execution bridge', () => {
  it('approves then delegates the verified tool route to ctx.tools.execute', async () => {
    const execute = vi.fn<ToolRuntime['execute']>(async () => ({ value: null, content: [], isError: false as const }))
    const route = vi.fn(() => ({ kind: 'route', route: { need: toolSurface.need, capability: { id: 'tool:echo', version: '1', status: 'verified' }, modality: 'visual', requiredPermissions: [] } }))
    const projectSurface = vi.fn(() => toolSurface)
    const broker: CapabilityApproval = { request: vi.fn<CapabilityApproval['request']>(async () => ({ kind: 'approved', grants: [] })) }
    await expect(executeCapabilityNeed({ route, surface: projectSurface } as unknown as Pick<HardnessService, 'route' | 'surface'>, { execute }, broker, toolSurface.need, { text: 'hi' }, { callId: 'c1' as never, signal: new AbortController().signal })).resolves.toMatchObject({ kind: 'executed', surface: toolSurface })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'echo', arguments: { text: 'hi' } }))
  })

  it('approves then delegates a non-tool OpenClaw route to the external executor', async () => {
    const tools = { execute: vi.fn<ToolRuntime['execute']>() }
    const route = vi.fn(() => ({ kind: 'route', route: { need: openclawSurface.need, capability: { id: 'openclaw:brave', version: '2026.8.1', status: 'testing' }, modality: 'native', requiredPermissions: [] } }))
    const projectSurface = vi.fn(() => openclawSurface)
    const approval = { request: vi.fn(async () => ({ kind: 'approved' as const, grants: [] })) }
    const external = {
      supports: vi.fn(() => true),
      execute: vi.fn(async () => ({ value: null, content: [], isError: false as const })),
    }

    await expect(executeCapabilityNeed(
      { route, surface: projectSurface } as unknown as Pick<HardnessService, 'route' | 'surface'>,
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
    const approval: CapabilityApproval = { request: vi.fn<CapabilityApproval['request']>(async () => ({ kind: 'denied', reason: 'user denied' })) }
    const externalExecute = vi.fn<CapabilityExecutor['execute']>()
    const external: CapabilityExecutor = { supports: vi.fn(() => true), execute: externalExecute }

    await expect(executeCapabilityNeed(
      { route, surface: projectSurface } as unknown as Pick<HardnessService, 'route' | 'surface'>,
      { execute: vi.fn<ToolRuntime['execute']>() },
      approval,
      openclawSurface.need,
      {},
      { callId: 'c3' as never, signal: new AbortController().signal },
      external,
    )).resolves.toEqual({ kind: 'denied', reason: 'user denied' })
    expect(externalExecute).not.toHaveBeenCalled()
  })

  it('runs the pre-execution gate after approval and before the side effect', async () => {
    const order: string[] = []
    const execute = vi.fn<ToolRuntime['execute']>(async () => {
      order.push('execute')
      return { value: null, content: [], isError: false as const }
    })
    const route = vi.fn(() => ({ kind: 'route', route: { need: toolSurface.need, capability: { id: 'tool:echo', version: '1', status: 'verified' }, modality: 'visual', requiredPermissions: [] } }))
    const projectSurface = vi.fn(() => toolSurface)
    const approval: CapabilityApproval = { request: vi.fn<CapabilityApproval['request']>(async () => { order.push('approved'); return { kind: 'approved', grants: [] } }) }

    await expect(executeCapabilityNeed(
      { route, surface: projectSurface } as unknown as Pick<HardnessService, 'route' | 'surface'>,
      { execute },
      approval,
      toolSurface.need,
      {},
      { callId: 'c4' as never, signal: new AbortController().signal },
      undefined,
      { beforeExecute: () => { order.push('before-execute'); return true } },
    )).resolves.toMatchObject({ kind: 'executed' })
    expect(order).toEqual(['approved', 'before-execute', 'execute'])
  })

  it('can abort after approval without executing the capability', async () => {
    const execute = vi.fn<ToolRuntime['execute']>()
    const route = vi.fn(() => ({ kind: 'route', route: { need: toolSurface.need, capability: { id: 'tool:echo', version: '1', status: 'verified' }, modality: 'visual', requiredPermissions: [] } }))
    const projectSurface = vi.fn(() => toolSurface)
    const approval: CapabilityApproval = { request: vi.fn<CapabilityApproval['request']>(async () => ({ kind: 'approved', grants: [] })) }

    await expect(executeCapabilityNeed(
      { route, surface: projectSurface } as unknown as Pick<HardnessService, 'route' | 'surface'>,
      { execute },
      approval,
      toolSurface.need,
      {},
      { callId: 'c5' as never, signal: new AbortController().signal },
      undefined,
      { beforeExecute: () => false },
    )).resolves.toEqual({ kind: 'aborted', reason: 'pre-execution gate rejected dispatch' })
    expect(execute).not.toHaveBeenCalled()
  })
})
