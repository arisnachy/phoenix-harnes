import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import HardnessRegistry from '../../hardness/src/index.ts'
import { indexSkills, indexTools } from '../src/index.ts'
import type { HardnessService } from '../../hardness/src/types.ts'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { SkillRegistry, SkillSummary } from '@deepseek-ai/dsh-skill'

describe('HARDNESS source adapters', () => {
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
    expect(hardness.get('skill:calendar-planning' as never)?.status).toBe('experimental')

    disposeTools()
    disposeSkills()
    expect(hardness.list()).toEqual([])
    await context.fiber.dispose()
  })
})
