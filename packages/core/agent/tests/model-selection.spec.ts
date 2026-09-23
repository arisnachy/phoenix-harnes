import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import {
  agentEvents,
  defaultExecutionHandoff,
  installModelSelection,
  isCodexPlannerModel,
  isConversationalFastPathText,
  jevSelectedModelId,
  type Agent,
  type ModelSelectionRef,
} from '../src/index.ts'
import { ReasoningEffortId, type LlmCallConfig } from '@phoenix-ai/dsh-llm'

describe('installModelSelection()', () => {
  it('accepts only an explicit Jev choice from the supplied same-family candidates', () => {
    const candidates = ['gpt-5.6-sol', 'gpt-5.6-luna']
    expect(jevSelectedModelId({
      structuredContent: {
        data: {
          result: { selected_model: 'gpt-5.6-luna' },
        },
      },
    }, candidates)).toBe('gpt-5.6-luna')
    expect(jevSelectedModelId({
      structuredContent: {
        data: {
          result: { selected_model: 'claude-sonnet' },
        },
      },
    }, candidates)).toBeUndefined()
    expect(jevSelectedModelId({
      probabilities: {
        'gpt-5.6-sol': 0.1,
        'gpt-5.6-luna': 0.9,
      },
    }, candidates)).toBeUndefined()
  })

  it('classifies narrow social, runtime-meta, and casual-reaction turns for the low-latency path', () => {
    expect(isConversationalFastPathText('hola')).toBe(true)
    expect(isConversationalFastPathText('¿estás usando Jev?')).toBe(true)
    expect(isConversationalFastPathText('gracias')).toBe(true)
    expect(isConversationalFastPathText('eso parece un pollo pavo bien feo jajja')).toBe(true)
    expect(isConversationalFastPathText('a mi super')).toBe(true)
    expect(isConversationalFastPathText('yo estoy súper')).toBe(true)
    expect(isConversationalFastPathText('me siento genial')).toBe(true)
    for (const continuation of [
      'dale',
      'sí',
      'ok',
      'perfecto',
      'listo',
      'bien',
      'no',
      'claro',
      'adelante',
      'continúa',
      'hazlo',
      'go ahead',
    ]) {
      expect(isConversationalFastPathText(continuation)).toBe(false)
    }
    expect(isConversationalFastPathText('revisa el repo y arregla el error')).toBe(false)
    expect(isConversationalFastPathText('¿esto parece un error de memoria?')).toBe(false)
    expect(isConversationalFastPathText('qué tiempo hace hoy')).toBe(false)
    expect(isConversationalFastPathText('https://example.com')).toBe(false)
  })

  it('routes trivial GPT-6 Codex conversation to Luna/low without spending Max reasoning', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: 'gpt-6-sol', reasoningEffort: ReasoningEffortId('max') },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const agent = {
      session: {
        events: [
          { type: 'turn/start', data: { turn: 1 } },
          {
            type: 'user/message',
            data: {
              source: { kind: 'user' },
              content: [{ type: 'text', text: 'hola' }],
            },
          },
        ],
      },
    } as unknown as Agent
    const signal = new AbortController().signal
    await ctx.systemPrompt.assemble()

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request',
      { turn: 1, step: 1, signal },
      () => Promise.resolve({
        provider: 'openai-codex',
        model: 'gpt-6-sol',
        reasoningEffort: ReasoningEffortId('max'),
      }),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6-luna',
      reasoningEffort: ReasoningEffortId('low'),
    })

    dispose()
    await ctx.fiber.dispose()
  })

  it('pins a directly selected GPT-6 Luna route to Max even when the stored selection says medium', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: ReasoningEffortId('medium') },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const agent = {
      session: {
        events: [
          { type: 'turn/start', data: { turn: 1 } },
          {
            type: 'user/message',
            data: {
              source: { kind: 'user' },
              content: [{ type: 'text', text: 'Analiza este problema con detalle.' }],
            },
          },
        ],
      },
    } as unknown as Agent
    const signal = new AbortController().signal
    await ctx.systemPrompt.assemble()

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request',
      { turn: 1, step: 1, signal },
      () => Promise.resolve({
        provider: 'openai-codex',
        model: 'gpt-6-luna',
        reasoningEffort: ReasoningEffortId('medium'),
      }),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6-luna',
      reasoningEffort: ReasoningEffortId('max'),
    })

    dispose()
    await ctx.fiber.dispose()
  })

  it('pins GPT-6 Luna tool acquisition to Max on the first step', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [{ name: 'read', description: 'read a file', parameters: { type: 'object' } }],
    }))
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: ReasoningEffortId('medium') },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const agent = {
      session: {
        events: [
          { type: 'turn/start', data: { turn: 1 } },
          {
            type: 'user/message',
            data: {
              source: { kind: 'user' },
              content: [{ type: 'text', text: 'Arregla router.ts y ejecuta los tests.' }],
            },
          },
        ],
      },
    } as unknown as Agent
    const signal = new AbortController().signal
    await ctx.systemPrompt.assemble()

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request',
      { turn: 1, step: 1, signal },
      () => Promise.resolve({
        provider: 'openai-codex',
        model: 'gpt-6-luna',
        reasoningEffort: ReasoningEffortId('medium'),
      }),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6-luna',
      reasoningEffort: ReasoningEffortId('max'),
    })

    dispose()
    await ctx.fiber.dispose()
  })

  it('uses premium Codex models as planners and the matching Luna generation at Max as worker', () => {
    expect(isCodexPlannerModel('gpt-5.6-sol')).toBe(true)
    expect(isCodexPlannerModel('gpt-6-astra')).toBe(true)
    expect(isCodexPlannerModel('gpt-6-luna')).toBe(false)

    expect(defaultExecutionHandoff({ provider: 'openai-codex', model: 'gpt-5.6-sol' })).toEqual({
      afterStep: 1,
      selection: {
        provider: 'openai-codex',
        model: 'gpt-5.6-luna',
        reasoningEffort: ReasoningEffortId('max'),
      },
    })
    expect(defaultExecutionHandoff({ provider: 'openai-codex', model: 'gpt-6-astra' })).toEqual({
      afterStep: 1,
      selection: {
        provider: 'openai-codex',
        model: 'gpt-6-luna',
        reasoningEffort: ReasoningEffortId('max'),
      },
    })
    expect(defaultExecutionHandoff({ provider: 'openai-codex', model: 'gpt-6-luna' })).toBeUndefined()
    expect(defaultExecutionHandoff({ provider: 'other', model: 'custom' })).toBeUndefined()
  })

  it('uses a medium first evidence step for Luna tool work, then returns to the selected Max effort', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [{ name: 'read', description: 'read a file', parameters: { type: 'object' } }],
    }))
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: 'gpt-5.6-luna', reasoningEffort: ReasoningEffortId('max') },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const agent = {
      session: {
        events: [
          { type: 'turn/start', data: { turn: 1 } },
          {
            type: 'user/message',
            data: {
              source: { kind: 'user' },
              content: [{ type: 'text', text: 'Arregla test_jsonparse.py y ejecuta los tests.' }],
            },
          },
        ],
      },
    } as unknown as Agent
    const seed: LlmCallConfig = {
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      reasoningEffort: ReasoningEffortId('max'),
    }
    const signal = new AbortController().signal
    await ctx.systemPrompt.assemble()

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      reasoningEffort: ReasoningEffortId('medium'),
    })
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 2, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      reasoningEffort: ReasoningEffortId('max'),
    })

    dispose()
    await ctx.fiber.dispose()
  })

  it('keeps Sol/Astra on the first operational planning step, then hands execution to Luna Max', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [{ name: 'read', description: 'read a file', parameters: { type: 'object' } }],
    }))
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: 'gpt-6-astra', reasoningEffort: ReasoningEffortId('high') },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const agent = {
      session: {
        events: [
          { type: 'turn/start', data: { turn: 1 } },
          {
            type: 'user/message',
            data: {
              source: { kind: 'user' },
              content: [{ type: 'text', text: 'Arregla router.ts y ejecuta los tests.' }],
            },
          },
        ],
      },
    } as unknown as Agent
    const seed: LlmCallConfig = {
      provider: 'openai-codex',
      model: 'gpt-6-astra',
      reasoningEffort: ReasoningEffortId('high'),
    }
    const signal = new AbortController().signal
    await ctx.systemPrompt.assemble()

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual(seed)
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 2, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6-luna',
      reasoningEffort: ReasoningEffortId('max'),
    })

    dispose()
    await ctx.fiber.dispose()
  })

  it('keeps the selected Max effort for a non-operational first step even when tools exist', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [{ name: 'read', description: 'read a file', parameters: { type: 'object' } }],
    }))
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: 'gpt-5.6-luna', reasoningEffort: ReasoningEffortId('max') },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const agent = {
      session: {
        events: [
          { type: 'turn/start', data: { turn: 1 } },
          {
            type: 'user/message',
            data: {
              source: { kind: 'user' },
              content: [{ type: 'text', text: 'Explícame por qué JSON usa comillas dobles.' }],
            },
          },
        ],
      },
    } as unknown as Agent
    const seed: LlmCallConfig = {
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      reasoningEffort: ReasoningEffortId('max'),
    }
    const signal = new AbortController().signal
    await ctx.systemPrompt.assemble()

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual(seed)

    dispose()
    await ctx.fiber.dispose()
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
      afterStep: 1,
      selection: { provider: 'openai-codex', model: 'gpt-5.6-luna', reasoningEffort: ReasoningEffortId('high') },
    })
    const agent = {} as Agent
    const seed: LlmCallConfig = { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: ReasoningEffortId('high') }
    const signal = new AbortController().signal
    await ctx.systemPrompt.assemble()

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual(seed)
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 2, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      reasoningEffort: ReasoningEffortId('high'),
    })
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 2, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual(seed)

    dispose()
    await ctx.fiber.dispose()
  })
})
