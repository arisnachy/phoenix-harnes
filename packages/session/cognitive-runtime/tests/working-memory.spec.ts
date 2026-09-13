import { describe, expect, it } from 'vitest'
import { SessionId } from '@phoenix-ai/dsh-session'
import type { CognitiveMemoryEntity, MemoryId } from '@phoenix-ai/dsh-session-learning'
import { createGlobalWorkspace } from '../src/workspace.ts'
import { partitionWorkingMemory } from '../src/working-memory.ts'
import type { AttentionCandidate } from '../src/types.ts'

function candidate(eventSeq: number): AttentionCandidate {
  return {
    record: {
      id: `memory-${String(eventSeq)}` as MemoryId,
      sessionId: 'session-1',
      eventSeq,
      kind: 'event',
      layers: ['episodic'],
      content: `event ${String(eventSeq)}`,
      summary: `event ${String(eventSeq)}`,
      entities: [],
      relations: [],
      provenance: {
        sessionId: 'session-1',
        eventSeq,
        sourceEventType: 'user/message',
        sourceUri: `session:session-1#event:${String(eventSeq)}`,
        occurredAt: eventSeq,
      },
      confidence: 1,
      importance: 1,
      frequency: 1,
      validFrom: eventSeq,
      recordedAt: eventSeq,
      lastObservedAt: eventSeq,
      status: 'active',
    },
    signals: { importance: 1, confidence: 1, recency: 1, urgency: 0, goalRelevance: 0, novelty: 1 },
    score: 1,
    reasons: ['test'],
  }
}

describe('partitionWorkingMemory', () => {
  it('selects one focus, then fills active and background budgets', () => {
    const result = partitionWorkingMemory([candidate(1), candidate(2), candidate(3), candidate(4)], 1, 2)

    expect(result.focus?.record.eventSeq).toBe(1)
    expect(result.active.map(item => item.record.eventSeq)).toEqual([2])
    expect(result.background.map(item => item.record.eventSeq)).toEqual([3, 4])
    expect(result.suppressed).toEqual([])
  })

  it('keeps focus while zero budgets suppress the rest', () => {
    const result = partitionWorkingMemory([candidate(1), candidate(2)], 0, 0)

    expect(result.focus?.record.eventSeq).toBe(1)
    expect(result.active).toEqual([])
    expect(result.background).toEqual([])
    expect(result.suppressed.map(item => item.record.eventSeq)).toEqual([2])
  })

  it('suppresses only candidates outside partially filled budgets', () => {
    const result = partitionWorkingMemory([
      candidate(1),
      candidate(2),
      candidate(3),
      candidate(4),
      candidate(5),
    ], 1, 1)

    expect(result.focus?.record.eventSeq).toBe(1)
    expect(result.active.map(item => item.record.eventSeq)).toEqual([2])
    expect(result.background.map(item => item.record.eventSeq)).toEqual([3])
    expect(result.suppressed.map(item => item.record.eventSeq)).toEqual([4, 5])
  })

  it('handles empty input and rejects negative or fractional budgets', () => {
    expect(partitionWorkingMemory([], 0, 0)).toEqual({ active: [], background: [], suppressed: [] })
    expect(() => partitionWorkingMemory([], -1, 0)).toThrow(/non-negative/)
    expect(() => partitionWorkingMemory([], 1.5, 0)).toThrow(/safe integer/)
  })

  it('returns detached partition candidates', () => {
    const input = [candidate(1), candidate(2)]
    const result = partitionWorkingMemory(input, 1, 0)
    const inputEntities = input[0]!.record.entities as CognitiveMemoryEntity[]
    inputEntities.push({ type: 'concept', value: 'changed', normalized: 'changed' })
    expect(result.focus?.record.entities).toEqual([])
  })
})

describe('createGlobalWorkspace', () => {
  it('creates a detached bounded state with the requested session identity', () => {
    const candidates = [candidate(1), candidate(2), candidate(3)]
    const partition = partitionWorkingMemory(candidates, 1, 1)
    const state = createGlobalWorkspace(SessionId('session-1'), 'phoenix', 3, candidates, partition)

    expect(state).toMatchObject({ sessionId: 'session-1', projectId: 'phoenix', observedSeq: 3, candidateCount: 3 })
    expect(state.focus?.record.eventSeq).toBe(1)
    expect(state.active.map(item => item.record.eventSeq)).toEqual([2])
    expect(state.background.map(item => item.record.eventSeq)).toEqual([3])
    const candidateEntities = candidates[0]!.record.entities as CognitiveMemoryEntity[]
    candidateEntities.push({ type: 'concept', value: 'mutated', normalized: 'mutated' })
    expect(state.focus?.record.entities).toEqual([])
  })

  it('omits optional project and focus fields for an empty workspace', () => {
    const state = createGlobalWorkspace(SessionId('session-1'), undefined, 0, [], {
      active: [],
      background: [],
      suppressed: [],
    })

    expect(state).toEqual({
      sessionId: 'session-1',
      observedSeq: 0,
      candidateCount: 0,
      active: [],
      background: [],
      suppressed: [],
    })
  })
})
