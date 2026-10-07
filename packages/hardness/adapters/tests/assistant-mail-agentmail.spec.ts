import { MailMessageId } from '../src/assistant-mail-types.ts'
import { describe, expect, it, vi } from 'vitest'
import { AgentMailHttpError, AgentMailTransport, agentMailDeleteInbox, agentMailRequest } from '../src/assistant-mail-agentmail.ts'

describe('AgentMail transport', () => {
  it('uses authenticated-only listing and idempotent reply pinned to the verified sender', async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = []
    const transport = new AgentMailTransport(async () => 'private-key', 'kira@agentmail.to', 1000, async (url, init) => {
      requests.push({ url: (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url), init })
      return Response.json((typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).includes('/reply') ? { message_id: 'sent', thread_id: 'thread' } : { messages: [], count: 0 })
    })
    expect(await transport.listMessages()).toEqual({ ids: [] })
    await transport.reply({ inboxId: 'kira@agentmail.to', messageId: MailMessageId('request'), to: 'owner@example.com', text: 'Done', idempotencyKey: 'stable-job' })
    expect(requests[0]?.url).toContain('include_unauthenticated=false')
    expect(requests[1]?.init?.headers).toMatchObject({ 'Idempotency-Key': 'stable-job' })
    expect(JSON.parse((requests[1]?.init?.body as string))).toMatchObject({ to: ['owner@example.com'], reply_all: false })
  })
  it('sends a new Kira message with a stable idempotency key', async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = []
    const transport = new AgentMailTransport(async () => 'private-key', 'kira@agentmail.to', 1000, async (url, init) => {
      requests.push({ url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, init })
      return Response.json({ message_id: 'sent-new', thread_id: 'thread-new' })
    })
    await expect(transport.send('owner@example.com', 'Resultado Phoenix', 'Trabajo terminado', 'task-occurrence-1')).resolves.toEqual({
      messageId: 'sent-new',
      threadId: 'thread-new',
    })
    expect(requests[0]?.url).toContain('/inboxes/kira%40agentmail.to/messages/send')
    expect(requests[0]?.init?.headers).toMatchObject({ 'Idempotency-Key': 'task-occurrence-1' })
    expect(JSON.parse(requests[0]?.init?.body as string)).toMatchObject({
      to: ['owner@example.com'],
      subject: 'Resultado Phoenix',
      text: 'Trabajo terminado',
    })
  })
  it('reports quota without exposing secrets or automatically upgrading', async () => {
    let requests = 0
    const transport = new AgentMailTransport(async () => 'private-key', 'kira@agentmail.to', 1000, async () => {
      requests++
      return Response.json({ message: 'private-key provider error' }, { status: 429 })
    })
    await expect(transport.listMessages()).rejects.toThrow('quota')
    expect(requests).toBe(1)
  })
  it('classifies provider verification 403 without exposing the provider body', async () => {
    const error = await agentMailRequest('/inboxes/kira%40agentmail.to/messages', 'private-key', 1000, async () =>
      Response.json({
        code: 'missing_permission',
        message: 'Forbidden',
        fix: 'Complete POST /v0/agent/verify; diagnostic private-key must never cross the boundary',
      }, { status: 403 })).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(AgentMailHttpError)
    expect(error).toMatchObject({ status: 403, code: 'missing_permission', reason: 'verification-required' })
    expect((error as Error).message).toContain('verification')
    expect((error as Error).message).not.toContain('private-key')
  })
  it('classifies a bare gateway 403 as a rejected stored credential', async () => {
    const error = await agentMailRequest('/inboxes/kira%40agentmail.to/messages', 'stale-key', 1000, async () =>
      Response.json({ message: 'Forbidden' }, { status: 403 })).catch((value: unknown) => value)
    expect(error).toMatchObject({ status: 403, reason: 'credential-rejected' })
    expect((error as Error).message).toContain('recover')
    expect((error as Error).message).not.toContain('stale-key')
  })

  it('classifies an unauthenticated signup gateway 403 separately from stale credentials', async () => {
    const error = await agentMailRequest('/agent/sign-up', undefined, 1000, async () =>
      Response.json({ message: 'Forbidden' }, { status: 403 }), { username: 'kira-local' })
      .catch((value: unknown) => value)
    expect(error).toMatchObject({ status: 403, reason: 'signup-rejected' })
    expect((error as Error).message).toContain('receive-only')
  })

  it('classifies unauthenticated signup 401 as signup rejection', async () => {
    const error = await agentMailRequest('/agent/sign-up', undefined, 1000, async () =>
      Response.json({ message: 'Unauthorized' }, { status: 401 }), { username: 'kira-local' })
      .catch((value: unknown) => value)
    expect(error).toMatchObject({ status: 401, reason: 'signup-rejected' })
  })

  it('classifies AgentMail authentication 401 as a rejected stored credential', async () => {
    const error = await agentMailRequest('/inboxes/kira%40agentmail.to/messages', 'stale-key', 1000, async () =>
      Response.json({ code: 'unknown_api_key', message: 'Unknown API key' }, { status: 401 })).catch((value: unknown) => value)
    expect(error).toMatchObject({ status: 401, code: 'unknown_api_key', reason: 'credential-rejected' })
  })

  it('classifies free-plan resource exhaustion instead of returning an opaque 403', async () => {
    const error = await agentMailRequest('/inboxes', 'private-key', 1000, async () =>
      Response.json({ code: 'limit_exceeded', message: 'Forbidden', fix: 'Delete an old inbox.' }, { status: 403 }))
      .catch((value: unknown) => value)
    expect(error).toMatchObject({ status: 403, code: 'limit_exceeded', reason: 'limit-exceeded' })
    expect((error as Error).message).toContain('free')
  })
})

