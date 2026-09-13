import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import { judgeGoalCompletion, recordGoalJudge } from '../src/judge.ts'

function provider() {
  return { capabilities: { outputSchema: true, toolFilter: true } }
}

const passingGateDesign = {
  cases: [{ name: 'malformed-input', purpose: 'Reject malformed input without silent success.' }],
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
    criterion: 'Keep the harness recoverable while satisfying the original request.',
    mandatory: true,
    status: 'verified',
    evidence: ['clean-room verification'],
  }],
  artifact_fingerprint: 'sha256:judge-history-artifact',
  clean_room_evidence: 'verified extracted artifact in a clean temporary directory',
  findings: [],
  procedural_lessons: [],
}

describe('goal judge durable review memory', () => {
  it('carries the user objective plus prior findings and required corrections into the next judge round', async () => {
    const session = Session.create(SessionId('judge-history-session'))
    recordGoalJudge(session, {
      callId: 'judge-history-1' as never,
      goalId: 'goal-history',
      revision: 1,
      round: 1,
      verdict: 'needs_changes',
      summary: 'The restart path can still strand the harness.',
      findings: ['The child process can exit without an external relaunch owner.'],
      requiredChanges: ['Keep the supervisor alive and prove automatic relaunch.'],
    })

    const start = vi.fn(async (_name: string, request: Record<string, unknown>) => {
      const label = request.label
      if (label === 'goal-adversarial-test-design') {
        return { result: Promise.resolve({ output: [], stopReason: 'completed' as const, structured: passingGateDesign }), dispose: async () => {} }
      }
      if (label === 'goal-adversarial-tester') {
        return { result: Promise.resolve({ output: [], stopReason: 'completed' as const, structured: passingGateExecution }), dispose: async () => {} }
      }
      const prompt = request.prompt as Array<{ type: string, text?: string }>
      const text = prompt.map(block => block.text ?? '').join('\n')
      expect(text).toContain('Original objective: "Make restart and configuration changes self-recovering"')
      expect(text).toContain('Durable mission review history')
      expect(text).toContain('The restart path can still strand the harness.')
      expect(text).toContain('The child process can exit without an external relaunch owner.')
      expect(text).toContain('Keep the supervisor alive and prove automatic relaunch.')
      return {
        result: Promise.resolve({
          output: [],
          stopReason: 'completed' as const,
          structured: { verdict: 'pass', summary: 'verified', findings: [], required_changes: [] },
        }),
        dispose: async () => {},
      }
    })

    const result = await judgeGoalCompletion({
      subagents: { getProvider: () => provider() as never, start: start as never },
      provider: 'spawn',
      parent: { id: SessionId('judge-history-parent'), session, options: {} } as never,
      objective: 'Make restart and configuration changes self-recovering',
      round: 2,
      signal: new AbortController().signal,
    })

    expect(result.verdict).toBe('pass')
  })
})
