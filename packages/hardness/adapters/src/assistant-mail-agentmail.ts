/** Pinned free-domain AgentMail IO; no billing, domain-upgrade or public ingress endpoints. */
import { createHash } from 'node:crypto'
import { MailMessageId, MailThreadId } from './assistant-mail-types.ts'
import type { AssistantMailTransport, MailDelivery, MailMessage, MailPage, MailReply } from './assistant-mail-types.ts'
import { mailAddress, mailRecord, mailString } from './assistant-mail-store.ts'

/** Sanitized AgentMail rejection category used by Phoenix recovery logic without exposing provider bodies. */
export type AgentMailFailureReason =
  | 'verification-required'
  | 'credential-rejected'
  | 'signup-rejected'
  | 'permission-missing'
  | 'limit-exceeded'
  | 'message-rejected'

function providerFailureReason(status: number, code: string | undefined, fix: string | undefined,
  authenticated: boolean): AgentMailFailureReason | undefined {
  if (status === 401) return authenticated ? 'credential-rejected' : 'signup-rejected'
  if (status !== 403) return undefined
  if ((code === 'missing_permission' || code === 'message_rejected')
    && fix !== undefined && /agent\/verify|verif(?:y|ication)/iu.test(fix)) return 'verification-required'
  if (code === undefined) return authenticated ? 'credential-rejected' : 'signup-rejected'
  if (code === 'missing_permission') return 'permission-missing'
  if (code === 'limit_exceeded') return 'limit-exceeded'
  if (code === 'message_rejected') return 'message-rejected'
  return undefined
}

function safeProviderFix(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const compact = value.replace(/\s+/gu, ' ').trim()
    .replace(/\bam_[A-Za-z0-9._-]+\b/gu, 'am_[redacted]')
  return compact.length === 0 ? undefined : compact.slice(0, 1200)
}

