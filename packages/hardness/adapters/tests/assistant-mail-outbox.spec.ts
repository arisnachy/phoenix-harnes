import { MailMessageId, MailThreadId } from '../src/assistant-mail-types.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MailOutbox } from '../src/assistant-mail-outbox.ts'
const reply = { inboxId: 'kira@agentmail.to', messageId: MailMessageId('incoming'), to: 'owner@example.com', text: 'Done', idempotencyKey: 'job-1' }

describe('durable reply outbox', () => {
  it('retries lost confirmation with exactly the same reply identity across restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-outbox-'))
    try {
      const path = join(directory, 'outbox.json')
      let sends = 0
      const delivered = new Map<string, string>()
      const send = async (input: typeof reply) => {
        delivered.set(input.idempotencyKey, input.text)
        if (++sends === 1) throw new Error('confirmation lost')
        return { messageId: MailMessageId('sent'), threadId: MailThreadId('thread') }
      }
      const first = new MailOutbox(path, send)
      await first.enqueue(reply)
      await first.flush()
      expect((await first.list())[0]?.state).toBe('pending')
      const restarted = new MailOutbox(path, send)
      await restarted.flush()
      expect(delivered.size).toBe(1)
      expect((await restarted.list())[0]?.state).toBe('sent')
      await restarted.flush()
      expect(sends).toBe(2)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('does not retry an ambiguous send after provider deduplication expires', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-outbox-'))
    try {
      let now = 0
      let sends = 0
      const outbox = new MailOutbox(join(directory, 'outbox.json'), async () => { sends++; throw new Error('lost') }, () => now)
      await outbox.enqueue(reply)
      await outbox.flush()
      now = 24 * 60 * 60 * 1000
      await outbox.flush()
      expect(sends).toBe(1)
      expect((await outbox.list())[0]?.state).toBe('ambiguous')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('recovers new messages from immutable payloads, preserves reply routing, and parks at the exact expiry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-outgoing-'))
    try {
      const path = join(directory, 'outbox.json')
      const message = { taskId: 'mail-task', scheduledFor: '2026-09-28T02:53:29.000Z', inboxId: reply.inboxId, to: reply.to, subject: 'Report', text: 'Saved body', idempotencyKey: 'new-message' }
      let now = 0
      const seen: typeof message[] = []
      const send = async (request: typeof message) => { seen.push(request); throw new Error('lost confirmation') }
      const first = new MailOutbox(path, async () => { throw new Error('not a reply') }, () => now, send)
      await first.enqueueMessage(message)
      await first.flush()
      const restarted = new MailOutbox(path, async () => { throw new Error('not a reply') }, () => now, send)
      await expect(restarted.enqueueMessage({ ...message, text: 'Regenerated' })).rejects.toThrow('different content')
      now = 86_399_999
      await restarted.flush()
      expect(seen).toEqual([message, message])
      now = 86_400_000
      await restarted.flush()
      expect(seen).toHaveLength(2)
      expect((await restarted.list())[0]?.state).toBe('ambiguous')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

})
