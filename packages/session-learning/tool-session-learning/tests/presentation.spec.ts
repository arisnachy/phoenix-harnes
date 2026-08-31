import { describe, expect, it } from 'vitest'
import { formatMemorySearchResult, formatRecentMemoryContext } from '../src/presentation.ts'

describe('memory_search presentation', () => {
  it('returns provenance and confidence without exposing ledger internals', () => {
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
        source_event_type: 'tool/result',
        confidence: 0.9,
        occurred_at: 100,
      }],
    })
  })
})

describe('automatic memory context', () => {
  it('shares only bounded non-interaction evidence and labels it untrusted', () => {
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
    expect(context).toContain('isolated sandbox')
    expect(context).not.toContain('private user message')
    expect(JSON.parse(context.slice(context.indexOf('{'), context.lastIndexOf('}') + 1))).toEqual({
      memories: [{
        session_id: 'session-1',
        event_seq: 3,
        kind: 'lesson',
        summary: 'Use the isolated sandbox for generated previews.',
        source_event_type: 'tool/memory_remember',
        confidence: 0.9,
        occurred_at: 100,
      }],
    })
  })
})
