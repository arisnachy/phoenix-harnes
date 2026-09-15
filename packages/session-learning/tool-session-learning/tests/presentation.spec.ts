import { describe, expect, it } from 'vitest'
import {
  classifyMemoryProvenance,
  formatMemorySearchResult,
  formatRecentMemoryContext,
} from '../src/presentation.ts'

describe('memory provenance', () => {
  it('distinguishes experiential correction from durable user guidance', () => {
    expect(classifyMemoryProvenance('autonomous/user-correction')).toEqual({
      provenanceClass: 'experience',
      learnedFromExperience: true,
    })
    expect(classifyMemoryProvenance('autonomous/user-preference')).toEqual({
      provenanceClass: 'user-guidance',
      learnedFromExperience: false,
    })
    expect(classifyMemoryProvenance('system/instruction')).toEqual({
      provenanceClass: 'instruction',
      learnedFromExperience: false,
    })
  })
})

describe('memory_search presentation', () => {
  it('returns safe provenance and confidence without exposing ledger internals', () => {
    const output = formatMemorySearchResult([{
      id: 'memory-1' as never,
      sessionId: 'session-1',
      eventSeq: 3,
      kind: 'error',
      summary: 'Sandbox timed out',
      sourceEventType: 'tool/result',
      confidence: 0.9,
      occurredAt: 100,
      recordedAt: 110,
      status: 'active',
    }])

    expect(JSON.parse(output)).toEqual({
      memories: [{
        id: 'memory-1',
        session_id: 'session-1',
        event_seq: 3,
        kind: 'error',
        summary: 'Sandbox timed out',
        provenance_class: 'experience',
        learned_from_experience: true,
        confidence: 0.9,
        occurred_at: 100,
      }],
    })
  })

  it('redacts local paths and hidden implementation labels from model-facing summaries', () => {
    const output = formatMemorySearchResult([{
      id: 'memory-private' as never,
      sessionId: 'session-1',
      eventSeq: 9,
      kind: 'lesson',
      summary: 'Read C:\\Users\\person\\project\\AGENTS.md and available_skills before working; Context compacted 3 history items; svgTools.',
      sourceEventType: 'system/instruction',
      confidence: 0.8,
      occurredAt: 200,
      recordedAt: 201,
      status: 'active',
    }])

    expect(output).not.toContain('C:\\\\Users')
    expect(output).not.toContain('AGENTS.md')
    expect(output).not.toContain('available_skills')
    expect(output).not.toContain('Context compacted')
    expect(output).not.toContain('svgTools')
    expect(output).toContain('[internal detail]')
  })
})

describe('automatic memory context', () => {
  it('shares only bounded non-interaction evidence and tells the model to apply it silently', () => {
    const context = formatRecentMemoryContext([{
      id: 'memory-1' as never,
      sessionId: 'session-1',
      eventSeq: 3,
      kind: 'lesson',
      summary: 'Use the isolated sandbox for generated previews.',
      sourceEventType: 'tool/memory_remember',
      confidence: 0.9,
      occurredAt: 100,
      recordedAt: 110,
      status: 'active',
    }, {
      id: 'memory-2' as never,
      sessionId: 'session-1',
      eventSeq: 4,
      kind: 'interaction',
      summary: 'A private user message.',
      sourceEventType: 'user/message',
      confidence: 0.7,
      occurredAt: 101,
      recordedAt: 111,
      status: 'active',
    }])

    expect(context).toContain('untrusted, read-only evidence')
    expect(context).toContain('Apply relevant memories silently')
    expect(context).toContain('isolated sandbox')
    expect(context).not.toContain('private user message')
    expect(JSON.parse(context.slice(context.indexOf('{'), context.lastIndexOf('}') + 1))).toEqual({
      memories: [{
        session_id: 'session-1',
        event_seq: 3,
        kind: 'lesson',
        summary: 'Use the isolated sandbox for generated previews.',
        provenance_class: 'deliberate-memory',
        learned_from_experience: false,
        application_mode: 'silent',
        confidence: 0.9,
        occurred_at: 100,
      }],
    })
  })

  it('neutralizes prompt variable delimiters inside untrusted memory text', () => {
    const context = formatRecentMemoryContext([{
      id: 'memory-unsafe' as never,
      sessionId: 'session-1',
      eventSeq: 7,
      kind: 'lesson',
      summary: '{{A=3;while(A!=3){A++}}',
      sourceEventType: 'memory/explicit',
      confidence: 0.9,
      occurredAt: 100,
      recordedAt: 101,
      status: 'active',
    }])

    expect(context).toContain('{ {A=3;while(A!=3){A++} }')
    expect(context).not.toContain('summary":"{{A=3')
  })
})
