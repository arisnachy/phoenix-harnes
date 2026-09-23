import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@phoenix-ai/dsh-session'
import { completionGatePassed, runAdversarialCompletionGate } from '../src/completion-gate.ts'
import { buildVerificationContract } from '../src/verification-contract.ts'
import { judgeGoalCompletion } from '../src/judge.ts'

function provider() {
  return {
    name: 'spawn',
    capabilities: { outputSchema: true, toolFilter: true, depthLimit: true, persona: true },
    inheritsParentContext: false,
  }
}

const passingChecks = {
  requirements: 'pass' as const,
  builderTests: 'pass' as const,
  adversarialTests: 'pass' as const,
  startup: 'pass' as const,
  artifactIntegrity: 'pass' as const,
  cleanRoom: 'pass' as const,
}

const passingLedger = [{
  criterionId: 'REQ-001',
  criterion: 'The shipped CLI handles malformed and alternate input formats.',
  mandatory: true,
  status: 'verified' as const,
  evidence: ['clean-room smoke + adversarial corrupt/alternate input tests'],
}]

const optionalOnlyLedger = [{
  criterionId: 'NICE-001',
  criterion: 'Optional presentation polish.',
  mandatory: false,
  status: 'verified' as const,
  evidence: ['visual review'],
}]

function structuredPass(objective: string) {
  const contract = buildVerificationContract(objective)
  return {
    checks: {
      requirements: 'pass',
      builder_tests: 'pass',
      adversarial_tests: 'pass',
      startup: 'pass',
      artifact_integrity: 'pass',
      clean_room: 'pass',
    },
    evidence_ledger: contract.criteria.map(item => ({
      criterion_id: item.id,
      criterion: item.criterion,
      mandatory: true,
      status: 'verified',
      evidence: ['independent executable evidence'],
    })),
    builder_test_audit: contract.requiresBuilderTestAudit
      ? [{
          test: 'builder-regression-suite',
          expected_source: 'specification',
          circular: false,
          evidence: ['expected values traced to the original requirement'],
        }]
      : [],
    completion_report: { unverified_items: [] as string[], known_limitations: [] as string[] },
    artifact_fingerprint: 'sha256:artifact',
    clean_room_evidence: 'Packaged, extracted into a fresh temporary directory, and verified there.',
    findings: [],
    procedural_lessons: [],
  }
}

async function runWithStructured(objective: string, executeStructured: Record<string, unknown>) {
  const starts: Array<{ name: string; request: Record<string, unknown> }> = []
  const start = vi.fn(async (name: string, request: Record<string, unknown>) => {
    starts.push({ name, request })
    if (request.label === 'goal-adversarial-test-design') {
      return {
        result: Promise.resolve({
          output: [],
          stopReason: 'completed' as const,
          structured: { cases: [{ name: 'fresh-attack', purpose: 'Break a requirement from the locked contract.' }] },
        }),
        dispose: async () => {},
      }
    }
    return {
      result: Promise.resolve({ output: [], stopReason: 'completed' as const, structured: executeStructured }),
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
      id: SessionId('anthropic-builder'),
      options: { provider: 'anthropic', model: 'claude-opus', reasoningEffort: 'high' },
    } as never,
    objective,
    round: 4,
    signal: new AbortController().signal,
  })
  return { result, starts }
}

