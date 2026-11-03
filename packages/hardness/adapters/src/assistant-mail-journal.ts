/** Authorized, deduplicated durable mail jobs. */
import { createHash, randomUUID } from 'node:crypto'
import { SessionId } from '@phoenix-ai/dsh-session'
import { MailMessageId, MailThreadId, MailJobId } from './assistant-mail-types.ts'
import type { MailAccount, MailJob, MailMessage } from './assistant-mail-types.ts'
import { MailFile, mailAddress, mailRecord, mailString } from './assistant-mail-store.ts'

function parseMessage(value: unknown): MailMessage {
  const row = mailRecord(value)
  if (typeof row.authenticated !== 'boolean' || typeof row.automatic !== 'boolean') throw new Error('invalid mail authentication metadata')
  return { inboxId: mailAddress(mailString(row.inboxId)),
    messageId: MailMessageId(mailString(row.messageId)),
    threadId: MailThreadId(mailString(row.threadId)),
    from: mailAddress(mailString(row.from)),
    subject: mailString(row.subject),
    text: mailString(row.text,
      64_000),
    authenticated: row.authenticated,
    automatic: row.automatic }
}
function parseJobs(value: unknown): MailJob[] {
  if (!Array.isArray(value)) throw new Error('invalid mail job ledger')
  return value.map((value) => {
    const row = mailRecord(value)
    if (!['received', 'pending', 'running', 'verifying', 'reply-pending', 'replied', 'blocked'].includes(String(row.state))) throw new Error('invalid mail job state')
    return { id: MailJobId(mailString(row.id)), updatedAt: mailString(row.updatedAt), message: parseMessage(row.message), state: row.state as MailJob['state'],
      ...(row.sessionId === undefined ? {} : { sessionId: SessionId(mailString(row.sessionId)) }),
      ...(row.outcome === undefined ? {} : { outcome: row.outcome === 'completed' ? 'completed' as const : row.outcome === 'blocked' ? 'blocked' as const : (() => { throw new Error('invalid mail outcome') })() }),
      ...(row.summary === undefined ? {} : { summary: mailString(row.summary, 16_000) }),
      ...(row.evidence === undefined ? {} : { evidence: mailString(row.evidence, 16_000) }),
      ...(row.error === undefined ? {} : { error: mailString(row.error, 2048) }),
    }
  })
}
/** Serializes receipt and state changes before execution or reply. */
export class MailJournal {
  private readonly file: MailFile<MailJob[]>
  constructor(path: string) { this.file = new MailFile(path, () => [], parseJobs) }
  /** Read durable job snapshots.
   * @returns Jobs in receipt order.
   */
  list(): Promise<MailJob[]> { return this.file.read() }
  /** Admit only authenticated mail from owner-authorized senders.
   * @param message Provider-validated candidate.
   * @param account Verified owner and explicit contacts.
   * @returns Existing/new job, or undefined for denied mail.
   */
  async accept(message: MailMessage, account: MailAccount): Promise<MailJob | undefined> {
    if (account.state !== 'ready' || account.inboxId !== message.inboxId || !message.authenticated || message.automatic
      || message.from === message.inboxId || ![account.ownerEmail, ...account.contacts].includes(message.from)) return undefined
    const id = MailJobId(createHash('sha256').update(JSON.stringify([message.inboxId, message.messageId])).digest('hex'))
    const jobs = await this.file.change(rows => rows.some(job => job.id === id) ? rows : [...rows, { id, updatedAt: new Date().toISOString(), message, state: 'pending', sessionId: SessionId(randomUUID()) }])
    return jobs.find(job => job.id === id)
  }
  /** Persist a job checkpoint; caller must own execution of that job.
   * @param id Durable job identity.
   * @param state New work state.
   * @param patch Verified output or failure context.
   * @returns Updated job.
   */
  async transition(id: MailJobId, state: MailJob['state'], patch: Pick<Partial<MailJob>, 'summary' | 'evidence' | 'error' | 'outcome'> = {}): Promise<MailJob> {
    const jobs = await this.file.change((rows) => {
      if (!rows.some(job => job.id === id)) throw new Error('unknown mail job')
      return rows.map(job => job.id === id ? { ...job, ...patch, state, updatedAt: new Date().toISOString() } : job)
    })
    const updated = jobs.find(job => job.id === id)
    if (updated === undefined) throw new Error('mail job disappeared during transition')
    return updated
  }
}
