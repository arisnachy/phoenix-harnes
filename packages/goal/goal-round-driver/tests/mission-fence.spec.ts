import { describe, expect, it } from 'vitest'
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'
import { goalBlockedByClosedUniversalMission } from '../src/mission-fence.ts'

function human(seq: number, kind = 'user'): SessionEvent {
  return { seq, type: 'user/message', data: { source: { kind } } } as unknown as SessionEvent
}
function terminal(seq: number, phase = 'completed', teamId = 'lead'): SessionEvent {
  return {
    seq, type: 'team/mission', data: {
      version: 1, teamId, snapshot: { teamId, phase },
    },
  } as unknown as SessionEvent
}
function session(events: SessionEvent[]): Pick<Session, 'id' | 'events'> {
  return { id: 'lead' as Session['id'], events }
}
describe('UME terminal fence for automatic Goal rounds', () => {
  it('allows ordinary Goals when no UME terminal event exists', () => {
    expect(goalBlockedByClosedUniversalMission(session([]))).toBe(false)
    expect(goalBlockedByClosedUniversalMission(session([human(1)]))).toBe(false)
  })
  it('blocks stale goal retries and plugin wakeups after terminal mission', () => {
    expect(goalBlockedByClosedUniversalMission(session([
      human(1), terminal(3),
      human(4, 'plugin'), terminal(5, 'partial'),
    ]))).toBe(true)
  })
  it.each(['completed', 'partial', 'failed', 'cancelled'])('treats %s as terminal', phase => {
    expect(goalBlockedByClosedUniversalMission(session([human(1), terminal(2, phase)]))).toBe(true)
  })
  it('accepts a NEW genuine human request, not a stale synthetic message', () => {
    expect(goalBlockedByClosedUniversalMission(session([
      human(1), terminal(2), human(3), human(4, 'goal'),
    ]))).toBe(false)
  })
  it('allows the next versioned mission after the previous one closed', () => {
    const reopened = { seq: 4, type: 'team/mission', data: {
      version: 1, teamId: 'lead', snapshot: {
        teamId: 'lead', id: 'lead:mission:next', phase: 'running',
      },
    } } as unknown as SessionEvent
    expect(goalBlockedByClosedUniversalMission(session([
      human(1), terminal(2), human(3), reopened,
    ]))).toBe(false)
  })
  it('ignores forked Team events and unsupported versions', () => {
    expect(goalBlockedByClosedUniversalMission(session([
      human(1), terminal(2, 'completed', 'other'),
      { seq: 3, type: 'team/mission', data: {
        version: 9, teamId: 'lead', snapshot: { teamId: 'lead', phase: 'completed' },
      } } as unknown as SessionEvent,
    ]))).toBe(false)
  })
})
