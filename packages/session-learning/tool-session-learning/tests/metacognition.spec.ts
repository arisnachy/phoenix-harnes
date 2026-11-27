import { describe, expect, it } from 'vitest'
import { assessMetaEvidence, classifyMetaFailure, compareMetaExperience, formatMetaComparison, metaRecoveryHint, metaResultCallId } from '../src/metacognition.ts'

describe('PHOENIX META evidence', () => {
  it('does not equate unverified outcomes with success or failure', () => {
    expect(assessMetaEvidence({ runs: 10, verifiedSuccesses: 3, failures: 1 })).toEqual({
      attempts: 10, verified: 3, failed: 1, unverified: 6, verifiedFraction: 0.3, sufficientForReuse: false,
    })
    expect(assessMetaEvidence({ runs: 5, verifiedSuccesses: 4, failures: 0 }).sufficientForReuse).toBe(true)
    expect(assessMetaEvidence({ runs: 0, verifiedSuccesses: 0, failures: 0 }).verifiedFraction).toBeNull()
    expect(assessMetaEvidence({ runs: 2, verifiedSuccesses: 3, failures: 0 }).sufficientForReuse).toBe(false)
  })
  it('classifies machine codes without trusting payload text', () => {
    expect(classifyMetaFailure({ code: 'CONTEXT_WINDOW_EXCEEDED' })).toBe('context')
    expect(classifyMetaFailure({ code: 'OUTPUT_TOKEN_LIMIT_REACHED' })).toBe('output-limit')
    expect(classifyMetaFailure({ code: 'TOKEN_LIMIT' })).toBe('unknown')
    expect(classifyMetaFailure({ code: 'TOOL_ABORTED' })).toBe('cancelled')
    expect(classifyMetaFailure({ code: 'RATE_LIMIT_EXCEEDED' })).toBe('quota')
    expect(classifyMetaFailure({ code: 'PERMISSION_DENIED' })).toBe('permission')
    expect(classifyMetaFailure({ code: 'ETIMEDOUT' })).toBe('transport')
    expect(classifyMetaFailure({ code: 'INVALID_ARGUMENT' })).toBe('invalid-input')
    expect(classifyMetaFailure({ message: 'RATE_LIMIT' })).toBe('unknown')
    expect(metaRecoveryHint('permission')).toContain('Never bypass')
    expect(metaRecoveryHint('cancelled')).toBeUndefined()
  })
  it('correlates canonical and legacy tool result identities', () => {
    expect(metaResultCallId({ source: { callId: 'actual' }, callId: 'legacy' })).toBe('actual')
    expect(metaResultCallId({ callId: 'legacy' })).toBe('legacy')
    expect(metaResultCallId({ source: { callId: 1 } })).toBeUndefined()
  })
})

describe('META historical counterfactual baseline', () => {
  const run = (verified: boolean, tokens: number, wallTimeMs: number) => ({
    occurredAt: 1, wallTimeMs, totalTokens: tokens, toolCalls: 1, failedToolCalls: 0,
    retries: 0, userInterventions: 0, verified, qualityPassed: verified,
  })
  it('keeps failed/unverified episodes in the denominator and does not infer causation', () => {
    const rows = [run(true, 100, 100), run(true, 200, 200), run(false, 1, 1), run(true, 10, 10)]
    expect(compareMetaExperience(rows)).toEqual({
      earlier: { attempts: 2, verified: 2, averageWallMs: 150, averageReportedTokens: 150 },
      recent: { attempts: 2, verified: 1, averageWallMs: null, averageReportedTokens: null },
      causalConclusion: false,
    })
    expect(formatMetaComparison(rows)).toContain('not proof')
    expect(compareMetaExperience(rows.slice(0, 3))).toBeUndefined()
  })
})
