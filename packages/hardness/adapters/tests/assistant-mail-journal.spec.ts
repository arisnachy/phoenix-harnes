import { MailMessageId, MailThreadId } from '../src/assistant-mail-types.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MailJournal } from '../src/assistant-mail-journal.ts'
import type { MailMessage } from '../src/assistant-mail-types.ts'
const message: MailMessage = { inboxId: 'kira@agentmail.to', messageId: MailMessageId('incoming'), threadId: MailThreadId('thread'), from: 'owner@example.com', subject: 'Review', text: 'Review this task', authenticated: true, automatic: false }
const account = { state: 'ready', ownerEmail: 'owner@example.com', inboxId: 'kira@agentmail.to', contacts: [] } as const

describe('mail job journal', () => {
  it('accepts a message once across concurrent receipt and restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-'))
    try {
      const path = join(directory, 'jobs.json')
      const journal = new MailJournal(path)
      const [a, b] = await Promise.all([journal.accept(message, account), journal.accept(message, account)])
      expect(a?.id).toBe(b?.id)
      expect(await new MailJournal(path).list()).toHaveLength(1)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('denies forged, unknown, unverified, own and automatic mail before work is queued', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-'))
    try {
      const journal = new MailJournal(join(directory, 'jobs.json'))
      expect(await journal.accept({ ...message, authenticated: false }, account)).toBeUndefined()
      expect(await journal.accept({ ...message, from: 'unknown@example.com' }, account)).toBeUndefined()
      expect(await journal.accept(message, { ...account, state: 'pending-verification' })).toBeUndefined()
      expect(await journal.accept({ ...message, automatic: true }, account)).toBeUndefined()
      expect(await journal.accept({ ...message, from: message.inboxId }, account)).toBeUndefined()
      expect(await journal.list()).toEqual([])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
