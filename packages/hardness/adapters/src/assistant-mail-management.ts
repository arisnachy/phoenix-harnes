/** Explicitly bounded mailbox administration against the official AgentMail v0 API.
 * Mail received here is untrusted data; the durable work receiver separately
 * authenticates and authorizes senders before executing any email instructions.
 */
import { createHash } from 'node:crypto'
import type { JsonValue } from '@phoenix-ai/dsh-session'
import { agentMailRequest } from './assistant-mail-agentmail.ts'
import { mailAddress, mailRecord, mailString } from './assistant-mail-store.ts'
import type { MailAccount, MailJob } from './assistant-mail-types.ts'

export type KiraMailOperation =
  | 'list' | 'search' | 'read' | 'threads' | 'search_threads' | 'thread'
  | 'read_status' | 'unread_status' | 'trash' | 'restore'
  | 'label_add' | 'label_remove' | 'delete'
  | 'thread_trash' | 'thread_restore' | 'thread_delete'
  | 'drafts' | 'draft' | 'draft_create' | 'draft_update' | 'draft_delete' | 'draft_send'
  | 'reply' | 'forward' | 'attachment'

export interface KiraMailOperationInput {
  readonly action: KiraMailOperation
  readonly messageId?: string
  readonly threadId?: string
  readonly draftId?: string
  readonly attachmentId?: string
  readonly folder?: 'inbox' | 'sent' | 'all' | 'trash'
  readonly query?: string
  readonly pageToken?: string
  readonly limit?: number
  readonly label?: string
  readonly to?: string
  readonly subject?: string
  readonly text?: string
  readonly confirmation?: string
  readonly idempotencyKey?: string
}

export interface KiraMailManagementConfig {
  readonly account: () => Promise<MailAccount>
  readonly key: () => Promise<string | undefined>
  readonly jobs: () => Promise<MailJob[]>
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  readonly fetcher?: typeof fetch
}

const blockedLabels = new Set(['spam', 'blocked', 'unauthenticated'])
const systemLabels = new Set(['sent', 'received', 'bounced', 'complained', 'rejected', 'opened', 'trash', 'read', 'unread'])
const unfinished = new Set<MailJob['state']>(['pending', 'received', 'running', 'verifying', 'reply-pending'])

