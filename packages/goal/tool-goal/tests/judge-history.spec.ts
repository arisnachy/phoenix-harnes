import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import { judgeGoalCompletion, recordGoalJudge } from '../src/judge.ts'

const passingGateDesign = {
  cases: [{ name: 'restart-regression', purpose: 'Verify the repaired runtime restart path.' }],
}

const passingGateExecution = {
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
    criterion: 'Keep Phoenix recoverable across restart and configuration changes.',
    mandatory: true,
    status: 'verified',
    evidence: ['restart regression'],
  }],
  artifact_fingerprint: 'sha256:judge-history-test',
  clean_room_evidence: 'verified in isolated test state',
  findings: [],
  procedural_lessons: [],
}

describe('goal judge durable review memory', () => {
  it('carries the original request and prior judge corrections into a later review round', async () => {
    const session = Session.create(SessionId('judge-history-session'))
    session.append('goal/change', {
      operation: 'create',
      goal: {
        id: 'goal-history',
        revision: 1,
        objective: 'Make restart safe and preserve the full review history.',
      },
    } as never)
    recordGoalJudge(session, {
      callId: 'judge-history-1' as never,
      goalId: 'goal-history',
      revision: 1,
      round: 1,
      verdict: 'needs_changes',
      summary: 'The first implementation can still lose the supervisor.',
      findings: ['The child Host owns too much of the restart lifecycle.'],
      requiredChanges: ['Move restart ownership to the persistent supervisor.'],
    })

    let judgePrompt = ''
    const start = vi.fn(async (_provider: string, request: Record<string, unknown>) => {
      if (request.label === 'goal-completion-judge') {
        const prompt = request.prompt as { type: string; text?: string }[]
        judgePrompt = prompt[0]?.text ?? ''
      }
      return {
        result: Promise.resolve({
          output: [],
          stopReason: 'completed' as const,
          structured: request.label === 'goal-adversarial-test-design'
            ? passingGateDesign
            : request.label === 'goal-adversarial-tester'
              ? passingGateExecution
              : { verdict: 'pass', summary: 'verified', findings: [], required_changes: [] },
        }),
        dispose: async () => {},
      }
    })

    await judgeGoalCompletion({
      subagents: {
        getProvider: () => ({ capabilities: { outputSchema: true, toolFilter: true } }) as never,
        start: start as never,
      },
      provider: 'spawn',
      parent: {
        id: SessionId('judge-history-parent'),
        session,
        options: {},
      } as never,
      objective: 'Make restart safe and preserve the full review history.',
      round: 2,
      signal: new AbortController().signal,
    })

    expect(judgePrompt).toContain('Original objective: "Make restart safe and preserve the full review history."')
    expect(judgePrompt).toContain('Previous independent judge history')
    expect(judgePrompt).toContain('The child Host owns too much of the restart lifecycle.')
    expect(judgePrompt).toContain('Move restart ownership to the persistent supervisor.')
    expect(judgePrompt).toContain('Do not forget or silently drop unresolved findings from earlier review rounds')
  })
})
