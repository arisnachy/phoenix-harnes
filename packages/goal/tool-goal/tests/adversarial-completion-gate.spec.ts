import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@phoenix-ai/dsh-session'
import { runAdversarialCompletionGate } from '../src/completion-gate.ts'
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

describe('adversarial completion tester', () => {
  it('designs fresh attacks from only the original requirement, then executes them with the parent model in a clean-room gate', async () => {
    const starts: Array<{ name: string; request: Record<string, unknown> }> = []
    const start = vi.fn(async (name: string, request: Record<string, unknown>) => {
      starts.push({ name, request })
      const label = request.label
      if (label === 'goal-adversarial-test-design') {
        return {
          result: Promise.resolve({
            output: [],
            stopReason: 'completed' as const,
            structured: {
              cases: [
                { name: 'corrupt-config', purpose: 'Reject corrupt configuration instead of silently succeeding.' },
                { name: 'alternate-format', purpose: 'Accept the supported alternate input representation.' },
              ],
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
              criterion_id: 'REQ-001',
              criterion: 'The shipped CLI handles malformed and alternate input formats.',
              mandatory: true,
              status: 'verified',
              evidence: ['clean-room smoke + adversarial corrupt/alternate input tests'],
            }],
            artifact_fingerprint: 'sha256:artifact',
            clean_room_evidence: 'Packaged, extracted into a fresh temporary directory, and verified there.',
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
        id: SessionId('anthropic-builder'),
        options: { provider: 'anthropic', model: 'claude-opus', reasoningEffort: 'high' },
      } as never,
      objective: 'Ship a reliable CLI artifact that handles malformed and alternate input formats.',
      round: 4,
      signal: new AbortController().signal,
    })

    expect(result.checks).toEqual(passingChecks)
    expect(result.evidenceLedger).toEqual(passingLedger)
    expect(result.artifactFingerprint).toBe('sha256:artifact')
    expect(starts).toHaveLength(2)

    const design = starts[0]?.request
    expect(design).toMatchObject({
      label: 'goal-adversarial-test-design',
      agentOptions: { provider: 'anthropic', model: 'claude-opus', reasoningEffort: 'high' },
      toolFilter: { allow: [] },
    })
    expect(JSON.stringify(design?.prompt)).toContain('Ship a reliable CLI artifact')
    expect(JSON.stringify(design?.prompt)).not.toMatch(/builder test|existing test|workspace test/i)

    const execute = starts[1]?.request
    expect(execute).toMatchObject({
      label: 'goal-adversarial-tester',
      agentOptions: { provider: 'anthropic', model: 'claude-opus', reasoningEffort: 'high' },
    })
    expect(JSON.stringify(execute?.prompt)).toContain('corrupt-config')
    expect(JSON.stringify(execute?.prompt)).toContain('evidence_ledger')
    expect(JSON.stringify(execute?.prompt)).toMatch(/temporary|clean.room|extract/i)
    expect(execute?.toolFilter).toEqual(expect.objectContaining({
      allow: expect.arrayContaining(['bash', 'read', 'glob', 'grep']),
    }))
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
                attemptId: 'gate-pass',
                checks: passingChecks,
                evidenceLedger: passingLedger,
                artifactFingerprint: 'sha256:same-artifact',
                cleanRoomEvidence: 'verified clean copy',
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
                summary: 'Certified independently.',
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

    expect(result).toEqual({
      verdict: 'pass',
      summary: 'Certified independently.',
      findings: [],
      requiredChanges: [],
    })
  })
})