it('waits for AgentMail subscription confirmation and wakes only for inbound mail in Kira inbox', async () => {
  const sockets: Socket[] = []
  const messageEvent = (data: unknown): Event => {
    const event = new Event('message') as Event & { data?: unknown }
    Object.defineProperty(event, 'data', { value: JSON.stringify(data) })
    return event
  }
  class Socket extends EventTarget {
    readonly sent: string[] = []
    constructor(_url: string) {
      super()
      sockets.push(this)
      queueMicrotask(() => { this.dispatchEvent(new Event('open')) })
    }
    send(data: string): void {
      this.sent.push(data)
      queueMicrotask(() => {
        this.dispatchEvent(messageEvent({ type: 'subscribed', inbox_ids: ['kira@agentmail.to'] }))
      })
    }
    close(): void { this.dispatchEvent(new Event('close')) }
  }
  vi.stubGlobal('WebSocket', Socket)
  try {
    let wakes = 0
    let disconnected = 0
    const transport = new AgentMailTransport(async () => 'secret', 'kira@agentmail.to', 1000)
    const dispose = await transport.subscribe(() => { wakes++ }, () => { disconnected++ })
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({
      type: 'subscribe',
      inbox_ids: ['kira@agentmail.to'],
      event_types: ['message.received'],
    })

    sockets[0]!.dispatchEvent(messageEvent({
      type: 'message_sent',
      event_type: 'message.sent',
      message: { inbox_id: 'kira@agentmail.to' },
    }))
    sockets[0]!.dispatchEvent(messageEvent({
      type: 'message_received',
      event_type: 'message.received',
      message: { inbox_id: 'other@agentmail.to' },
    }))
    expect(wakes).toBe(0)

    sockets[0]!.dispatchEvent(messageEvent({
      type: 'message_received',
      event_type: 'message.received',
      message: { inbox_id: 'kira@agentmail.to' },
    }))
    expect(wakes).toBe(1)

    sockets[0]!.dispatchEvent(new Event('close'))
    sockets[0]!.dispatchEvent(new Event('error'))
    expect(disconnected).toBe(1)
    dispose()
    expect(disconnected).toBe(1)
  } finally { vi.unstubAllGlobals() }
})

it('rejects identity mismatches and admits only candidates from the authenticated listing', async () => {
  let candidate = false
  let wrongIdentity = false
  const transport = new AgentMailTransport(async () => 'secret', 'kira@agentmail.to', 1000, async url => Response.json((typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).includes('/messages?') ? { messages: candidate ? [{ message_id: 'incoming' }] : [] } : { message_id: wrongIdentity ? 'different' : 'incoming', inbox_id: 'kira@agentmail.to', thread_id: 'thread', from: 'Owner <owner@example.com>', labels: ['received'], text: 'Review this task', headers: { 'Reply-To': 'outsider@example.com' } }))
  const id = MailMessageId('incoming')
  expect((await transport.readMessage(id)).authenticated).toBe(false)
  candidate = true
  await transport.listMessages()
  expect(await transport.readMessage(id)).toMatchObject({ authenticated: true, from: 'owner@example.com' })
  wrongIdentity = true
  await expect(transport.readMessage(id)).rejects.toThrow('identity')
})

it('uses HTML mail content as task text when AgentMail has no plain-text part', async () => {
  const transport = new AgentMailTransport(async () => 'secret', 'kira@agentmail.to', 1000, async url => {
    const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (address.includes('/messages?')) return Response.json({ messages: [{ message_id: 'html-only' }] })
    return Response.json({
      message_id: 'html-only',
      inbox_id: 'kira@agentmail.to',
      thread_id: 'thread-html',
      from: 'owner@example.com',
      labels: ['received'],
      html: '<div>Revisa <b>Phoenix</b><br>y ejecuta la tarea.</div>',
      headers: {},
    })
  })
  await transport.listMessages()
  await expect(transport.readMessage(MailMessageId('html-only'))).resolves.toMatchObject({
    authenticated: true,
    text: 'Revisa Phoenix\ny ejecuta la tarea.',
  })
})

it('deletes a stale inbox with the authenticated DELETE endpoint and treats missing as already deleted', async () => {
  const requests: { url: string; method?: string }[] = []
  let status = 204
  const fetcher = async (url: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    requests.push({ url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, ...(init?.method === undefined ? {} : { method: init.method }) })
    return new Response(null, { status })
  }
  await agentMailDeleteInbox('old@agentmail.to', 'private-key', 1000, fetcher)
  status = 404
  await agentMailDeleteInbox('old@agentmail.to', 'private-key', 1000, fetcher)
  expect(requests).toEqual([
    { url: 'https://api.agentmail.to/v0/inboxes/old%40agentmail.to', method: 'DELETE' },
    { url: 'https://api.agentmail.to/v0/inboxes/old%40agentmail.to', method: 'DELETE' },
  ])
})
