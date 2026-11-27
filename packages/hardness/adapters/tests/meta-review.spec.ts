import { describe, expect, it } from 'vitest'
import { combineMetaVerdicts, metaRouteEligible, uniqueMetaCriteria, validMetaVerdict } from '../src/meta-review.ts'
const now = Date.UTC(2026, 10, 26, 14)
const primary = { provider: 'codex', model: 'luna' }
const alternative = { provider: 'gemini', model: 'reviewer' }
const ai = { stale: false, observedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 1000).toISOString(),
  registeredProviders: [{ id: 'gemini' }], quotaBudget: [{ provider: 'gemini', windows: [{ status: 'observed', remainingPercent: 45 }] }] }
describe('META reviewer supervision', () => {
  it('rejects self-contradictory passes and duplicate criteria', () => {
    expect(validMetaVerdict({ verdict: 'pass', evidence: ['test'], requiredChanges: ['fix'] })).toBe(false)
    expect(validMetaVerdict({ verdict: 'pass', evidence: ['test'], requiredChanges: [], failedCriterion: true })).toBe(false)
    expect(validMetaVerdict({ verdict: 'pass', evidence: ['test'], requiredChanges: [], qualityFailed: true })).toBe(false)
    expect(validMetaVerdict({ verdict: 'pass', evidence: ['test'], requiredChanges: [] })).toBe(true)
    expect(uniqueMetaCriteria([{ id: 'x' }, { id: 'x' }])).toBe(false)
  })
  it('never lets reviewer agreement or a pass outvote a concrete defect', () => {
    expect(combineMetaVerdicts('pass', 'needs_changes')).toBe('needs_changes')
    expect(combineMetaVerdicts('needs_changes', 'pass')).toBe('needs_changes')
    expect(combineMetaVerdicts('pass', 'blocked')).toBe('blocked')
    expect(combineMetaVerdicts('pass', 'pass')).toBe('pass')
  })
  it('requires configured distinct route, fresh quota, registration and unambiguous account', () => {
    expect(metaRouteEligible(alternative, primary, ai, now)).toBe(true)
    expect(metaRouteEligible(primary, primary, ai, now)).toBe(false)
    expect(metaRouteEligible(alternative, undefined, ai, now)).toBe(false)
    expect(metaRouteEligible(alternative, primary, { ...ai, stale: true }, now)).toBe(false)
    expect(metaRouteEligible(alternative, primary, ai, now + 2000)).toBe(false)
    expect(metaRouteEligible(alternative, primary, { ...ai, quotaBudget: [] }, now)).toBe(false)
    expect(metaRouteEligible(alternative, primary, { ...ai, quotaBudget: [...ai.quotaBudget, ...ai.quotaBudget] }, now)).toBe(false)
    expect(metaRouteEligible(alternative, primary, { ...ai, quotaBudget: [{ provider: 'gemini', windows: [{ status: 'observed', remainingPercent: 5 }] }] }, now)).toBe(false)
  })
})
