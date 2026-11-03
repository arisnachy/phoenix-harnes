import { SessionId } from '@phoenix-ai/dsh-session'
import { ProactivityDeferredError } from '../src/proactivity-engine.ts'
import { MailJobId, MailMessageId, MailThreadId } from '../src/assistant-mail-types.ts'
import { describe, expect, it } from 'vitest'
import { createMailCompletionTool, createMailExecutor, mailWorkResult } from '../src/assistant-mail-executor.ts'

describe('mail completion gate', () => {
  it('refuses acceptance-only output and requires concrete verification evidence', () => {
    expect(() => mailWorkResult({ outcome: 'completed', summary: 'accepted', evidence: '' })).toThrow()
    expect(() => mailWorkResult({ outcome: 'accepted', summary: 'Queued', evidence: 'none' })).toThrow()
    expect(mailWorkResult({ outcome: 'completed', summary: 'Fixed', evidence: 'Relevant tests passed' })).toMatchObject({ outcome: 'completed' })
  })
  it('does not expose a completion tool belonging to another mission', async () => {
    let result: unknown
    const tool = createMailCompletionTool(SessionId('owned'), async (output) => { result = output })
    await expect(tool.execute({ outcome: 'completed', summary: 'Fixed', evidence: 'Checked' }, { agent: { id: 'other' } } as never)).rejects.toThrow('mission')
    expect(result).toBeUndefined()
  })
})

it('defers host startup before creating a mission when execution services have not mounted', async () => {
  const executor = createMailExecutor({ get: () => undefined } as never, {} as never,
    async () => ({ state: 'ready', contacts: [] }),
    { pollMs: 60_000, privateWorkProvider: 'spawn', privateWorkResultChars: 1000 }, 1000)
  await expect(executor.run({ id: MailJobId('job'), state: 'pending', updatedAt: '2026-10-03T00:00:00Z',
    sessionId: SessionId('mission'), message: { inboxId: 'kira@agentmail.to', messageId: MailMessageId('incoming'),
      threadId: MailThreadId('thread'), from: 'owner@example.com', subject: 'Encargo', text: 'Revisa esto',
      authenticated: true, automatic: false },
  })).rejects.toBeInstanceOf(ProactivityDeferredError)
  await executor.stop()
})
