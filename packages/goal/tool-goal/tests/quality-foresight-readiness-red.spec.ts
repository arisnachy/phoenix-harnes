import { describe, expect, test } from 'vitest'
import {
  completionGatePassed,
  type GoalCompletionGateResult,
} from '../src/completion-gate.ts'

function passingGate(overrides: Partial<GoalCompletionGateResult> = {}): GoalCompletionGateResult {
  return {
    checks: {
      requirements: 'pass',
      builderTests: 'pass',
      adversarialTests: 'pass',
      startup: 'pass',
      artifactIntegrity: 'pass',
      cleanRoom: 'pass',
    },
    evidenceLedger: [{
      criterionId: 'REQ-1',
      criterion: 'The requested system works as delivered.',
      mandatory: true,
      status: 'verified',
      evidence: ['test:requested-system'],
    }],
    realWorldScenarios: [{
      id: 'EDGE-1',
      title: 'restart under load',
      severity: 'high',
      status: 'pass',
      evidenceKind: 'simulated',
      evidence: ['simulated:test:restart-under-load'],
    }],
    riskForecasts: [{
      id: 'RISK-1',
      scenario: 'Provider outage can stall queued work.',
      likelihood: 'medium',
      confidence: 'medium',
      impact: 'high',
      evidence: ['architecture:single-provider-route'],
      mitigation: 'Use the verified fallback route.',
      status: 'mitigated',
    }],
    innovationOpportunity: {
      status: 'not-applicable',
      rationale: 'No responsible extra feature adds enough value.',
      evidence: [],
    },
    artifactFingerprint: 'sha256:artifact',
    cleanRoomEvidence: 'Clean extracted package starts and passes verification.',
    findings: [],
    proceduralLessons: [],
    ...overrides,
  }
}

describe('quality foresight completion readiness', () => {
  test('blocks an untested high-severity real-world scenario', () => {
    const gate = passingGate({
      realWorldScenarios: [{
        id: 'EDGE-1',
        title: 'restart under load',
        severity: 'high',
        status: 'untested',
        evidenceKind: 'simulated',
        evidence: [],
        blocker: 'The deployment provider is unavailable.',
      }],
    })

    expect(completionGatePassed(gate)).toBe(false)
  })

  test('blocks an open high-impact future-risk forecast', () => {
    const gate = passingGate({
      riskForecasts: [{
        id: 'RISK-1',
        scenario: 'Provider outage can stall queued work.',
        likelihood: 'high',
        confidence: 'high',
        impact: 'high',
        evidence: ['architecture:single-provider-route'],
        mitigation: '',
        status: 'open',
      }],
    })

    expect(completionGatePassed(gate)).toBe(false)
  })

  test('rejects a live claim that has no authoritative live evidence reference', () => {
    const gate = passingGate({
      realWorldScenarios: [{
        id: 'EDGE-1',
        title: 'deployed health check',
        severity: 'high',
        status: 'pass',
        evidenceKind: 'live',
        evidence: ['simulated:test:health-check'],
      }],
    })

    expect(completionGatePassed(gate)).toBe(false)
  })

  test('requires evidence for an innovation reported as implemented', () => {
    const gate = passingGate({
      innovationOpportunity: {
        status: 'implemented',
        rationale: 'Added proactive recovery because it reduces downtime.',
        evidence: [],
      },
    })

    expect(completionGatePassed(gate)).toBe(false)
  })

  test('preserves legacy completion behavior when no foresight fields exist', () => {
    const legacy = passingGate()
    const { realWorldScenarios: _scenarios, riskForecasts: _forecasts, innovationOpportunity: _innovation, ...oldShape } = legacy
    expect(completionGatePassed(oldShape)).toBe(true)
  })
})
