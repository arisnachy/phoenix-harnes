import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import {
  agentEvents,
  defaultExecutionHandoff,
  installModelSelection,
  type Agent,
  type ModelSelectionRef,
} from '../src/index.ts'
import { ReasoningEffortId, type LlmCallConfig } from '@phoenix-ai/dsh-llm'

describe('installModelSelection()', () => {
  it('only provides the default Luna handoff for OpenAI Codex', () => {
    expect(defaultExecutionHandoff({ provider: 'openai-codex', model: 'gpt-5.6-sol' })).toEqual({
      afterStep: 0,
      selection: {
        provider: 'openai-codex',
        model: 'gpt-5.6-luna',
        reasoningEffort: ReasoningEffortId('high'),
      },
    })
    expect(defaultExecutionHandoff({ provider: 'other', model: 'custom' })).toBeUndefined()
  })

  it('snapshots prompt variables and request routing together, then disposes both listeners', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selection: ModelSelectionRef = { current: undefined, assembled: undefined }
    const dispose = installModelSelection(ctx, selection)
    const agent = {} as Agent
    const seed: LlmCallConfig = { provider: 'seed', model: 'seed', temperature: 0.2 }
    const signal = new AbortController().signal

    expect((await ctx.systemPrompt.assemble()).variables).toEqual({})
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toBe(seed)

    selection.current = {
      provider: 'alpha',
      model: 'a1',
      reasoningEffort: ReasoningEffortId('high'),
    }
    expect((await ctx.systemPrompt.assemble()).variables).toMatchObject({ provider: 'alpha', model: 'a1' })
    selection.current = { provider: 'beta', model: 'b1' }
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'alpha',
      model: 'a1',
      reasoningEffort: ReasoningEffortId('high'),
      temperature: 0.2,
    })

    expect((await ctx.systemPrompt.assemble()).variables).toMatchObject({ provider: 'beta', model: 'b1' })
    const inherited: LlmCallConfig = {
      provider: 'alpha',
      model: 'a1',
      reasoningEffort: ReasoningEffortId('max'),
      temperature: 0.2,
    }
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(inherited),
    )).resolves.toEqual({ provider: 'beta', model: 'b1', temperature: 0.2 })

    dispose()
    expect((await ctx.systemPrompt.assemble()).variables).toEqual({})
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 2, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toBe(seed)
    await ctx.fiber.dispose()
  })

  it('hands execution steps to the configured Luna route after the initial plan step', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: ReasoningEffortId('high') },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, {
      afterStep: 0,
      selection: { provider: 'openai-codex', model: 'gpt-5.6-luna', reasoningEffort: ReasoningEffortId('high') },
    })
    const agent = {} as Agent
    const seed: LlmCallConfig = { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: ReasoningEffortId('high') }
    const signal = new AbortController().signal
    await ctx.systemPrompt.assemble()

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual(seed)
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      reasoningEffort: ReasoningEffortId('high'),
    })
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual(seed)

    dispose()
    await ctx.fiber.dispose()
  })
})
