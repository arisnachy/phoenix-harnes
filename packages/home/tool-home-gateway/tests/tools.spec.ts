import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRuntime from '@phoenix-ai/dsh-tools'
import { apply } from '../src/index.ts'

const signal = new AbortController().signal

describe('Home Assistant model-facing tools', () => {
  it('publishes safe schemas and explicit gateway guidance', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.provide('home', {
      listDevices: async () => [],
      control: async () => ({ entityId: 'light.office', service: 'light.turn_on', status: 200, succeeded: true }),
    } as never)
    apply(ctx)

    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(['home_list_devices', 'home_control'])
    expect((ctx.tools.schemas()[1]?.parameters as { properties: Record<string, unknown> }).properties).toHaveProperty('entity_id')
    expect((await ctx.systemPrompt.assemble()).sections.map(section => section.text).join('\n')).toContain('allowlisted Home Assistant gateway')
  })

  it('delegates list and control calls with the caller cancellation signal', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const calls: unknown[] = []
    ctx.provide('home', {
      listDevices: async (received: AbortSignal) => { calls.push(received); return [] },
      control: async (request: unknown, received: AbortSignal) => {
        calls.push(request, received)
        return { entityId: 'light.office', service: 'light.turn_on', status: 200, succeeded: true }
      },
    } as never)
    apply(ctx)

    const listTool = ctx.tools.get('home_list_devices')
    const controlTool = ctx.tools.get('home_control')
    expect(listTool).toBeDefined()
    expect(controlTool).toBeDefined()
    await listTool?.execute({}, { signal } as never)
    await controlTool?.execute({ entity_id: 'light.office', service: 'turn_on', data: { brightness: 80 } }, { signal } as never)

    expect(calls).toEqual([
      signal,
      { entityId: 'light.office', service: 'turn_on', data: { brightness: 80 } },
      signal,
    ])
  })

  it('routes physical control through the shared approval gate', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    let controlled = false
    ctx.provide('home', {
      listDevices: async () => [],
      control: async () => {
        controlled = true
        return { entityId: 'light.office', service: 'light.turn_on', status: 200, succeeded: true }
      },
    } as never)
    apply(ctx)

    const result = await ctx.tools.execute({
      callId: 'home-control-approval' as never,
      name: 'home_control',
      arguments: { entity_id: 'light.office', service: 'turn_on', data: {} },
      signal,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('requires approval') })
    expect(controlled).toBe(false)
  })
})
