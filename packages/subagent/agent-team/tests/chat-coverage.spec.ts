import { describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SessionStore, { SessionId, type Session } from '@phoenix-ai/dsh-session'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@phoenix-ai/dsh-llm'
import { TeamChat, shouldPublishTeammateSpeech } from '../src/chat.ts'
import { TEAM_PERSONAS } from '../src/personas.ts'
import { TeamId } from '../src/types.ts'
import { TeamJournal } from '../src/journal.ts'
import type { TeamChatMessage } from '../src/chat-types.ts'

const content = (text: string) => [{ type: 'text' as const, text }]
async function fixture(maxBytes = 1024) {
  const store = new Context()
  await store.plugin(SessionStore)
  const root = store.sessions.create(SessionId('root'))
  const child = store.sessions.create(SessionId('child'), { meta: { origin: 'subagent', parentSession: root.id } })
  child.append('subagent/descriptor', { version: 2, mode: 'continuable', provider: 'spawn', label: 'Research question' })
  const agents = new Map<string, Agent>()
  const actor = (session: Session) => ({ id: session.id, session, options: {}, inject: vi.fn((message: ReturnType<typeof createUserMessage>) => session.append('user/message', message, { surfaceOp: 'append' })) }) as unknown as Agent
  const lead = actor(root), worker = actor(child)
  agents.set(root.id, lead); agents.set(child.id, worker)
  const abort = new AbortController()
  const followup = vi.fn(async (_lead: Agent, id: string, blocks: ReturnType<typeof content>) => {
    store.sessions.get(SessionId(id))!.append('user/message', createUserMessage({ content: blocks, source: { kind: 'user' } }), { surfaceOp: 'append' })
  })
  const listChildren = vi.fn(async () => [])
  const inspect = vi.fn()
  const ctx = { sessions: store.sessions, agents: { get: (id: string) => agents.get(id) },
    subagents: { followup, listChildren }, sessionPersistence: { inspect } } as unknown as Context
  const chat = new TeamChat(ctx, new TeamJournal(ctx, () => {}), maxBytes, 2, abort.signal)
  const row = (overrides: Partial<TeamChatMessage> = {}) => {
    const message: TeamChatMessage = { id: 'question', senderId: 'user', senderName: 'User', senderKind: 'user', missionId: root.id, text: 'Why this approach?', time: 1, sourceSeq: 0, targetId: child.id, mentions: [child.id], reactions: [], deliveries: [{ targetId: child.id, accepted: true }], ...overrides }
    root.append('team/chat-message', { version: 1, message: Object.fromEntries(Object.entries(message).filter(([, value]) => value !== undefined)) } as never); return message
  }
  return { store, ctx, root, child, lead, worker, agents, abort, followup, listChildren, inspect, chat, row }
}

describe('human teamwork without progress spam', () => {
  it('keeps actions and new evidence but removes duplicate future-tense messages', () => {
    expect(shouldPublishTeammateSpeech('Kira, revisaré la portada.', false, false)).toBe(true)
    expect(shouldPublishTeammateSpeech('La tercera nota la tomaré también de la portada.', true, false)).toBe(false)
    expect(shouldPublishTeammateSpeech('Kira, voy a verificar otra noticia.', true, true)).toBe(false)
    expect(shouldPublishTeammateSpeech('Kira, confirmé el titular y la URL.', true, true)).toBe(true)
    expect(shouldPublishTeammateSpeech('Kira, ¿necesitas otra fuente?', true, false)).toBe(true)
    expect(shouldPublishTeammateSpeech('Kira, el buscador dio HTTP 500; probaré otro.', true, false)).toBe(false)
    expect(shouldPublishTeammateSpeech('Kira, Google mostró CAPTCHA; intentaré Yahoo.', true, true)).toBe(false)
    expect(shouldPublishTeammateSpeech('Kira, no puedo continuar sin tu autorización.', true, false)).toBe(true)
    expect(shouldPublishTeammateSpeech('Kira, confirmé en una fuente oficial los requisitos; ya tengo el enlace.', true, true)).toBe(true)
    expect(shouldPublishTeammateSpeech('', false, false)).toBe(false)
  })
  it('shares one opening and one tool-backed finding with Kira, not a stream of plans', async () => {
    const f = await fixture()
    f.child.append('turn/start', { turn: 1 })
    const speak = (text: string, step: number) => f.child.append('assistant/message', {
      turn: 1, step, message: createAssistantMessage({ source: { provider: 'mock', model: 'mock' }, content: content(text) }),
    }, { surfaceOp: 'append' })
    speak('Revisaré la portada y comprobaré los enlaces.', 1)
    await f.chat.capture(f.root, f.child.header, f.child.events)
    speak('La tercera nota la tomaré también de la portada.', 2)
    await f.chat.capture(f.root, f.child.header, f.child.events)
    expect(f.chat.messages(f.root).filter(row => row.senderKind === 'agent')).toHaveLength(1)
    const callId = CallId('browser-verification')
    f.child.append('tool/call', { turn: 1, step: 3, callId,
      name: 'phoenix_browser', arguments: '{"url":"https://listindiario.com"}' })
    f.child.append('tool/result', { turn: 1, step: 3,
      message: createToolResultMessage({ callId, content: content('verified page opened'), isError: false }),
    }, { surfaceOp: 'append' })
    speak('Kira, encontré la nota y comprobé su página individual.', 4)
    await f.chat.capture(f.root, f.child.header, f.child.events)
    const shared = f.chat.messages(f.root).filter(row => row.senderKind === 'agent')
    expect(shared).toHaveLength(2)
    expect(shared.every(row => row.targetId === f.root.id)).toBe(true)
  })
})

describe('chat durable ownership and delivery', () => {
  it('rejects missing, child, replaced and aborted roots', async () => {
    const f = await fixture()
    expect(() => f.chat.root('missing')).toThrow('root session not found')
    expect(() => f.chat.root(f.child.id)).toThrow('root session not found')
    const read = f.chat.read(f.root.id)
    vi.spyOn(f.store.sessions, 'get').mockReturnValue(undefined)
    await expect(read).rejects.toThrow('root session changed')
    f.abort.abort()
    expect(() => f.chat.root(f.root.id)).toThrow()
  })
  it('validates reply admission before publishing any request', async () => {
    const f = await fixture()
    const request = { sessionId: f.root.id, targetId: f.child.id, requestId: 'request', text: 'Why?' }
    for (const invalid of [{ text: '' }, { text: 'x'.repeat(1025) }, { requestId: 'bad space' }, { replyTo: 'missing' }, { targetIds: ['a', 'b'] }]) {
      await expect(f.chat.reply({ ...request, ...invalid })).rejects.toThrow()
    }
    const oneShot = f.store.sessions.create(SessionId('one-shot'), { meta: { origin: 'subagent', parentSession: f.root.id } })
    await expect(f.chat.reply({ ...request, targetId: oneShot.id })).rejects.toThrow('not continuable')
    expect(f.chat.messages(f.root)).toEqual([])
    f.agents.delete(f.root.id)
    await expect(f.chat.reply(request)).rejects.toThrow('lead is not active')
  })
  it('retries a non-Error delivery failure, serializes concurrent retries and rejects conflicting identities', async () => {
    const f = await fixture()
    f.followup.mockRejectedValueOnce('offline')
    const request = { sessionId: f.root.id, targetId: f.child.id, requestId: 'request', text: 'Why?' }
    expect(await f.chat.reply(request)).toEqual({ messageId: 'request', queued: true })
    expect(f.chat.messages(f.root)[0]?.deliveries).toEqual([{ targetId: f.child.id, accepted: false, error: 'Delivery failed' }])
    await Promise.all([f.chat.reply(request), f.chat.reply(request)])
    expect(f.followup).toHaveBeenCalledTimes(2)
    expect(vi.spyOn(f.lead, 'inject')).toHaveBeenCalledTimes(1)
    await expect(f.chat.reply({ ...request, text: 'Different?' })).rejects.toThrow('identity conflicts')
    expect(f.chat.messages(f.root)).toHaveLength(1)
  })
  it('requires actual human delivery before answering and keeps answers retry-stable', async () => {
    const f = await fixture()
    f.row()
    await expect(f.chat.answer(f.worker, { messageId: 'question', text: 'Because it fits.' })).rejects.toThrow('has not reached')
    f.child.append('user/message', createUserMessage({ content: content('[Team user message question]\nWhy?'), source: { kind: 'user' } }), { surfaceOp: 'append' })
    const answer = { messageId: 'question', text: 'Because it fits.' }
    await Promise.all([f.chat.answer(f.worker, answer), f.chat.answer(f.worker, answer)])
    expect(f.chat.messages(f.root).filter(row => row.replyTo === 'question')).toHaveLength(1)
    await expect(f.chat.answer(f.worker, { ...answer, text: 'Different answer.' })).rejects.toThrow('identity conflicts')
    await expect(f.chat.answer(f.worker, { ...answer, text: '' })).rejects.toThrow('invalid or oversized')
    await expect(f.chat.answer(f.lead, answer)).rejects.toThrow('non-child')
    f.agents.delete(f.child.id)
    await expect(f.chat.answer(f.worker, answer)).rejects.toThrow('stale')
  })
  it('rejects answers outside the accepted human request ownership', async () => {
    for (const overrides of [{ senderKind: 'agent' as const }, { missionId: 'elsewhere' }, { deliveries: [] }]) {
      const f = await fixture(); f.row(overrides)
      await expect(f.chat.answer(f.worker, { messageId: 'question', text: 'Because.' })).rejects.toThrow('not accepted')
    }
    const f = await fixture()
    await expect(f.chat.answer(f.worker, { messageId: 'missing', text: 'Because.' })).rejects.toThrow('not accepted')
    f.row({ text: 'Send the email.' })
    await expect(f.chat.answer(f.worker, { messageId: 'question', text: 'Because.' })).rejects.toThrow('operational requests')
  })
  it('bounds multibyte output without splitting a scalar and enforces read limits', async () => {
    const f = await fixture(5)
    f.child.append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({ source: { provider: 'mock', model: 'mock' }, content: content('ééé') }) }, { surfaceOp: 'append' })
    expect((await f.chat.read(f.root.id)).messages[0]?.text).toBe('éé')
    for (const limit of [0, 201, 1.5]) await expect(f.chat.read(f.root.id, limit)).rejects.toThrow('limit')
    f.row({ id: 'later', text: 'ééé' })
    expect((await f.chat.readFor(f.worker, 100)).messages.at(-1)?.text).toBe('éé')
    f.agents.delete(f.child.id)
    await expect(f.chat.readFor(f.worker, 100)).rejects.toThrow('stale')
  })
  it('rejects malformed persisted records and foreign mission reactions', async () => {
    const f = await fixture()
    f.root.append('team/chat-message', { version: 1, message: {} } as never)
    f.root.append('team/chat-reaction', { version: 1, reaction: {}, active: true } as never)
    expect(f.chat.messages(f.root)).toEqual([])
    f.row({ missionId: 'foreign' })
    await expect(f.chat.react({ sessionId: f.root.id, messageId: 'question', emoji: '👍', active: true })).rejects.toThrow('another mission')
    await expect(f.chat.react({ sessionId: f.root.id, messageId: 'question', emoji: '👍', active: 'yes' } as never)).rejects.toThrow('boolean')
    await expect(f.chat.react({ sessionId: f.root.id, messageId: 'question', emoji: '👍', active: true }, { ...f.worker, id: SessionId('foreign') })).rejects.toThrow('does not belong')
  })
  it('rechecks exact child ownership after waiting for the root transaction', async () => {
    const f = await fixture()
    f.row()
    const answer = f.chat.answer(f.worker, { messageId: 'question', text: 'Because.' })
    f.agents.delete(f.worker.id)
    await expect(answer).rejects.toThrow('stale team actor')
    f.agents.set(f.worker.id, f.worker)
    const reply = f.chat.reply({ sessionId: f.root.id, targetId: f.child.id, requestId: 'race', text: 'Why?' })
    f.agents.delete(f.root.id)
    await expect(reply).rejects.toThrow('lead session changed')
    expect(f.chat.messages(f.root)).toHaveLength(1)
  })
  it('requires a parent for child reads and answers', async () => {
    const f = await fixture()
    const orphan = f.store.sessions.create(SessionId('orphan'), { meta: { origin: 'subagent' } })
    const actor = { id: orphan.id, session: orphan } as Agent
    f.agents.set(actor.id, actor)
    await expect(f.chat.readFor(actor, 10)).rejects.toThrow('root not found')
    await expect(f.chat.answer(actor, { messageId: 'question', text: 'Because.' })).rejects.toThrow('root not found')
  })
  it('includes uncatalogued live and historical message senders without inventing text', async () => {
    const f = await fixture()
    f.store.sessions.create(SessionId('unidentified'), { meta: { parentSession: f.root.id } })
    f.row({ senderKind: 'agent', senderId: 'historical', senderName: 'Historical worker' })
    const read = await f.chat.read(f.root.id)
    expect(read.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'unidentified', status: 'inactive' }),
      expect.objectContaining({ id: 'historical', status: 'done' }),
    ]))
    expect(read.messages).toHaveLength(1)
  })

  it('retains canonical named and overflow persona identities across lifecycle changes', async () => {
    const f = await fixture()
    for (const [index, persona] of TEAM_PERSONAS.entries()) f.root.append('team/chat-participant', { version: 1, participant: { id: `occupied-${index}`, name: persona.name, avatar: persona.kind, role: 'Team', status: 'working', missionId: f.root.id } })
    f.root.append('team/chat-participant', { version: 1, participant: { id: 'plain', name: 'Plain', role: 'Team', status: 'working', missionId: f.root.id } })
    await f.chat.capture(f.root, f.child.header, f.child.events)
    expect((await f.chat.read(f.root.id)).participants.find(row => row.id === f.child.id)?.name).toMatch(/21$/)
    for (const name of ['forge', 'atlas', 'custom']) {
      const child = f.store.sessions.create(SessionId(name), { meta: { origin: 'subagent', parentSession: f.root.id } })
      f.root.append('team/member', { version: 1, teamId: TeamId(f.root.id), member: { id: child.id, name, description: 'General task', provider: 'spawn', context: 'fresh', phase: 'provisioning' } })
      await f.chat.capture(f.root, child.header, child.events)
      child.append('turn/end', { turn: 1, reason: { kind: 'error', error: 'failed' } } as never)
      await f.chat.capture(f.root, child.header, child.events)
    }
    expect((await f.chat.read(f.root.id)).participants).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'forge', name: 'La Forja', status: 'failed' }),
      expect.objectContaining({ id: 'atlas', name: 'Atlas', status: 'failed' }),
      expect.objectContaining({ id: 'custom', name: 'custom', status: 'failed' }),
    ]))
  })
  it('backfills cold catalog identities once and preserves uncaptured cold participants', async () => {
    const f = await fixture()
    f.listChildren.mockResolvedValue([
      { kind: 'other', id: 'ignored' }, { kind: 'child', id: f.child.id, activity: 'done' },
      { kind: 'child', id: 'cold', activity: 'inactive' },
    ] as never)
    f.inspect.mockResolvedValue({ meta: { id: SessionId('cold'), parentSession: f.root.id }, events: [] })
    expect((await f.chat.read(f.root.id)).participants).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'cold', role: 'Team' })]))
    await f.chat.read(f.root.id)
    expect(f.inspect).toHaveBeenCalledTimes(1)
  })
  it('rejects accepted missionless user messages as conversational answer owners', async () => {
    const f = await fixture()
    f.row({ missionId: undefined })
    await expect(f.chat.answer(f.worker, { messageId: 'question', text: 'Because.' })).rejects.toThrow('not accepted')
  })

  it('delivers to a cold persisted child and returns bounded exact-byte reads', async () => {
    const f = await fixture()
    const get = f.store.sessions.get.bind(f.store.sessions)
    vi.spyOn(f.store.sessions, 'get').mockImplementation(id => id === f.child.id ? undefined : get(id))
    f.inspect.mockResolvedValue({ meta: f.child.header, events: f.child.events })
    f.followup.mockResolvedValue(undefined)
    expect(await f.chat.reply({ sessionId: f.root.id, targetId: f.child.id, requestId: 'cold', text: 'Why?' })).toEqual({ messageId: 'cold', queued: false })
    expect(f.followup).toHaveBeenCalledTimes(1)
    f.row({ id: 'budget', text: 'x'.repeat(1024) })
    expect((await f.chat.readFor(f.lead, 100)).messages).toHaveLength(1)
  })
  it('recovers a previously admitted user request while preserving child recovery ownership', async () => {
    const f = await fixture()
    const message = f.row({ supervised: false, deliveries: [{ targetId: f.child.id, accepted: false }] })
    await f.chat.recover(f.worker)
    expect(f.followup).not.toHaveBeenCalled()
    await f.chat.recover(f.lead)
    expect(f.followup).toHaveBeenCalledTimes(1)
    expect(f.chat.messages(f.root).find(row => row.id === message.id)?.supervised).toBe(true)
  })

  it('ignores empty surface prose and refuses answer requests with no delivery receipt', async () => {
    const f = await fixture()
    f.root.append('user/message', createUserMessage({ content: content('   '), source: { kind: 'user' } }), { surfaceOp: 'append' })
    expect(f.chat.messages(f.root)).toEqual([])
    f.row({ deliveries: undefined })
    await expect(f.chat.answer(f.worker, { messageId: 'question', text: 'Because.' })).rejects.toThrow('not accepted')
    await f.chat.reply({ sessionId: f.root.id, targetId: f.child.id, requestId: 'question', text: 'Why this approach?' })
    expect(f.followup).not.toHaveBeenCalled()
    expect(f.chat.messages(f.root)[0]?.supervised).toBe(true)
  })
  it('recovers contextual replies using the original quote and accepted recipient', async () => {
    const f = await fixture()
    f.row({ id: 'original' })
    f.row({ id: 'contextual', replyTo: 'original', supervised: false, deliveries: [{ targetId: f.child.id, accepted: false }] })
    await f.chat.recover(f.lead)
    expect(f.followup).toHaveBeenCalledTimes(1)
    expect(f.followup.mock.calls[0]?.[2][0]?.text).toContain('Reply to User (original)')
  })

  it('shows one verified Astra-to-Kira handoff without a duplicate child final reply', async () => {
    const f = await fixture(8192)
    f.child.append('turn/start', { turn: 1 })
    const first = createAssistantMessage({
      source: { provider: 'mock', model: 'mock' },
      content: content('Kira, abriré la portada y comprobaré el enlace.'),
    })
    f.child.append('assistant/message', { turn: 1, step: 1, message: first }, { surfaceOp: 'append' })
    const callId = CallId('team-result-handoff')
    f.child.append('tool/call', {
      turn: 1, step: 2, callId, name: 'send_message',
      arguments: '{"target":"lead","purpose":"result","message":"Titular verificado"}',
    })
    f.child.append('tool/result', {
      turn: 1, step: 2,
      message: createToolResultMessage({ callId, content: content('accepted'), isError: false }),
    }, { surfaceOp: 'append' })
    const redundant = createAssistantMessage({
      source: { provider: 'mock', model: 'mock' }, content: content('El titular está verificado; ya informé a Kira.'),
    })
    f.child.append('assistant/message', { turn: 1, step: 3, message: redundant }, { surfaceOp: 'append' })
    await f.chat.capture(f.root, f.child.header, f.child.events)
    expect(f.chat.messages(f.root).map(row => row.text)).toEqual([
      'Kira, abriré la portada y comprobaré el enlace.',
    ])
    // An explicit new assignment can still produce new substantive dialogue.
    f.child.append('turn/start', { turn: 2 })
    const next = createAssistantMessage({
      source: { provider: 'mock', model: 'mock' }, content: content('Kira, comprobaré ahora el segundo artículo.'),
    })
    f.child.append('assistant/message', { turn: 2, step: 1, message: next }, { surfaceOp: 'append' })
    await f.chat.capture(f.root, f.child.header, f.child.events)
    expect(f.chat.messages(f.root).map(row => row.text)).toContain('Kira, comprobaré ahora el segundo artículo.')
  })

  it('never publishes child narration produced after a user-stopped lead turn', async () => {
    const f = await fixture()
    f.root.append('turn/start', { turn: 1 })
    f.root.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    const stale = createAssistantMessage({
      source: { provider: 'mock', model: 'mock' }, content: content('Kira, seguiré navegando.'),
    })
    f.child.append('turn/start', { turn: 1 })
    f.child.append('assistant/message', { turn: 1, step: 1, message: stale }, { surfaceOp: 'append' })
    await f.chat.capture(f.root, f.child.header, f.child.events)
    expect(f.chat.messages(f.root)).toHaveLength(0)
  })

  it('keeps raw tool telemetry in child events without impersonating a teammate in chat', async () => {
    const f = await fixture()
    const callId = CallId('github-read')
    f.child.append('tool/call', {
      turn: 1, step: 1, callId, name: 'mcp__GitHub__fetch_file',
      arguments: '{"secret":"PRIVATE_ARGUMENT"}',
    })
    await f.chat.capture(f.root, f.child.header, f.child.events)
    f.child.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId, content: content('PRIVATE_RESULT'), isError: false,
      }),
    }, { surfaceOp: 'append' })
    await f.chat.capture(f.root, f.child.header, f.child.events)
    expect(f.child.events.some(event => event.type === 'tool/call')).toBe(true)
    expect(f.child.events.some(event => event.type === 'tool/result')).toBe(true)
    expect(f.root.events.filter(event => event.type === 'team/chat-message'
      && event.data.message.id.startsWith(f.child.id + ':activity:'))).toHaveLength(0)
    expect(f.chat.messages(f.root)).toHaveLength(0)

    // A pre-upgrade persisted activity row must not resurrect on backfill.
    f.row({
      id: f.child.id + ':activity:123', senderId: f.child.id, senderKind: 'agent',
      text: '**Actividad real** · 3 respuesta(s) sin error. Última herramienta: mcp__phoenix_browser__navigate.',
    })
    f.row({
      id: 'real-human-reply', senderId: f.child.id, senderKind: 'agent',
      text: 'Revisé la navegación y no encontré errores.',
    })
    expect(f.chat.messages(f.root).map(row => row.id)).toEqual(['real-human-reply'])
  })

})
