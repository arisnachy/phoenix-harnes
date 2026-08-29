import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import HardnessRegistry from '@deepseek-ai/dsh-hardness/src/index.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CapabilityId, HardnessService } from '@deepseek-ai/dsh-hardness'
import type { ToolDefinition, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { AcquisitionRegistry } from '../src/acquisition-registry.ts'
import { installHardnessModelTools } from '../src/model-tools.ts'

describe('HARDNESS model-facing tools', () => {
  it('exposes bounded capability search to the model', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const hardness = ctx.get('hardness') as HardnessService
    hardness.register({
      id: 'skill:calendar-planning' as CapabilityId,
      kind: 'calendar-planning',
      name: 'calendar-planning',
      description: 'Plans calendar work.',
      inputs: [], outputs: [], dependencies: [], requiredPermissions: [],
      provider: 'skill', location: 'runtime', version: '1', compatibility: [], limitations: [], modalities: ['native'], status: 'experimental',
    })
    const definitions: ToolDefinition[] = []
    const tools = {
      register: (definition: ToolDefinition) => {
        definitions.push(definition)
        return () => {}
      },
      execute: vi.fn(),
    } as unknown as Pick<ToolRuntime, 'register' | 'execute'>

    installHardnessModelTools({
      hardness,
      tools,
      approval: { request: vi.fn() } as never,
      acquisition: new AcquisitionRegistry(hardness),
    })

    const search = definitions.find(definition => definition.name === 'capability_search')
    const value = await search?.execute({ query: 'calendar', limit: 6 }, {} as never)

    expect(definitions.map(definition => definition.name)).toEqual(['capability_search', 'capability_run'])
    expect(value).toMatchObject({ query: 'calendar', matches: [expect.objectContaining({ id: 'skill:calendar-planning' })] })
    await ctx.fiber.dispose()
  })

  it('runs a selected capability through approval, evidence, rendering, and promotion', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const hardness = ctx.get('hardness') as HardnessService
    const capabilityId = 'tool:weather' as CapabilityId
    hardness.register({
      id: capabilityId,
      kind: 'weather',
      name: 'weather',
      description: 'Weather lookup.',
      inputs: [], outputs: ['text/plain'], dependencies: [], requiredPermissions: [{ kind: 'network.access' }],
      provider: 'fixture', location: 'tool-registry', version: '1', compatibility: [], limitations: [], modalities: ['native'], status: 'testing',
    })
    const definitions: ToolDefinition[] = []
    const execute = vi.fn(async () => ({
      isError: false as const,
      value: null,
      content: [{ type: 'text' as const, text: 'sunny' }],
    }))
    const tools = {
      register: (definition: ToolDefinition) => {
        definitions.push(definition)
        return () => {}
      },
      execute,
    } as unknown as Pick<ToolRuntime, 'register' | 'execute'>
    const request = vi.fn(async () => 'allowed-once' as const)

    installHardnessModelTools({
      hardness,
      tools,
      approval: { request } as never,
      acquisition: new AcquisitionRegistry(hardness),
    })

    const run = definitions.find(definition => definition.name === 'capability_run')
    const signal = new AbortController().signal
    const agent = { session: {} } as Agent
    const value = await run?.execute(
      { kind: 'weather', payload: { city: 'Santo Domingo' } },
      { callId: 'call-model' as never, signal, agent } as never,
    )

    expect(request).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledOnce()
    expect(value).toMatchObject({ kind: 'completed', artifact: { mime: 'text/plain', data: 'sunny' } })
    expect(run?.output.presentationMeta?.({}, value as never)).toMatchObject({ artifact: { mime: 'text/plain', data: 'sunny' } })
    expect(hardness.get(capabilityId)?.status).toBe('verified')
    await ctx.fiber.dispose()
  })
})