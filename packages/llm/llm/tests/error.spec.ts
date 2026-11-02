import { describe, expect, it } from 'vitest'
import { isQuotaExceededError } from '@phoenix-ai/dsh-llm'

describe('quota error classification', () => {
  it.each([
    'The usage limit has been reached',
    'usage limit reached',
    'usage limit exceeded',
    'quota exhausted',
  ])('recognizes terminal quota wording: %s', (message) => {
    expect(isQuotaExceededError(message)).toBe(true)
  })

  it('does not confuse transient rate limiting with account quota exhaustion', () => {
    expect(isQuotaExceededError('rate limit reached; retry in 500ms')).toBe(false)
  })
})
