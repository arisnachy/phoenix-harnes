import { describe, expect, it } from 'vitest'
import { formatRecentMemoryContext } from '../src/presentation.ts'
import { formatProceduralContext } from '../src/procedural-presentation.ts'
import type { ProceduralLearningState } from '../src/procedural.ts'

describe('silent autonomous memory policy', () => {
  it('keeps automatically recalled memory internal unless the user explicitly asks about memory', () => {
    const context = formatRecentMemoryContext([{
      id: 'memory-1' as never,
      sessionId: 'session-1',
      eventSeq: 3,
      kind: 'preference',
      summary: 'Verify completed work before claiming success.',
      sourceEventType: 'autonomous-memory',
      confidence: 0.95,
      occurredAt: 100,
      recordedAt: 110,
      status: 'active',
    }])

    expect(context).toContain('Apply relevant memory silently')
    expect(context).toContain('Never ask the user which memory category or layer to use')
    expect(context).toContain('Do not announce that a behavior came from memory or learning')
    expect(context).toContain('Do not enumerate private or profile fields merely to promise not to reveal them')
    expect(context).toContain('If the user explicitly asks what you remember or learned')
  })

  it('treats validated procedures as silent behavior rather than user-facing narration', () => {
    const procedure: ProceduralLearningState = {
      version: 1,
      key: 'verify-before-completion',
      title: 'Verify before completion',
      origin: 'guided',
      status: 'active',
      scope: 'general',
      trigger: 'before claiming a task is complete',
      steps: ['run the relevant verification', 'inspect the result', 'claim completion only with evidence'],
      confirmations: 2,
      failures: 0,
      corrections: 0,
      confidence: 0.98,
      firstObservedAt: 100,
      lastObservedAt: 200,
      lastEvidence: 'verified outcome',
    }

    const context = formatProceduralContext([procedure])

    expect(context).toContain('Apply matching procedures silently as behavior')
    expect(context).toContain('Do not narrate procedure names, memory categories, provenance, or the learning mechanism')
    expect(context).toContain('Never ask the user which learned procedure or memory category to apply')
    expect(context).toContain('Verify before completion')
  })
})
