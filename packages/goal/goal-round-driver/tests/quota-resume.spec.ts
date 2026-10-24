import { describe, expect, it } from 'vitest'
import { LlmError, QUOTA_EXCEEDED_CODE } from '@phoenix-ai/dsh-llm'
import { markQuotaResume, quotaResumeAt, quotaResumeTarget } from '../src/quota-resume.ts'

describe('conservative persisted provider quota reset', () => {
  const now = Date.parse('2026-10-24T14:00:00.000Z')
  it('respects an actual ChatGPT Plus 239-minute reset estimate and safety margin', () => {
    const error = new LlmError('You have hit your ChatGPT usage limit (plus plan). Try again in ~239 min.', QUOTA_EXCEEDED_CODE)
    const at = quotaResumeAt(error, now)
    expect(at).toBe('2026-10-24T17:59:30.000Z')
    expect(quotaResumeTarget(markQuotaResume('Provider quota exhausted.', at!))).toBe(Date.parse(at!))
  })

  it('handles explicit hours and refuses negative, zero or extreme wait estimates', () => {
    expect(quotaResumeAt(new LlmError('Try again in 4 hours', QUOTA_EXCEEDED_CODE), now))
      .toBe('2026-10-24T18:00:30.000Z')
    for (const message of ['Try again in 0 min', 'Try again in 99999 hours', 'Quota exhausted']) {
      expect(quotaResumeAt(new LlmError(message, QUOTA_EXCEEDED_CODE), now)).toBeUndefined()
    }
  })

  it('does not guess resets for transient rate limits, arbitrary exceptions or forged markers', () => {
    expect(quotaResumeAt(new LlmError('Try again in 3 min', 'RATE_LIMIT'), now)).toBeUndefined()
    expect(quotaResumeAt(new Error('Try again in 3 min'), now)).toBeUndefined()
    expect(quotaResumeTarget('Retry at 2026-10-24T17:59:30Z')).toBeUndefined()
    expect(quotaResumeTarget('[Phoenix quota resume at 2026-13-24T17:59:30.000Z]')).toBeUndefined()
    expect(quotaResumeTarget('[Phoenix quota resume at 2026-10-24T17:59:30.000Z] extra')).toBeUndefined()
  })
})
