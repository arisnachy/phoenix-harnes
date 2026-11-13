import { describe, expect, it } from 'vitest'
import { consumeCodexReset, projectCodexResetState } from '../src/account.ts'

describe('Codex earned reset controls', () => {
  it('projects reset count and credit expiration without leaking provider extras', () => {
    const value = projectCodexResetState({
      rateLimits: {
        primary: { usedPercent: 55, windowDurationMins: 300, resetsAt: 1_900_000_000, token: 'discard' },
        secondary: { usedPercent: 12, windowDurationMins: 10_080 },
      },
      rateLimitResetCredits: {
        availableCount: 2,
        credits: [{
          id: 'RateLimitResetCredit_1', status: 'available', resetType: 'codexRateLimits',
          expiresAt: 1_900_000_000, title: 'Full reset', privateKey: 'discard',
        }],
      },
      accessToken: 'discard',
    }, true)
    expect(value).toMatchObject({
      connected: true,
      availableCount: 2,
      primary: { usedPercent: 55, windowDurationMins: 300 },
      secondary: { usedPercent: 12, windowDurationMins: 10_080 },
      credits: [{ id: 'RateLimitResetCredit_1', status: 'available', expiresAt: 1_900_000_000 }],
    })
    expect(value.credits).toHaveLength(1)
    expect(JSON.stringify(value)).not.toContain('discard')
  })

  it('distinguishes unavailable metadata from zero available credits', () => {
    const unknown = projectCodexResetState({ rateLimits: {} }, true)
    expect(unknown.availableCount).toBeUndefined()
    expect(unknown.credits).toEqual([])
    const empty = projectCodexResetState({ rateLimitResetCredits: { availableCount: 0, credits: [] } }, true)
    expect(empty.availableCount).toBe(0)
    expect(empty.connected).toBe(true)
  })

  it('rejects a malformed idempotency key before opening any Codex process', async () => {
    await expect(consumeCodexReset({} as never, { env: {}, disposeGraceMs: 1000 }, {
      idempotencyKey: 'bad',
    })).rejects.toThrow('valid UUID idempotency key')
    await expect(consumeCodexReset({} as never, { env: {}, disposeGraceMs: 1000 }, {
      idempotencyKey: '8ae96ff3-3425-4f4c-8772-b6fd61502868', creditId: '',
    })).rejects.toThrow('creditId must not be empty')
  })
})
