import { describe, expect, it } from 'vitest'
import {
  AdaptiveLearningEngine,
  adaptiveOutcomeForToolResult,
  type AdaptiveMemoryStore,
  type AdaptiveMemoryWrite,
  type AdaptiveStoredMemory,
} from '../src/adaptive.ts'

describe('adaptiveOutcomeForToolResult', () => {
  it('keeps an accepted Computer result as an unverified candidate', () => {
    expect(adaptiveOutcomeForToolResult('computer', false)).toEqual({ outcome: 'candidate' })
    expect(adaptiveOutcomeForToolResult('computer', false)).not.toHaveProperty('verified', true)
  })

  it('preserves failures and verified success for other tools', () => {
    expect(adaptiveOutcomeForToolResult('computer', true)).toEqual({ outcome: 'failure' })
    expect(adaptiveOutcomeForToolResult('web_search', false)).toEqual({ outcome: 'success', verified: true })
  })
})

class MemoryStore implements AdaptiveMemoryStore {
  readonly rows: AdaptiveStoredMemory[] = []

  timeline(query: { projectId?: string; sessionId?: string; includeHistory?: boolean } = {}): readonly AdaptiveStoredMemory[] {
    return this.rows.filter((row) => {
      if (query.projectId !== undefined && row.projectId !== query.projectId) return false
      if (query.sessionId !== undefined && row.sessionId !== query.sessionId) return false
      return query.includeHistory === true || row.status === 'active'
    })
  }

  async remember(input: AdaptiveMemoryWrite): Promise<void> {
    for (let index = 0; index < this.rows.length; index += 1) {
      const row = this.rows[index]
      if (row?.status === 'active' && row.subject === input.subject && row.projectId === input.projectId) {
        this.rows[index] = { ...row, status: 'superseded' }
      }
    }
    this.rows.push({
      subject: input.subject,
      value: input.value,
      summary: input.summary,
      sessionId: input.sessionId,
      status: 'active',
      occurredAt: input.occurredAt,
      sourceEventType: input.sourceEventType,
      ...input.projectId === undefined ? {} : { projectId: input.projectId },
    })
  }
}

function base(now: number) {
  return {
    strategy: 'Verify generated runtime assets from the extracted artifact',
    evidence: 'The clean-room artifact was inspected after extraction.',
    sessionId: 'session-1',
    eventSeq: 7,
    sourceEventType: 'goal/false-pass',
    occurredAt: now,
    projectId: 'phoenix',
  } as const
}

describe('AdaptiveLearningEngine', () => {
  it('promotes a candidate after a verified successful outcome', async () => {
    const store = new MemoryStore()
    const engine = new AdaptiveLearningEngine(store)
    const now = 1_000_000

    const candidate = await engine.recordOutcome({ ...base(now), outcome: 'candidate' })
    expect(candidate.status).toBe('candidate')

    const learned = await engine.recordOutcome({
      ...base(now + 1),
      outcome: 'success',
      verified: true,
      sourceEventType: 'goal/change:complete',
    })

    expect(learned.status).toBe('active')
    expect(learned.confirmations).toBeGreaterThanOrEqual(2)
    expect(learned.confidence).toBeGreaterThanOrEqual(0.8)
    expect(engine.recommend({ projectId: 'phoenix', now: now + 2 })).toEqual([
      expect.objectContaining({ strategy: base(now).strategy, status: 'active' }),
    ])
  })

  it('quarantines repeatedly failing strategies and excludes them from recommendations', async () => {
    const store = new MemoryStore()
    const engine = new AdaptiveLearningEngine(store)
    const now = 2_000_000

    await engine.recordOutcome({ ...base(now), outcome: 'failure' })
    const failed = await engine.recordOutcome({ ...base(now + 1), outcome: 'failure' })

    expect(failed.status).toBe('quarantined')
    expect(failed.failures).toBe(2)
    expect(engine.recommend({ projectId: 'phoenix', now: now + 2 })).toEqual([])
  })

  it('treats an explicit user correction as strong negative evidence', async () => {
    const store = new MemoryStore()
    const engine = new AdaptiveLearningEngine(store)
    const now = 3_000_000

    await engine.recordOutcome({ ...base(now), outcome: 'success', verified: true })
    const corrected = await engine.recordOutcome({
      ...base(now + 1),
      outcome: 'correction',
      evidence: 'User explicitly said the strategy was incorrect for this task.',
      sourceEventType: 'user/correction',
    })

    expect(corrected.status).toBe('quarantined')
    expect(corrected.corrections).toBe(1)
    expect(corrected.confidence).toBeLessThan(0.5)
  })

  it('refuses to persist secrets instead of learning a redacted secret-shaped strategy', async () => {
    const store = new MemoryStore()
    const engine = new AdaptiveLearningEngine(store)

    await expect(engine.recordOutcome({
      ...base(4_000_000),
      strategy: 'Call the provider with api_key=sk-super-secret-value',
      outcome: 'success',
      verified: true,
    })).rejects.toThrow(/secret/i)

    expect(store.rows).toHaveLength(0)
  })

  it('expires time-bounded strategies from recommendation without deleting audit history', async () => {
    const store = new MemoryStore()
    const engine = new AdaptiveLearningEngine(store)
    const now = 5_000_000

    const learned = await engine.recordOutcome({
      ...base(now),
      outcome: 'success',
      verified: true,
      ttlMs: 100,
    })

    expect(learned.status).toBe('active')
    expect(engine.recommend({ projectId: 'phoenix', now: now + 50 })).toHaveLength(1)
    expect(engine.recommend({ projectId: 'phoenix', now: now + 101 })).toHaveLength(0)
    expect(store.timeline({ projectId: 'phoenix', includeHistory: true }).length).toBeGreaterThan(0)
  })
})
