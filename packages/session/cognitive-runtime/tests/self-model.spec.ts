import { describe, expect, it } from 'vitest'
import { SessionId } from '@phoenix-ai/dsh-session'
import type { AttentionCandidate, CognitiveState } from '../src/types.ts'
import { deriveOperationalSelfModel } from '../src/self-model.ts'

function candidate(sessionId: string, kind: string, summary: string, subject: string | undefined, seq: number): AttentionCandidate {
  return {
    record: {
      id: 'id-' + String(seq),
      sessionId,
      eventSeq: seq,
      kind,
      layers: kind === 'pending' ? ['prospective'] : ['episodic'],
      summary,
      ...subject === undefined ? {} : { subject },
      status: 'active',
      confidence: 0.8,
      provenance: { sessionId, eventSeq: seq, sourceUri: 'session:' + sessionId + '#event:' + String(seq) },
    },
    score: 0.9,
    reasons: [],
    signals: {},
  } as unknown as AttentionCandidate
}

function state(): CognitiveState {
  const sessionId = SessionId('self-model-session')
  return {
    sessionId,
    observedSeq: 5,
    candidateCount: 6,
    focus: candidate(sessionId, 'mission', 'Complete the clinical report', 'mission.report', 1),
    active: [
      candidate(sessionId, 'fact', 'Kira coordinates Phoenix', 'assistant.identity.role', 2),
      candidate(sessionId, 'pending', 'Check the report results', 'pending.report', 3),
      candidate(sessionId, 'error', 'Previous retry timed out', 'error.retry', 4),
      candidate('another-session', 'fact', 'Other user private fact', 'assistant.identity.private', 5),
    ],
    background: [],
    suppressed: [candidate(sessionId, 'lesson', 'Suppressed memory', 'lesson.suppressed', 6)],
  }
}

describe('operational self model', () => {
  it('produces session-scoped identity, commitments and error evidence without inventing sentience', () => {
    const result = deriveOperationalSelfModel(state())
    expect(result.sessionId).toBe('self-model-session')
    expect(result.identity.map(item => item.summary)).toEqual(['Kira coordinates Phoenix'])
    expect(result.goals.map(item => item.summary)).toEqual(['Complete the clinical report'])
    expect(result.pending.map(item => item.summary)).toEqual(['Check the report results'])
    expect(result.errors.map(item => item.summary)).toEqual(['Previous retry timed out'])
    expect(result.learning).toEqual([])
    expect(result.suppressedCount).toBe(1)
    expect(result.subjectiveExperience).toBe('undetermined')
    expect(JSON.stringify(result)).not.toContain('Other user private fact')
    expect(JSON.stringify(result)).not.toContain('Suppressed memory')
  })

  it('returns no fabricated facts for an empty cognitive state', () => {
    const empty: CognitiveState = {
      sessionId: SessionId('empty'),
      observedSeq: -1,
      candidateCount: 0,
      active: [],
      background: [],
      suppressed: [],
    }
    const result = deriveOperationalSelfModel(empty)
    expect(result.focus).toBeUndefined()
    expect(result.identity).toEqual([])
    expect(result.pending).toEqual([])
    expect(result.epistemicStatus).toBe('operational-model-only')
  })

  it('preserves optional project provenance and tolerates records without subjects', () => {
    const current = state()
    const unclassified = candidate(String(current.sessionId), 'fact', 'No subject record', undefined, 7)
    const result = deriveOperationalSelfModel({
      ...current,
      projectId: 'phoenix',
      background: [unclassified],
    })
    expect(result.projectId).toBe('phoenix')
    expect(result.identity.map(item => item.summary)).toEqual(['Kira coordinates Phoenix'])
    expect(result.focus?.category).toBe('focus')
  })

  it('bounds evidence and rejects invalid limits', () => {
    const subject = state()
    expect(deriveOperationalSelfModel(subject, 1).identity).toHaveLength(1)
    expect(() => deriveOperationalSelfModel(subject, 0)).toThrow(/maxPerCategory/)
    expect(() => deriveOperationalSelfModel(subject, 17)).toThrow(/maxPerCategory/)
  })
})
