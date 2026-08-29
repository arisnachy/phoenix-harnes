import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import HardnessRegistry from '@phoenix-ai/dsh-hardness/src/index.ts'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { HardnessService } from '@phoenix-ai/dsh-hardness'
import type { HostConnectionHandle } from '@phoenix-ai/dsh-client-connection'
import { AcquisitionRegistry } from '../src/acquisition-registry.ts'
import { OpenClawCapabilityBroker } from '../src/openclaw/broker.ts'
import { createHardnessAcquisition, installHardnessMissionRuntime } from '../src/mission-runtime.ts'

describe('HARDNESS production mission runtime', () => {
  it('resolves a live session and runs the governed mission through RPC', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const hardness = ctx.get('hardness') as HardnessService
    const acquisition = new AcquisitionRegistry(hardness)
    acquisition.register(async need => need.kind === 'weather' ? {
      id: 'tool:weather' as never, kind: 'weather', name: 'Weather', description: 'fixture', inputs: [], outputs: ['forecast'], dependencies: [], requiredPermissions: [], provider: 'fixture', location: 'tool-registry', version: '1', compatibility: [], limitations: [], modalities: ['native'], status: 'experimental',
    } : undefined)
    let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
    const handle = vi.fn((_channel: string, candidate: Parameters<HostConnectionHandle['rpc']['handle']>[1]) => {
      handler = candidate
      return async () => {}
    })
    const connection: HostConnectionHandle = { rpc: { handle } as never }
    const session = { append: vi.fn() }
    const agent = { session } as unknown as Agent
    const tools = { execute: vi.fn(async () => ({ isError: false as const, value: null, content: [], meta: { artifact: { id: 'weather', mime: 'text/html', data: '<h1>Sunny</h1>' } } })) }
    const approval = { request: vi.fn(async () => 'allowed-once' as const) }
    installHardnessMissionRuntime({ connection, agents: { get: id => id === 'session-1' ? agent : undefined }, approval: approval as never, hardness, tools, acquisition })
    await expect(handler?.('mission/run', { sessionId: 'session-1', callId: 'call-1', need: { kind: 'weather' }, args: {} }, new AbortController().signal)).resolves.toMatchObject({ ok: true, value: { kind: 'completed', artifact: { id: 'weather' } } })
    expect(approval.request).toHaveBeenCalled()
    expect(tools.execute).toHaveBeenCalledOnce()
    expect(session.append.mock.calls.map(([type]) => type)).toEqual([
      'hardness/mission', 'hardness/mission', 'hardness/mission', 'hardness/mission',
      'hardness/mission', 'hardness/mission', 'hardness/mission', 'hardness/mission',
    ])
    await ctx.fiber.dispose()
  })

  it('acquires and executes an OpenClaw extension through the same governed RPC', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const hardness = ctx.get('hardness') as HardnessService
    const host = {
      prepare: vi.fn(async (extensionId: string) => ({ kind: 'ready' as const, extensionId })),
      execute: vi.fn(async () => ({
        isError: false as const,
        value: null,
        content: [],
        meta: { artifact: { id: 'search-result', mime: 'text/plain', data: 'phoenix' } },
      })),
      deactivate: vi.fn(async () => {}),
    }
    const broker = new OpenClawCapabilityBroker(host)
    const acquisition = createHardnessAcquisition(hardness, [], broker)
    let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
    const handle = vi.fn((_channel: string, candidate: Parameters<HostConnectionHandle['rpc']['handle']>[1]) => {
      handler = candidate
      return async () => {}
    })
    const connection: HostConnectionHandle = { rpc: { handle } as never }
    const agent = { session: {} } as Agent
    const approval = { request: vi.fn(async () => 'allowed-once' as const) }
    const tools = { execute: vi.fn() }

    installHardnessMissionRuntime({
      connection,
      agents: { get: id => id === 'session-openclaw' ? agent : undefined },
      approval: approval as never,
      hardness,
      tools: tools as never,
      acquisition,
      executor: broker,
    })

    await expect(handler?.(
      'mission/run',
      { sessionId: 'session-openclaw', callId: 'call-openclaw', need: { kind: 'web-search' }, args: { query: 'phoenix' } },
      new AbortController().signal,
    )).resolves.toMatchObject({ ok: true, value: { kind: 'completed', artifact: { id: 'search-result' } } })
    expect(host.prepare).toHaveBeenCalled()
    expect(host.execute).toHaveBeenCalled()
    expect(tools.execute).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})
