/** Durable outbound replies with the provider's 24-hour idempotency lifetime. */
import { MailMessageId, MailThreadId } from './assistant-mail-types.ts'
import type { MailDelivery, MailReply } from './assistant-mail-types.ts'
import { MailFile, mailAddress, mailRecord, mailString } from './assistant-mail-store.ts'

interface Outgoing { readonly reply: MailReply; readonly state: 'pending' | 'sent' | 'ambiguous'; readonly firstAttempt?: number; readonly delivery?: MailDelivery }
function outgoing(value: unknown): Outgoing[] {
  if (!Array.isArray(value)) throw new Error('invalid mail outbox')
  return value.map((raw) => {
    const row = mailRecord(raw)
    const input = mailRecord(row.reply)
    if (!['pending', 'sent', 'ambiguous'].includes(String(row.state)) || (row.firstAttempt !== undefined && (typeof row.firstAttempt !== 'number' || !Number.isFinite(row.firstAttempt)))) throw new Error('invalid mail outbox state')
    const delivery = row.delivery === undefined ? undefined : mailRecord(row.delivery)
    return { state: row.state as Outgoing['state'], reply: { inboxId: mailAddress(mailString(input.inboxId)), messageId: MailMessageId(mailString(input.messageId)), to: mailAddress(mailString(input.to)), text: mailString(input.text, 32_000), idempotencyKey: mailString(input.idempotencyKey) },
      ...(row.firstAttempt === undefined ? {} : { firstAttempt: row.firstAttempt }),
      ...(delivery === undefined ? {} : { delivery: { messageId: MailMessageId(mailString(delivery.messageId)),
        threadId: MailThreadId(mailString(delivery.threadId)) } }),
    }
  })
}
/** One serialized sender; ambiguous expired sends require owner review. */
export class MailOutbox {
  private readonly file: MailFile<Outgoing[]>
  private flushing: Promise<void> | undefined
  constructor(path: string,
    private readonly send: (reply: MailReply) => Promise<MailDelivery>,
    private readonly clock: () => number = Date.now) { this.file = new MailFile(path,
    () => [],
    outgoing) }
  /** Read provider-confirmed and pending replies.
   * @returns Outgoing records.
   */
  list(): Promise<Outgoing[]> { return this.file.read() }
  /** Commit immutable output before trying any external send.
   * @param reply Reply authorized by one verified mail job.
   */
  async enqueue(reply: MailReply): Promise<void> {
    await this.file.change((rows) => {
      const previous = rows.find(row => row.reply.idempotencyKey === reply.idempotencyKey)
      if (previous !== undefined) {
        if (JSON.stringify(previous.reply) !== JSON.stringify(reply)) throw new Error('mail reply identity reused with different content')
        return rows
      }
      return [...rows, { reply, state: 'pending' }]
    })
  }
  /** Retry only while the provider's deduplication guarantee remains valid. */
  flush(): Promise<void> {
    if (this.flushing !== undefined) return this.flushing
    this.flushing = this.deliver().finally(() => { this.flushing = undefined })
    return this.flushing
  }
  private async deliver(): Promise<void> {
    for (const row of await this.file.read()) {
      if (row.state !== 'pending') continue
      const key = row.reply.idempotencyKey
      const now = this.clock()
      if (row.firstAttempt !== undefined && (now < row.firstAttempt || now - row.firstAttempt >= 86_400_000)) {
        await this.file.change(rows => rows.map(item => item.reply.idempotencyKey === key ? { ...item, state: 'ambiguous' } : item))
        continue
      }
      await this.file.change(rows => rows.map(item => item.reply.idempotencyKey === key ? { ...item,
        firstAttempt: item.firstAttempt ?? now } : item))
      let delivery: MailDelivery
      try { delivery = await this.send(row.reply) } catch { continue /* Provider failure is retained as pending;
         periodic recovery retries within its guarantee. */ }
      await this.file.change(rows => rows.map(item => item.reply.idempotencyKey === key ? { ...item, state: 'sent', delivery } : item))
    }
  }
}
