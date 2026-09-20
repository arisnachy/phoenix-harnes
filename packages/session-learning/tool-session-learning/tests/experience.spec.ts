import { describe, expect, it } from 'vitest'
import type { CognitiveMemoryRecord } from '@phoenix-ai/dsh-session-learning'
import {
  ExperienceLearningEngine,
  decodeExperienceAggregate,
  experienceMemoryInput,
  fingerprintKey,
  type ExperienceAggregate,
  type ExperienceMaturity,
} from '../src/experience.ts'
import { fingerprintTask } from '../src/task-context.ts'

function completeRuns(count: number, projectId?: string): ExperienceAggregate {
  const engine = new ExperienceLearningEngine()
  let state: ExperienceAggregate | undefined
  for (let run = 0; run < count; run += 1) {
    const startedAt = 1_000 + (run * 10_000)
    engine.beginTask({
      sessionId: 'session-1',
      text: 'Fill the monthly quality survey for Clinic A',
      occurredAt: startedAt,
      ...projectId === undefined ? {} : { projectId },
    })
    engine.observeToolCall('session-1')
    engine.observeUsage('session-1', { inputTokens: 100, outputTokens: 20, reasoningTokens: 10 })
    state = engine.completeVerified('session-1', startedAt + 2_000)
  }
  if (state === undefined) throw new Error('expected completed state')
  return state
}

function recordFor(state: ExperienceAggregate, status: CognitiveMemoryRecord['status'] = 'active'): CognitiveMemoryRecord {
  return {
    id: 'cognitive-test' as never,
    sessionId: 's',
    eventSeq: 1,
    kind: 'lesson',
    layers: ['semantic'],
    content: state.taskSummary,
    summary: state.taskSummary,
    subject: `phoenix.learning.experience.${state.key}`,
    value: JSON.stringify(state),
    entities: [],
    relations: [],
    provenance: {
      sessionId: 's',
      eventSeq: 1,
      sourceEventType: 'test',
      sourceUri: 'session:s#event:1',
      occurredAt: state.lastObservedAt,
    },
    confidence: 1,
    importance: 1,
    frequency: 1,
    validFrom: state.firstObservedAt,
    recordedAt: state.lastObservedAt,
    lastObservedAt: state.lastObservedAt,
    status,
    ...state.projectId === undefined ? {} : { projectId: state.projectId },
  }
}

function aggregateWith(maturity: ExperienceMaturity, overrides: Partial<ExperienceAggregate> = {}): ExperienceAggregate {
  const fingerprint = fingerprintTask('repeatable task')
  return {
    version: 1,
    key: fingerprintKey(fingerprint),
    taskFingerprint: fingerprint,
    taskSummary: 'repeatable task',
    maturity,
    runs: 1,
    verifiedSuccesses: 1,
    failures: 0,
    totalWallTimeMs: 100,
    totalTokens: 10,
    totalToolCalls: 1,
    totalFailedToolCalls: 0,
    totalRetries: 0,
    totalUserInterventions: 0,
    firstObservedAt: 1,
    lastObservedAt: 101,
    recentRuns: [{
      occurredAt: 101,
      wallTimeMs: 100,
      totalTokens: 10,
      toolCalls: 1,
      failedToolCalls: 0,
      retries: 0,
      userInterventions: 0,
      verified: true,
      qualityPassed: true,
    }],
    ...overrides,
  }
}

