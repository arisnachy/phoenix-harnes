import { SessionId } from '@phoenix-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { runAdversarialCompletionGate } from '../src/completion-gate.ts'

function provider() {
  return {
    name: 'spawn',
    capabilities: { outputSchema: true, toolFilter: true, depthLimit: true, persona: true },
    inheritsParentContext: false,
  }
}

function structuredGate(authorityRef: string) {
  return {
    checks: {
      requirements: 'pass', builder_tests: 'pass', adversarial_tests: 'pass', startup: 'pass',
      artifact_integrity: 'pass', clean_room: 'pass',
    },
    evidence_ledger: [{
      criterion_id: 'REQ-LIVE', criterion: 'The created system is operationally connected.', mandatory: true,
      status: 'verified', evidence: ['living verification'],
    }],
    artifact_fingerprint: 'sha256:living-artifact',
    clean_room_evidence: 'clean artifact verified',
    findings: [], procedural_lessons: [],
    real_world_scenarios: [{
      id: 'LIVE-1', title: 'authoritative runtime state', severity: 'high', status: 'pass',
      evidence_kind: 'live', evidence: ['state read succeeded'], authority_ref: authorityRef,
    }],
    risk_forecasts: [],
    innovation: { status: 'not-applicable', rationale: 'No responsible extra feature adds value.', evidence: [] },
  }
}

async function run(authorityRef: string, living: unknown) {
  const start = vi.fn(async (_name: string, request: Record<string, unknown>) => ({
    result: Promise.resolve({
      output: [], stopReason: 'completed' as const,
      structured: request.label === 'goal-adversarial-test-design'
        ? { cases: [{ name: 'runtime-authority', purpose: 'Verify the claimed live runtime really exists.' }] }
        : structuredGate(authorityRef),
    }),
    dispose: async () => {},
  }))
  return runAdversarialCompletionGate({
    subagents: { getProvider: () => provider() as never, list: () => ['spawn'], start: start as never },
    provider: 'spawn',
    parent: {
      id: SessionId('living-builder'),
      options: { provider: 'anthropic', model: 'claude-opus', reasoningEffort: 'high' },
    } as never,
    objective: 'Ship a living operational system.',
    round: 2,
    signal: new AbortController().signal,
    living,
  } as never)
}

describe('living authority in quality evidence', () => {
  it('rejects a fabricated live authority reference even when the tester labels it pass', async () => {
    const result = await run('living:missing-system', {
      inspect: vi.fn(() => { throw new Error('unknown living creation missing-system') }),
      readState: vi.fn(async () => ({})),
    })

    expect(result.foresightComplete).toBe(false)
    expect(result.realWorldScenarios[0]?.status).not.toBe('pass')
    expect(result.findings.join(' ')).toMatch(/living|authority|missing/i)
  })
})
