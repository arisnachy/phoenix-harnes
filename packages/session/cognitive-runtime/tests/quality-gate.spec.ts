import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@phoenix-ai/dsh-session'
import { COMPLETION_AUDIT_PROMPT, turnNeedsQualityAudit } from '../src/quality-gate.ts'

function event(type: string, data: Record<string, unknown>): SessionEvent {
  return { seq: 0, time: 1_700_000_000_000, type, data } as SessionEvent
}

describe('completion quality gate', () => {
  it('requests one audit before a tool-using turn closes', () => {
    const events = [
      event('turn/start', { turn: 4 }),
      event('tool/call', { turn: 4, step: 1, callId: 'call-1', name: 'write', arguments: '{}' }),
      event('tool/result', { turn: 4, step: 1 }),
    ]

    expect(turnNeedsQualityAudit(events, 4, false)).toBe(true)
    expect(turnNeedsQualityAudit(events, 4, true)).toBe(false)
  })

  it('does not spend an extra model step on a turn that performed no tool work', () => {
    const events = [
      event('turn/start', { turn: 2 }),
      event('assistant/message', { turn: 2, step: 1 }),
    ]

    expect(turnNeedsQualityAudit(events, 2, false)).toBe(false)
  })

  it('does not confuse tool work from an earlier turn with the current turn', () => {
    const events = [
      event('tool/call', { turn: 1, step: 1, callId: 'call-old', name: 'read', arguments: '{}' }),
      event('turn/start', { turn: 2 }),
    ]

    expect(turnNeedsQualityAudit(events, 2, false)).toBe(false)
  })

  it('requires evidence, repair, and truthful blockers without permitting a review loop', () => {
    expect(COMPLETION_AUDIT_PROMPT).toContain('evidence')
    expect(COMPLETION_AUDIT_PROMPT).toContain('repair')
    expect(COMPLETION_AUDIT_PROMPT).toContain('external blocker')
    expect(COMPLETION_AUDIT_PROMPT).toContain('Do not invent')
  })
})
