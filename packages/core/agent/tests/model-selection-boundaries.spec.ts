import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import { ReasoningEffortId } from '@phoenix-ai/dsh-llm'
import { agentEvents, installModelSelection, defaultExecutionHandoff, isPhoenixCodexAutoStalled,
  jevSelectedModelId, isContextualConversationFastPathText, PHOENIX_CODEX_AUTO_MODEL,
  type Agent, type ModelSelectionRef } from '../src/index.ts'

describe('routing evidence from durable and external input', () => {
  it('accepts an explicit allowed Jev choice through list envelopes and rejects incomplete choices', () => {
    const candidates = ['gpt-6-sol', 'gpt-6-luna']
    for (const value of [undefined, null, 7, 'unknown', [], [null, 'unknown'], { choice: 7 }, { result: null }]) {
      expect(jevSelectedModelId(value, candidates)).toBeUndefined()
    }
    expect(jevSelectedModelId('gpt-6-sol', candidates)).toBe('gpt-6-sol')
    expect(jevSelectedModelId([null, { answer: ['unknown', 'gpt-6-luna'] }], candidates)).toBe('gpt-6-luna')
  })

  it('rejects empty, oversized, path-bearing and acquisition text from contextual conversation routing', () => {
    for (const text of ['', ' '.repeat(181), 'x'.repeat(181), './fix', 'https://example.com', 'read router.ts']) {
      expect(isContextualConversationFastPathText(text)).toBe(false)
    }
  })

  it('recognizes repeated calls independently of changing line numbers while successful results are not failures', () => {
    const event = (type: string, data: unknown) => ({ type, data })
    const stalled = (events: ReturnType<typeof event>[]) => isPhoenixCodexAutoStalled({ session: { events: [event('turn/start', { turn: 1 }), ...events] } }, 1)
    expect(stalled([event('turn/start', { turn: 1 }),
      ...[12, 13, 14].map(line => event('tool/call', { name: 'read', arguments: `router.ts:${line}` })),
    ])).toBe(true)
    expect(stalled([event('tool/call', { name: 'read' }), event('tool/call', { name: 'write' }), event('tool/call', {})])).toBe(false)
    expect(stalled([event('tool/result', { error: {} }), event('tool/result', { error: {} })])).toBe(true)
    expect(stalled([event('tool/result', { error: {} }), event('tool/result', {})])).toBe(false)
    expect(stalled([event('tool/call', { name: 'read' }), event('tool/call', { name: 'read' }), event('tool/call', { name: 'read' })])).toBe(true)
    expect(stalled([event('tool/call', { name: 'read' }), event('tool/call', { name: 'write' }), event('tool/call', { name: 'write' })])).toBe(false)
  })
})

/** Install selection hooks over replayable turn evidence and observe continuation admissions. */
async function router(model: string = PHOENIX_CODEX_AUTO_MODEL, tools = true, team = false, assemble = true) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  if (tools) ctx.systemPrompt.tools(() => ({ schemas: [{ name: team ? 'spawn_teammate' : 'read', description: 'action', parameters: {} }] }))
  const selection: ModelSelectionRef = { current: { provider: 'openai-codex', model }, assembled: undefined }
  const dispose = installModelSelection(ctx, selection, defaultExecutionHandoff)
  const events: { type: string; data: unknown }[] = [{ type: 'turn/start', data: { turn: 1 } }]
  const messages: unknown[] = []
  const agent = { session: { events }, steer: (message: unknown) => { messages.push(message) } } as unknown as Agent
  const signal = new AbortController().signal
  if (assemble) await ctx.systemPrompt.assemble()
  return { ctx, events, messages, selection,
    request: (step = 1) => agentEvents(ctx, agent).waterfall('agent/request', { turn: 1, step, signal }, () => Promise.resolve({ provider: 'seed', model: 'seed' })),
    stop: () => agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal }),
    close: async () => { dispose(); await ctx.fiber.dispose() },
  }
}

function user(text: string) { return { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } } }
function answer(step: number, text?: string) { return { type: 'assistant/message', data: { turn: 1, step, message: { content: text === undefined ? [] : [{ type: 'text', text }] } } } }