function permissionFromFix(fix: string | undefined): string | undefined {
  const match = fix?.match(/['"`]([a-z][a-z0-9_]{1,63})['"`]\s+permission/iu)
  return match?.[1]
}

function providerFailureMessage(status: number, reason: AgentMailFailureReason | undefined,
  permission?: string, validation?: string): string {
  if (status === 400 && validation !== undefined) return `AgentMail rejected request field: ${validation}`
  if (status === 429) return 'mail quota reached; no paid upgrade will be requested'
  if (reason === 'verification-required') return 'AgentMail requires Kira mailbox verification again; recover access and enter the six-digit owner code'
  if (reason === 'credential-rejected') return 'AgentMail rejected the stored credential; Phoenix can recover the existing Kira mailbox automatically'
  if (reason === 'signup-rejected') return 'AgentMail rejected owner-bound mailbox signup; Phoenix can retry through receive-only agent onboarding'
  if (reason === 'permission-missing') {
    return permission === undefined
      ? 'AgentMail API key lacks a required permission; replace it with a key whose scope and permissions cover Kira mailbox'
      : `AgentMail API key lacks required permission ${permission}`
  }
  if (reason === 'limit-exceeded') return 'AgentMail free mailbox/resource limit reached; remove an old inbox before creating another'
  if (reason === 'message-rejected') return 'AgentMail rejected the message; review the recipient or mailbox verification state'
  return `mail provider request failed (${status})`
}

/** Confirmed HTTP rejection. Provider bodies and credentials are never exposed. */
export class AgentMailHttpError extends Error {
  override readonly name = 'AgentMailHttpError'
  constructor(
    readonly status: number,
    readonly code?: string,
    readonly reason?: AgentMailFailureReason,
    readonly fix?: string,
    readonly permission?: string,
    readonly validation?: string,
  ) {
    super(providerFailureMessage(status, reason, permission, validation))
  }
}

async function responseError(response: Response, authenticated: boolean): Promise<AgentMailHttpError> {
  let code: string | undefined
  let fix: string | undefined
  let validation: string | undefined
  try {
    const text = await response.text()
    if (text.length <= 65_536) {
      const data = JSON.parse(text) as unknown
      if (typeof data === 'object' && data !== null) {
        const record = data as Record<string, unknown>
        if (typeof record.code === 'string' && /^[a-z0-9_]{1,64}$/u.test(record.code)) code = record.code
        if (typeof record.fix === 'string') fix = record.fix.slice(0, 4096)
        if (record.code === 'validation_error' && Array.isArray(record.errors)) {
          const issues = record.errors.flatMap((item) => {
            if (item === null || typeof item !== 'object' || Array.isArray(item)) return []
            const issue = item as Record<string, unknown>
            const parts = Array.isArray(issue.path)
              ? issue.path.filter(part => typeof part === 'string' || typeof part === 'number').join('.')
              : issue.path
            const path = typeof parts === 'string'
              ? parts.replace(/[^a-zA-Z0-9_.\[\]-]/gu, '').slice(0, 160)
              : 'request'
            const message = typeof issue.message === 'string'
              ? issue.message.replace(/\bam_[A-Za-z0-9._-]+\b/gu, 'am_[redacted]')
                .replace(/\s+/gu, ' ').trim().slice(0, 320)
              : 'invalid value'
            return [`${path}: ${message}`]
          }).slice(0, 3)
          if (issues.length > 0) validation = issues.join('; ')
        }
      }
    }
  } catch {
    // A malformed provider error body must not hide the confirmed HTTP status.
  }
  const safeFix = safeProviderFix(fix)
  const reason = providerFailureReason(response.status, code, safeFix, authenticated)
  return new AgentMailHttpError(response.status, code, reason, safeFix, permissionFromFix(safeFix), validation)
}

/** Map any durable Phoenix mail identity to AgentMail's exact HTTP header alphabet.
 * The application journal keeps the original identity for local deduplication.
 * The provider receives a deterministic SHA-256 alias only for malformed/oversized
 * internal IDs, so retries, restarts and recovery preserve the same remote key.
 *
 * AgentMail allows 1–256 chars in A-Z, a-z, 0-9, hyphen, dot, underscore, tilde.
 * A nested agent call or scheduled occurrence may contain a colon, which is invalid.
 */
export function agentMailIdempotencyKey(value: string): string {
  const key = mailString(value, 4096)
  if (/^[A-Za-z0-9._~-]{1,256}$/u.test(key)) return key
  return `phoenix-${createHash('sha256').update(key).digest('hex')}`
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
    headers: { 'Content-Type': 'application/json', ...(key === undefined ? {} : { Authorization: `Bearer ${key}` }), ...(idempotencyKey === undefined ? {} : { 'Idempotency-Key': agentMailIdempotencyKey(idempotencyKey) }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal === undefined ? AbortSignal.timeout(timeoutMs) : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  })
  if (!response.ok) throw await responseError(response, key !== undefined)
  const text = await response.text()
  if (text.length > 2_000_000) throw new Error('mail provider response exceeds limit')
  try { return JSON.parse(text) as unknown } catch { throw new Error('invalid mail provider JSON response') }
}

/** Permanently delete one inbox when Phoenix still holds a usable account credential.
 * A missing inbox is already the desired end state.
 * @param inboxId Exact provider inbox identity.
 * @param key Resolved AgentMail credential.
 * @param timeoutMs Request deadline.
 * @param fetcher HTTP transport.
 * @param signal Optional owner cancellation.
 */
export async function agentMailDeleteInbox(inboxId: string,
  key: string,
  timeoutMs: number,
  fetcher: typeof fetch,
  signal?: AbortSignal): Promise<void> {
  const response = await fetcher(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(mailAddress(inboxId))}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${mailString(key, 8192)}` },
    signal: signal === undefined ? AbortSignal.timeout(timeoutMs) : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  })
  if (!response.ok && response.status !== 404) throw await responseError(response, true)
}

function firstNonemptyMailText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = value.replace(/\r\n?/gu, '\n').trim()
    if (normalized.length > 0) return normalized.slice(0, 64_000)
  }
  return undefined
}

/**
 * Reduce provider HTML to bounded task text when an email has no text/plain part.
 * AgentMail documents HTML-only mail as normal for forwarded Gmail/Outlook messages.
 */
function htmlMailText(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  const withoutActiveContent = value
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1\s*>/giu, ' ')
    .replace(/<(br|hr)\s*\/?>/giu, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  return withoutActiveContent.length === 0 ? undefined : withoutActiveContent.slice(0, 64_000)
}

function inboundEventForInbox(event: Event, inboxId: string): 'subscribed' | 'message.received' | 'error' | undefined {
  const raw = (event as Event & { data?: unknown }).data
  if (typeof raw !== 'string') return undefined
  let payload: Record<string, unknown>
  try { payload = mailRecord(JSON.parse(raw) as unknown) } catch { return undefined }
  if (payload.type === 'error') return 'error'
  if (payload.type === 'subscribed') {
    const ids = payload.inbox_ids ?? payload.inboxIds
    return Array.isArray(ids) && ids.includes(inboxId) ? 'subscribed' : undefined
  }
  const eventType = payload.event_type ?? payload.eventType
  const isInbound = payload.type === 'message_received'
    || eventType === 'message.received'
  if (!isInbound) return undefined
  const message = payload.message
  if (message === undefined) return undefined
  let record: Record<string, unknown>
  try { record = mailRecord(message) } catch { return undefined }
  const eventInbox = record.inbox_id ?? record.inboxId
  return eventInbox === inboxId ? 'message.received' : undefined
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
      text: firstNonemptyMailText(data.extracted_text, data.text)
        ?? htmlMailText(data.extracted_html)
        ?? htmlMailText(data.html)
        ?? '(mensaje sin texto)',
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
   * The promise resolves only after AgentMail confirms the inbox subscription,
   * so callers never report "connected" for a socket that never became a wake channel.
   * @param onMessage Reconciliation callback.
   * @param onDisconnected Closed/error channel notification.
   * @returns Socket disposer.
   */
  async subscribe(onMessage: () => void, onDisconnected?: () => void): Promise<() => void> {
    const key = await this.key()
    if (key === undefined) throw new Error('mail credential is unavailable')
    const signal = this.signal
    if (signal?.aborted === true) throw new Error('mail wake subscription cancelled')
    const socket = new WebSocket(`wss://ws.agentmail.to/v0?api_key=${encodeURIComponent(key)}`)
    const ready = Promise.withResolvers<void>()
    let settled = false
    let subscribed = false
    let disposed = false
    function aborted(): void {
      disposed = true
      settleReady(new Error('mail wake subscription cancelled'))
      try { socket.close() } catch { /* The socket may already be closing. */ }
    }
    function settleReady(error?: Error): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
      if (error === undefined) ready.resolve()
      else ready.reject(error)
    }
    const disconnected = (): void => {
      if (disposed) return
      if (!subscribed) {
        settleReady(new Error('mail wake channel disconnected before subscription confirmation'))
        return
      }
      subscribed = false
      try { onDisconnected?.() } catch { /* Callback failure cannot escape the provider event loop. */ }
    }
    const timer = setTimeout(() => {
      settleReady(new Error('mail wake subscription timed out'))
      try { socket.close() } catch { /* The socket may already be closing. */ }
    }, this.timeoutMs)
    signal?.addEventListener('abort', aborted, { once: true })
    socket.addEventListener('open', () => {
      if (disposed) return
      try {
        socket.send(JSON.stringify({
          type: 'subscribe',
          inbox_ids: [this.inboxId],
          event_types: ['message.received'],
        }))
      } catch {
        settleReady(new Error('mail wake subscription could not be sent'))
      }
    })
    socket.addEventListener('message', (event) => {
      const kind = inboundEventForInbox(event, this.inboxId)
      if (kind === 'subscribed') {
        subscribed = true
        settleReady()
        return
      }
      if (kind === 'error') {
        settleReady(new Error('AgentMail rejected the wake subscription'))
        return
      }
      if (kind !== 'message.received' || disposed) return
      try { onMessage() } catch { /* Reconciliation callback failure cannot escape provider delivery. */ }
    })
    socket.addEventListener('close', disconnected)
    socket.addEventListener('error', disconnected)
    await ready.promise
    return () => {
      if (disposed) return
      disposed = true
      subscribed = false
      signal?.removeEventListener('abort', aborted)
      try { socket.close() } catch { /* Disposal is idempotent. */ }
    }
  }
}
