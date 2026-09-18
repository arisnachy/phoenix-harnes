import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import type { QualityAssessmentSnapshot, QualityMutation } from '@phoenix-ai/dsh-quality'
import { judgeGoalCompletion } from '../src/judge.ts'

function provider() {
  return { capabilities: { outputSchema: true, toolFilter: true }, inheritsParentContext: false }
}

const design = { cases: [{ name: 'load', purpose: 'Challenge behavior under realistic load.' }] }
const gate = {
  checks: {
    requirements: 'pass', builder_tests: 'pass', adversarial_tests: 'pass', startup: 'pass',
    artifact_integrity: 'pass', clean_room: 'pass',
  },
  evidence_ledger: [{
    criterion_id: 'REQ-1', criterion: 'Ship a resilient service.', mandatory: true,
    status: 'verified', evidence: ['test:acceptance'],
  }],
  artifact_fingerprint: 'sha256:quality-judge',
  clean_room_evidence: 'clean package passed', findings: [], procedural_lessons: [],
  real_world_scenarios: [{
    id: 'EDGE-1', title: 'restart under load', severity: 'high', status: 'pass',
    evidence_kind: 'simulated', evidence: ['test:restart-load'],
  }],
  risk_forecasts: [{
    id: 'RISK-OPEN', scenario: 'provider quota exhaustion', likelihood: 'high', confidence: 'high', impact: 'critical',
    evidence: ['usage:measured'], mitigation: '', status: 'open',
  }],
  innovation: { status: 'not-applicable', rationale: 'No safe extra feature adds value.', evidence: [] },
}

function qualityStub() {
  let state: QualityAssessmentSnapshot | undefined
  return {
    get: vi.fn(() => state),
    start: vi.fn((_agent, request: { objective: string; taskClass: 'substantial' }) => {
      state = {
        id: 'qa-judge' as never, revision: 1, objective: request.objective, taskClass: request.taskClass,
        criteria: [], scenarios: [], forecasts: [], requiredChanges: [], createdAt: 1, updatedAt: 1,
      }
      return state
    }),
    record: vi.fn((_agent, ref: { id: string; revision: number }, mutation: QualityMutation) => {
      if (state === undefined || state.id !== ref.id || state.revision !== ref.revision) throw new Error('stale test quality ref')
      const next = { ...state, revision: state.revision + 1, updatedAt: state.updatedAt + 1 }
      if (mutation.kind === 'criterion') next.criteria = [...state.criteria.filter(item => item.id !== mutation.value.id), mutation.value]
      if (mutation.kind === 'scenario') next.scenarios = [...state.scenarios.filter(item => item.id !== mutation.value.id), mutation.value]
      if (mutation.kind === 'forecast') next.forecasts = [...state.forecasts.filter(item => item.id !== mutation.value.id), mutation.value]
      if (mutation.kind === 'innovation') next.innovation = mutation.value
      if (mutation.kind === 'required-changes') next.requiredChanges = mutation.value
      state = next
      return state
    }),
  }
}

describe('goal judge quality readiness', () => {
  it('refuses semantic PASS while a material forecast remains open', async () => {
    const quality = qualityStub()
    const start = vi.fn(async (_name: string, request: Record<string, unknown>) => ({
      result: Promise.resolve({
        output: [], stopReason: 'completed' as const,
        structured: request.label === 'goal-adversarial-test-design'
          ? design
          : request.label === 'goal-adversarial-tester'
            ? gate
            : { verdict: 'pass', summary: 'Semantically complete.', findings: [], required_changes: [] },
      }),
      dispose: async () => {},
    }))
    const result = await judgeGoalCompletion({
      subagents: { getProvider: () => provider() as never, list: () => ['spawn'], start: start as never },
      provider: 'spawn',
      parent: {
        id: SessionId('quality-judge-parent'),
        session: Session.create(SessionId('quality-judge-session')),
        options: { provider: 'anthropic', model: 'claude-opus' },
      } as never,
      objective: 'Ship a resilient service.', round: 2, signal: new AbortController().signal,
      quality: quality as never,
    })

    expect(result.verdict).toBe('needs_changes')
    expect(result.requiredChanges.join(' ')).toMatch(/RISK-OPEN|forecast/i)
    expect(quality.start).toHaveBeenCalledTimes(1)
    expect(quality.record).toHaveBeenCalled()
  })
})
