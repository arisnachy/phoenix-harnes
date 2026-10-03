/** Serial local mailbox catch-up, job recovery and reply confirmation. */
import { MailJobId } from './assistant-mail-types.ts'
import type { AssistantMailTransport, MailAccount, MailJob, MailMessage } from './assistant-mail-types.ts'
import type { MailJournal } from './assistant-mail-journal.ts'
import type { MailOutbox } from './assistant-mail-outbox.ts'

/** Verified work outcome; no acceptance-only result is deliverable. */
export interface MailWorkResult { readonly outcome: 'completed' | 'blocked'; readonly summary: string; readonly evidence: string }

/** Reconciles only while the owning local host is alive. */
export class MailReceiver {
  private active: Promise<void> | undefined
  private stopped = false
  private isStopped(): boolean { return this.stopped }
  constructor(private readonly transport: AssistantMailTransport,
    private readonly journal: MailJournal,
    private readonly outbox: MailOutbox,
    private readonly account: () => Promise<MailAccount>,
    private readonly execute: (job: MailJob) => Promise<MailWorkResult>) {}
  /** Reconcile concurrent notifications into one owned recovery interval. */
  reconcile(): Promise<void> {
    if (this.isStopped()) return Promise.resolve()
    if (this.active !== undefined) return this.active
    this.active = this.recover().finally(() => { this.active = undefined })
    return this.active
  }
  /** Stop accepting new work and await the current interval. */
  async stop(): Promise<void> { this.stopped = true; await this.active }
  private async recover(): Promise<void> {
    const account = await this.account()
    if (account.state !== 'ready') return
    const known = new Set((await this.journal.list()).map(job => job.message.messageId))
    const tokens = new Set<string>()
    let cursor: string | undefined
    let ingestionFailed = false
    do {
      if (this.isStopped()) return
      const page = await this.transport.listMessages(cursor)
      for (const id of page.ids) {
        if (this.isStopped()) return
        if (known.has(id)) continue
        let message: MailMessage
        try {
          message = await this.transport.readMessage(id)
        } catch {
          // Isolate bad provider messages; retry transient failures next poll, without starving durable work.
          ingestionFailed = true
          continue
        }
        await this.journal.accept(message, account)
        known.add(id)
      }
      cursor = page.next
      if (cursor !== undefined && tokens.has(cursor)) throw new Error('mail provider repeated pagination token')
      if (cursor !== undefined) tokens.add(cursor)
    } while (cursor !== undefined)
    for (const job of await this.journal.list()) {
      if (this.isStopped()) return
      if (job.state === 'replied' || job.state === 'blocked') continue
      const current = await this.account()
      if (current.state !== 'ready' || ![current.ownerEmail, ...current.contacts].includes(job.message.from)) {
        await this.journal.transition(job.id, 'blocked', { error: 'sender authorization is no longer active' })
        continue
      }
      let finished = job
      if (job.state !== 'reply-pending') {
        try {
          const result = await this.execute(job)
          if (result.outcome !== 'completed' || result.summary.trim().length === 0 || result.evidence.trim().length === 0) {
            await this.journal.transition(job.id, 'blocked', { error: result.summary || 'work has no verified result' })
            continue
          }
          finished = await this.journal.transition(job.id, 'reply-pending', { summary: result.summary, evidence: result.evidence })
        } catch {
          if (this.isStopped()) return
          await this.journal.transition(job.id, 'blocked', { error: 'work interrupted or approval required; inspect the persisted conversation before retrying' })
          continue
        }
      }
      if (finished.summary === undefined) throw new Error('pending mail reply has no durable content')
      await this.outbox.enqueue({ inboxId: finished.message.inboxId, messageId: finished.message.messageId, to: finished.message.from, text: finished.summary, idempotencyKey: `phoenix-mail-${finished.id}` })
    }
    if (this.isStopped()) return
    await this.outbox.flush()
    for (const row of await this.outbox.list()) {
      if ('subject' in row.reply) continue
      const id = MailJobId(row.reply.idempotencyKey.replace(/^phoenix-mail-/u, ''))
      const job = (await this.journal.list()).find(job => job.id === id)
      if (job?.state !== 'reply-pending') continue
      if (row.state === 'sent') await this.journal.transition(id, 'replied')
      if (row.state === 'ambiguous') await this.journal.transition(id, 'blocked', { error: 'mail send confirmation is ambiguous beyond the provider retry window' })
    }
    if (ingestionFailed) throw new Error('one or more mail messages could not be read; other jobs were reconciled')
  }
}
