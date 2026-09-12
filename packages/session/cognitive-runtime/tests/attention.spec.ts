import { describe, expect, it, vi } from 'vitest'
import type { CognitiveMemoryRecord, MemoryId } from '@phoenix-ai/dsh-session-learning'
import { scoreAttention } from '../src/attention.ts'
import type { AttentionWeights } from '../src/types.ts'

const weights: AttentionWeights = {
  importance: 1,
  confidence: 1,
  recency: 1,
  urgency: 1,
  goalRelevance: 1,
  novelty: 1,
}

function record(overrides: Partial<CognitiveMemoryRecord> = {}): CognitiveMemoryRecord {
  const eventSeq = overrides.eventSeq ?? 1
  const occurredAt = overrides.provenance?.occurredAt ?? eventSeq * 100
  const sessionId = overrides.sessionId ?? 'session-1'
  return {
    id: (overrides.id ?? `memory-${String(eventSeq)}`) as MemoryId,
    sessionId,
    eventSeq,
    kind: overrides.kind ?? 'event',
    layers: overrides.layers ?? ['episodic', 'temporal'],
    content: overrides.content ?? `event ${String(eventSeq)}`,
    summary: overrides.summary ?? `event ${String(eventSeq)}`,
    entities: overrides.entities ?? [],
    relations: overrides.relations ?? [],
    provenance: overrides.provenance ?? {
      sessionId,
      eventSeq,
      sourceEventType: 'user/message',
      sourceUri: `session:${sessionId}#event:${String(eventSeq)}`,
      occurredAt,
    },
    confidence: overrides.confidence ?? 0.5,
    importance: overrides.importance ?? 0.5,
    frequency: overrides.frequency ?? 1,
    validFrom: overrides.validFrom ?? occurredAt,
    recordedAt: overrides.recordedAt ?? occurredAt,
    lastObservedAt: overrides.lastObservedAt ?? occurredAt,
    status: overrides.status ?? 'active',
    ...overrides.projectId === undefined ? {} : { projectId: overrides.projectId },
    ...overrides.subject === undefined ? {} : { subject: overrides.subject },
    ...overrides.value === undefined ? {} : { value: overrides.value },
    ...overrides.validUntil === undefined ? {} : { validUntil: overrides.validUntil },
    ...overrides.supersedes === undefined ? {} : { supersedes: overrides.supersedes },
    ...overrides.supersededBy === undefined ? {} : { supersededBy: overrides.supersededBy },
  }
}

