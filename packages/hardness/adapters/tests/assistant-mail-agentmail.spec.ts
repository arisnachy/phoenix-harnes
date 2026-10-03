import { MailMessageId } from '../src/assistant-mail-types.ts'
import { describe, expect, it, vi } from 'vitest'
import { AgentMailTransport } from '../src/assistant-mail-agentmail.ts'

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
})

it('waits for subscription confirmation, wakes only on received mail, and reports disconnect once', async () => {
  const sockets: Socket[] = []
  class Socket extends EventTarget {
    readonly sent: string[] = []
    constructor(_url: string) {
      super()
      sockets.push(this)
      queueMicrotask(() => { this.dispatchEvent(new Event('open')) })
    }
    send(data: string): void { this.sent.push(data) }
    close(): void { this.dispatchEvent(new Event('close')) }
    emit(data: unknown): void {
      const event = new Event('message') as Event & { readonly data: string }
      Object.defineProperty(event, 'data', { value: JSON.stringify(data) })
      this.dispatchEvent(event)
    }
  }
  vi.stubGlobal('WebSocket', Socket)
  try {
    let disconnected = 0
    let wakes = 0
    const transport = new AgentMailTransport(async () => 'secret', 'kira@agentmail.to', 1000)
    const subscribing = transport.subscribe(() => { wakes++ }, () => { disconnected++ })
    await vi.waitFor(() => { expect(sockets[0]?.sent).toHaveLength(1) })
    expect(JSON.parse(sockets[0]?.sent[0] ?? '{}')).toEqual({
      type: 'subscribe',
      inbox_ids: ['kira@agentmail.to'],
      event_types: ['message.received'],
    })
    sockets[0]?.emit({ type: 'subscribed', inbox_ids: ['kira@agentmail.to'] })
    const dispose = await subscribing
    expect(wakes).toBe(0)
    sockets[0]?.emit({ type: 'event', eventType: 'message.received' })
    expect(wakes).toBe(1)
    sockets[0]?.emit({ type: 'subscribed', inbox_ids: ['kira@agentmail.to'] })
    expect(wakes).toBe(1)
    sockets[0]?.dispatchEvent(new Event('close'))
    sockets[0]?.dispatchEvent(new Event('error'))
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
