import { describe, expect, it } from 'vitest'
import {
  ProceduralExperienceTrace,
  ProceduralLearningEngine,
  filterProceduralSearchHits,
  type ProceduralMemoryStore,
  type ProceduralMemoryWrite,
  type ProceduralStoredMemory,
} from '../src/procedural.ts'

class MemoryStore implements ProceduralMemoryStore {
  readonly rows: ProceduralStoredMemory[] = []

  timeline(query: { projectId?: string; sessionId?: string; includeHistory?: boolean } = {}): readonly ProceduralStoredMemory[] {
    return this.rows.filter((row) => {
      if (query.projectId !== undefined && row.projectId !== query.projectId) return false
      if (query.sessionId !== undefined && row.sessionId !== query.sessionId) return false
      return query.includeHistory === true || row.status === 'active'
    })
  }

  async remember(input: ProceduralMemoryWrite): Promise<void> {
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

function provenance(now: number) {
  return {
    sessionId: 'session-1',
    eventSeq: 12,
    occurredAt: now,
    projectId: 'phoenix',
  } as const
}

describe('ProceduralLearningEngine', () => {
  it('activates an explicit guided procedure with structured steps', async () => {
    const engine = new ProceduralLearningEngine(new MemoryStore())
    const learned = await engine.teach({
      title: 'Safe configuration restart',
      scope: 'phoenix/configuration',
      trigger: 'before restarting after a configuration change',
      steps: ['validate the candidate configuration', 'run boot checks', 'restart only after validation passes'],
      evidence: 'The user explicitly taught this workflow.',
      ...provenance(1_000),
    })

    expect(learned.origin).toBe('guided')
    expect(learned.status).toBe('active')
    expect(learned.confidence).toBeGreaterThanOrEqual(0.9)
    expect(learned.steps).toEqual([
      'validate the candidate configuration',
      'run boot checks',
      'restart only after validation passes',
    ])
    expect(engine.recommend({ projectId: 'phoenix', scope: 'phoenix/configuration' })).toHaveLength(1)
  })

  it('keeps unverified experience as a candidate and promotes verified experience', async () => {
    const store = new MemoryStore()
    const engine = new ProceduralLearningEngine(store)
    const candidate = await engine.recordExperience({
      title: 'Recover OAuth token exchange',
      scope: 'oauth',
      trigger: 'authorization succeeds but token exchange fails',
      steps: ['inspect pending authorization state', 'verify redirect and verifier', 'retry token exchange'],
      evidence: 'Observed during an unfinished mission.',
      verified: false,
      ...provenance(2_000),
    })
    expect(candidate.status).toBe('candidate')
    expect(engine.recommend({ projectId: 'phoenix', scope: 'oauth' })).toEqual([])

    const active = await engine.recordExperience({
      title: 'Recover OAuth token exchange',
      scope: 'oauth',
      trigger: 'authorization succeeds but token exchange fails',
      steps: candidate.steps,
      evidence: 'The mission passed independent completion verification.',
      verified: true,
      ...provenance(2_100),
    })
    expect(active.status).toBe('active')
    expect(active.confirmations).toBeGreaterThan(candidate.confirmations)
  })

  it('quarantines a corrected procedure and removes it from recommendations', async () => {
    const engine = new ProceduralLearningEngine(new MemoryStore())
    const learned = await engine.teach({
      title: 'Restart workflow',
      scope: 'phoenix/configuration',
      trigger: 'restart requested',
      steps: ['restart immediately'],
      evidence: 'Initial user instruction.',
      ...provenance(3_000),
    })
    const corrected = await engine.correct({
      key: learned.key,
      evidence: 'The user corrected the workflow and said validation must happen first.',
      ...provenance(3_100),
    })

    expect(corrected.status).toBe('quarantined')
    expect(corrected.corrections).toBe(1)
    expect(engine.recommend({ projectId: 'phoenix', scope: 'phoenix/configuration' })).toEqual([])
  })

  it('rejects secret-bearing guided procedures', async () => {
    const store = new MemoryStore()
    const engine = new ProceduralLearningEngine(store)
    await expect(engine.teach({
      title: 'Provider auth',
      scope: 'auth',
      trigger: 'authenticate',
      steps: ['use api_key=sk-super-secret-value'],
      evidence: 'User instruction.',
      ...provenance(4_000),
    })).rejects.toThrow(/secret/i)
    expect(store.rows).toHaveLength(0)
  })
})

describe('ProceduralExperienceTrace', () => {
  it('distills successful work into bounded action and recovery steps without raw arguments', () => {
    const trace = new ProceduralExperienceTrace()
    trace.toolCall('session-1', 'web_search')
    trace.toolCall('session-1', 'write_file')
    trace.recovery('session-1', 'Validate the generated file before retrying the renderer.')

    expect(trace.complete('session-1')).toEqual([
      'Use tool web_search',
      'Use tool write_file',
      'Recovery lesson: Validate the generated file before retrying the renderer.',
    ])
    expect(trace.complete('session-1')).toEqual([])
  })
})

describe('filterProceduralSearchHits', () => {
  it('hides candidate and quarantined procedural rows from ordinary recall', () => {
    const hit = (status: 'candidate' | 'active' | 'quarantined') => ({
      record: {
        subject: `phoenix.learning.procedure.${status}`,
        value: JSON.stringify({
          version: 1,
          key: status,
          title: status,
          origin: 'experience',
          status,
          scope: 'test',
          trigger: 'test',
          steps: ['test'],
          confirmations: 1,
          failures: 0,
          corrections: 0,
          confidence: 0.8,
          firstObservedAt: 1,
          lastObservedAt: 1,
          lastEvidence: 'evidence',
        }),
        summary: status,
        projectId: 'phoenix',
        sessionId: 's',
        status: 'active',
        provenance: { occurredAt: 1, sourceEventType: 'test' },
      },
      score: 1,
    })

    expect(filterProceduralSearchHits([hit('candidate'), hit('active'), hit('quarantined')] as never)).toHaveLength(1)
  })
})
