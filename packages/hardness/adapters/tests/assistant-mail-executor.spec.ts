import { SessionId } from '@phoenix-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { createMailCompletionTool, mailWorkResult } from '../src/assistant-mail-executor.ts'

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
