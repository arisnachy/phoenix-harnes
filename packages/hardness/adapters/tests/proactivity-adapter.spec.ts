import { describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRuntimePlugin from '@phoenix-ai/dsh-tools'
import SkillRegistryPlugin from '@phoenix-ai/dsh-skill'
import HardnessRegistry from '../../hardness/src/index.ts'
import { apply } from '../src/index.ts'

describe('HARDNESS proactivity adapter integration', () => {
  it('exposes scheduled-task tools only in model-facing scopes and disposes them cleanly', async () => {
    const context = new Context()
    await context.plugin(SystemPrompt)
    await context.plugin(ToolRuntimePlugin)
    await context.plugin(SkillRegistryPlugin)
    await context.plugin(HardnessRegistry)
    context.provide('agents', { get: () => undefined } as never)
    context.provide('approval', { request: vi.fn() } as never)

    const dispose = await apply(context, { judgeProvider: 'spawn', modelTools: true })

    expect(context.tools.get('phoenix_task_create')).toBeDefined()\n    expect(context.tools.get('phoenix_watch_create')).toBeDefined()
    expect(context.tools.get('phoenix_task_list')).toBeDefined()
    expect(context.tools.get('phoenix_task_pause')).toBeDefined()
    expect(context.tools.get('phoenix_task_resume')).toBeDefined()
    expect(context.tools.get('phoenix_task_cancel')).toBeDefined()

    dispose()
    expect(context.tools.get('phoenix_task_create')).toBeUndefined()\n    expect(context.tools.get('phoenix_watch_create')).toBeUndefined()
    await context.fiber.dispose()
  })
})
