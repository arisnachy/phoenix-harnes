import { describe, expect, it } from 'vitest'
import { SessionId } from '@phoenix-ai/dsh-session'
import type { CognitiveMemoryRecord } from '@phoenix-ai/dsh-session-learning'
import { renderCognitiveModelContext } from '../src/model-context.ts'
import type { AttentionCandidate, CognitiveState } from '../src/types.ts'

function candidate(
  summary: string,
  options: {
    kind?: CognitiveMemoryRecord['kind']
    layers?: CognitiveMemoryRecord['layers']
    score?: number
    eventSeq?: number
  } = {},
): AttentionCandidate {
  const eventSeq = options.eventSeq ?? 1
  const occurredAt = 1_700_000_000_000 + eventSeq
  const record: CognitiveMemoryRecord = {
    id: `memory:${String(eventSeq)}` as CognitiveMemoryRecord['id'],
    sessionId: 'projection-session',
    eventSeq,
    kind: options.kind ?? 'conversation',
    layers: options.layers ?? ['working', 'episodic'],
    content: summary,
    summary,
    entities: [],
    relations: [],
    provenance: {
      sessionId: 'projection-session',
      eventSeq,
      sourceEventType: 'user/message',
      sourceUri: `session://projection-session/event/${String(eventSeq)}`,
      occurredAt,
    },
    confidence: 0.9,
    importance: 0.8,
    frequency: 1,
    validFrom: occurredAt,
    recordedAt: occurredAt,
    lastObservedAt: occurredAt,
    status: 'active',
  }
  return {
    record,
    signals: {
      importance: 0.8,
      confidence: 0.9,
      recency: 1,
      urgency: record.kind === 'pending' ? 1 : 0,
      goalRelevance: record.layers.includes('prospective') ? 1 : 0,
      novelty: 1,
    },
    score: options.score ?? 0.9,
    reasons: ['recency', 'importance'],
  }
}

function state(overrides: Partial<CognitiveState> = {}): CognitiveState {
  return {
    sessionId: SessionId('projection-session'),
    observedSeq: 9,
    candidateCount: 0,
    active: [],
    background: [],
    suppressed: [],
    ...overrides,
  }
}

describe('renderCognitiveModelContext', () => {
  it('returns no model-facing context when the workspace has no cognitive candidates', () => {
    expect(renderCognitiveModelContext(state())).toBe('')
  })

  it('projects focus, active work, prospective commitments, and completion discipline', () => {
    const focus = candidate('user/message: finish the Phoenix main and stable promotion', {
      kind: 'pending',
      layers: ['working', 'episodic', 'prospective'],
      eventSeq: 9,
    })
    const active = candidate('tool/result: typecheck succeeded', { kind: 'success', eventSeq: 8 })
    const rendered = renderCognitiveModelContext(state({
      focus,
      active: [active],
      candidateCount: 2,
    }))

    expect(rendered).toContain('PHOENIX cognitive workspace')
    expect(rendered).toContain('finish the Phoenix main and stable promotion')
    expect(rendered).toContain('typecheck succeeded')
    expect(rendered).toContain('Unresolved prospective work')
    expect(rendered).toContain('Do not declare completion without evidence')
    expect(rendered).not.toContain('hidden chain-of-thought')
  })

  it('does not inject background or suppressed memories and obeys the hard character budget', () => {
    const focus = candidate(`user/message: ${'important '.repeat(80)}`, { eventSeq: 5 })
    const rendered = renderCognitiveModelContext(state({
      focus,
      active: [candidate('active evidence', { eventSeq: 4 })],
      background: [candidate('BACKGROUND MUST NOT APPEAR', { eventSeq: 3 })],
      suppressed: [candidate('SUPPRESSED MUST NOT APPEAR', { eventSeq: 2 })],
      candidateCount: 4,
    }), { maxChars: 420, maxActive: 1 })

    expect(rendered.length).toBeLessThanOrEqual(420)
    expect(rendered).not.toContain('BACKGROUND MUST NOT APPEAR')
    expect(rendered).not.toContain('SUPPRESSED MUST NOT APPEAR')
  })
})