describe('ExperienceLearningEngine', () => {
  it('turns repeated verified work into durable habit evidence while counting end-to-end time', () => {
    const state = completeRuns(5, 'clinic')
    expect(state).toMatchObject({
      maturity: 'habitual',
      runs: 5,
      verifiedSuccesses: 5,
      totalWallTimeMs: 10_000,
      totalTokens: 650,
      totalToolCalls: 5,
      projectId: 'clinic',
    })
  })

  it('uses novel, repeated, validated and habitual maturity as evidence accumulates', () => {
    expect(completeRuns(1).maturity).toBe('novel')
    expect(completeRuns(2).maturity).toBe('repeated')
    expect(completeRuns(3).maturity).toBe('validated')
    expect(completeRuns(5).maturity).toBe('habitual')
  })

  it('aggregates paraphrased repeated tasks while keeping projects isolated', () => {
    const engine = new ExperienceLearningEngine()
    engine.beginTask({
      sessionId: 's1',
      text: 'Fill monthly clinic survey',
      occurredAt: 10,
      projectId: 'clinic-a',
    })
    const first = engine.completeVerified('s1', 20)
    engine.beginTask({
      sessionId: 's2',
      text: 'Complete the monthly survey for the clinic',
      occurredAt: 30,
      projectId: 'clinic-a',
    })
    const second = engine.completeVerified('s2', 40)
    expect(second?.key).toBe(first?.key)
    expect(second?.runs).toBe(2)
    expect(second?.taskSummary).toBe(first?.taskSummary)

    engine.beginTask({
      sessionId: 's3',
      text: 'Complete the monthly survey for the clinic',
      occurredAt: 50,
      projectId: 'clinic-b',
    })
    const isolated = engine.completeVerified('s3', 60)
    expect(isolated?.runs).toBe(1)
    expect(isolated?.projectId).toBe('clinic-b')
  })

  it('can retain candidate maturity when repetition exists without enough verified success', () => {
    const seed = aggregateWith('repeated', {
      runs: 2,
      verifiedSuccesses: 1,
      failures: 1,
      lastObservedAt: 50,
    })
    const engine = new ExperienceLearningEngine()
    engine.restore([recordFor(seed)])
    engine.beginTask({ sessionId: 's', text: 'repeatable task', occurredAt: 100 })
    expect(engine.completeVerified('s', 150)?.maturity).toBe('candidate')
  })

  it('counts related user follow-ups as intervention instead of resetting the episode', () => {
    const engine = new ExperienceLearningEngine()
    engine.beginTask({ sessionId: 's', text: 'Fill monthly clinic survey', occurredAt: 100 })
    engine.beginTask({ sessionId: 's', text: 'Fill the clinic survey monthly please', occurredAt: 120 })
    engine.observeToolCall('s')
    engine.observeToolResult('s', true)
    engine.observeToolResult('s', false)
    engine.observeRetry('s')
    const state = engine.completeVerified('s', 200)
    expect(state).toMatchObject({
      totalUserInterventions: 1,
      totalFailedToolCalls: 1,
      totalRetries: 1,
      totalToolCalls: 1,
      totalWallTimeMs: 100,
    })
  })

  it('replaces an unrelated unfinished episode and never promotes it', () => {
    const engine = new ExperienceLearningEngine()
    engine.beginTask({ sessionId: 's', text: 'Fill monthly clinic survey', occurredAt: 100 })
    engine.beginTask({ sessionId: 's', text: 'Compile TypeScript package', occurredAt: 200 })
    const state = engine.completeVerified('s', 260)
    expect(state?.taskSummary).toContain('Compile TypeScript')
    expect(state?.totalWallTimeMs).toBe(60)
  })

  it('ignores counters without an active episode and handles malformed token usage conservatively', () => {
    const engine = new ExperienceLearningEngine()
    engine.observeToolCall('missing')
    engine.observeToolResult('missing', true)
    engine.observeRetry('missing')
    engine.observeUserIntervention('missing')
    engine.observeUsage('missing', { inputTokens: 1, outputTokens: 1 })
    expect(engine.completeVerified('missing', 1)).toBeUndefined()

    engine.beginTask({ sessionId: 's', text: 'Measure resource accounting', occurredAt: 10 })
    engine.observeUsage('s', {
      inputTokens: -1,
      outputTokens: Number.NaN,
      cacheReadTokens: 2.9,
      cacheWriteTokens: Number.POSITIVE_INFINITY,
    })
    engine.observeUserIntervention('s')
    const state = engine.completeVerified('s', 20)
    expect(state?.totalTokens).toBe(2)
    expect(state?.totalUserInterventions).toBe(1)
  })

  it('ignores a task with no fingerprint tokens and supports explicit clear', () => {
    const engine = new ExperienceLearningEngine()
    engine.beginTask({ sessionId: 's', text: 'a y de la', occurredAt: 1 })
    expect(engine.completeVerified('s', 2)).toBeUndefined()
    engine.beginTask({ sessionId: 's', text: 'Useful repeatable task', occurredAt: 3 })
    engine.clear('s')
    expect(engine.completeVerified('s', 4)).toBeUndefined()
  })

  it('restores only active newest durable experience and exposes defensive snapshots', () => {
    const old = aggregateWith('novel', { lastObservedAt: 20 })
    const newer = aggregateWith('repeated', { runs: 2, verifiedSuccesses: 2, lastObservedAt: 40 })
    const engine = new ExperienceLearningEngine()
    engine.restore([
      recordFor(newer, 'forgotten'),
      recordFor(old),
      recordFor(newer),
      recordFor(old),
      { ...recordFor(old), value: '{bad-json', status: 'active' },
    ])
    const snapshot = engine.snapshot(newer.key)
    expect(snapshot?.runs).toBe(2)
    expect(engine.snapshot('missing')).toBeUndefined()
    if (snapshot !== undefined) {
      ;(snapshot as { runs: number }).runs = 99
    }
    expect(engine.snapshot(newer.key)?.runs).toBe(2)
  })

  it('serializes every maturity with bounded confidence and importance', () => {
    const importance = new Map<ExperienceMaturity, number>()
    for (const maturity of ['novel', 'repeated', 'candidate', 'validated', 'habitual'] as const) {
      const state = aggregateWith(maturity)
      const input = experienceMemoryInput(state, { sessionId: 's', eventSeq: 3, occurredAt: 110 })
      importance.set(maturity, input.importance)
      expect(input.subject).toBe(`phoenix.learning.experience.${state.key}`)
      expect(input.confidence).toBeGreaterThan(0.6)
      expect(decodeExperienceAggregate(recordFor(state))?.maturity).toBe(maturity)
    }
    expect(importance.get('habitual')).toBe(0.96)
    expect(importance.get('validated')).toBe(0.9)
    expect(importance.get('novel')).toBe(0.76)
  })

  it('supports zero-run diagnostic serialization without division artifacts', () => {
    const state = aggregateWith('novel', {
      runs: 0,
      verifiedSuccesses: 0,
      totalWallTimeMs: 0,
      totalTokens: 0,
      recentRuns: [],
    })
    const input = experienceMemoryInput(state, { sessionId: 's', eventSeq: 0, occurredAt: 0 })
    expect(input.summary).toContain('avgWallMs=0')
    expect(input.summary).toContain('avgTokens=0')
  })

  it('redacts common secret forms from persisted task summaries', () => {
    const engine = new ExperienceLearningEngine()
    engine.beginTask({
      sessionId: 's',
      text: 'Use api_key=SECRET123 and Bearer abcdef and sk-abcdefgh12345678 to fill report',
      occurredAt: 1,
    })
    const state = engine.completeVerified('s', 2)
    expect(state?.taskSummary).not.toContain('SECRET123')
    expect(state?.taskSummary).not.toContain('sk-abcdefgh12345678')
    expect(state?.taskSummary).toContain('[REDACTED]')
  })

  it('rejects malformed durable aggregate shapes', () => {
    const valid = recordFor(aggregateWith('novel'))
    const { subject: _subject, ...withoutSubject } = valid
    const { value: _value, ...withoutValue } = valid
    const malformed: Array<Partial<CognitiveMemoryRecord>> = [
      withoutSubject,
      { ...valid, subject: 'other.subject' },
      withoutValue,
      { ...valid, value: '{}' },
      { ...valid, value: '[]' },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), key: 1 }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), taskSummary: 1 }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), taskFingerprint: null }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), taskFingerprint: {} }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), taskFingerprint: { normalized: 'x', tokens: Array.from({ length: 65 }, () => 'x') } }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), taskFingerprint: { normalized: 'x', tokens: [1] } }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), taskFingerprint: { normalized: 'x', tokens: ['x'.repeat(161)] } }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), maturity: 'bad' }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), runs: 'bad' }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), runs: 1.5 }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), runs: -1 }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), totalWallTimeMs: -1 }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), totalFailedToolCalls: -1 }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), firstObservedAt: -1 }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), projectId: 3 }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), recentRuns: 'bad' }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), recentRuns: Array.from({ length: 13 }, () => aggregateWith('novel').recentRuns[0]) }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), recentRuns: [{}] }) },
    ]
    const validRun = aggregateWith('novel').recentRuns[0]!
    for (const field of ['occurredAt', 'wallTimeMs', 'totalTokens', 'toolCalls', 'failedToolCalls', 'retries', 'userInterventions'] as const) {
      malformed.push({
        ...valid,
        value: JSON.stringify({ ...aggregateWith('novel'), recentRuns: [{ ...validRun, [field]: -1 }] }),
      })
    }
    malformed.push(
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), recentRuns: [{ ...validRun, verified: false }] }) },
      { ...valid, value: JSON.stringify({ ...aggregateWith('novel'), recentRuns: [{ ...validRun, qualityPassed: false }] }) },
    )
    for (const row of malformed) expect(decodeExperienceAggregate(row as CognitiveMemoryRecord)).toBeUndefined()
  })

  it('hashes both token and normalized-only fingerprints deterministically', () => {
    const fingerprint = fingerprintTask('Fill survey 123 for Clinic A')
    expect(fingerprintKey(fingerprint)).toMatch(/^[0-9a-f]{8}$/u)
    expect(fingerprintKey({ normalized: 'fallback', tokens: [] })).toMatch(/^[0-9a-f]{8}$/u)
  })
})