describe('scoreAttention', () => {
  it('combines persisted importance, confidence, and recency signals', () => {
    const result = scoreAttention([
      record({ eventSeq: 1, importance: 1, confidence: 0, lastObservedAt: 100 }),
      record({ eventSeq: 2, importance: 0, confidence: 1, lastObservedAt: 200 }),
      record({ eventSeq: 3, importance: 0, confidence: 0, lastObservedAt: 300 }),
    ], { ...weights, urgency: 0, goalRelevance: 0, novelty: 0 })

    expect(result.map(candidate => candidate.record.eventSeq)).toEqual([2, 3, 1])
    expect(result.find(candidate => candidate.record.eventSeq === 1)?.signals).toMatchObject({ importance: 1, confidence: 0, recency: 0 })
    expect(result.find(candidate => candidate.record.eventSeq === 2)?.signals).toMatchObject({ importance: 0, confidence: 1, recency: 0.5 })
    expect(result.find(candidate => candidate.record.eventSeq === 3)?.signals).toMatchObject({ importance: 0, confidence: 0, recency: 1 })
    expect(result.every(candidate => Number.isFinite(candidate.score))).toBe(true)
  })

  it('raises urgent pending and error records and prospective mission records', () => {
    const result = scoreAttention([
      record({ eventSeq: 1, kind: 'event' }),
      record({ eventSeq: 2, kind: 'pending' }),
      record({ eventSeq: 3, kind: 'error' }),
      record({ eventSeq: 4, kind: 'mission', layers: ['prospective'] }),
    ], { ...weights, importance: 0, confidence: 0, recency: 0, novelty: 0 })

    expect(result[0]?.signals.urgency).toBe(1)
    expect(result[0]?.signals.goalRelevance).toBe(1)
    expect(result.find(candidate => candidate.record.eventSeq === 3)?.signals.urgency).toBe(1)
    expect(result.find(candidate => candidate.record.eventSeq === 4)?.signals.urgency).toBe(0)
    expect(result.find(candidate => candidate.record.eventSeq === 1)?.signals).toMatchObject({ urgency: 0, goalRelevance: 0 })
  })

  it('uses inverse frequency as novelty and honors configured weights', () => {
    const records = [
      record({ eventSeq: 1, frequency: 1, importance: 0.2 }),
      record({ eventSeq: 2, frequency: 8, importance: 0.9 }),
    ]
    const novelty = scoreAttention(records, { ...weights, importance: 0, confidence: 0, recency: 0, urgency: 0, goalRelevance: 0 })
    const importance = scoreAttention(records, { ...weights, confidence: 0, recency: 0, urgency: 0, goalRelevance: 0, novelty: 0 })

    expect(novelty[0]?.record.eventSeq).toBe(1)
    expect(novelty[0]?.signals.novelty).toBe(1)
    expect(novelty[1]?.signals.novelty).toBe(0.125)
    expect(importance[0]?.record.eventSeq).toBe(2)
    expect(scoreAttention([record({ frequency: 0 })], weights)[0]?.signals.novelty).toBe(1)
  })

  it('uses canonical occurrence time instead of reinforcement time for recency', () => {
    const result = scoreAttention([
      record({
        eventSeq: 1,
        provenance: { ...record().provenance, eventSeq: 1, occurredAt: 100 },
        lastObservedAt: 10_000,
      }),
      record({
        eventSeq: 2,
        provenance: { ...record().provenance, eventSeq: 2, occurredAt: 200 },
        lastObservedAt: 200,
      }),
    ], { ...weights, importance: 0, confidence: 0, urgency: 0, goalRelevance: 0, novelty: 0 })

    expect(result.map(candidate => candidate.record.eventSeq)).toEqual([2, 1])
    expect(result.map(candidate => candidate.signals.recency)).toEqual([1, 0])
  })

  it('filters inactive lifecycle records before scoring', () => {
    const result = scoreAttention([
      record({ eventSeq: 1, status: 'forgotten' }),
      record({ eventSeq: 2, status: 'superseded' }),
      record({ eventSeq: 3, status: 'obsolete' }),
      record({ eventSeq: 4, status: 'active' }),
    ], weights)

    expect(result.map(candidate => candidate.record.eventSeq)).toEqual([4])
  })

  it('returns no candidates when every record is outside the active lifecycle', () => {
    expect(scoreAttention([
      record({ status: 'forgotten' }),
      record({ eventSeq: 2, status: 'superseded' }),
      record({ eventSeq: 3, status: 'obsolete' }),
    ], weights)).toEqual([])
  })

  it('breaks equal scores by event sequence, source URI, and id', () => {
    const result = scoreAttention([
      record({ id: 'z' as MemoryId, eventSeq: 2, provenance: { ...record().provenance, eventSeq: 2, sourceUri: 'z', occurredAt: 100 } }),
      record({ id: 'b' as MemoryId, eventSeq: 1, provenance: { ...record().provenance, eventSeq: 1, sourceUri: 'b', occurredAt: 100 } }),
      record({ id: 'a' as MemoryId, eventSeq: 1, provenance: { ...record().provenance, eventSeq: 1, sourceUri: 'a', occurredAt: 100 } }),
      record({ id: 'c' as MemoryId, eventSeq: 1, provenance: { ...record().provenance, eventSeq: 1, sourceUri: 'a', occurredAt: 100 } }),
    ], { importance: 0, confidence: 0, recency: 0, urgency: 0, goalRelevance: 0, novelty: 0 })

    expect(result.map(candidate => candidate.record.id)).toEqual(['z', 'a', 'c', 'b'])
  })

  it('returns detached candidates and uses no ambient clock', () => {
    const source = [
      record({ eventSeq: 1, lastObservedAt: 100, entities: [{ type: 'concept', value: 'clock', normalized: 'clock' }] }),
      record({ eventSeq: 2, lastObservedAt: 200 }),
    ]
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const first = scoreAttention(source, weights)
    vi.setSystemTime(1_000_000)
    const result = scoreAttention(source, weights)
    vi.useRealTimers()
    const sourceEntities = source[0]!.entities as Array<CognitiveMemoryRecord['entities'][number]>
    sourceEntities.push({ type: 'concept', value: 'mutated', normalized: 'mutated' })
    source.push(record({ eventSeq: 3, lastObservedAt: 1000 }))

    expect(result).toEqual(first)
    expect(result).toHaveLength(2)
    const resultEntities = result.find(candidate => candidate.record.eventSeq === 1)?.record.entities as Array<CognitiveMemoryRecord['entities'][number]>
    expect(resultEntities).toHaveLength(1)
    resultEntities.push({ type: 'concept', value: 'result', normalized: 'result' })
    expect(sourceEntities).toHaveLength(2)
    expect(sourceEntities[0]!.value).toBe('clock')
  })

  it('returns an empty result for empty input and rejects invalid weights', () => {
    expect(scoreAttention([], weights)).toEqual([])
    expect(() => scoreAttention([], { ...weights, importance: -1 })).toThrow(/non-negative/)
    expect(() => scoreAttention([], { ...weights, confidence: Number.NaN })).toThrow(/finite/)
    expect(scoreAttention([record({ importance: Number.NaN })], weights)[0]?.signals.importance).toBe(0)
  })

  it('normalizes finite extreme weights without overflow', () => {
    const result = scoreAttention([
      record({ kind: 'pending', importance: 1, confidence: 1, layers: ['prospective'] }),
    ], {
      importance: Number.MAX_VALUE,
      confidence: Number.MAX_VALUE,
      recency: Number.MAX_VALUE,
      urgency: Number.MAX_VALUE,
      goalRelevance: Number.MAX_VALUE,
      novelty: Number.MAX_VALUE,
    })

    expect(result[0]?.score).toBe(1)
    expect(Number.isFinite(result[0]?.score)).toBe(true)
  })

  it('orders tie-break text by Unicode code point', () => {
    const result = scoreAttention([
      record({ id: 'astral' as MemoryId, eventSeq: 1, provenance: { ...record().provenance, eventSeq: 1, sourceUri: '\u{1F600}', occurredAt: 100 } }),
      record({ id: 'bmp' as MemoryId, eventSeq: 1, provenance: { ...record().provenance, eventSeq: 1, sourceUri: '\uE000', occurredAt: 100 } }),
    ], { importance: 0, confidence: 0, recency: 0, urgency: 0, goalRelevance: 0, novelty: 0 })

    expect(result.map(candidate => candidate.record.id)).toEqual(['bmp', 'astral'])
  })
})
