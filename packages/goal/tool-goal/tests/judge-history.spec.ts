import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import { judgeGoalCompletion, recordGoalJudge } from '../src/judge.ts'

const passingGateDesign = {
  cases: [{ name: 'restart-recovery', purpose: 'Verify the repaired behavior against the original objective.' }],
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
    criterion: 'The original user request remains authoritative across repair rounds.',
    mandatory: true,
    status: 'verified',
    evidence: ['clean-room verification'],
  }],
  artifact_fingerprint: 'sha256:judge-history-artifact',
  clean_room_evidence: 'verified current artifact',
  findings: [],
  procedural_lessons: [],
}

function provider() {
  return { capabilities: { outputSchema: true, toolFilter: true } }
}

describe('goal judge durable review memory', () => {
  it('gives the next judge the original objective plus prior judge findings and required repairs', async () => {
    const session = Session.create(SessionId('judge-history-session'))
    session.append('goal/change', {
      kind: 'goal/change',
      version: 1,
      operation: 'create',
      goal: {
        id: 'goal-history' as never,
        revision: 1,
        objective: 'Make PHOENIX restart safely and recover broken configuration',
        phase: 'active',
        maxGoalRounds: 8,
      },
      roundsStarted: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    recordGoalJudge(session, {
      callId: 'judge-call-1' as never,
      goalId: 'goal-history',
      revision: 1,
      round: 1,
      verdict: 'needs_changes',
      summary: 'Restart still depends on the Host process.',
      findings: ['The Host can die before a relaunch owner survives.'],
      requiredChanges: ['Move restart ownership into the external supervisor.'],
    })

    const start = vi.fn(async (_name: string, request: Record<string, unknown>) => ({
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
    }))

    await judgeGoalCompletion({
      subagents: { getProvider: () => provider() as never, start: start as never },
      provider: 'spawn',
      parent: {
        id: SessionId('judge-history-parent'),
        session,
        options: {},
      } as never,
      objective: 'Make PHOENIX restart safely and recover broken configuration',
      round: 2,
      signal: new AbortController().signal,
    })

    const judgeCall = start.mock.calls.find(([, request]) => (request as Record<string, unknown>).label === 'goal-completion-judge')
    expect(judgeCall).toBeDefined()
    const request = judgeCall?.[1] as { prompt: Array<{ type: string; text?: string }> }
    const prompt = request.prompt.map(block => block.text ?? '').join('\n')
    expect(prompt).toContain('Make PHOENIX restart safely and recover broken configuration')
    expect(prompt).toContain('Restart still depends on the Host process.')
    expect(prompt).toContain('The Host can die before a relaunch owner survives.')
    expect(prompt).toContain('Move restart ownership into the external supervisor.')
    expect(prompt).toContain('round 1')
  })
})
