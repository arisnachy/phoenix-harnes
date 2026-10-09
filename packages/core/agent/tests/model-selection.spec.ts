import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import {
  agentEvents,
  defaultExecutionHandoff,
  installModelSelection,
  latestModelSelectionPreference,
  persistModelSelectionPreference,
  isContextualConversationFastPathText,
  isConversationalFastPathText,
  isBriefTeamDemonstration,
  jevSelectedModelId,
  PHOENIX_CODEX_AUTO_MODEL,
  type Agent,
  type ModelSelectionRef,
} from '../src/index.ts'
import { ReasoningEffortId, createUserMessage, type LlmCallConfig } from '@phoenix-ai/dsh-llm'

describe('installModelSelection()', () => {
  it('captures the selected default on first dispatch while blank sessions observe changes', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const session = Session.create(SessionId('default-preference'))
    const agent = { session, options: {} } as unknown as Agent
    ctx.agent = agent
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: 'gpt-6-sol' }, assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    try {
      await ctx.systemPrompt.assemble()
      expect(session.events).toHaveLength(0)
      selection.current = { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL }
      session.append('turn/start', { turn: 1 })
      session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Fix router.ts.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      await ctx.systemPrompt.assemble()
      const signal = new AbortController().signal
      await expect(agentEvents(ctx, agent).waterfall('agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve({ provider: 'seed', model: 'seed' }))).resolves.toMatchObject({ model: 'gpt-6.1-sol' })
      expect(session.events.filter(event => event.type === 'agent/model-selection').map(event => event.data)).toEqual([
        { selection: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL }, source: 'default' },
      ])
      await agentEvents(ctx, agent).waterfall('agent/request', { turn: 1, step: 2, signal }, () => Promise.resolve({ provider: 'seed', model: 'seed' }))
      expect(session.events.filter(event => event.type === 'agent/model-selection')).toHaveLength(1)
      expect(session.events.find(event => event.type === 'agent/model-selection')).not.toHaveProperty('surfaceOp')
      expect(session.events.find(event => event.type === 'agent/model-selection')).not.toHaveProperty('ignorable')
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('restores explicit planner preference independently of the serving Luna request header', () => {
    const session = Session.create(SessionId('explicit-preference'))
    const selected = { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: ReasoningEffortId('xhigh') }
    expect(latestModelSelectionPreference(session)).toBeUndefined()
    expect(persistModelSelectionPreference(session, selected, 'explicit')).toBe(true)
    expect(persistModelSelectionPreference(session, { ...selected }, 'explicit')).toBe(false)
    session.append('request/header', { header: { config: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: ReasoningEffortId('max') } }, reason: 'initial' })
    const restored = Session.fromRestore(session.id, structuredClone(session.events), structuredClone(session.header))
    expect(restored.requestHeader()?.config.model).toBe('gpt-6-luna')
    expect(latestModelSelectionPreference(restored)).toEqual({ selection: selected, source: 'explicit' })
    expect(persistModelSelectionPreference(restored, { provider: 'deepseek', model: 'deepseek-v4-pro' }, 'explicit')).toBe(true)
    expect(latestModelSelectionPreference(restored)).toEqual({ selection: { provider: 'deepseek', model: 'deepseek-v4-pro' }, source: 'explicit' })
  })

  it('does not replace a newer explicit preference with an older assembled default', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const session = Session.create(SessionId('selection-race'))
    const agent = { session, options: {} } as unknown as Agent
    ctx.agent = agent
    const older = { provider: 'openai-codex', model: 'gpt-6-sol' }
    const newer = { provider: 'openai-codex', model: 'gpt-6-astra' }
    const selection: ModelSelectionRef = { current: older, assembled: undefined }
    const dispose = installModelSelection(ctx, selection)
    try {
      await ctx.systemPrompt.assemble()
      persistModelSelectionPreference(session, newer, 'explicit')
      selection.current = newer
      await expect(agentEvents(ctx, agent).waterfall('agent/request', { turn: 1, step: 1, signal: new AbortController().signal }, () => Promise.resolve(older))).resolves.toEqual(older)
      expect(latestModelSelectionPreference(session)).toEqual({ selection: newer, source: 'explicit' })
      expect(session.events).toHaveLength(1)
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

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

  it('keeps every provider specialist delegation inside the real Kira Team path', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [
        { name: 'read', description: 'read a file', parameters: { type: 'object' } },
        { name: 'spawn_teammate', description: 'create a Kira teammate', parameters: { type: 'object' } },
        { name: 'subagent', description: 'legacy subagent', parameters: { type: 'object' } },
        { name: 'subagent_fork', description: 'legacy fork', parameters: { type: 'object' } },
        { name: 'codex_auto_review', description: 'Codex native auto-review worker', parameters: { type: 'object' } },
      ],
    }))
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)

    const autoAssembly = await ctx.systemPrompt.assemble()
    expect(autoAssembly.tools.map(tool => tool.name).sort()).toEqual(['codex_auto_review', 'read', 'spawn_teammate'])
    expect(selection.assembledToolCount).toBe(3)

    selection.current = { provider: 'openai-codex', model: 'gpt-6-luna' }
    const explicitAssembly = await ctx.systemPrompt.assemble()
    expect(explicitAssembly.tools.map(tool => tool.name).sort()).toEqual(['codex_auto_review', 'read', 'spawn_teammate'])

    selection.current = { provider: 'deepseek', model: 'deepseek-v4-pro' }
    const nonCodexAssembly = await ctx.systemPrompt.assemble()
    expect(nonCodexAssembly.tools.map(tool => tool.name).sort()).toEqual(['read', 'spawn_teammate'])

    dispose()
    await ctx.fiber.dispose()
  })

  it('adapts a tiny requested Team demonstration to Sol/medium without sacrificing real work quality', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL }, assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const userMessage = (value: string) => ({
      type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: value }] },
    })
    const events: { type: string; data: unknown }[] = [
      { type: 'turn/start', data: { turn: 1 } },
      userMessage('quiero verte en acción con tu equipo vamos has una pequeña prueba'),
    ]
    const agent = { session: { events }, options: {} } as unknown as Agent
    const signal = new AbortController().signal
    try {
      expect(isBriefTeamDemonstration('quiero verte en accion con tu equipo vamos has una pequena prueba')).toBe(true)
      expect(isBriefTeamDemonstration('haz una prueba con tu equipo en github repo')).toBe(false)
      expect(isBriefTeamDemonstration('Hola, ¿cómo estás?')).toBe(false)
      await ctx.systemPrompt.assemble()
      await expect(agentEvents(ctx, agent).waterfall('agent/request',
        { turn: 1, step: 1, signal }, () => Promise.resolve({ provider: 'seed', model: 'seed' })))
        .resolves.toMatchObject({ model: 'gpt-6.1-sol', reasoningEffort: ReasoningEffortId('medium') })
      await expect(agentEvents(ctx, agent).waterfall('agent/request',
        { turn: 1, step: 2, signal }, () => Promise.resolve({ provider: 'seed', model: 'seed' })))
        .resolves.toMatchObject({ model: 'gpt-6-luna', reasoningEffort: ReasoningEffortId('max') })
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('exposes the first-step Sol plan policy, then switches to a single Luna execution brief', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const events: { type: string; data: unknown }[] = [{ type: 'turn/start', data: { turn: 1 } }]
    const agent = { options: {}, session: { events } } as unknown as Agent
    ctx.agent = agent
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL }, assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection)
    try {
      const first = await ctx.systemPrompt.assemble()
      const firstPolicy = first.sections.find(item => item.name === 'phoenix:auto-visible-handoff')?.text
      expect(firstPolicy).toContain('**Plan:**')
      expect(firstPolicy).toContain('user-visible')
      events.push({ type: 'step/start', data: { turn: 1, step: 1 } })
      const second = await ctx.systemPrompt.assemble()
      const secondPolicy = second.sections.find(item => item.name === 'phoenix:auto-visible-handoff')?.text
      expect(secondPolicy).toContain('already-approved execution brief')
      expect(secondPolicy).not.toContain('FIRST step')
      selection.current = { provider: 'deepseek', model: 'deepseek-v4-pro' }
      const external = await ctx.systemPrompt.assemble()
      expect(external.sections.some(item => item.name === 'phoenix:auto-visible-handoff')).toBe(false)
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('hands off Sol\'s actual visible plan to Luna exactly once before requiring real Team work', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [{ name: 'spawn_teammate', description: 'assign real work', parameters: { type: 'object' } }],
    }))
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL }, assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const events: { type: string; data: unknown }[] = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { source: { kind: 'user' },
        content: [{ type: 'text', text: 'quiero verte en accion con tu equipo haz una pequeña prueba' }] } },
      { type: 'assistant/message', data: { turn: 1, step: 1, message: {
        source: { provider: 'openai-codex', model: 'gpt-6.1-sol' },
        content: [{ type: 'text', text: '**Plan:** Haré una pequeña prueba; asignaré una verificación y compartiré evidencia.' }],
      } } },
    ]
    const steered: unknown[] = []
    const agent = { session: { events }, options: {}, steer: (message: unknown) => { steered.push(message) } } as unknown as Agent
    const signal = new AbortController().signal
    try {
      await ctx.systemPrompt.assemble()
      await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal })
      await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal })
      expect(steered).toHaveLength(1)
      expect(JSON.stringify(steered[0])).toContain('visible **Plan:**')
      expect(JSON.stringify(steered[0])).toContain('spawn_teammate')
      expect(JSON.stringify(steered[0])).not.toContain('Phoenix Auto team admission')
      await expect(agentEvents(ctx, agent).waterfall('agent/request',
        { turn: 1, step: 2, signal }, () => Promise.resolve({ provider: 'seed', model: 'seed' })))
        .resolves.toMatchObject({ model: 'gpt-6-luna', reasoningEffort: ReasoningEffortId('max') })
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
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

  it('routes simple fictional visual requests directly to Luna low, retaining Sol for actual multi-step work', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({ schemas: [
      { name: 'phoenix_visualize', description: 'inline chart', parameters: { type: 'object' } },
      { name: 'spawn_teammate', description: 'create Kira teammate', parameters: { type: 'object' } },
    ] }))
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL }, assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const events: { type: string; data: unknown }[] = [{ type: 'turn/start', data: { turn: 1 } }]
    const agent = { session: { events }, options: {} } as unknown as Agent
    const signal = new AbortController().signal
    const seed = { provider: 'seed', model: 'seed' }
    await ctx.systemPrompt.assemble()
    for (const text of ['crea un grafico ficticio', 'genera una tabla de ejemplo', 'create a sample chart']) {
      events.push({ type: 'user/message', data: {
        source: { kind: 'user' }, content: [{ type: 'text', text }],
      } })
      await expect(agentEvents(ctx, agent).waterfall('agent/request',
        { turn: 1, step: 1, signal }, () => Promise.resolve(seed))).resolves.toMatchObject({
        model: 'gpt-6-luna', reasoningEffort: ReasoningEffortId('low'),
      })
      events.pop()
    }
    events.push({ type: 'user/message', data: {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'Crea un gráfico ficticio y después intégralo en un reporte de producción.' }],
    } })
    await expect(agentEvents(ctx, agent).waterfall('agent/request',
      { turn: 1, step: 1, signal }, () => Promise.resolve(seed))).resolves.toMatchObject({
      model: 'gpt-6.1-sol', reasoningEffort: ReasoningEffortId('xhigh'),
    })
    dispose()
    await ctx.fiber.dispose()
  })

  it('closes a verified fictitious graphic without the Phoenix Auto team admission loop', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({ schemas: [
      { name: 'phoenix_visualize', description: 'inline chart', parameters: { type: 'object' } },
      { name: 'spawn_teammate', description: 'create Kira teammate', parameters: { type: 'object' } },
    ] }))
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL }, assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const events: { type: string; data: unknown }[] = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: {
        source: { kind: 'user' }, content: [{ type: 'text', text: 'crea un grafico ficticio' }],
      } },
      { type: 'tool/call', data: {
        turn: 1, step: 1, callId: 'visual-1', name: 'phoenix_visualize',
        arguments: '{"title":"Tendencia de ejemplo","visual":{"visualType":"chart","chartType":"line","demo":true}}',
      } },
      { type: 'tool/result', data: {
        turn: 1, step: 1, message: {
          source: { kind: 'tool', callId: 'visual-1' },
          content: [{ type: 'tool-result', toolCallId: 'visual-1', isError: false,
            content: [{ type: 'text', text: 'Rich visual ready: Tendencia de ejemplo' }] }],
        },
      } },
      { type: 'assistant/message', data: {
        turn: 1, step: 1, message: {
          source: { provider: 'openai-codex', model: 'gpt-6-luna' },
          content: [{ type: 'text', text: 'Gráfico de ejemplo generado y mostrado.' }],
        },
      } },
    ]
    const steered: unknown[] = []
    const agent = { session: { events }, steer: (message: unknown) => { steered.push(message) } } as unknown as Agent
    const signal = new AbortController().signal
    await ctx.systemPrompt.assemble()
    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal })
    expect(steered).toEqual([])

    // An invalid/failed visual receipt must never pretend the task is done.
    const result = events.find(event => event.type === 'tool/result')
    if (result === undefined) throw new Error('expected visual result fixture')
    const success = result.data
    result.data = { turn: 1, step: 1, error: { code: 'INVALID_VISUAL' }, message: success }
    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal })
    expect(steered).toHaveLength(1)
    expect(JSON.stringify(steered[0])).toContain('real Kira Team participation')
    result.data = success

    // Previous-turn evidence cannot count for another user's request.
    events.push({ type: 'turn/start', data: { turn: 2 } })
    events.push({ type: 'user/message', data: {
      source: { kind: 'user' }, content: [{ type: 'text', text: 'crea un grafico ficticio' }],
    } })
    events.push({ type: 'assistant/message', data: {
      turn: 2, step: 1, message: {
        source: { provider: 'openai-codex', model: 'gpt-6-luna' },
        content: [{ type: 'text', text: 'Lo haré ahora.' }],
      },
    } })
    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 2, signal })
    expect(steered).toHaveLength(2)

    dispose()
    await ctx.fiber.dispose()
  })

  it('keeps actionable Phoenix Auto work open until a real Kira teammate reports back', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [
        { name: 'read', description: 'read a file', parameters: { type: 'object' } },
        { name: 'spawn_teammate', description: 'create a Kira teammate', parameters: { type: 'object' } },
      ],
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
        type: 'assistant/message',
        data: {
          turn: 1,
          step: 3,
          message: {
            source: { provider: 'openai-codex', model: 'gpt-6-luna' },
            content: [{ type: 'text', text: 'Corregido y verificado.' }],
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

    expect(steered).toHaveLength(1)
    expect(JSON.stringify(steered[0])).toMatch(/real Kira Team participation/i)
    expect(JSON.stringify(steered[0])).toMatch(/spawn_teammate/i)

    dispose()
    await ctx.fiber.dispose()
  })

  it('allows Phoenix Auto to close after a real teammate result reaches Kira', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.tools(() => ({
      schemas: [
        { name: 'read', description: 'read a file', parameters: { type: 'object' } },
        { name: 'spawn_teammate', description: 'create a Kira teammate', parameters: { type: 'object' } },
      ],
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
        type: 'user/message',
        data: {
          source: { kind: 'team-message', messageId: 'team-result-1', purpose: 'result' },
          content: [{ type: 'text', text: 'Orión verificó el cambio y las pruebas pasan.' }],
        },
      },
      {
        type: 'assistant/message',
        data: {
          turn: 1,
          step: 4,
          message: {
            source: { provider: 'openai-codex', model: 'gpt-6-luna' },
            content: [{ type: 'text', text: 'Resultado integrado y verificado.' }],
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

  it('synchronizes Phoenix Auto provider identity without persisting the synthetic model id', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selection: ModelSelectionRef = {
      current: { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_MODEL },
      assembled: undefined,
    }
    const agent = {
      options: { provider: 'deepseek', model: 'deepseek-v4-pro', reasoningEffort: ReasoningEffortId('high') },
      session: { events: [] },
    } as unknown as Agent
    ctx.agent = agent
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)

    await ctx.systemPrompt.assemble()

    expect(agent.options.provider).toBe('openai-codex')
    expect(agent.options.model).toBe('deepseek-v4-pro')
    expect(agent.options.reasoningEffort).toBe(ReasoningEffortId('high'))

    dispose()
    await ctx.fiber.dispose()
  })

  it('synchronizes live AgentOptions to a concrete non-Codex selection before delegation tools run', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selection: ModelSelectionRef = {
      current: { provider: 'deepseek', model: 'deepseek-v4-pro' },
      assembled: undefined,
    }
    const agent = {
      options: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: ReasoningEffortId('max') },
      session: { events: [] },
    } as unknown as Agent
    ctx.agent = agent
    const dispose = installModelSelection(ctx, selection)

    await ctx.systemPrompt.assemble()

    expect(agent.options.provider).toBe('deepseek')
    expect(agent.options.model).toBe('deepseek-v4-pro')
    expect(agent.options.reasoningEffort).toBeUndefined()

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

  it.each(['gpt-5.6-luna', 'gpt-6-future', 'gpt-5.6-sol'])('plans and rescues with selected Codex %s while Luna Max executes', async (model) => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selected = { provider: 'openai-codex', model, reasoningEffort: ReasoningEffortId('max') }
    const selection: ModelSelectionRef = { current: selected, assembled: undefined }
    const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
    const events: { type: string; data: unknown }[] = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Fix router.ts and run the tests.' }] } },
    ]
    const agent = { session: { events } } as unknown as Agent
    const signal = new AbortController().signal
    const request = (step: number): Promise<LlmCallConfig> => agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step, signal }, () => Promise.resolve(selected),
    )
    const worker = { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: ReasoningEffortId('max') }
    try {
      await ctx.systemPrompt.assemble()
      await expect(request(1)).resolves.toEqual(selected)
      await expect(request(2)).resolves.toEqual(worker)
      for (const step of [2, 3]) events.push({
        type: 'tool/result',
        data: { turn: 1, step, error: { name: 'ToolError', code: 'TS2345' }, message: { role: 'tool', content: [{ type: 'text', text: 'TS2345 at router.ts' }] } },
      })
      await expect(request(4)).resolves.toEqual(selected)
      await expect(request(5)).resolves.toEqual(worker)
      for (const step of [4, 5]) events.push({
        type: 'tool/result',
        data: { turn: 1, step, message: { role: 'tool', content: [{ type: 'text', text: 'Tool succeeded after recovery.' }] } },
      })
      events.push({
        type: 'user/message',
        data: {
          source: { kind: 'team-message', messageId: 'selected-route-blocker', purpose: 'blocker' },
          content: [{ type: 'text', text: 'The specialist needs a new plan.' }],
        },
      })
      await expect(request(6)).resolves.toEqual(selected)
      await expect(request(7)).resolves.toEqual(worker)
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it.each(['gpt-5.6-sol', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna', 'custom-codex-model'])('hands selected Codex %s to the active Luna worker at Max', (model) => {
    expect(defaultExecutionHandoff({ provider: 'openai-codex', model })).toEqual({
      afterStep: 1,
      selection: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: ReasoningEffortId('max') },
    })
    expect(defaultExecutionHandoff({ provider: 'other', model })).toBeUndefined()
  })

  it('keeps selected older Luna for planning, then executes with the active Luna Max', async () => {
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
      reasoningEffort: ReasoningEffortId('max'),
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
    const agent = { session: { events: [] } } as unknown as Agent
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
