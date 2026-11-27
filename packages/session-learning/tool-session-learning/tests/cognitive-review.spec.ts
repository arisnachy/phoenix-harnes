import { describe, expect, it } from 'vitest'
import { cognitionGuidance, reviewCognition } from '../src/cognitive-review.ts'
import type { ExperienceAggregate, ExperienceRunMetrics } from '../src/experience.ts'

const run = (verified = true, retries = 0, cost = 100): ExperienceRunMetrics => ({
  occurredAt: 1, wallTimeMs: cost, totalTokens: cost, toolCalls: 1,
  failedToolCalls: retries, retries, userInterventions: 0, verified, qualityPassed: verified,
})
const state = (rows: ExperienceRunMetrics[]): ExperienceAggregate => ({
  version: 1, key: 'test', taskFingerprint: { tokens: [] } as ExperienceAggregate['taskFingerprint'],
  taskSummary: 'private', maturity: 'validated', runs: rows.length,
  verifiedSuccesses: rows.filter(row => row.verified).length, failures: 0,
  totalWallTimeMs: 0, totalTokens: 0, totalToolCalls: 0, totalFailedToolCalls: 0,
  totalRetries: 0, totalUserInterventions: 0, firstObservedAt: 1, lastObservedAt: 1, recentRuns: rows,
})
describe('cognitive review', () => {
  it('does not fabricate evidence, quota, emotion or prediction', () => {
    const report = reviewCognition(undefined)
    expect(report.agency.next).toBe('discover')
    expect(report.homeostasis.liveQuota).toBe('not-observed')
    expect(report.foresight.predictiveProbability).toBeNull()
    expect(report.uncertainty.userEmotion).toBe('not-inferred')
    expect(cognitionGuidance(undefined)).toBe('')
  })
  it('recommends reuse only for recent verified evidence', () => {
    expect(reviewCognition(state([run(), run(), run(), run()])).agency.next).toBe('reuse')
    expect(reviewCognition(state([run(), run(), run(), run(false)])).consolidation.reusableCandidate).toBe(false)
  })
  it('prioritizes repeated friction over habitual reuse', () => {
    const report = reviewCognition(state([run(), run(), run(true, 1), run(true, 1)]))
    expect(report.agency.next).toBe('diagnose')
    expect(report.agency.autonomousDispatch).toBe(false)
    expect(report.plasticity.requiresVerifiedOutcome).toBe(true)
    expect(cognitionGuidance(state([run(true, 1), run(true, 1)]))).toContain('do not repeat')
  })
  it('detects historical cost regression without claiming causality', () => {
    const report = reviewCognition(state([run(), run(), run(true, 0, 200), run(true, 0, 200)]))
    expect(report.agency.next).toBe('compare')
    expect(report.homeostasis.costRegression).toBe(true)
    expect(report.plasticity.causalConclusion).toBe(false)
    expect(JSON.stringify(report)).not.toContain('private')
  })
  it('cannot promote two unverified episodes', () => {
    expect(reviewCognition(state([run(false), run(false)])).agency.next).toBe('verify')
  })
})
