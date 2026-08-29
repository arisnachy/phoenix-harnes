import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import ApprovalService, {
  approvalRecommendationFor,
  createApprovalDeadline,
  type ApprovalOutcome,
} from '@phoenix-ai/dsh-user-approval'

function agent(): Agent {
  return {
    session: {
      events: [{ type: 'turn/start' }],
      append: vi.fn(),
    },
  } as unknown as Agent
}

describe('bounded approval deadlines', () => {
  it('chooses allow for low-risk reversible work and reject for high-risk work', () => {
    expect(approvalRecommendationFor({ risk: 'low', reversible: true })).toBe('allowed-once')
    expect(approvalRecommendationFor({ risk: 'high', reversible: false })).toBe('rejected')
  })

  it('creates a finite deadline with a second-readable expiry', () => {
    expect(createApprovalDeadline({ now: 10_000, timeoutMs: 2_000, risk: 'low', reversible: true, policyRevision: 3 })).toEqual({
      requestedAt: 10_000,
      expiresAt: 12_000,
      risk: 'low',
      recommendation: 'allowed-once',
      policyRevision: 3,
    })
  })

  it('resolves a pending answer at expiry and records the automatic outcome', async () => {
    vi.useFakeTimers()
    try {
      const ctx = new Context()
      await ctx.plugin(ApprovalService, { timeoutMs: 1_000 })
      const pending = new Promise<ApprovalOutcome>(() => {})
      ctx.on('approval/request', () => pending)
      const answer = ctx.approval.request({
        agent: agent(),
        toolName: 'read-file',
        risk: 'low',
        reversible: true,
      })

      await vi.advanceTimersByTimeAsync(1_000)
      await expect(answer).resolves.toBe('allowed-once')
    } finally {
      vi.useRealTimers()
    }
  })
})
