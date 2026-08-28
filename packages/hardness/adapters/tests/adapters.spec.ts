import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import HardnessRegistry from '../../hardness/src/index.ts'
import { indexSkills, indexTools } from '../src/index.ts'
import type { HardnessService } from '../../hardness/src/types.ts'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { SkillRegistry, SkillSummary } from '@deepseek-ai/dsh-skill'

describe('HARDNESS source adapters', () => {
  it('projects tools and skills with discoverable contract metadata and disposes owned descriptors', async () => {
    const context = new Context()
    await context.plugin(HardnessRegistry)
    const hardness = context.get('hardness') as HardnessService | undefined
    if (hardness === undefined) throw new Error('hardness service missing')

    const tools = { schemas: () => [{
      name: 'read_calendar',
      description: 'Reads calendar events.',
      parameters: {
        type: 'object',
        properties: {
          calendarId: { type: 'string' },
          date: { type: 'string' },
        },
        required: ['date'],
      },
    }] } as unknown as ToolRuntime
    const skills = { list: async () => [{
      name: 'calendar-planning',
      description: 'Plans calendar events.',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'runtime',
      provider: 'fixture',
    } as SkillSummary] } as unknown as SkillRegistry

    const disposeTools = indexTools(tools, hardness)
    const disposeSkills = await indexSkills(skills, hardness)

    const tool = hardness.get('tool:read_calendar' as never)
    expect(tool?.status).toBe('experimental')
    expect(tool?.modalities).toEqual(['native'])
    expect(tool?.inputs).toEqual(['calendarId', 'date'])
    expect(tool?.compatibility).toContain('json-schema:object')
    expect(tool?.limitations).toContain('output contract unavailable from model-visible tool schema')

    const skill = hardness.get('skill:calendar-planning' as never)
    expect(skill?.status).toBe('experimental')
    expect(skill?.modalities).toEqual(['native'])
    expect(skill?.compatibility).toEqual(expect.arrayContaining([
      'source:runtime',
      'invocation:model',
      'invocation:user',
    ]))
    expect(skill?.limitations).toContain('skill summary exposes no executable input/output schema')

    expect(hardness.route({ kind: 'tool' }, { modalities: ['native'] }).kind).toBe('missing')

    disposeTools()
    disposeSkills()
    expect(hardness.list()).toEqual([])
    await context.fiber.dispose()
  })
})
