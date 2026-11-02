import { describe, expect, it } from 'vitest'
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'
import { activeScheduledMissionScope, scheduledMissionScopeActive } from '../src/mission-scope.ts'

function session(events: SessionEvent[], id = 'lead'): Pick<Session, 'id' | 'events'> {
  return { id: id as Session['id'], events }
}
function event(seq: number, phase: string, epoch: number): SessionEvent {
  return { seq, type: 'team/mission', data: {
    version: 1, teamId: 'lead', snapshot: {
      id: 'lead:mission:1', teamId: 'lead', phase, cancellationEpoch: epoch,
    },
  } } as unknown as SessionEvent
}
describe('proactivity mission-owned task fence', () => {
  it('captures a real active mission and rejects a closed or incremented epoch', () => {
    const active = session([event(1, 'running', 0)])
    const scope = activeScheduledMissionScope(active)
    expect(scope).toEqual({ sessionId: 'lead', missionId: 'lead:mission:1', epoch: 0 })
    expect(scheduledMissionScopeActive(active, scope!)).toBe(true)
    expect(scheduledMissionScopeActive(session([event(1, 'running', 0), event(2, 'cancelled', 1)]), scope!)).toBe(false)
    expect(scheduledMissionScopeActive(session([event(1, 'running', 1)]), scope!)).toBe(false)
    expect(scheduledMissionScopeActive(session([event(1, 'running', 0)], 'another'), scope!)).toBe(false)
  })
  it('does not attach to a previous mission after a new human input', () => {
    const input = { seq: 2, type: 'user/message', data: { source: { kind: 'user' } } } as unknown as SessionEvent
    expect(activeScheduledMissionScope(session([event(1, 'running', 0), input]))).toBeUndefined()
  })
  it('does not attach to fake or terminal missions', () => {
    expect(activeScheduledMissionScope(session([event(1, 'completed', 1)]))).toBeUndefined()
    expect(activeScheduledMissionScope(session([]))).toBeUndefined()
  })
})
