import { describe, expect, test } from 'vitest'
import { qualityReadiness, type QualityAssessmentSnapshot } from '../src/index.ts'

const base = (): QualityAssessmentSnapshot => ({
  id: 'qa-1' as never,
  revision: 1,
  objective: 'Ship a resilient service',
  taskClass: 'substantial',
  criteria: [{
    id: 'REQ-1',
    text: 'Service starts',
    tier: 'requested',
    mandatory: true,
    status: 'verified',
    evidence: ['test:start'],
  }],
  scenarios: [{
    id: 'EDGE-1',
    title: 'restart',
    severity: 'high',
    status: 'pass',
    evidenceKind: 'simulated',
    evidence: ['test:restart'],
  }],
  forecasts: [],
  requiredChanges: [],
  innovation: { status: 'not-applicable', rationale: 'No responsible extra feature adds value.' },
  createdAt: 1,
  updatedAt: 1,
})

describe('qualityReadiness', () => {
  test('accepts substantial work only when mandatory criteria and material scenarios are resolved', () => {
    expect(qualityReadiness(base())).toEqual({ ready: true, blockers: [] })
  })

  test('rejects an unresolved high-severity scenario', () => {
    const snapshot = base()
    snapshot.scenarios[0] = { ...snapshot.scenarios[0], status: 'untested', blocker: 'provider offline' }
    expect(qualityReadiness(snapshot).ready).toBe(false)
  })

  test('rejects a high-impact forecast that has no mitigation or explicit acceptance', () => {
    const snapshot = base()
    snapshot.forecasts = [{
      id: 'RISK-1',
      scenario: 'queue saturation',
      likelihood: 'high',
      confidence: 'medium',
      impact: 'high',
      evidence: ['metric:throughput'],
      mitigation: '',
      status: 'open',
    }]
    expect(qualityReadiness(snapshot).ready).toBe(false)
  })

  test('never treats an innovation as compensation for an unmet requested criterion', () => {
    const snapshot = base()
    snapshot.criteria[0] = { ...snapshot.criteria[0], status: 'failed' }
    snapshot.innovation = { status: 'implemented', rationale: 'Added dashboard', evidence: ['test:dashboard'] }
    expect(qualityReadiness(snapshot).ready).toBe(false)
  })
})
