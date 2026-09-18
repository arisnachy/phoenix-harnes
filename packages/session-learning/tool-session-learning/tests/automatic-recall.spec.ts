import { describe, expect, it, vi } from 'vitest'
import { selectAutomaticMemory } from '../src/automatic-recall.ts'
import { formatRecentMemoryContext } from '../src/presentation.ts'

describe('automatic task-aware memory recall', () => {
  it('prefers relevant cognitive experience over generic recent memory', () => {
    const relevant = [{ record: { kind: 'lesson' }, score: 0.92, reasons: ['lexical:3/4'] }]
    const generic = [{ kind: 'preference', summary: 'Generic preference' }]
    const source = {
      recall: vi.fn(() => generic),
      recallCognitive: vi.fn(() => relevant),
      currentProjectId: vi.fn(() => 'phoenix-harnes'),
    }

    const selected = selectAutomaticMemory(source as never, 'Repair the OAuth token exchange failure', 8)

    expect(source.recallCognitive).toHaveBeenCalledWith(expect.objectContaining({
      query: 'Repair the OAuth token exchange failure',
      projectId: 'phoenix-harnes',
    }))
    expect(source.recall).not.toHaveBeenCalled()
    expect(selected).toBe(relevant)
  })

  it('falls back to durable continuity memory when no task-relevant cognitive record exists', () => {
    const generic = [{ kind: 'lesson', summary: 'Verified fallback lesson' }]
    const source = {
      recall: vi.fn(() => generic),
      recallCognitive: vi.fn(() => []),
      currentProjectId: vi.fn(() => undefined),
    }

    const selected = selectAutomaticMemory(source as never, 'Completely new task', 8)

    expect(source.recall).toHaveBeenCalledWith(8)
    expect(selected).toBe(generic)
  })
})

describe('silent memory context policy', () => {
  it('tells the model to apply memory silently instead of narrating memory machinery or asking the user to route it', () => {
    const context = formatRecentMemoryContext([{
      id: 'memory-1' as never,
      sessionId: 'session-1',
      eventSeq: 3,
      kind: 'lesson',
      summary: 'Verify the working directory before file operations.',
      sourceEventType: 'tool/memory_remember',
      confidence: 0.95,
      occurredAt: 100,
      recordedAt: 101,
      status: 'active',
    }])

    expect(context).toMatch(/apply .* silently/i)
    expect(context).toMatch(/do not ask .* memory (?:type|layer)/i)
    expect(context).toMatch(/do not (?:announce|narrate|recite|restate)/i)
    expect(context).not.toContain('"session_id"')
    expect(context).not.toContain('"event_seq"')
    expect(context).not.toContain('"source_event_type"')
  })

  it('redacts internal absolute paths from automatic memory context', () => {
    const context = formatRecentMemoryContext([{
      id: 'memory-path' as never,
      sessionId: 'session-1',
      eventSeq: 4,
      kind: 'lesson',
      summary: 'Use C:\\Users\\operator\\private\\phoenix\\AGENTS.md before editing.',
      sourceEventType: 'tool/memory_remember',
      confidence: 0.95,
      occurredAt: 100,
      recordedAt: 101,
      status: 'active',
    }])

    expect(context).not.toContain('C:\\Users\\operator')
    expect(context).toContain('[internal-path]')
  })
})
