/** Pinned free-domain AgentMail IO; no billing, domain-upgrade or public ingress endpoints. */
import { MailMessageId, MailThreadId } from './assistant-mail-types.ts'
import type { AssistantMailTransport, MailDelivery, MailMessage, MailPage, MailReply } from './assistant-mail-types.ts'
import { mailAddress, mailRecord, mailString } from './assistant-mail-store.ts'

/** Confirmed HTTP rejection, excluding provider response bodies and credentials. */
export class AgentMailHttpError extends Error {
  override readonly name = 'AgentMailHttpError'
  constructor(readonly status: number) {
    super(status === 429 ? 'mail quota reached; no paid upgrade will be requested' : `mail provider request failed (${status})`)
  }
}

/** Official provider API; errors deliberately exclude provider bodies and secrets.
 * @param path API path relative to /v0.
 * @param key Resolved API key, omitted only for initial signup.
 * @param timeoutMs Request deadline.
 * @param fetcher HTTP transport.
 * @param body Optional JSON body.
 * @param idempotencyKey Immutable outgoing identity.
 * @param signal Optional owner cancellation, combined with the request deadline.
 * @returns Parsed provider JSON.
 */
export async function agentMailRequest(path: string,
  key: string | undefined,
  timeoutMs: number,
  fetcher: typeof fetch,
  body?: unknown,
  idempotencyKey?: string,
  signal?: AbortSignal): Promise<unknown> {
  const response = await fetcher(`https://api.agentmail.to/v0${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(key === undefined ? {} : { Authorization: `Bearer ${key}` }), ...(idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal === undefined ? AbortSignal.timeout(timeoutMs) : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  })
  if (!response.ok) throw new AgentMailHttpError(response.status)
  const text = await response.text()
  if (text.length > 2_000_000) throw new Error('mail provider response exceeds limit')
  try { return JSON.parse(text) as unknown } catch { throw new Error('invalid mail provider JSON response') }
}

/** AgentMail implementation with outgoing WebSocket notifications and authenticated-only reconciliation. */
export class AgentMailTransport implements AssistantMailTransport {
  private authenticatedIds = new Set<MailMessageId>()
  constructor(private readonly key: () => Promise<string | undefined>,
    private readonly inboxId: string,
    private readonly timeoutMs: number,
    private readonly fetcher: typeof fetch = fetch,
    private readonly signal?: AbortSignal) {}
  private async request(path: string, body?: unknown, idempotencyKey?: string): Promise<unknown> {
    const key = await this.key()
    if (key === undefined) throw new Error('mail credential is unavailable')
    return agentMailRequest(path, key, this.timeoutMs, this.fetcher, body, idempotencyKey, this.signal)
  }
  private messagesPath(): string { return `/inboxes/${encodeURIComponent(this.inboxId)}/messages` }
  /** List provider-filtered authenticated candidates.
   * @param cursor Pagination token.
   * @returns Validated page.
   */
  async listMessages(cursor?: string): Promise<MailPage> {
    if (cursor === undefined) this.authenticatedIds.clear()
    const query = new URLSearchParams({ limit: '100', include_spam: 'false', include_blocked: 'false', include_unauthenticated: 'false', labels: 'received' })
    if (cursor !== undefined) query.set('page_token', cursor)
    const data = mailRecord(await this.request(`${this.messagesPath()}?${query}`))
    if (!Array.isArray(data.messages)) throw new Error('invalid mail page')
    const ids = data.messages.map(value => MailMessageId(mailString(mailRecord(value).message_id)))
    for (const id of ids) this.authenticatedIds.add(id)
    return { ids, ...(data.next_page_token === undefined ? {} : { next: mailString(data.next_page_token) }) }
  }
  /** Read a message authenticated by the provider's filtered listing, never by user-written headers.
   * @param id Candidate message identity.
   * @returns Bounded message.
   */
  async readMessage(id: MailMessageId): Promise<MailMessage> {
    const data = mailRecord(await this.request(`${this.messagesPath()}/${encodeURIComponent(id)}`))
    if (data.message_id !== id || data.inbox_id !== this.inboxId || !Array.isArray(data.labels)) throw new Error('mail identity mismatch')
    const labels = data.labels
    const headers = data.headers === undefined ? {} : mailRecord(data.headers)
    const lowered = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]))
    const autoSubmitted = lowered['auto-submitted']
    const from = mailAddress(mailString(data.from))
    return {
      inboxId: this.inboxId, messageId: id, threadId: MailThreadId(mailString(data.thread_id)), from,
      subject: typeof data.subject === 'string' ? data.subject.slice(0, 1024) : '(sin asunto)',
      text: mailString(data.extracted_text ?? data.text ?? '(mensaje sin texto)', 64_000),
      authenticated: this.authenticatedIds.has(id) && labels.includes('received') && !labels.some(label => ['unauthenticated', 'spam', 'blocked', 'sent'].includes(String(label))),
      automatic: labels.includes('sent') || from === this.inboxId.toLowerCase() || (autoSubmitted !== undefined && autoSubmitted !== 'no') || /^(mailer-daemon|postmaster)@/u.test(from),
    }
  }
  /** Send a new message from Kira's verified mailbox.
   * @param to Authorized recipient.
   * @param subject Bounded message subject.
   * @param text Bounded message body.
   * @param idempotencyKey Stable provider deduplication key.
   * @returns Confirmed delivery identity.
   */
  async send(to: string, subject: string, text: string, idempotencyKey: string): Promise<MailDelivery> {
    const data = mailRecord(await this.request(`${this.messagesPath()}/send`, {
      to: [mailAddress(to)],
      subject: mailString(subject, 1024),
      text: mailString(text, 64_000),
      headers: { 'Auto-Submitted': 'auto-generated' },
    }, mailString(idempotencyKey)))
    return { messageId: MailMessageId(mailString(data.message_id)), threadId: MailThreadId(mailString(data.thread_id)) }
  }

  /** Reply to the validated sender, overriding potentially hostile Reply-To and excluding CC.
   * @param request Durable reply.
   * @returns Confirmed delivery identity.
   */
  async reply(request: MailReply): Promise<MailDelivery> {
    if (request.inboxId !== this.inboxId) throw new Error('mail reply inbox mismatch')
    const data = mailRecord(await this.request(`${this.messagesPath()}/${encodeURIComponent(request.messageId)}/reply`, {
      to: [mailAddress(request.to)], reply_all: false, text: request.text, headers: { 'Auto-Submitted': 'auto-replied' },
    }, request.idempotencyKey))
    return { messageId: MailMessageId(mailString(data.message_id)), threadId: MailThreadId(mailString(data.thread_id)) }
  }
  /** Outgoing-only wake channel. Polling remains the recovery authority.
   * @param onMessage Reconciliation callback.
   * @param onDisconnected Closed/error channel notification.
   * @returns Socket disposer.
   */
  async subscribe(onMessage: () => void, onDisconnected?: () => void): Promise<() => void> {
    const key = await this.key()
    if (key === undefined) throw new Error('mail credential is unavailable')
    const socket = new WebSocket(`wss://ws.agentmail.to/v0?api_key=${encodeURIComponent(key)}`)
    socket.addEventListener('open', () => { socket.send(JSON.stringify({ type: 'subscribe', inbox_ids: [this.inboxId], event_types: ['message.received'] })) })
    socket.addEventListener('message', () => { onMessage() })
    let closed = false
    const disconnected = (): void => {
      if (closed) return
      closed = true
      try { onDisconnected?.() } catch { /* Callback failure cannot escape the provider event loop. */ }
    }
    socket.addEventListener('close', disconnected)
    socket.addEventListener('error', disconnected)
    return () => { closed = true; socket.close() }
  }
}
