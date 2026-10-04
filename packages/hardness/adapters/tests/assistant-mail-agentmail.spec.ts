import { MailMessageId } from '../src/assistant-mail-types.ts'
import { describe, expect, it, vi } from 'vitest'
import { AgentMailTransport, agentMailDeleteInbox } from '../src/assistant-mail-agentmail.ts'

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

it('reports a socket closing exactly once and contains disposal callbacks', async () => {
  const sockets: EventTarget[] = []
  class Socket extends EventTarget { constructor(_url: string) { super(); sockets.push(this) } send(_data: string): void {} close(): void { this.dispatchEvent(new Event('close')) } }
  vi.stubGlobal('WebSocket', Socket)
  try {
    let disconnected = 0
    const transport = new AgentMailTransport(async () => 'secret', 'kira@agentmail.to', 1000)
    const dispose = await transport.subscribe(() => {}, () => { disconnected++ })
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

it('deletes a stale inbox with the authenticated DELETE endpoint and treats missing as already deleted', async () => {
  const requests: { url: string; method?: string }[] = []
  let status = 204
  const fetcher = async (url: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    requests.push({ url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, method: init?.method })
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