describe('adversarial completion tester', () => {
  it('locks literal requirements before workspace inspection and verifies edge obligations', async () => {
    const objective = 'Ship a regex CLI using argparse. It must report the exact error position.'
    const { result, starts } = await runWithStructured(objective, structuredPass(objective))

    expect(result.checks).toEqual(passingChecks)
    expect(result.evidenceLedger.map(item => item.criterionId)).toEqual(
      buildVerificationContract(objective).criteria.map(item => item.id),
    )
    expect(starts).toHaveLength(2)

    const designPrompt = JSON.stringify(starts[0]?.request.prompt)
    expect(designPrompt).toContain('Locked verifier-owned criteria')
    expect(designPrompt).toContain('argparse')
    expect(designPrompt).toContain('EDGE-UNICODE')
    expect(designPrompt).toContain('EDGE-ZERO-PROGRESS')
    expect(designPrompt).toContain('EDGE-ORACLE')

    const executePrompt = JSON.stringify(starts[1]?.request.prompt)
    expect(executePrompt).toContain('builder_test_audit')
    expect(executePrompt).toContain('expected-value provenance')
    expect(executePrompt).toContain('completion_report')
    expect(executePrompt).toContain('RISK-LIMITATIONS')
    expect(result.completionReport).toEqual({ unverifiedItems: [], knownLimitations: [] })
  })

  it('preserves known limitations as canonical gate data', async () => {
    const objective = 'Implement a parser for account identifiers.'
    const structured = structuredPass(objective)
    structured.completion_report = {
      unverified_items: [],
      known_limitations: ['Legacy locale-specific aliases remain intentionally unsupported.'],
    }
    const { result } = await runWithStructured(objective, structured)
    expect(result.completionReport?.knownLimitations).toEqual([
      'Legacy locale-specific aliases remain intentionally unsupported.',
    ])
  })

  it('fails report integrity when completion claims are duplicated', async () => {
    const objective = 'Implement a parser for account identifiers.'
    const structured = structuredPass(objective)
    structured.completion_report = {
      unverified_items: [],
      known_limitations: ['One bounded limitation.', 'One bounded limitation.'],
    }
    const { result } = await runWithStructured(objective, structured)
    expect(result.checks.requirements).toBe('fail')
    expect(result.findings.join(' ')).toMatch(/duplicate claims/i)
  })

  it('fails closed when the tester omits a locked literal requirement', async () => {
    const objective = 'Build a CLI using argparse. It must return JSON.'
    const structured = structuredPass(objective)
    const contract = buildVerificationContract(objective)
    const omitted = contract.criteria.find(item => item.source === 'literal') ?? contract.criteria[0]
    if (omitted === undefined) throw new Error('verification contract must contain at least one criterion')
    structured.evidence_ledger = structured.evidence_ledger.filter(item => item.criterion_id !== omitted.id)

    const { result } = await runWithStructured(objective, structured)
    expect(result.checks.requirements).toBe('fail')
    expect(result.evidenceLedger.find(item => item.criterionId === omitted.id)).toMatchObject({
      mandatory: true,
      status: 'failed',
    })
    expect(result.findings.join(' ')).toMatch(/missing from the evidence ledger/i)
  })

  it('rejects circular builder tests even when their suite is green', async () => {
    const objective = 'Build a JSON parser compatible with the standard library.'
    const structured = structuredPass(objective)
    structured.builder_test_audit = [{
      test: 'test_error_position',
      expected_source: 'implementation_observed',
      circular: true,
      evidence: ['expected position copied from candidate output'],
    }]

    const { result } = await runWithStructured(objective, structured)
    expect(result.checks.builderTests).toBe('fail')
    expect(result.findings.join(' ')).toMatch(/circular|provenance/i)
  })

  it('requires at least one verified mandatory criterion before the gate can pass', () => {
    expect(completionGatePassed({
      checks: passingChecks,
      evidenceLedger: passingLedger,
      artifactFingerprint: 'sha256:artifact',
      cleanRoomEvidence: 'verified clean copy',
      findings: [],
      proceduralLessons: [],
    })).toBe(true)

    expect(completionGatePassed({
      checks: passingChecks,
      evidenceLedger: optionalOnlyLedger,
      artifactFingerprint: 'sha256:artifact',
      cleanRoomEvidence: 'verified clean copy',
      findings: [],
      proceduralLessons: [],
    })).toBe(false)
  })

  it('reuses an exact-revision certified PASS when the verifier provider is temporarily unavailable', async () => {
    const objective = 'Ship the verified artifact.'
    const goalId = 'goal-certified'
    const result = await judgeGoalCompletion({
      subagents: undefined,
      provider: 'spawn',
      parent: {
        options: { provider: 'anthropic', model: 'claude-opus' },
        session: {
          events: [
            { type: 'goal/change', data: { operation: 'create', goal: { id: goalId, revision: 1, objective } } },
            {
              type: 'goal/completion-gate',
              data: {
                goalId, revision: 1, round: 2, attemptId: 'gate-pass',
                checks: passingChecks, evidenceLedger: passingLedger,
                artifactFingerprint: 'sha256:same-artifact', cleanRoomEvidence: 'verified clean copy',
                findings: [], proceduralLessons: [],
              },
            },
            {
              type: 'goal/judge',
              data: {
                goalId, revision: 1, round: 2, verdict: 'pass',
                summary: 'Certified independently.', findings: [], requiredChanges: [],
              },
            },
          ],
        },
      } as never,
      objective,
      round: 2,
      signal: new AbortController().signal,
    })

    expect(result).toEqual({
      verdict: 'pass',
      summary: 'Certified independently.',
      findings: [],
      requiredChanges: [],
      verificationIncidents: [],
    })
  })

  it('does not reuse a historical PASS whose gate has no mandatory criterion', async () => {
    const objective = 'Ship the verified artifact.'
    const goalId = 'goal-weak-history'
    const result = await judgeGoalCompletion({
      subagents: undefined,
      provider: 'spawn',
      parent: {
        options: { provider: 'anthropic', model: 'claude-opus' },
        session: {
          events: [
            { type: 'goal/change', data: { operation: 'create', goal: { id: goalId, revision: 1, objective } } },
            {
              type: 'goal/completion-gate',
              data: {
                goalId, revision: 1, round: 2, attemptId: 'gate-weak',
                checks: passingChecks, evidenceLedger: optionalOnlyLedger,
                artifactFingerprint: 'sha256:weak-artifact', cleanRoomEvidence: 'nominal clean copy',
                findings: [], proceduralLessons: [],
              },
            },
            {
              type: 'goal/judge',
              data: {
                goalId, revision: 1, round: 2, verdict: 'pass',
                summary: 'Weak historical pass.', findings: [], requiredChanges: [],
              },
            },
          ],
        },
      } as never,
      objective,
      round: 2,
      signal: new AbortController().signal,
    })

    expect(result.verdict).toBe('blocked')
  })
})
