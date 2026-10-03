/** Durable outbound replies and new messages with the provider's 24-hour idempotency lifetime. */
import { MailMessageId, MailThreadId } from './assistant-mail-types.ts'
import type { MailDelivery, MailReply, MailOutgoingMessage, MailOutgoingOwnership } from './assistant-mail-types.ts'
import { MailFile, mailAddress, mailRecord, mailString } from './assistant-mail-store.ts'

interface Outgoing { readonly reply: MailReply | MailOutgoingMessage; readonly state: 'pending' | 'sent' | 'ambiguous'; readonly firstAttempt?: number; readonly delivery?: MailDelivery }
function outgoing(value: unknown): Outgoing[] {
  if (!Array.isArray(value)) throw new Error('invalid mail outbox')
  return value.map((raw) => {
    const row = mailRecord(raw)
    const input = mailRecord(row.reply)
    if (!['pending', 'sent', 'ambiguous'].includes(String(row.state)) || (row.firstAttempt !== undefined && (typeof row.firstAttempt !== 'number' || !Number.isFinite(row.firstAttempt)))) throw new Error('invalid mail outbox state')
    if (input.subject !== undefined && !Number.isFinite(Date.parse(mailString(input.scheduledFor)))) throw new Error('invalid outgoing mail occurrence')
    const delivery = row.delivery === undefined ? undefined : mailRecord(row.delivery)
    if (row.state === 'sent' && delivery === undefined) throw new Error('sent mail has no provider confirmation')
    return { state: row.state as Outgoing['state'], reply: { inboxId: mailAddress(mailString(input.inboxId)), ...(input.subject === undefined ? { messageId: MailMessageId(mailString(input.messageId)) } : { subject: mailString(input.subject, 1024), taskId: mailString(input.taskId), scheduledFor: mailString(input.scheduledFor) }), to: mailAddress(mailString(input.to)), text: mailString(input.text, 64_000), idempotencyKey: mailString(input.idempotencyKey) },
      ...(row.firstAttempt === undefined ? {} : { firstAttempt: row.firstAttempt }),
      ...(delivery === undefined ? {} : { delivery: { messageId: MailMessageId(mailString(delivery.messageId)),
        threadId: MailThreadId(mailString(delivery.threadId)) } }),
    }
  })
}
/** One serialized sender; ambiguous expired sends require owner review. */
export class MailOutbox {
  private readonly file: MailFile<Outgoing[]>
  private stopped = false
  private isStopped(): boolean { return this.stopped }
  private flushing: Promise<void> | undefined
  constructor(path: string,
    private readonly send: (reply: MailReply) => Promise<MailDelivery>,
    private readonly clock: () => number = Date.now,
    private readonly sendMessage?: (message: MailOutgoingMessage) => Promise<MailDelivery>,
    private readonly authorizeMessage?: (ownership: MailOutgoingOwnership) => Promise<boolean>) { this.file = new MailFile(path,
    () => [],
    outgoing) }
  /** Read provider-confirmed and pending outgoing messages.
   * @returns Outgoing records.
   */
  list(): Promise<Outgoing[]> { return this.file.read() }
  /** Commit immutable output before trying any external send.
   * @param reply Reply authorized by one verified mail job.
   */
  async enqueue(reply: MailReply): Promise<void> { await this.persist(reply) }
  /** Persist a new message without inventing an incoming reply identity.
   * @param message Authorized immutable outgoing message.
   */
  async enqueueMessage(message: MailOutgoingMessage): Promise<void> { await this.persist(message) }
  private async persist(input: MailReply | MailOutgoingMessage): Promise<void> {
    const [canonical] = outgoing([{ reply: input, state: 'pending' }])
    if (canonical === undefined) throw new Error('mail outgoing payload is missing')
    const reply = canonical.reply
    await this.file.change((rows) => {
      const previous = rows.find(row => row.reply.idempotencyKey === reply.idempotencyKey)
      if (previous !== undefined) {
        if (JSON.stringify(previous.reply) !== JSON.stringify(reply)) throw new Error('mail outgoing identity reused with different content')
        return rows
      }
      return [...rows, { reply, state: 'pending' }]
    })
  }
  /** Retry only while the provider's deduplication guarantee remains valid. */
  flush(): Promise<void> {
    if (this.isStopped()) return Promise.resolve()
    if (this.flushing !== undefined) return this.flushing
    this.flushing = this.deliver().finally(() => { this.flushing = undefined })
    return this.flushing
  }
  /** Stop further provider attempts and await the currently owned flush. */
  async stop(): Promise<void> { this.stopped = true; await this.flushing }
  private async deliver(): Promise<void> {
    for (const row of await this.file.read()) {
      if (this.isStopped()) return
      if (row.state !== 'pending') continue
      const sendMessage = this.sendMessage
      if ('subject' in row.reply && sendMessage === undefined) throw new Error('outbox new-message sender is unavailable')
      const key = row.reply.idempotencyKey
      const now = this.clock()
      if (row.firstAttempt !== undefined && (now < row.firstAttempt || now - row.firstAttempt >= 86_400_000)) {
        await this.file.change(rows => rows.map(item => item.reply.idempotencyKey === key ? { ...item, state: 'ambiguous' } : item))
        continue
      }
      if ('subject' in row.reply && this.authorizeMessage !== undefined && !await this.authorizeMessage(row.reply)) continue
      if (this.isStopped()) return
      await this.file.change(rows => rows.map(item => item.reply.idempotencyKey === key ? { ...item,
        firstAttempt: item.firstAttempt ?? now } : item))
      let delivery: MailDelivery
      try {
        if ('subject' in row.reply) {
          if (sendMessage === undefined) throw new Error('outbox new-message sender is unavailable')
          delivery = await sendMessage(row.reply)
        } else delivery = await this.send(row.reply)
      } catch { continue /* Provider failure is retained as pending;
         periodic recovery retries within its guarantee. */ }
      await this.file.change(rows => rows.map(item => item.reply.idempotencyKey === key ? { ...item, state: 'sent', delivery } : item))
    }
  }
}
