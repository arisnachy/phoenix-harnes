import { describe, expect, it } from 'vitest'
import { completionGatePassed, type GoalCompletionGateResult } from '../src/completion-gate.ts'
import { judgeGoalCompletion } from '../src/judge.ts'

const passingChecks = {
  requirements: 'pass' as const,
  builderTests: 'pass' as const,
  adversarialTests: 'pass' as const,
  startup: 'pass' as const,
  artifactIntegrity: 'pass' as const,
  cleanRoom: 'pass' as const,
}

function gate(mandatory: boolean): GoalCompletionGateResult {
  return {
    checks: passingChecks,
    evidenceLedger: [{
      criterionId: 'REQ-001',
      criterion: 'The delivered artifact satisfies the original mission.',
      mandatory,
      status: 'verified',
      evidence: ['clean-room verification'],
    }],
    artifactFingerprint: 'sha256:artifact',
    cleanRoomEvidence: 'verified from a fresh extracted copy',
    findings: [],
    proceduralLessons: [],
  }
}

describe('mandatory completion evidence', () => {
  it('accepts a gate only when at least one mandatory criterion is independently verified', () => {
    expect(completionGatePassed(gate(true))).toBe(true)
    expect(completionGatePassed(gate(false))).toBe(false)
  })

  it('does not reuse a historical judge PASS whose gate contains only optional criteria', async () => {
    const objective = 'Ship a verified artifact.'
    const goalId = 'goal-optional-only'
    const optionalOnly = gate(false)

    const result = await judgeGoalCompletion({
      subagents: undefined,
      provider: 'spawn',
      parent: {
        options: { provider: 'anthropic', model: 'claude-opus' },
        session: {
          events: [
            {
              type: 'goal/change',
              data: {
                operation: 'create',
                goal: { id: goalId, revision: 1, objective },
              },
            },
            {
              type: 'goal/completion-gate',
              data: {
                goalId,
                revision: 1,
                round: 2,
                attemptId: 'optional-only',
                checks: optionalOnly.checks,
                evidenceLedger: optionalOnly.evidenceLedger,
                artifactFingerprint: optionalOnly.artifactFingerprint,
                cleanRoomEvidence: optionalOnly.cleanRoomEvidence,
                findings: [],
                proceduralLessons: [],
              },
            },
            {
              type: 'goal/judge',
              data: {
                goalId,
                revision: 1,
                round: 2,
                verdict: 'pass',
                summary: 'Weak historical pass.',
                findings: [],
                requiredChanges: [],
              },
            },
          ],
        },
      } as never,
      objective,
      round: 2,
      signal: new AbortController().signal,
    })

    expect(result.verdict).not.toBe('pass')
  })
})