describe('continuation admission from replayed routing evidence', () => {
  it('leaves stopping turns alone until assembly has established available tools', async () => {
    const r = await router(PHOENIX_CODEX_AUTO_MODEL, true, false, false)
    try { r.events.push(user('Fix router.ts'), answer(1, 'I will inspect it')); await r.stop(); expect(r.messages).toEqual([]) } finally { await r.close() }
  })

  it('treats an incomplete durable stopping reply as no executed action rather than claiming completion', async () => {
    const r = await router()
    try { r.events.push(user('Fix router.ts'), { type: 'assistant/message', data: { turn: 1, step: 1 } }); await r.stop(); expect(r.messages).toHaveLength(1) } finally { await r.close() }
  })

  it.each(['Explain in detail the design', 'What is JSON?'])('routes answer-only text without task acquisition: %s', async (text) => {
    const r = await router()
    try { r.events.push(user(text)); expect(await r.request()).toMatchObject({ model: 'gpt-6-luna', reasoningEffort: text.includes('detail') ? 'medium' : 'low' }) } finally { await r.close() }
  })

  it('ignores malformed or missing stopping evidence and never extends answer-only or tool-free turns', async () => {
    const r = await router()
    try {
      await r.stop()
      r.events.push(user('Fix router.ts'))
      await r.stop()
      r.events.push({ type: 'assistant/message', data: { turn: 2, step: 1 } })
      await r.stop()
      expect(r.messages).toEqual([])
    } finally { await r.close() }
    const toolFree = await router(PHOENIX_CODEX_AUTO_MODEL, false)
    try { toolFree.events.push(user('Fix router.ts'), answer(1, 'I will inspect it')); await toolFree.stop(); expect(toolFree.messages).toEqual([]) } finally { await toolFree.close() }
  })

  it('admits each unfinished step once, caps repeated continuation, and rescues the next route', async () => {
    const r = await router()
    try {
      r.events.push(user('Fix router.ts'))
      for (const step of [1, 1, 2, 3, 4, 5, 6]) { r.events.push(answer(step, 'I will inspect the file next.')); await r.stop() }
      expect(r.messages).toHaveLength(4)
      expect(await r.request(7)).toMatchObject({ model: 'gpt-6.1-sol' })
    } finally { await r.close() }
  })

  it('requires a team outcome once per stopping step and requests a planner after repeated delegation stalls', async () => {
    const r = await router(PHOENIX_CODEX_AUTO_MODEL, true, true)
    try {
      r.events.push(user('Fix router.ts'), { type: 'user/message', data: { source: { kind: 'team-message', purpose: 'question', messageId: 'question' }, content: [{ type: 'text', text: 'What should I inspect?' }] } }, { type: 'tool/result', data: { step: 1 } }, answer(1, 'Done'))
      await r.stop(); await r.stop()
      r.events.push(answer(2, 'Done')); await r.stop()
      expect(r.messages).toHaveLength(2)
      expect(await r.request(3)).toMatchObject({ model: 'gpt-6.1-sol' })
    } finally { await r.close() }
  })

  it('does not extend an empty final reply after actual tools ran or after selection changes', async () => {
    const r = await router()
    try {
      r.events.push(user('Fix router.ts'), { type: 'tool/result', data: { step: 1 } }, answer(1))
      await r.stop(); expect(r.messages).toEqual([])
      r.selection.current = { provider: 'other', model: 'worker' }
      r.events.push(answer(2, 'I will inspect it next.')); await r.stop(); expect(r.messages).toEqual([])
    } finally { await r.close() }
  })
})

describe('selected routes and assembly ownership', () => {
  it.each(['gpt-5.6-sol', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'])('uses a same-family conversational worker for %s', async (model) => {
    const r = await router(model)
    try { r.events.push(user('hola')); expect(await r.request()).toMatchObject({ model: model.startsWith('gpt-5.6') ? 'gpt-5.6-luna' : 'gpt-6-luna', reasoningEffort: 'low' }) } finally { await r.close() }
  })

  it('pins substantive selected GPT-6 Luna to Max and keeps other providers on their conversational selection', async () => {
    const luna = await router('gpt-6-luna')
    try { luna.events.push(user('Fix router.ts')); expect(await luna.request()).toMatchObject({ model: 'gpt-6-luna', reasoningEffort: 'max' }) } finally { await luna.close() }
    const other = await router()
    try {
      other.selection.current = { provider: 'other', model: 'custom' }
      await other.ctx.systemPrompt.assemble()
      other.events.push(user('hola'))
      expect(await other.request()).toEqual({ provider: 'other', model: 'custom' })
    } finally { await other.close() }
    const custom = await router('custom-model')
    try { custom.events.push(user('hola')); expect(await custom.request()).toMatchObject({ model: 'gpt-6-luna', reasoningEffort: 'low' }) } finally { await custom.close() }
  })

  it('updates the scoped creation options from the next assembled selection, including effort removal', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const options: { provider?: string; model?: string; reasoningEffort?: ReasoningEffortId } = {}
    ctx.agent = { options } as Agent
    const selection: ModelSelectionRef = { current: { provider: 'other', model: 'worker', reasoningEffort: ReasoningEffortId('high') }, assembled: undefined }
    const dispose = installModelSelection(ctx, selection)
    try {
      await ctx.systemPrompt.assemble()
      expect(options).toEqual(selection.current)
      selection.current = { provider: 'other', model: 'new-worker' }
      await ctx.systemPrompt.assemble()
      expect(options).toEqual(selection.current)
    } finally { dispose(); await ctx.fiber.dispose() }
  })
})
