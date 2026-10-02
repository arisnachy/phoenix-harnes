import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import {
  agentEvents,
  defaultExecutionHandoff,
  installModelSelection,
  isCodexPlannerModel,
  isContextualConversationFastPathText,
  isConversationalFastPathText,
  jevSelectedModelId,
  PHOENIX_CODEX_AUTO_MODEL,
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
    expect(isConversationalFastPathText('como te va que se cuenta')).toBe(true)
    expect(isConversationalFastPathText('¿cómo te va, qué se cuenta?')).toBe(true)
    expect(isConversationalFastPathText('hola, cómo te va, qué se cuenta')).toBe(true)
    expect(isConversationalFastPathText('que quieres que hagamos')).toBe(false)
    expect(isContextualConversationFastPathText('que quieres que hagamos')).toBe(true)
    expect(isContextualConversationFastPathText('¿qué te gustaría que hagamos?')).toBe(true)
    expect(isContextualConversationFastPathText('de qué hablamos')).toBe(true)
    expect(isConversationalFastPathText('cuéntame algo bueno')).toBe(true)
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
    expect(isConversationalFastPathText('qué se cuenta de OpenAI hoy')).toBe(false)
    expect(isConversationalFastPathText('qué quieres que hagamos con Phoenix')).toBe(false)
    expect(isContextualConversationFastPathText('qué quieres que hagamos con Phoenix')).toBe(false)
    expect(isConversationalFastPathText('cómo te va el build de Phoenix')).toBe(false)
    expect(isConversationalFastPathText('¿esto parece un error de memoria?')).toBe(false)
    expect(isConversationalFastPathText('qué tiempo hace hoy')).toBe(false)
    expect(isConversationalFastPathText('https://example.com')).toBe(false)
  })

  it('keeps every selected model inside the real Kira Team delegation path when Team is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [
        { name: 'read', description: 'read a file', parameters: { type: 'object' } },
        { name: 'spawn_teammate', description: 'create a Kira teammate', parameters: { type: 'object' } },
        { name: 'subagent', description: 'legacy subagent', parameters: { type: 'object' } },
        { name: 'subagent_fork', description: 'legacy fork', parameters: { type: 'object' } },
      ],
    }))
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)

    const autoAssembly = await ctx.systemPrompt.assemble()
    expect(autoAssembly.tools.map(tool => tool.name)).toEqual(['read', 'spawn_teammate'])
    expect(selection.assembledToolCount).toBe(2)

    selection.current = { provider: 'openai-codex', model: 'gpt-6-luna' }
    const explicitAssembly = await ctx.systemPrompt.assemble()
    expect(explicitAssembly.tools.map(tool => tool.name)).toEqual(['read', 'spawn_teammate'])

    selection.current = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    const externalAssembly = await ctx.systemPrompt.assemble()
    expect(externalAssembly.tools.map(tool => tool.name)).toEqual(['read', 'spawn_teammate'])

    dispose()
    await ctx.fiber.dispose()
  })

  it('routes Phoenix Auto from Sol planning to Luna Max execution', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [{ name: 'read', description: 'read a file', parameters: { type: 'object' } }],
    }))
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const events: { type: string; data: unknown }[] = [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Arregla router.ts y ejecuta los tests.' }],
        },
      },
    ]
    const agent = { session: { events } } as unknown as Agent
    const signal = new AbortController().signal
    const seed: LlmCallConfig = { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL }
    await ctx.systemPrompt.assemble()

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: ReasoningEffortId('xhigh'),
    })
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

  it('uses Sol xhigh for clearly difficult Phoenix Auto planning', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [{ name: 'read', description: 'read a file', parameters: { type: 'object' } }],
    }))
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL },
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
              content: [{
                type: 'text',
                text: 'Refactoriza la arquitectura completa, migra varios paquetes y deja todo el CI verde.',
              }],
            },
          },
        ],
      },
    } as unknown as Agent
    const signal = new AbortController().signal
    const seed: LlmCallConfig = { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL }
    await ctx.systemPrompt.assemble()

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: ReasoningEffortId('xhigh'),
    })

    dispose()
    await ctx.fiber.dispose()
  })

  it('routes real Kira Team work to Luna Max and escalates a blocker to Sol xhigh once', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const events: { type: string; data: unknown }[] = [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        data: {
          source: {
            kind: 'team-message',
            messageId: 'team-result-1',
            purpose: 'result',
          },
          content: [{ type: 'text', text: 'La Forja terminó el cambio y las pruebas focales pasan.' }],
        },
      },
    ]
    const agent = { session: { events } } as unknown as Agent
    const signal = new AbortController().signal
    const seed: LlmCallConfig = { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL }
    await ctx.systemPrompt.assemble()

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6-luna',
      reasoningEffort: ReasoningEffortId('max'),
    })

    events.push(
      { type: 'turn/start', data: { turn: 2 } },
      {
        type: 'user/message',
        data: {
          source: {
            kind: 'team-message',
            messageId: 'team-blocker-1',
            purpose: 'blocker',
          },
          content: [{ type: 'text', text: 'La Forja encontró dos estrategias incompatibles y necesita dirección.' }],
        },
      },
    )

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 2, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: ReasoningEffortId('xhigh'),
    })
    // The same blocker must not hold Sol for the rest of the turn; Kira returns
    // immediately to Luna Max after the one strategic intervention.
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 2, step: 2, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6-luna',
      reasoningEffort: ReasoningEffortId('max'),
    })

    dispose()
    await ctx.fiber.dispose()
  })

  it('returns a direct Codex Team blocker to the selected Lead before Luna Max execution resumes', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selection: ModelSelectionRef = {
      current: {
        provider: 'openai-codex',
        model: 'gpt-6-astra',
        reasoningEffort: ReasoningEffortId('high'),
      },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const events: { type: string; data: unknown }[] = [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        data: {
          source: {
            kind: 'team-message',
            messageId: 'team-blocker-direct-1',
            purpose: 'blocker',
          },
          content: [{ type: 'text', text: 'Atlas needs the Lead to choose between two incompatible fixes.' }],
        },
      },
    ]
    const agent = { session: { events } } as unknown as Agent
    const signal = new AbortController().signal
    const seed: LlmCallConfig = {
      provider: 'openai-codex',
      model: 'gpt-6-astra',
      reasoningEffort: ReasoningEffortId('high'),
    }
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

  it('uses the selected Codex model as Team Lead, Luna Max as muscle, and returns blockers to that Lead', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [
        { name: 'read', description: 'read a file', parameters: { type: 'object' } },
        { name: 'spawn_teammate', description: 'create a Kira teammate', parameters: { type: 'object' } },
      ],
    }))
    const selection: ModelSelectionRef = {
      current: {
        provider: 'openai-codex',
        model: 'gpt-6-astra',
        reasoningEffort: ReasoningEffortId('high'),
      },
      assembled: undefined,
    }
    // Team mode itself enables the selected-planner -> Luna Max handoff even
    // when a caller did not explicitly supply the legacy handoff resolver.
    const dispose = installModelSelection(ctx, selection)
    const events: { type: string; data: unknown }[] = [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Arregla router.ts y valida el resultado.' }],
        },
      },
    ]
    const agent = { session: { events } } as unknown as Agent
    const signal = new AbortController().signal
    const seed: LlmCallConfig = {
      provider: 'openai-codex',
      model: 'gpt-6-astra',
      reasoningEffort: ReasoningEffortId('high'),
    }
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

    events.push({
      type: 'user/message',
      data: {
        source: {
          kind: 'team-message',
          messageId: 'direct-midturn-blocker',
          purpose: 'blocker',
        },
        content: [{ type: 'text', text: 'Atlas está bloqueado y necesita una decisión del Lead.' }],
      },
    })
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 3, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual(seed)
    // One Lead intervention is enough for this blocker; execution then returns
    // to the cheaper/faster Luna Max worker route.
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 4, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6-luna',
      reasoningEffort: ReasoningEffortId('max'),
    })

    dispose()
    await ctx.fiber.dispose()
  })

  it('returns repeated direct Codex execution failures to the selected Lead without a Team blocker message', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [
        { name: 'read', description: 'read a file', parameters: { type: 'object' } },
        { name: 'spawn_teammate', description: 'create a Kira teammate', parameters: { type: 'object' } },
      ],
    }))
    const selection: ModelSelectionRef = {
      current: {
        provider: 'openai-codex',
        model: 'gpt-6-astra',
        reasoningEffort: ReasoningEffortId('high'),
      },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection)
    const events: { type: string; data: unknown }[] = [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Repara router.ts y termina la tarea.' }],
        },
      },
    ]
    const agent = { session: { events } } as unknown as Agent
    const signal = new AbortController().signal
    const seed: LlmCallConfig = {
      provider: 'openai-codex',
      model: 'gpt-6-astra',
      reasoningEffort: ReasoningEffortId('high'),
    }
    await ctx.systemPrompt.assemble()

    await agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed),
    )
    await agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 2, signal }, () => Promise.resolve(seed),
    )
    events.push({
      type: 'tool/result',
      data: {
        turn: 1,
        step: 2,
        error: { name: 'ToolError', code: 'E_REPEAT' },
        message: { content: [{ type: 'text', text: 'same failure at line 42' }] },
      },
    })
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 3, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6-luna',
      reasoningEffort: ReasoningEffortId('max'),
    })
    events.push({
      type: 'tool/result',
      data: {
        turn: 1,
        step: 3,
        error: { name: 'ToolError', code: 'E_REPEAT' },
        message: { content: [{ type: 'text', text: 'same failure at line 77' }] },
      },
    })

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 4, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual(seed)
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 5, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6-luna',
      reasoningEffort: ReasoningEffortId('max'),
    })

    dispose()
    await ctx.fiber.dispose()
  })

  it('continues a Phoenix Auto task when the Sol planning step stops before executing tools', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [{ name: 'read', description: 'read a file', parameters: { type: 'object' } }],
    }))
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const events: { type: string; data: unknown }[] = [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Arregla router.ts y ejecuta los tests.' }],
        },
      },
    ]
    const steered: unknown[] = []
    const agent = {
      session: { events },
      steer: (message: unknown) => { steered.push(message) },
    } as unknown as Agent
    const signal = new AbortController().signal
    const seed: LlmCallConfig = { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL }

    await ctx.systemPrompt.assemble()
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: ReasoningEffortId('xhigh'),
    })
    events.push({
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        message: {
          source: { provider: 'openai-codex', model: 'gpt-6.1-sol' },
          content: [{ type: 'text', text: 'Primero revisaré el router y después ejecutaré las pruebas.' }],
        },
      },
    })

    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal })
    expect(steered).toHaveLength(1)
    expect(JSON.stringify(steered[0])).toMatch(/execute the next concrete action/i)

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

  it('recovers when Luna later announces another action and stops instead of doing it', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [{ name: 'read', description: 'read a file', parameters: { type: 'object' } }],
    }))
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const events: { type: string; data: unknown }[] = [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Revisa Phoenix y arregla el problema.' }],
        },
      },
    ]
    const steered: unknown[] = []
    const agent = {
      session: { events },
      steer: (message: unknown) => { steered.push(message) },
    } as unknown as Agent
    const signal = new AbortController().signal
    const seed: LlmCallConfig = { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL }

    await ctx.systemPrompt.assemble()
    await agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed),
    )
    events.push({
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        message: {
          source: { provider: 'openai-codex', model: 'gpt-6.1-sol' },
          content: [{ type: 'text', text: 'Voy a revisar primero los archivos relevantes.' }],
        },
      },
    })
    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal })

    await agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 2, signal }, () => Promise.resolve(seed),
    )
    events.push(
      {
        type: 'tool/call',
        data: { turn: 1, step: 2, name: 'read', arguments: '{"path":"router.ts"}' },
      },
      {
        type: 'tool/result',
        data: {
          turn: 1,
          step: 2,
          message: { role: 'tool', content: [{ type: 'text', text: 'router contents' }] },
        },
      },
      {
        type: 'assistant/message',
        data: {
          turn: 1,
          step: 3,
          message: {
            source: { provider: 'openai-codex', model: 'gpt-6-luna' },
            content: [{
              type: 'text',
              text: 'Para ir más rápido, usaré la vía directa para cada tarea y haré pruebas focalizadas.',
            }],
          },
        },
      },
    )

    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal })
    expect(steered).toHaveLength(2)
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 4, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: ReasoningEffortId('xhigh'),
    })

    dispose()
    await ctx.fiber.dispose()
  })

  it('does not override a same-step tool action that intentionally concludes the turn', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [{ name: 'browser_open', description: 'open a page', parameters: { type: 'object' } }],
    }))
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const events: { type: string; data: unknown }[] = [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Abre la interfaz y comprueba que cargue.' }],
        },
      },
      {
        type: 'assistant/message',
        data: {
          turn: 1,
          step: 1,
          message: {
            source: { provider: 'openai-codex', model: 'gpt-6.1-sol' },
            content: [
              { type: 'text', text: 'Ahora comprobaré la interfaz.' },
              { type: 'tool-call', id: 'call-1', name: 'browser_open', arguments: '{"url":"http://127.0.0.1:3080"}' },
            ],
          },
        },
      },
      {
        type: 'tool/call',
        data: { turn: 1, step: 1, name: 'browser_open', arguments: '{"url":"http://127.0.0.1:3080"}' },
      },
      {
        type: 'tool/result',
        data: {
          turn: 1,
          step: 1,
          message: { role: 'tool', content: [{ type: 'text', text: 'opened' }] },
        },
      },
    ]
    const steered: unknown[] = []
    const agent = {
      session: { events },
      steer: (message: unknown) => { steered.push(message) },
    } as unknown as Agent
    const signal = new AbortController().signal

    await ctx.systemPrompt.assemble()
    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal })
    expect(steered).toEqual([])

    dispose()
    await ctx.fiber.dispose()
  })

  it('does not extend a Phoenix Auto turn that reports concrete completion', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [{ name: 'read', description: 'read a file', parameters: { type: 'object' } }],
    }))
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const events: { type: string; data: unknown }[] = [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Arregla router.ts y ejecuta los tests.' }],
        },
      },
      {
        type: 'tool/call',
        data: { turn: 1, step: 2, name: 'read', arguments: '{"path":"router.ts"}' },
      },
      {
        type: 'tool/result',
        data: {
          turn: 1,
          step: 2,
          message: { role: 'tool', content: [{ type: 'text', text: 'done' }] },
        },
      },
      {
        type: 'assistant/message',
        data: {
          turn: 1,
          step: 3,
          message: {
            source: { provider: 'openai-codex', model: 'gpt-6-luna' },
            content: [{ type: 'text', text: 'Corregido. Los tests pasan y el cambio quedó verificado.' }],
          },
        },
      },
    ]
    const steered: unknown[] = []
    const agent = {
      session: { events },
      steer: (message: unknown) => { steered.push(message) },
    } as unknown as Agent
    const signal = new AbortController().signal

    await ctx.systemPrompt.assemble()
    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal })
    expect(steered).toEqual([])

    dispose()
    await ctx.fiber.dispose()
  })

  it('uses Luna low for answer-only Phoenix Auto turns', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL },
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
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve({
        provider: 'openai-codex',
        model: PHOENIX_CODEX_AUTO_MODEL,
      }),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6-luna',
      reasoningEffort: ReasoningEffortId('low'),
    })

    dispose()
    await ctx.fiber.dispose()
  })

  it('rescues repeated Phoenix Auto tool failures with Sol, then returns to Luna Max', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const events: { type: string; data: unknown }[] = [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Arregla router.ts y ejecuta los tests.' }],
        },
      },
      {
        type: 'tool/result',
        data: {
          turn: 1,
          step: 2,
          error: { name: 'ToolError', code: 'TS2345' },
          message: { role: 'tool', content: [{ type: 'text', text: 'TS2345 at router.ts:42' }] },
        },
      },
      {
        type: 'tool/result',
        data: {
          turn: 1,
          step: 3,
          error: { name: 'ToolError', code: 'TS2345' },
          message: { role: 'tool', content: [{ type: 'text', text: 'TS2345 at router.ts:84' }] },
        },
      },
    ]
    const agent = { session: { events } } as unknown as Agent
    const signal = new AbortController().signal
    const seed: LlmCallConfig = { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL }
    await ctx.systemPrompt.assemble()

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 4, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: ReasoningEffortId('xhigh'),
    })
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 5, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6-luna',
      reasoningEffort: ReasoningEffortId('max'),
    })

    dispose()
    await ctx.fiber.dispose()
  })

  it('keeps an explicit selection exact when adaptive handoff is not installed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selected = {
      provider: 'openai-codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: ReasoningEffortId('xhigh'),
    } as const
    const selection: ModelSelectionRef = { current: selected, assembled: undefined }
    const dispose = installModelSelection(ctx, selection)
    const events: { type: string; data: unknown }[] = [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'hola' }],
        },
      },
    ]
    const agent = { session: { events } } as unknown as Agent
    const signal = new AbortController().signal
    const seed: LlmCallConfig = { provider: 'seed', model: 'seed', reasoningEffort: ReasoningEffortId('max') }
    await ctx.systemPrompt.assemble()

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual(selected)
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 2, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual(selected)

    dispose()
    await ctx.fiber.dispose()
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

  it('routes a contextual conversational opener to Luna/low while preserving its context-aware classification', async () => {
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
              content: [{ type: 'text', text: 'que quieres que hagamos' }],
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

  it('restores the selector route after a conversational fast turn', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selected = {
      provider: 'openai-codex',
      model: 'gpt-6-sol',
      reasoningEffort: ReasoningEffortId('max'),
    } as const
    const selection: ModelSelectionRef = {
      current: selected,
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const events: { type: string; data: unknown }[] = [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'hola' }],
        },
      },
    ]
    const agent = { session: { events } } as unknown as Agent
    const signal = new AbortController().signal
    const seed: LlmCallConfig = { ...selected }

    await ctx.systemPrompt.assemble()
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-6-luna',
      reasoningEffort: ReasoningEffortId('low'),
    })
    expect(selection.current).toEqual(selected)

    events.push(
      { type: 'turn/start', data: { turn: 2 } },
      {
        type: 'user/message',
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Analiza este problema con detalle.' }],
        },
      },
    )
    await ctx.systemPrompt.assemble()
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 2, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual(seed)
    expect(selection.current).toEqual(selected)

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

  it('uses premium Codex models as planners and the active Luna worker at Max', () => {
    expect(isCodexPlannerModel('gpt-5.6-sol')).toBe(true)
    expect(isCodexPlannerModel('gpt-6.1-sol')).toBe(true)
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
    expect(defaultExecutionHandoff({ provider: 'openai-codex', model: 'gpt-6.1-sol' })).toEqual({
      afterStep: 1,
      selection: {
        provider: 'openai-codex',
        model: 'gpt-6-luna',
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
