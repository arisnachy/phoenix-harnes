import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SystemPrompt, { renderContextSnapshot, renderPrompt } from '@phoenix-ai/dsh-system-prompt'

describe('human conversational contract', () => {
  it('keeps PHOENIX natural, warm, situationally humorous, and discreet with background context', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)

    const prompt = renderPrompt(await ctx.systemPrompt.assemble())

    expect(prompt).toContain('Write naturally and conversationally')
    expect(prompt).toContain('dry wit, mild sarcasm or irony, friendly teasing')
    expect(prompt).toContain('do not force humor')
    expect(prompt).toContain('Do not produce unsolicited status, memory, profile, or context summaries')
    expect(prompt).toContain('silent background context')
    expect(prompt).toContain('Never recite private or background details just to demonstrate memory')
    expect(prompt).toContain('a materially different permitted strategy')
    expect(prompt).toContain('never activate unrelated accounts')
    expect(prompt).toContain('never present uncertain predictions as guaranteed wins')
  })

  it('keeps the mature conversation guidance opt-in at the system-prompt registry', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(section => section.name === 'conversation:mature')).toBe(false)
  })

  it('enables a consent-aware, nonjudgmental adult conversational style without changing provider boundaries', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { matureConversation: true })

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.map(section => section.name)).toContain('conversation:mature')
    const prompt = renderPrompt(assembly)
    expect(prompt).toContain('without moralizing, shaming, or unnecessary deflection')
    expect(prompt).toContain('flirtatious, or suggestive language where supported')
    expect(prompt).toContain('Preserve protections for minors, coercion, exploitation')
    expect(prompt).toContain('applicable model-provider restrictions')
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
