import { describe, expect, it } from 'vitest'
import type { CognitiveMemoryHit, CognitiveMemoryRecord } from '@phoenix-ai/dsh-session-learning'
import { formatDirectedMemoryContext } from '../src/episodic-presentation.ts'
import { resolveMemoryIntent } from '../src/memory-intent.ts'

function hit(record: CognitiveMemoryRecord): CognitiveMemoryHit {
  return { record, score: 1, reasons: ['test'] }
}

function record(overrides: Partial<CognitiveMemoryRecord>): CognitiveMemoryRecord {
  return {
    id: 'memory-id' as CognitiveMemoryRecord['id'],
    sessionId: 'private-session-id',
    eventSeq: 4,
    kind: 'mission',
    layers: ['autobiographical', 'episodic', 'temporal'],
    content: 'Mission: Fix Phoenix updater.',
    summary: 'Mission: Fix Phoenix updater. Outcome: Update launch verified.',
    entities: [],
    relations: [],
    provenance: {
      sessionId: 'private-session-id',
      eventSeq: 4,
      sourceEventType: 'episodic/mission/verified',
      sourceUri: 'session://private-session-id/events/4',
      occurredAt: Date.parse('2026-09-14T14:30:00.000Z'),
      projectId: 'phoenix-harnes',
    },
    confidence: 0.96,
    importance: 0.95,
    frequency: 1,
    validFrom: Date.parse('2026-09-14T14:30:00.000Z'),
    recordedAt: Date.parse('2026-09-14T14:30:00.000Z'),
    lastObservedAt: Date.parse('2026-09-14T14:30:00.000Z'),
    status: 'active',
    projectId: 'phoenix-harnes',
    subject: 'phoenix.episode.mission.abc123',
    value: JSON.stringify({
      version: 1,
      id: 'abc123',
      sessionId: 'private-session-id',
      userIntent: 'Arregla el actualizador de Phoenix.',
      startedAt: Date.parse('2026-09-14T14:00:00.000Z'),
      endedAt: Date.parse('2026-09-14T14:30:00.000Z'),
      verification: 'verified',
      tools: ['github'],
      outcome: 'Update launch verified.',
      projectId: 'phoenix-harnes',
    }),
    ...overrides,
  }
}

describe('human-safe directed memory presentation', () => {
  it('provides prior-work evidence without leaking memory plumbing', () => {
    const intent = resolveMemoryIntent('¿Qué hicimos ayer?', {
      now: Date.parse('2026-09-15T13:00:00.000Z'),
      timezoneOffsetMinutes: -240,
    })
    const text = formatDirectedMemoryContext(intent, [hit(record({}))])

    expect(text).toContain('Arregla el actualizador de Phoenix.')
    expect(text).toContain('Update launch verified.')
    expect(text).not.toContain('private-session-id')
    expect(text).not.toContain('episodic/mission/verified')
    expect(text).not.toContain('session://')
    expect(text).not.toContain('confidence')
    expect(text).not.toContain('autobiographical')
  })

  it('does not mix profile facts into work-history evidence', () => {
    const intent = resolveMemoryIntent('¿Qué hicimos ayer?', {
      now: Date.parse('2026-09-15T13:00:00.000Z'),
      timezoneOffsetMinutes: -240,
    })
    const profile = record({
      kind: 'preference',
      subject: 'user.preference.response_style',
      summary: 'User prefers short answers.',
      value: 'short',
    })
    const text = formatDirectedMemoryContext(intent, [hit(profile), hit(record({}))])

    expect(text).toContain('Arregla el actualizador de Phoenix.')
    expect(text).not.toContain('prefers short answers')
  })
})
