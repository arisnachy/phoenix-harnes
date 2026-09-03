import { Context } from '@phoenix-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import HardnessRegistry from '@phoenix-ai/dsh-hardness/src/index.ts'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { CapabilityId, HardnessService } from '@phoenix-ai/dsh-hardness'
import type { HostConnectionHandle } from '@phoenix-ai/dsh-client-connection'
import type { ToolRuntime } from '@phoenix-ai/dsh-tools'
import type { Session } from '@phoenix-ai/dsh-session'
import { AcquisitionRegistry } from '../src/acquisition-registry.ts'
import { OpenClawCapabilityBroker } from '../src/openclaw/broker.ts'
import { createHardnessAcquisition, createHardnessMissionRunner, installHardnessMissionRuntime } from '../src/mission-runtime.ts'

describe('HARDNESS production mission runtime', () => {
  it('runs a code artifact through the isolated runtime endpoint', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const hardness = ctx.get('hardness') as HardnessService
    let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
    const handle = vi.fn((_channel: string, candidate: Parameters<HostConnectionHandle['rpc']['handle']>[1]) => {
      handler = candidate
      return async () => {}
    })
    const connection: HostConnectionHandle = { rpc: { handle } as never }
    const append = vi.fn<Session['append']>()
    const agent = { session: { append } } as unknown as Agent
    const runtime = { language: 'typescript', isolation: 'worker-thread', run: vi.fn(async () => ({ logs: ['ok'], value: 1 })) }
    installHardnessMissionRuntime({
      connection,
      agents: { get: id => id === 'session-code' ? agent : undefined },
      approval: { request: vi.fn() } as never,
      hardness,
      tools: { execute: vi.fn() },
      acquisition: new AcquisitionRegistry(hardness),
      codeRuntime: runtime as never,
    })
    await expect(handler?.('artifact/run', {
      sessionId: 'session-code', artifactId: 'artifact-code', callId: 'call-code', language: 'typescript', program: 'return 1',
    }, new AbortController().signal)).resolves.toMatchObject({ ok: true, value: { kind: 'execution', result: { value: 1 } } })
    expect(runtime.run).toHaveBeenCalledWith(expect.objectContaining({ program: 'return 1', bindings: [] }))
    expect(append).toHaveBeenCalledWith('hardness/artifact', {
      artifactId: 'artifact-code', callId: 'call-code', language: 'typescript', result: { logs: ['ok'], value: 1 },
    })
    await ctx.fiber.dispose()
  })

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
    const append = vi.fn<Session['append']>()
    const session = { append, events: [] }
    const agent = { session } as unknown as Agent
    const execute = vi.fn<ToolRuntime['execute']>(async () => ({ isError: false as const, value: null, content: [], meta: { artifact: { id: 'weather', mime: 'text/html', data: '<h1>Sunny</h1>' } } }))
    const tools = { execute }
    const approval = { request: vi.fn(async () => 'allowed-once' as const) }
    const judgeStart = vi.fn(async () => ({
      id: 'judge-run' as never,
      localAgent: undefined,
      result: Promise.resolve({
        stopReason: 'completed' as const,
        output: [],
        structured: {
          verdict: 'pass', summary: 'verified', evidence: ['weather'], required_changes: [],
          criteria: [
            { id: 'artifact-produced', verdict: 'pass', evidence: ['weather'], findings: [] },
            { id: 'artifact-rendered', verdict: 'pass', evidence: ['weather'], findings: [] },
          ],
          quality: { verdict: 'pass', summary: 'complete', evidence: ['weather'], findings: [] },
        },
      }),
      dispose: vi.fn(async () => {}),
    }))
    installHardnessMissionRuntime({
      connection, agents: { get: id => id === 'session-1' ? agent : undefined }, approval: approval as never, hardness, tools, acquisition,
      subagents: {
        getProvider: () => ({ capabilities: { outputSchema: true, toolFilter: true } }) as never,
        start: judgeStart,
      },
    })
    await expect(handler?.('mission/run', { sessionId: 'session-1', callId: 'call-1', need: { kind: 'weather' }, args: {} }, new AbortController().signal)).resolves.toMatchObject({ ok: true, value: { kind: 'completed', artifact: { id: 'weather' } } })
    expect(approval.request).toHaveBeenCalled()
    expect(tools.execute).toHaveBeenCalledOnce()
    expect(judgeStart).toHaveBeenCalledOnce()
    const eventTypes = vi.mocked(session.append).mock.calls.map(([type]) => type)
    expect(eventTypes[0]).toBe('hardness/kernel')
    expect(eventTypes.at(-1)).toBe('hardness/kernel')
    expect(eventTypes.filter(type => type === 'hardness/kernel')).toHaveLength(7)
    expect(eventTypes.filter(type => type === 'hardness/mission')).toHaveLength(8)
    await ctx.fiber.dispose()
  })

  it('renders a generated raster through the production HARDNESS artifact runtime', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const hardness = ctx.get('hardness') as HardnessService
    const imageCapability = {
      id: 'tool:image_generation' as CapabilityId,
      kind: 'image_generation',
      name: 'image_generation',
      description: 'Generate an actual image.',
      inputs: [],
      outputs: [],
      dependencies: [],
      requiredPermissions: [],
      provider: 'dsh-tools',
      location: 'tool-registry',
      version: '1.0.0',
      compatibility: [],
      limitations: [],
      modalities: ['native'],
      status: 'verified',
    } as const
    hardness.register(imageCapability)
    const execute = vi.fn<ToolRuntime['execute']>(async () => ({
      isError: false as const,
      value: null,
      content: [{ type: 'image' as const, attachment: { attachmentId: 'image-1' as never, mediaType: 'image/png' as const, bytes: 3, width: 1, height: 1 } }],
      meta: {
        artifact: {
          id: 'image-1',
          mime: 'image/png',
          data: {
            provider: 'codex',
            model: 'codex-built-in-image-gen',
            attachment: { attachmentId: 'image-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 },
          },
        },
      },
    }))
    const judge = async () => ({
      verdict: 'pass' as const,
      summary: 'verified image',
      evidence: ['image-1'],
      requiredChanges: [],
      criteria: [
        { id: 'artifact-produced', verdict: 'pass' as const, evidence: ['image-1'], findings: [] },
        { id: 'artifact-rendered', verdict: 'pass' as const, evidence: ['image-1'], findings: [] },
      ],
      quality: { verdict: 'pass' as const, summary: 'complete image', evidence: ['image-1'], findings: [] },
    })
    const agent = { session: { append: vi.fn(), events: [] } } as unknown as Agent
    const runner = createHardnessMissionRunner({
      hardness,
      tools: { execute },
      acquisition: new AcquisitionRegistry(hardness),
      approval: { request: vi.fn(async () => 'allowed-once' as const) } as never,
      judge,
    })

    await expect(runner.run({
      need: { kind: 'image_generation' },
      args: { prompt: 'Kira portrait' },
      context: { callId: 'call-image' as never, signal: new AbortController().signal, agent },
    })).resolves.toMatchObject({
      kind: 'completed',
      artifact: { id: 'image-1', mime: 'image/png' },
      rendered: { kind: 'hardness-image', artifactId: 'image-1', mime: 'image/png' },
    })
    expect(execute).toHaveBeenCalledOnce()
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
    const agent = { session: { append: vi.fn(), events: [] } } as unknown as Agent
    const approval = { request: vi.fn(async () => 'allowed-once' as const) }
    const execute = vi.fn<ToolRuntime['execute']>()
    const tools = { execute }
    const judge = async () => ({
      verdict: 'pass' as const, summary: 'verified', evidence: ['search-result'], requiredChanges: [],
      criteria: [
        { id: 'artifact-produced', verdict: 'pass' as const, evidence: ['search-result'], findings: [] },
        { id: 'artifact-rendered', verdict: 'pass' as const, evidence: ['search-result'], findings: [] },
      ],
      quality: { verdict: 'pass' as const, summary: 'complete', evidence: ['search-result'], findings: [] },
    })

    installHardnessMissionRuntime({
      connection,
      agents: { get: id => id === 'session-openclaw' ? agent : undefined },
      approval: approval as never,
      hardness,
      tools,
      acquisition,
      executor: broker,
      judge,
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