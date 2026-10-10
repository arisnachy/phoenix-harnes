import { describe, expect, it, vi } from 'vitest'
import { TelegramInbox, TELEGRAM_BOT_TOKEN_REF } from '../src/telegram-bot.ts'

const TOKEN = '123456789:ABCdef_0123456789ABCdef_0123456789'
const makeMessage = (chatId: number, text: string, type = 'private', fromId = chatId) => ({
  update_id: 50,
  message: { message_id: 10, text, from: { id: fromId, is_bot: false }, chat: { id: chatId, type } },
})

function fixture() {
  const values = new Map<string, string>([[TELEGRAM_BOT_TOKEN_REF, TOKEN]])
  const creds = {
    describe: async (key: string) => ({ configured: values.has(String(key)) }),
    resolve: async (key: string) => values.has(String(key)) ? { value: values.get(String(key))! } : undefined,
    set: async (key: string, value: string) => { values.set(String(key), value) },
    unset: async (key: string) => { values.delete(String(key)) },
  }
  const messages: Array<{ role: string; source: { kind: string }; content: Array<{ type: 'text'; text: string }> }> = []
  const events: Array<{ type: 'turn/end'; data: { reason:
    | { kind: 'completed' }
    | { kind: 'error'; error: { code: string } }
  } }> = []
  const followup = vi.fn((input: { content: Array<{ type: string; text: string }> }) => {
    messages.push({
      role: 'assistant', source: { kind: 'model' },
      content: [{ type: 'text', text: `Phoenix terminó: ${input.content[0]?.text ?? ''}` }],
    })
    events.push({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  })
  const agent = {
    id: '',
    options: { provider: 'openai-codex', model: 'gpt-6-luna' },
    followup,
    whenIdle: async () => undefined,
    session: { deriveMessages: () => messages, events },
  }
  const registered = new Map<string, typeof agent>()
  const conflicts = new Set<string>()
  const agents = {
    get: vi.fn((sessionId: string) => registered.get(String(sessionId))),
    create: vi.fn(async (options: { sessionId: string; agentOptions: typeof agent.options }) => {
      agent.id = options.sessionId
      agent.options = options.agentOptions
      registered.set(String(options.sessionId), agent)
      return { agent, dispose: async () => undefined }
    }),
  }
  const sessions = {
    create: vi.fn(async (request: { payload: { sessionId: string } }) => {
      const sessionId = request.payload.sessionId
      if (conflicts.has(String(sessionId))) {
        return { result: { ok: false as const, error: { code: 'session-conflict' } } }
      }
      if (!registered.has(String(sessionId))) {
        await agents.create({ sessionId, agentOptions: { provider: 'openai-codex', model: 'gpt-6-luna' } })
      }
      return { result: { ok: true as const, value: { sessionId } } }
    }),
    prompt: vi.fn(async (request: { payload: { sessionId: string; content: Array<{ type: 'text'; text: string }> } }) => {
      const active = registered.get(String(request.payload.sessionId))
      if (active === undefined) return { result: { ok: false as const, error: { code: 'session-not-found' } } }
      active.followup({ role: 'user', source: { kind: 'user' }, content: request.payload.content } as never)
      return { result: { ok: true as const, value: { accepted: true as const } } }
    }),
  }
  const context = { get: (name: string) => name === 'credentials' ? creds
    : name === 'agents' ? agents : name === 'apiProxy' ? { sessions } : undefined,
    logger: { warn: vi.fn() } }
  const inbox = new TelegramInbox(context as never)
  const sent = vi.fn(async (_token: string, _chat: number, _text: string) => undefined)
  const internal = inbox as unknown as {
    send: typeof sent
    process(update: ReturnType<typeof makeMessage>, token: string, credentials: typeof creds): Promise<void>
  }
  internal.send = sent
  return { inbox, internal, creds, values, agent, agents, sessions, sent, followup, events, messages, registered, conflicts }
}

describe('Telegram owner-paired Host inbox', () => {
  it('rejects an unsolicited command until a private chat presents the temporary pairing code', async () => {
    const f = fixture()
    await f.internal.process(makeMessage(12345, 'arregla Phoenix'), TOKEN, f.creds)
    expect(f.sent).not.toHaveBeenCalled()
    expect(f.followup).not.toHaveBeenCalled()

    const code = await f.inbox.pairing()
    await f.internal.process(makeMessage(12345, `/start ${code}`, 'group'), TOKEN, f.creds)
    await f.internal.process(makeMessage(12345, `/start ${code}`, 'private', 54321), TOKEN, f.creds)
    expect(await f.inbox.isPaired()).toBe(false)
    await f.internal.process(makeMessage(12345, `/start ${code}`), TOKEN, f.creds)
    expect(await f.inbox.isPaired()).toBe(true)
    expect(f.values.get('PHOENIX_TELEGRAM_OWNER_CHAT_ID')).toBe('12345')
    expect(f.sent).toHaveBeenCalledWith(TOKEN, 12345, expect.stringContaining('Vinculación confirmada'))
  })

  it('preserves the same pairing code across Host receiver restarts', async () => {
    const f = fixture()
    const code = await f.inbox.pairing()
    const newReceiver = new TelegramInbox({
      get: (name: string) => name === 'credentials' ? f.creds : undefined,
      logger: { warn: vi.fn() },
    } as never)
    const internal = newReceiver as unknown as { send: typeof f.sent; process: typeof f.internal.process }
    internal.send = f.sent
    await internal.process(makeMessage(12345, `/start ${code}`), TOKEN, f.creds)
    expect(f.values.get('PHOENIX_TELEGRAM_OWNER_CHAT_ID')).toBe('12345')
    expect(f.values.has('PHOENIX_TELEGRAM_PAIRING')).toBe(false)
  })

  it('sends an authorized text to the real Agent.followup seam and returns its result', async () => {
    const f = fixture()
    f.values.set('PHOENIX_TELEGRAM_OWNER_CHAT_ID', '12345')
    await f.internal.process(makeMessage(22222, 'no soy el dueño'), TOKEN, f.creds)
    expect(f.followup).not.toHaveBeenCalled()

    await f.internal.process(makeMessage(12345, 'Corrige la compilación'), TOKEN, f.creds)
    expect(f.followup).toHaveBeenCalledTimes(1)
    expect(f.followup.mock.calls[0]?.[0]).toMatchObject({
      role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Corrige la compilación' }],
    })
    expect(f.agents.create).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: { provider: 'openai-codex', model: 'gpt-6-luna' },
    }))
    expect(f.sessions.create).toHaveBeenCalledTimes(1)
    expect(f.sessions.prompt).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ mode: 'queue', content: [{ type: 'text', text: 'Corrige la compilación' }] }),
    }))
    expect(f.values.get('PHOENIX_TELEGRAM_SESSION_ID')).toBeDefined()
    expect(f.sent).toHaveBeenCalledWith(TOKEN, 12345, 'Recibido. Kira está trabajando en tu solicitud.')
    expect(f.sent).toHaveBeenCalledWith(TOKEN, 12345, 'Phoenix terminó: Corrige la compilación')
  })


  it('reports a model failure instead of claiming a blank response succeeded', async () => {
    const f = fixture()
    f.values.set('PHOENIX_TELEGRAM_OWNER_CHAT_ID', '12345')
    f.followup.mockImplementationOnce(() => {
      f.events.push({ type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'NO_ADAPTER' } } } })
    })
    await f.internal.process(makeMessage(12345, 'Hola Kira'), TOKEN, f.creds)
    expect(f.sent).toHaveBeenCalledWith(TOKEN, 12345, expect.stringContaining('NO_ADAPTER'))
    expect(f.sent).not.toHaveBeenCalledWith(TOKEN, 12345, expect.stringContaining('terminó sin una respuesta de texto'))
  })

  it('migrates an older Telegram Agent without model options into a normal gateway session', async () => {
    const f = fixture()
    f.values.set('PHOENIX_TELEGRAM_OWNER_CHAT_ID', '12345')
    f.values.set('PHOENIX_TELEGRAM_SESSION_ID', 'legacy-session')
    f.registered.set('legacy-session', { ...f.agent, options: { provider: '', model: '' } })
    await f.internal.process(makeMessage(12345, 'Hola'), TOKEN, f.creds)
    expect(f.values.get('PHOENIX_TELEGRAM_SESSION_ID')).not.toBe('legacy-session')
    expect(f.sessions.create).toHaveBeenCalledOnce()
    expect(f.sent).toHaveBeenCalledWith(TOKEN, 12345, 'Phoenix terminó: Hola')
  })

  it('recovers a cold legacy session instead of reopening it with the wrong cwd', async () => {
    const f = fixture()
    f.values.set('PHOENIX_TELEGRAM_OWNER_CHAT_ID', '12345')
    f.values.set('PHOENIX_TELEGRAM_SESSION_ID', 'legacy-cold-session')
    f.conflicts.add('legacy-cold-session')
    await f.internal.process(makeMessage(12345, 'Hola'), TOKEN, f.creds)
    expect(f.sessions.create).toHaveBeenCalledTimes(1)
    const requested = f.sessions.create.mock.calls[0]![0].payload.sessionId
    expect(requested).not.toBe('legacy-cold-session')
    expect(f.values.get('PHOENIX_TELEGRAM_SESSION_GATEWAY_ID')).toBe(requested)
    expect(f.values.get('PHOENIX_TELEGRAM_SESSION_ID')).toBe(requested)
    expect(f.sent).toHaveBeenCalledWith(TOKEN, 12345, 'Phoenix terminó: Hola')
  })

  it('resumes a composed cold session across Host restarts', async () => {
    const f = fixture()
    f.values.set('PHOENIX_TELEGRAM_OWNER_CHAT_ID', '12345')
    f.values.set('PHOENIX_TELEGRAM_SESSION_ID', 'modern-session')
    f.values.set('PHOENIX_TELEGRAM_SESSION_GATEWAY_ID', 'modern-session')
    await f.internal.process(makeMessage(12345, 'Hola'), TOKEN, f.creds)
    expect(f.sessions.create.mock.calls[0]![0].payload.sessionId).toBe('modern-session')
    expect(f.values.get('PHOENIX_TELEGRAM_SESSION_ID')).toBe('modern-session')
    expect(f.sent).toHaveBeenCalledWith(TOKEN, 12345, 'Phoenix terminó: Hola')
  })

  it('recovers from a composed session whose original workspace no longer matches', async () => {
    const f = fixture()
    f.values.set('PHOENIX_TELEGRAM_OWNER_CHAT_ID', '12345')
    f.values.set('PHOENIX_TELEGRAM_SESSION_ID', 'moved-session')
    f.values.set('PHOENIX_TELEGRAM_SESSION_GATEWAY_ID', 'moved-session')
    f.conflicts.add('moved-session')
    await f.internal.process(makeMessage(12345, 'Hola'), TOKEN, f.creds)
    expect(f.sessions.create).toHaveBeenCalledTimes(2)
    expect(f.sessions.create.mock.calls[0]![0].payload.sessionId).toBe('moved-session')
    const nextId = f.sessions.create.mock.calls[1]![0].payload.sessionId
    expect(nextId).not.toBe('moved-session')
    expect(f.values.get('PHOENIX_TELEGRAM_SESSION_ID')).toBe(nextId)
    expect(f.sent).toHaveBeenCalledWith(TOKEN, 12345, 'Phoenix terminó: Hola')
  })

  it('ignores attempts to pair after five incorrect codes', async () => {
    const f = fixture()
    const code = await f.inbox.pairing()
    const invalid = code === '111111' ? '222222' : '111111'
    for (let i = 0; i < 5; i++) {
      await f.internal.process(makeMessage(999, `/start ${invalid}`), TOKEN, f.creds)
    }
    await f.internal.process(makeMessage(999, `/start ${code}`), TOKEN, f.creds)
    expect(await f.inbox.isPaired()).toBe(false)
  })
})
