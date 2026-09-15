import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@phoenix-ai/dsh-session'
import { runAdversarialCompletionGate } from '../src/completion-gate.ts'

function provider() {
  return {
    name: 'spawn',
    capabilities: { outputSchema: true, toolFilter: true, depthLimit: true, persona: true },
    inheritsParentContext: false,
  }
}

function runtime(execution: Record<string, unknown>) {
  const start = vi.fn(async (_name: string, request: Record<string, unknown>) => ({
    result: Promise.resolve({
      output: [],
      stopReason: 'completed' as const,
      structured: request.label === 'goal-adversarial-test-design'
        ? { cases: [{ name: 'restart', purpose: 'Break recovery after restart.' }] }
        : execution,
    }),
    dispose: async () => {},
  }))
  return { getProvider: () => provider() as never, list: () => ['spawn'], start: start as never }
}

function baseExecution() {
  return {
    checks: {
      requirements: 'pass', builder_tests: 'pass', adversarial_tests: 'pass', startup: 'pass',
      artifact_integrity: 'pass', clean_room: 'pass',
    },
    evidence_ledger: [{
      criterion_id: 'REQ-1', criterion: 'Service starts and recovers.', mandatory: true,
      status: 'verified', evidence: ['test:start', 'test:recovery'],
    }],
    artifact_fingerprint: 'sha256:quality',
    clean_room_evidence: 'fresh extracted copy passed',
    findings: [],
    procedural_lessons: [],
    real_world_scenarios: [{
      id: 'EDGE-1', title: 'restart', severity: 'high', status: 'pass',
      evidence_kind: 'simulated', evidence: ['test:restart'],
    }],
    risk_forecasts: [{
      id: 'RISK-1', scenario: 'queue saturation', likelihood: 'medium', confidence: 'medium', impact: 'high',
      evidence: ['metric:throughput'], mitigation: 'bound queue depth', status: 'mitigated',
    }],
    innovation: { status: 'not-applicable', rationale: 'No responsible extra feature adds value.', evidence: [] },
  }
}

async function run(execution: Record<string, unknown>) {
  return runAdversarialCompletionGate({
    subagents: runtime(execution),
    provider: 'spawn',
    parent: {
      id: SessionId('quality-builder'),
      options: { provider: 'anthropic', model: 'claude-opus', reasoningEffort: 'high' },
    } as never,
    objective: 'Ship a resilient service.',
    round: 3,
    signal: new AbortController().signal,
  })
}

describe('quality foresight completion evidence', () => {
  it('returns structured real-world challenge, forecast, and innovation evidence', async () => {
    const result = await run(baseExecution())
    expect(result.foresightComplete).toBe(true)
    expect(result.realWorldScenarios).toEqual([expect.objectContaining({ id: 'EDGE-1', evidenceKind: 'simulated' })])
    expect(result.riskForecasts).toEqual([expect.objectContaining({ id: 'RISK-1', status: 'mitigated' })])
    expect(result.innovationOpportunity).toMatchObject({ status: 'not-applicable' })
  })

  it('refuses to certify claimed live evidence without an authoritative runtime reference', async () => {
    const execution = baseExecution()
    execution.real_world_scenarios = [{
      id: 'EDGE-LIVE', title: 'live restart', severity: 'critical', status: 'pass',
      evidence_kind: 'live', evidence: ['observed restart'],
    }]
    const result = await run(execution)
    expect(result.foresightComplete).toBe(false)
    expect(result.findings.join(' ')).toMatch(/live.*authority|authority.*live/i)
  })

  it('preserves a high-impact open forecast as an unresolved future risk', async () => {
    const execution = baseExecution()
    execution.risk_forecasts = [{
      id: 'RISK-OPEN', scenario: 'provider exhaustion', likelihood: 'high', confidence: 'high', impact: 'critical',
      evidence: ['usage:measured'], mitigation: '', status: 'open',
    }]
    const result = await run(execution)
    expect(result.foresightComplete).toBe(true)
    expect(result.riskForecasts[0]).toMatchObject({ id: 'RISK-OPEN', impact: 'critical', status: 'open' })
  })
})
