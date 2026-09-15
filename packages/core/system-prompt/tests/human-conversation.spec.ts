import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SystemPrompt, { renderContextSnapshot, renderPrompt } from '@phoenix-ai/dsh-system-prompt'

describe('human conversational contract', () => {
  it('keeps PHOENIX natural, warm, situationally humorous, and discreet with background context', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)

    const prompt = renderPrompt(await ctx.systemPrompt.assemble())

    expect(prompt).toContain('Write naturally and conversationally')
    expect(prompt).toContain('Use light, situational humor when it fits')
    expect(prompt).toContain('Do not produce unsolicited status, memory, profile, or context summaries')
    expect(prompt).toContain('silent background context')
    expect(prompt).toContain('Never recite private or background details just to demonstrate memory')
  })

  it('labels runtime context as silent background rather than conversation to recite', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.context({
      name: 'memory',
      order: 0,
      text: 'private background fact',
    })

    const snapshot = renderContextSnapshot(await ctx.systemPrompt.assemble())

    expect(snapshot).toContain('Background runtime context (silent;')
    expect(snapshot).toContain('Do not summarize, recite, or reveal it unless')
    expect(snapshot).toContain('private background fact')
    expect(snapshot).not.toContain('Current runtime context.')
  })
})
