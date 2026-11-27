import { describe, expect, it } from 'vitest'
import { compareMetaScenarios, createMetaScenarioTool } from '../src/meta-scenarios.ts'
const scenario = (id: string, status: 'pass' | 'fail' | 'unknown', basis: 'observed' | 'hypothesis' | 'unknown') => ({
  id, intervention: id, assumptions: ['same workload'], falsifier: 'run independent test',
  outcomes: [{ id: 'quality', status, basis, sources: basis === 'observed' ? ['test:1'] : [] }],
})
const input = { invariants: ['same requirements'], criteria: [{ id: 'quality', mandatory: true }],
  baseline: scenario('baseline', 'pass', 'observed'), alternatives: [scenario('alternative', 'pass', 'hypothesis')] }
describe('META counterfactual scenario audit', () => {
  it('does not promote hypothetical benefit to verified success', () => {
    const result = compareMetaScenarios(input)
    expect(result).toMatchObject({ causalConclusion: false, evidenceIndependentlyVerified: false,
      candidates: [{ status: 'insufficient-evidence', unresolvedCriteria: ['quality'] }] })
    expect(result.candidates[0]?.flags).toContain('asymmetric-declared-observation-coverage')
  })
  it('flags shared source dependence and retains mandatory failures', () => {
    const result = compareMetaScenarios({ ...input, alternatives: [scenario('alternative', 'fail', 'observed')] })
    expect(result.candidates[0]).toMatchObject({ status: 'declared-constraint-failure', declaredFailedCriteria: ['quality'] })
    expect(result.candidates[0]?.flags).toContain('shared-source-dependence')
  })
  it('rejects missing or duplicated criteria and unsourced observations', () => {
    expect(() => compareMetaScenarios({ ...input, alternatives: [{ ...scenario('alternative', 'pass', 'observed'), outcomes: [] }] })).toThrow()
    expect(() => compareMetaScenarios({ ...input, alternatives: [{ ...scenario('alternative', 'pass', 'observed'), outcomes: [{ id: 'quality', status: 'pass', basis: 'observed', sources: [] }] }] })).toThrow(/SOURCE/u)
    expect(() => compareMetaScenarios({ ...input, alternatives: [input.baseline] })).toThrow()
    expect(createMetaScenarioTool().name).toBe('phoenix_meta_compare')
  })
})
