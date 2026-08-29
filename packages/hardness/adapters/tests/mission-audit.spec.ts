import { CallId } from '@phoenix-ai/dsh-llm'
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { createHardnessMissionAudit, replayHardnessMissionAudit } from '../src/mission-audit.ts'

describe('HARDNESS mission audit', () => {
  it('appends and replays only the rows for the requested call', () => {
    const events: SessionEvent[] = []
    const session = {
      append: vi.fn((type: string, data: unknown) => {
        events.push({ type, data, seq: events.length, time: 1 } as never)
      }),
    } as unknown as Session
    const audit = createHardnessMissionAudit(session)
    const callId = CallId('call-1')

    audit.record({ callId, step: 'inspect', outcome: 'completed', capabilityKind: 'weather' })
    audit.record({ callId: CallId('call-2'), step: 'audit', outcome: 'completed', capabilityKind: 'other' })
    audit.record({ callId, step: 'audit', outcome: 'completed', capabilityKind: 'weather', evidenceId: 'evidence-1' })

    expect(session.append).toHaveBeenCalledTimes(3)
    expect(replayHardnessMissionAudit(events, callId)).toEqual([
      { callId, step: 'inspect', outcome: 'completed', capabilityKind: 'weather' },
      { callId, step: 'audit', outcome: 'completed', capabilityKind: 'weather', evidenceId: 'evidence-1' },
    ])
  })
})
