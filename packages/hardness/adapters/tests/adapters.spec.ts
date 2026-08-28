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
    context.provide('connection', { rpc: { handle: vi.fn(() => async () => {}) } } as never)
    context.provide('agents', { get: () => undefined } as never)
    context.provide('approval', { request: vi.fn() } as never)

    const dispose = await apply(context)
    expect(context.tools.get('hardness_run')).toBeDefined()
    const assembly = await context.systemPrompt.assemble()
    expect(renderPrompt(assembly)).toContain('<phoenix_hardness_protocol>')

    dispose()
    expect(context.tools.get('hardness_run')).toBeUndefined()
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