function boundedId(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} required`)
  return mailString(value, 1024)
}
function boundedLimit(value: number | undefined): number {
  if (value === undefined) return 20
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) throw new Error('limit must be 1–50')
  return value
}
function labelValue(value: string | undefined): string {
  const label = boundedId(value, 'label').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/u.test(label) || systemLabels.has(label.toLowerCase())) {
    throw new Error('Only custom non-system labels may be edited via label_add or label_remove')
  }
  return label
}
function messageProjection(raw: unknown, authorized: ReadonlySet<string>, full = false): Record<string, JsonValue> {
  const v = mailRecord(raw)
  const labels = Array.isArray(v.labels) ? v.labels.filter((x): x is string => typeof x === 'string').slice(0, 30) : []
  const from = typeof v.from === 'string' ? v.from.slice(0, 320) : ''
  let address = ''
  try { address = mailAddress(from) } catch { /* Malformed external sender remains untrusted. */ }
  const body = typeof v.text === 'string' && v.text.trim().length > 0 ? v.text
    : typeof v.extracted_text === 'string' ? v.extracted_text
      : typeof v.extracted_html === 'string' ? v.extracted_html.replace(/<[^>]+>/gu, ' ')
        : typeof v.html === 'string' ? v.html.replace(/<[^>]+>/gu, ' ') : ''
  const attachments = Array.isArray(v.attachments) ? v.attachments.slice(0, 25).map((a) => {
    const item = mailRecord(a)
    return {
      attachmentId: typeof item.attachment_id === 'string' ? item.attachment_id.slice(0, 1024) : '',
      filename: typeof item.filename === 'string' ? item.filename.slice(0, 255) : '',
      size: typeof item.size === 'number' ? item.size : 0,
      contentType: typeof item.content_type === 'string' ? item.content_type.slice(0, 120) : '',
    }
  }) : []
  return {
    messageId: typeof v.message_id === 'string' ? v.message_id : '',
    threadId: typeof v.thread_id === 'string' ? v.thread_id : '',
    from, subject: typeof v.subject === 'string' ? v.subject.slice(0, 1024) : '(sin asunto)',
    preview: typeof v.preview === 'string' ? v.preview.slice(0, 300) : body.slice(0, 300),
    labels, authorizedTaskSender: authorized.has(address),
    untrustedContent: true, attachments,
    ...(full ? { text: body.slice(0, 16_000) } : {}),
  }
}
function threadProjection(raw: unknown, authorized: ReadonlySet<string>, full = false): Record<string, JsonValue> {
  const v = mailRecord(raw)
  const messages = Array.isArray(v.messages) ? v.messages.slice(0, 50)
    .filter((row) => {
      const message = mailRecord(row)
      return !Array.isArray(message.labels) || !message.labels.some(label => blockedLabels.has(String(label)))
    })
    .map(row => messageProjection(row, authorized, full)) : []
  return {
    threadId: typeof v.thread_id === 'string' ? v.thread_id : '',
    subject: typeof v.subject === 'string' ? v.subject.slice(0, 1024) : '',
    preview: typeof v.preview === 'string' ? v.preview.slice(0, 300) : '',
    messageCount: typeof v.message_count === 'number' ? v.message_count : messages.length,
    labels: Array.isArray(v.labels) ? v.labels.filter(x => typeof x === 'string').slice(0, 30) : [],
    ...(full ? { messages } : {}),
    untrustedContent: true,
  }
}
function draftProjection(raw: unknown, full = false): Record<string, JsonValue> {
  const v = mailRecord(raw)
  return {
    draftId: typeof v.draft_id === 'string' ? v.draft_id : '',
    to: Array.isArray(v.to) ? v.to.filter(x => typeof x === 'string').slice(0, 20) : [],
    subject: typeof v.subject === 'string' ? v.subject.slice(0, 1024) : '',
    preview: typeof v.preview === 'string' ? v.preview.slice(0, 300) : '',
    ...(full && typeof v.text === 'string' ? { text: v.text.slice(0, 16_000) } : {}),
    ...(typeof v.send_at === 'string' ? { sendAt: v.send_at } : {}),
    ...(typeof v.send_status === 'string' ? { sendStatus: v.send_status } : {}),
  }
}

/** Manage messages, threads and drafts in Kira's existing verified inbox.
 * @param config Host-only credential, verified account and durable job journal.
 * @param input Explicit model-facing operation, validated before provider IO.
 * @returns Bounded provider-confirmed action result.
 */
export async function operateKiraMail(config: KiraMailManagementConfig,
  input: KiraMailOperationInput): Promise<Record<string, JsonValue>> {
  const account = await config.account()
  if (account.state !== 'ready' || account.inboxId === undefined) throw new Error('Kira mailbox must be connected and verified')
  const key = await config.key()
  if (key === undefined) throw new Error('Kira mailbox has no valid stored AgentMail credential')
  const base = `/inboxes/${encodeURIComponent(account.inboxId)}`
  const authorized = new Set([account.ownerEmail, ...account.contacts].filter((x): x is string => x !== undefined))
  const fetcher = config.fetcher ?? fetch
  const request = (path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
    body?: unknown, dedupe?: string): Promise<unknown> =>
    agentMailRequest(`${base}${path}`, key, config.timeoutMs, fetcher, body, dedupe, config.signal, method)
  const jobs = await config.jobs()
  const isActive = (messageId: string): boolean => jobs.some(
    job => job.message.messageId === messageId && unfinished.has(job.state))
  const guardMessage = (id: string): void => {
    if (isActive(id)) throw new Error('Cannot modify or delete a message while its Kira mail task is unfinished')
  }
  const guardThread = async (id: string): Promise<void> => {
    // The local journal remains authoritative if AgentMail omits message details
    // from a long or partially fetched thread.
    if (jobs.some(job => job.message.threadId === id && unfinished.has(job.state))) {
      throw new Error('Cannot modify a thread with unfinished Kira mail tasks')
    }
    const row = mailRecord(await request(`/threads/${encodeURIComponent(id)}`))
    if (!Array.isArray(row.messages)) throw new Error('Cannot safely inspect thread messages before deletion')
    if (row.messages.some(message => isActive(mailString(mailRecord(message).message_id)))) {
      throw new Error('Cannot delete a thread containing unfinished Kira mail tasks')
    }
  }
  const pathId = (id: string): string => encodeURIComponent(id)
  const paging = (): URLSearchParams => {
    const q = new URLSearchParams({ limit: String(boundedLimit(input.limit)) })
    if (input.pageToken !== undefined) q.set('page_token', mailString(input.pageToken, 4096))
    return q
  }
  const folder = input.folder ?? 'inbox'
  const listQuery = (): URLSearchParams => {
    const params = paging()
    params.set('include_spam', 'false')
    params.set('include_blocked', 'false')
    params.set('include_unauthenticated', 'false')
    if (folder === 'inbox') params.append('labels', 'received')
    if (folder === 'sent') params.append('labels', 'sent')
    if (folder === 'trash') { params.set('include_trash', 'true'); params.append('labels', 'trash') }
    return params
  }
  if (input.action === 'list' || input.action === 'search') {
    const params = listQuery()
    if (input.action === 'search') {
      const q = mailString(boundedId(input.query, 'query'), 256)
      if (q.trim().length < 2) throw new Error('AgentMail search query requires at least two characters')
      params.set('q', q)
    }
    const path = input.action === 'search' ? '/messages/search' : '/messages'
    const data = mailRecord(await request(`${path}?${params}`))
    if (!Array.isArray(data.messages)) throw new Error('AgentMail returned invalid message listing')
    return {
      action: input.action, inboxId: account.inboxId,
      messages: data.messages.slice(0, 50).map(row => messageProjection(row, authorized)),
      ...(typeof data.next_page_token === 'string' ? { nextPageToken: data.next_page_token } : {}),
    }
  }
  if (input.action === 'read') {
    const id = boundedId(input.messageId, 'message_id')
    const record = mailRecord(await request(`/messages/${pathId(id)}`))
    const labels = Array.isArray(record.labels) ? record.labels : []
    if (labels.some(l => blockedLabels.has(String(l)))) throw new Error('Blocked, spam and unauthenticated messages cannot be read by Kira')
    return { action: 'read', inboxId: account.inboxId, message: messageProjection(record, authorized, true) }
  }
  if (input.action === 'threads' || input.action === 'search_threads') {
    const params = listQuery()
    if (input.action === 'search_threads') {
      const q = mailString(boundedId(input.query, 'query'), 256)
      if (q.trim().length < 2) throw new Error('AgentMail thread search requires at least two characters')
      params.set('q', q)
    }
    const path = input.action === 'search_threads' ? '/threads/search' : '/threads'
    const data = mailRecord(await request(`${path}?${params}`))
    if (!Array.isArray(data.threads)) throw new Error('AgentMail returned invalid threads listing')
    return {
      action: input.action, threads: data.threads.slice(0, 50).map(row => threadProjection(row, authorized)),
      ...(typeof data.next_page_token === 'string' ? { nextPageToken: data.next_page_token } : {}),
    }
  }
  if (input.action === 'thread') {
    const id = boundedId(input.threadId, 'thread_id')
    const data = await request(`/threads/${pathId(id)}`)
    return { action: 'thread', thread: threadProjection(data, authorized, true) }
  }
  if (input.action === 'drafts' || input.action === 'draft') {
    if (input.action === 'draft') {
      const id = boundedId(input.draftId, 'draft_id')
      return { action: 'draft', draft: draftProjection(await request(`/drafts/${pathId(id)}`), true) }
    }
    const data = mailRecord(await request(`/drafts?${paging()}`))
    if (!Array.isArray(data.drafts)) throw new Error('AgentMail returned invalid drafts listing')
    return {
      action: 'drafts', drafts: data.drafts.slice(0, 50).map(row => draftProjection(row)),
      ...(typeof data.next_page_token === 'string' ? { nextPageToken: data.next_page_token } : {}),
    }
  }
  if (input.action === 'draft_create' || input.action === 'draft_update') {
    const to = input.to === undefined ? undefined : mailAddress(input.to)
    if (to !== undefined && !authorized.has(to)) throw new Error('Draft recipient is not an authorized contact')
    const body: Record<string, unknown> = {
      ...(to === undefined ? {} : { to: [to] }),
      ...(input.subject === undefined ? {} : { subject: mailString(input.subject, 1024) }),
      ...(input.text === undefined ? {} : { text: mailString(input.text, 64_000) }),
    }
    if (Object.keys(body).length === 0) throw new Error('A draft needs at least one requested field')
    if (input.action === 'draft_create') {
      const created = await request('/drafts', 'POST', body)
      return { action: 'draft_create', draft: draftProjection(created, true) }
    }
    const id = boundedId(input.draftId, 'draft_id')
    const updated = await request(`/drafts/${pathId(id)}`, 'PATCH', body)
    return { action: 'draft_update', draft: draftProjection(updated, true) }
  }
  if (input.action === 'draft_delete') {
    const id = boundedId(input.draftId, 'draft_id')
    await request(`/drafts/${pathId(id)}`, 'DELETE')
    return { action: 'draft_delete', draftId: id, deleted: true }
  }
  if (input.action === 'draft_send') {
    const id = boundedId(input.draftId, 'draft_id')
    if (input.confirmation !== 'ENVIAR BORRADOR') throw new Error('Draft sending needs explicit owner confirmation')
    const draft = mailRecord(await request(`/drafts/${pathId(id)}`))
    const recipients = Array.isArray(draft.to) ? draft.to.map(to => mailAddress(mailString(to))) : []
    if (recipients.length !== 1 || !authorized.has(recipients[0]!)
      || (Array.isArray(draft.cc) && draft.cc.length > 0)
      || (Array.isArray(draft.bcc) && draft.bcc.length > 0)) {
      throw new Error('Draft may only be sent to one verified owner/authorized contact without CC or BCC')
    }
    const dedupe = `phoenix-draft-${createHash('sha256').update(id).digest('hex')}`
    const delivered = mailRecord(await request(`/drafts/${pathId(id)}/send`, 'POST', {}, dedupe))
    return { action: 'draft_send', state: 'sent', to: recipients[0],
      messageId: mailString(delivered.message_id), threadId: mailString(delivered.thread_id) }
  }
  if (input.action === 'attachment') {
    const id = boundedId(input.messageId, 'message_id')
    const attachmentId = boundedId(input.attachmentId, 'attachment_id')
    const parent = mailRecord(await request(`/messages/${pathId(id)}`))
    if (Array.isArray(parent.labels)
      && parent.labels.some(label => blockedLabels.has(String(label)))) {
      throw new Error('Attachment belongs to blocked, spam or unauthenticated mail')
    }
    const data = mailRecord(await request(
      `/messages/${pathId(id)}/attachments/${pathId(attachmentId)}`))
    const downloadUrl = mailString(data.download_url, 4096)
    const parsed = new URL(downloadUrl)
    if (parsed.protocol !== 'https:') throw new Error('AgentMail attachment URL must use HTTPS')
    return {
      action: 'attachment', attachmentId, messageId: id, downloadUrl,
      ...(typeof data.expires_at === 'string' ? { expiresAt: data.expires_at } : {}),
      ...(typeof data.filename === 'string' ? { filename: data.filename.slice(0, 255) } : {}),
      ...(typeof data.content_type === 'string' ? { contentType: data.content_type } : {}),
      ...(typeof data.size === 'number' ? { size: data.size } : {}),
      transientPrivateUrl: true,
    }
  }
  if (input.action === 'forward') {
    const id = boundedId(input.messageId, 'message_id')
    const recipient = mailAddress(boundedId(input.to, 'to'))
    if (!authorized.has(recipient)) throw new Error('Forward recipient is not owner-authorized')
    if (input.confirmation !== 'REENVIAR MENSAJE' || input.idempotencyKey === undefined) {
      throw new Error('Forward needs explicit owner request and a stable chat call identity')
    }
    const original = mailRecord(await request(`/messages/${pathId(id)}`))
    if (Array.isArray(original.labels)
      && original.labels.some(label => blockedLabels.has(String(label)))) {
      throw new Error('Cannot forward blocked, spam or unauthenticated messages')
    }
    const delivered = mailRecord(await request(`/messages/${pathId(id)}/forward`, 'POST', {
      to: [recipient],
      ...(input.text === undefined ? {} : { text: mailString(input.text, 64_000) }),
    }, input.idempotencyKey))
    return { action: 'forward', state: 'sent', to: recipient,
      messageId: mailString(delivered.message_id), threadId: mailString(delivered.thread_id) }
  }
  if (input.action === 'reply') {
    const id = boundedId(input.messageId, 'message_id')
    const original = mailRecord(await request(`/messages/${pathId(id)}`))
    const to = mailAddress(mailString(original.from))
    if (!authorized.has(to)) throw new Error('Reply recipient is not authorized')
    if (input.text === undefined || input.idempotencyKey === undefined) {
      throw new Error('Reply requires body and a stable originating chat identity')
    }
    const delivered = mailRecord(await request(`/messages/${pathId(id)}/reply`, 'POST',
      { to: [to], reply_all: false, text: mailString(input.text, 64_000),
        headers: { 'Auto-Submitted': 'auto-replied' } }, input.idempotencyKey))
    return { action: 'reply', state: 'sent', to,
      messageId: mailString(delivered.message_id), threadId: mailString(delivered.thread_id) }
  }
  const msgId = input.messageId === undefined ? undefined : boundedId(input.messageId, 'message_id')
  const threadId = input.threadId === undefined ? undefined : boundedId(input.threadId, 'thread_id')
  if (input.action.startsWith('thread_')) {
    const id = boundedId(threadId, 'thread_id')
    if (input.action === 'thread_delete') {
      if (input.confirmation !== `ELIMINAR DEFINITIVAMENTE:${id}`) {
        throw new Error('Permanent thread deletion requires explicit owner confirmation with thread ID')
      }
      await guardThread(id)
      await request(`/threads/${pathId(id)}`, 'DELETE')
      return { action: input.action, threadId: id, deleted: true }
    }
    if (input.action === 'thread_trash') await guardThread(id)
    const data = mailRecord(await request(`/threads/${pathId(id)}`, 'PATCH',
      input.action === 'thread_trash' ? { add_labels: ['trash'] } : { remove_labels: ['trash'] }))
    return { action: input.action, threadId: id,
      labels: Array.isArray(data.labels) ? data.labels.filter((label): label is string => typeof label === 'string') : [] }
  }
  const id = boundedId(msgId, 'message_id')
  if (input.action === 'delete') {
    if (input.confirmation !== `ELIMINAR DEFINITIVAMENTE:${id}`) {
      throw new Error('Permanent message deletion requires explicit owner confirmation with message ID')
    }
    guardMessage(id)
    await request(`/messages/${pathId(id)}`, 'DELETE')
    return { action: 'delete', messageId: id, deleted: true }
  }
  if (input.action === 'trash') guardMessage(id)
  const patch: Record<string, unknown> =
    input.action === 'trash' ? { add_labels: ['trash'] }
      : input.action === 'restore' ? { remove_labels: ['trash'] }
      : input.action === 'read_status' ? { add_labels: ['read'], remove_labels: ['unread'] }
      : input.action === 'unread_status' ? { add_labels: ['unread'], remove_labels: ['read'] }
      : input.action === 'label_add' ? { add_labels: [labelValue(input.label)] }
      : input.action === 'label_remove' ? { remove_labels: [labelValue(input.label)] }
      : {}
  if (Object.keys(patch).length === 0) throw new Error('Unsupported AgentMail management action')
  const changed = mailRecord(await request(`/messages/${pathId(id)}`, 'PATCH', patch))
  return { action: input.action, messageId: id,
    labels: Array.isArray(changed.labels) ? changed.labels.filter((label): label is string => typeof label === 'string') : [] }
}
