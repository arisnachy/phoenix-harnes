import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntimePlugin from '@deepseek-ai/dsh-tools'
import SkillRegistryPlugin from '@deepseek-ai/dsh-skill'
import HardnessRegistry from '../../hardness/src/index.ts'
import { apply, indexSkills, indexTools } from '../src/index.ts'
import type { HardnessService } from '../../hardness/src/types.ts'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { SkillRegistry, SkillSummary } from '@deepseek-ai/dsh-skill'

describe('HARDNESS source adapters', () => {
  it('mounts the model-facing tool and protocol in the composed runtime', async () => {
    const context = new Context()
    await context.plugin(SystemPrompt)
    await context.plugin(ToolRuntimePlugin)
    await context.plugin(SkillRegistryPlugin)
    await context.plugin(HardnessRegistry)
    const hardness = context.get('hardness') as HardnessService
    context.provide('connection', { rpc: { handle: vi.fn(() => async () => {}) } } as never)
    context.provide('agents', { get: () => undefined } as never)
    context.provide('approval', { request: vi.fn() } as never)

    const dispose = await apply(context)
    expect(context.tools.get('hardness_run')).toBeDefined()
    expect(hardness.get('tool:hardness_run' as never)).toBeUndefined()
    const assembly = await context.systemPrompt.assemble()
    expect(renderPrompt(assembly)).toContain('<phoenix_hardness_protocol>')

    dispose()
    expect(context.tools.get('hardness_run')).toBeUndefined()
    await context.fiber.dispose()
  })

  it('mounts without a connection and waits for the optional RPC host', async () => {
    const context = new Context()
    await context.plugin(SystemPrompt)
    await context.plugin(ToolRuntimePlugin)
    await context.plugin(SkillRegistryPlugin)
    await context.plugin(HardnessRegistry)
    context.provide('agents', { get: () => undefined } as never)
    context.provide('approval', { request: vi.fn() } as never)

    const handle = vi.fn(() => async () => {})
    const dispose = await apply(context)
    expect(context.tools.get('hardness_run')).toBeDefined()
    expect(handle).not.toHaveBeenCalled()

    context.provide('connection', { rpc: { handle } } as never)
    expect(handle).toHaveBeenCalledWith('/hardness', expect.any(Function), { authority: 'loopback' })

    dispose()
    await context.fiber.dispose()
  })

  it('exposes the read-only connector inventory when authorization is mounted', async () => {
    const context = new Context()
    await context.plugin(SystemPrompt)
    await context.plugin(ToolRuntimePlugin)
    await context.plugin(SkillRegistryPlugin)
    await context.plugin(HardnessRegistry)
    context.provide('agents', { get: () => undefined } as never)
    context.provide('approval', { request: vi.fn() } as never)
    context.provide('authorization', {
      list: () => [{
        key: 'authorization-google/account',
        label: 'Google Workspace',
        methods: [{ id: 'oauth', label: 'Sign in with Google' }],
        inFlight: false,
      }],
      inspect: async () => undefined,
    } as never)

    const dispose = await apply(context)
    expect(context.tools.get('connector_list')).toBeDefined()
    expect((context.get('hardness') as HardnessService).get('tool:connector_list' as never)).toBeDefined()

    dispose()
    expect(context.tools.get('connector_list')).toBeUndefined()
    await context.fiber.dispose()
  })

  it('keeps dynamic tool projections synchronized and excludes internal tools', async () => {
    const context = new Context()
    await context.plugin(HardnessRegistry)
    const hardness = context.get('hardness') as HardnessService
    let schemas = [{ name: 'mcp__calendar__list', description: 'List calendar events.' }]
    let change: (() => void) | undefined
    const events = {
      on: vi.fn((_event: 'tools/change', listener: () => void) => {
        change = listener
        return () => { change = undefined }
      }),
    }
    const tools = { schemas: () => schemas } as unknown as ToolRuntime

    const dispose = indexTools(tools, hardness, { events, exclude: ['hardness_run'] })
    expect(hardness.get('tool:mcp__calendar__list' as never)?.description).toBe('List calendar events.')

    schemas = [{ name: 'mcp__calendar__create', description: 'Create a calendar event.' }, { name: 'hardness_run', description: 'internal' }]
    change?.()
    expect(hardness.get('tool:mcp__calendar__list' as never)).toBeUndefined()
    expect(hardness.get('tool:mcp__calendar__create' as never)?.description).toBe('Create a calendar event.')
    expect(hardness.get('tool:hardness_run' as never)).toBeUndefined()

    dispose()
    expect(hardness.list()).toEqual([])
    await context.fiber.dispose()
  })

  it('projects tools and skills and disposes owned descriptors', async () => {
    const context = new Context()
    await context.plugin(HardnessRegistry)
    const hardness = context.get('hardness') as HardnessService | undefined
    if (hardness === undefined) throw new Error('hardness service missing')

    const tools = { schemas: () => [{ name: 'read_calendar', description: 'Reads calendar events.', parameters: { type: 'object' } }] } as unknown as ToolRuntime
    const skills = { list: async () => [{
      name: 'calendar-planning', description: 'Plans calendar events.', invocation: { modelInvocable: true, userInvocable: true }, source: 'runtime', provider: 'fixture',
    } as SkillSummary] } as unknown as SkillRegistry

    const disposeTools = indexTools(tools, hardness)
    const disposeSkills = await indexSkills(skills, hardness)
    expect(hardness.get('tool:read_calendar' as never)?.status).toBe('experimental')
    expect(hardness.get('tool:read_calendar' as never)?.modalities).toEqual(['native'])
    expect(hardness.get('skill:calendar-planning' as never)?.status).toBe('experimental')
    expect(hardness.get('skill:calendar-planning' as never)?.modalities).toEqual(['native'])
    expect(hardness.route({ kind: 'tool' }, { modalities: ['native'] }).kind).toBe('missing')

    disposeTools()
    disposeSkills()
    expect(hardness.list()).toEqual([])
    await context.fiber.dispose()
  })
})
