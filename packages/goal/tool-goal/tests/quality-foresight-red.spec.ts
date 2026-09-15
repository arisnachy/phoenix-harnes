import { expect, it, vi } from 'vitest'
import { SessionId } from '@phoenix-ai/dsh-session'
import { runAdversarialCompletionGate } from '../src/completion-gate.ts'

function provider() {
  return {
    name: 'spawn',
    capabilities: { outputSchema: true, toolFilter: true, depthLimit: true, persona: true },
    inheritsParentContext: false,
  }
}

it('returns real-world edge cases, future-risk forecasts, and an innovation disposition', async () => {
  const starts: Array<Record<string, unknown>> = []
  const start = vi.fn(async (_name: string, request: Record<string, unknown>) => {
    starts.push(request)
    if (request.label === 'goal-adversarial-test-design') {
      return {
        result: Promise.resolve({
          output: [],
          stopReason: 'completed' as const,
          structured: {
            cases: [{ name: 'restart-under-load', purpose: 'Prove recovery after an interrupted busy run.' }],
          },
        }),
        dispose: async () => {},
      }
    }
    return {
      result: Promise.resolve({
        output: [],
        stopReason: 'completed' as const,
        structured: {
          checks: {
            requirements: 'pass',
            builder_tests: 'pass',
            adversarial_tests: 'pass',
            startup: 'pass',
            artifact_integrity: 'pass',
            clean_room: 'pass',
          },
          evidence_ledger: [{
            criterion_id: 'REQ-1',
            criterion: 'The service remains usable after restart.',
            mandatory: true,
            status: 'verified',
            evidence: ['simulated:test:restart-under-load'],
          }],
          real_world_scenarios: [{
            id: 'EDGE-1',
            title: 'restart under load',
            severity: 'high',
            status: 'pass',
            evidence_kind: 'simulated',
            evidence: ['simulated:test:restart-under-load'],
            blocker: '',
          }],
          risk_forecasts: [{
            id: 'RISK-1',
            scenario: 'A provider outage can stall queued work after delivery.',
            likelihood: 'medium',
            confidence: 'medium',
            impact: 'high',
            evidence: ['architecture:single-provider-route'],
            mitigation: 'Keep the verified fallback route armed.',
            status: 'mitigated',
          }],
          innovation_opportunity: {
            status: 'not-applicable',
            rationale: 'No extra feature adds enough value without increasing operational risk.',
            evidence: [],
          },
          artifact_fingerprint: 'sha256:artifact',
          clean_room_evidence: 'Verified from a clean extracted package.',
          findings: [],
          procedural_lessons: [],
        },
      }),
      dispose: async () => {},
    }
  })

  const result = await runAdversarialCompletionGate({
    subagents: {
      getProvider: () => provider() as never,
      list: () => ['spawn'],
      start: start as never,
    },
    provider: 'spawn',
    parent: {
      id: SessionId('quality-builder'),
      options: { provider: 'anthropic', model: 'claude-opus', reasoningEffort: 'high' },
    } as never,
    objective: 'Ship a resilient service that keeps working after restart.',
    round: 3,
    signal: new AbortController().signal,
  })

  expect(result.realWorldScenarios).toEqual([
    expect.objectContaining({ id: 'EDGE-1', evidenceKind: 'simulated', status: 'pass' }),
  ])
  expect(result.riskForecasts).toEqual([
    expect.objectContaining({ id: 'RISK-1', impact: 'high', status: 'mitigated' }),
  ])
  expect(result.innovationOpportunity).toEqual(expect.objectContaining({ status: 'not-applicable' }))

  const executionPrompt = JSON.stringify(starts.find(request => request.label === 'goal-adversarial-tester')?.prompt)
  expect(executionPrompt).toMatch(/fail after delivery|future risk|forecast/i)
  expect(executionPrompt).toMatch(/simulated|live evidence/i)
})
