import { MailMessageId, MailThreadId } from '../src/assistant-mail-types.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MailJournal } from '../src/assistant-mail-journal.ts'
import { MailOutbox } from '../src/assistant-mail-outbox.ts'
import { MailReceiver } from '../src/assistant-mail-receiver.ts'
import type { AssistantMailTransport, MailMessage } from '../src/assistant-mail-types.ts'
const message: MailMessage = { inboxId: 'kira@agentmail.to', messageId: MailMessageId('incoming'), threadId: MailThreadId('thread'), from: 'owner@example.com', subject: 'Review', text: 'Review this task', authenticated: true, automatic: false }

describe('local mail recovery', () => {
  it('recovers offline mail once and marks replied only after confirmed send', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-receiver-'))
    try {
      let executions = 0
      let sends = 0
      const transport: AssistantMailTransport = { listMessages: async () => ({ ids: [MailMessageId('incoming'), MailMessageId('incoming')] }), readMessage: async () => message, reply: async () => { sends++; return { messageId: MailMessageId('sent'), threadId: MailThreadId('thread') } }, subscribe: async () => () => {} }
      const journal = new MailJournal(join(directory, 'jobs.json'))
      const outbox = new MailOutbox(join(directory, 'outbox.json'), input => transport.reply(input))
      const receiver = new MailReceiver(transport, journal, outbox, async () => ({ state: 'ready', ownerEmail: message.from, inboxId: message.inboxId, contacts: [] }), async () => { executions++; return { outcome: 'completed', summary: 'Reviewed', evidence: 'Validation passed' } })
      await Promise.all([receiver.reconcile(), receiver.reconcile()])
      expect((await journal.list())[0]?.state).toBe('replied')
      await receiver.reconcile()
      expect(executions).toBe(1)
      expect(sends).toBe(1)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('does not spend model calls on an empty mailbox', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-receiver-'))
    try {
      let executions = 0
      const transport: AssistantMailTransport = { listMessages: async () => ({ ids: [] }), readMessage: async () => message, reply: async () => { throw new Error('unexpected send') }, subscribe: async () => () => {} }
      const journal = new MailJournal(join(directory, 'jobs.json'))
      const receiver = new MailReceiver(transport, journal, new MailOutbox(join(directory, 'outbox.json'), input => transport.reply(input)), async () => ({ state: 'ready', ownerEmail: message.from, inboxId: message.inboxId, contacts: [] }), async () => { executions++; throw new Error('unexpected model call') })
      await receiver.reconcile()
      expect(executions).toBe(0)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})

it('continues authorized work past a malformed message and reports degraded ingestion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-receiver-'))
  try {
    const journal = new MailJournal(join(directory, 'jobs.json'))
    const transport: AssistantMailTransport = { listMessages: async () => ({ ids: [MailMessageId('malformed'), MailMessageId('incoming')] }), readMessage: async (id) => { if (id === 'malformed') throw new Error('invalid message'); return message }, reply: async () => ({ messageId: MailMessageId('sent'), threadId: MailThreadId('thread') }), subscribe: async () => () => {} }
    const receiver = new MailReceiver(transport, journal, new MailOutbox(join(directory, 'outbox.json'), input => transport.reply(input)), async () => ({ state: 'ready', ownerEmail: message.from, inboxId: message.inboxId, contacts: [] }), async () => ({ outcome: 'completed', summary: 'Reviewed', evidence: 'Verified' }))
    await expect(receiver.reconcile()).rejects.toThrow('message')
    expect((await journal.list())[0]?.state).toBe('replied')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
it('retains the running checkpoint when its owner stops', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-receiver-'))
  try {
    const journal = new MailJournal(join(directory, 'jobs.json'))
    let rejectWork!: (error: Error) => void
    let started!: () => void
    const startedWork = new Promise<void>((resolve) => { started = resolve })
    const transport: AssistantMailTransport = { listMessages: async () => ({ ids: [MailMessageId('incoming')] }), readMessage: async () => message, reply: async () => { throw new Error('no send') }, subscribe: async () => () => {} }
    const receiver = new MailReceiver(transport, journal, new MailOutbox(join(directory, 'outbox.json'), input => transport.reply(input)), async () => ({ state: 'ready', ownerEmail: message.from, inboxId: message.inboxId, contacts: [] }), async (job) => {
      await journal.transition(job.id, 'running')
      started()
      return new Promise((_resolve, reject) => { rejectWork = reject })
    })
    const running = receiver.reconcile()
    await startedWork
    const stopping = receiver.stop()
    rejectWork(new Error('owner stopped'))
    await Promise.all([running, stopping])
    expect((await journal.list())[0]?.state).toBe('running')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
