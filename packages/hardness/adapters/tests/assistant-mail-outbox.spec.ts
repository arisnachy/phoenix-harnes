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
})
