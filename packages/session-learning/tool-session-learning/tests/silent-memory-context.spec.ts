import { describe, expect, it } from 'vitest'
import type { MemoryRecord } from '@phoenix-ai/dsh-session-learning'
import { formatRecentMemoryContext } from '../src/presentation.ts'
import { formatProceduralContext } from '../src/procedural-presentation.ts'

describe('silent automatic memory recall', () => {
  it('keeps storage provenance and internal implementation details out of automatic prompt context', () => {
    const record: MemoryRecord = {
      id: 'memory-1' as never,
      sessionId: 'session-secret',
      eventSeq: 9,
      kind: 'lesson',
      summary: 'Antes de tocar archivos consulta AGENTS.md y C:\\Users\\owner\\repo\\private.txt.',
      sourceEventType: 'autonomous/user-correction',
      confidence: 0.96,
      occurredAt: 100,
      recordedAt: 101,
      status: 'active',
    }

    const context = formatRecentMemoryContext([record])

    expect(context).toContain('Apply relevant memories silently')
    expect(context).not.toContain('session-secret')
    expect(context).not.toContain('source_event_type')
    expect(context).not.toContain('event_seq')
    expect(context).not.toContain('AGENTS.md')
    expect(context).not.toContain('C:\\Users')
  })

  it('does not tell the model to narrate memory mechanics or ask which memory category to use', () => {
    const record: MemoryRecord = {
      id: 'memory-2' as never,
      sessionId: 'session-2',
      eventSeq: 2,
      kind: 'preference',
      summary: 'Prefiero respuestas directas con evidencia.',
      sourceEventType: 'autonomous/user-preference',
      confidence: 0.93,
      occurredAt: 200,
      recordedAt: 201,
      status: 'active',
    }

    const context = formatRecentMemoryContext([record])
    expect(context).toContain('Do not announce that you are recalling or applying memory')
    expect(context).toContain('Never ask the user which memory category to use')
    expect(context).toContain('Ask a clarifying question only when a material ambiguity cannot be resolved')
  })
})

describe('silent validated procedures', () => {
  it('injects a matching learned procedure as private execution guidance rather than narration material', () => {
    const context = formatProceduralContext([{
      version: 1,
      key: 'abc123',
      title: 'Verify workspace before file operations',
      origin: 'experience',
      status: 'active',
      scope: 'workspace',
      trigger: 'Working with repository files',
      steps: ['Inspect the current workspace', 'Operate on the resolved target', 'Verify the result'],
      confirmations: 2,
      failures: 0,
      corrections: 0,
      confidence: 0.93,
      firstObservedAt: 100,
      lastObservedAt: 200,
      lastEvidence: 'verified completion',
    }])

    expect(context).toContain('private execution guidance')
    expect(context).toContain('Apply matching procedures silently')
    expect(context).toContain('Do not recite procedure titles, triggers, memory categories, provenance, confidence, or internal paths')
    expect(context).toContain('Verify workspace before file operations')
  })
})
