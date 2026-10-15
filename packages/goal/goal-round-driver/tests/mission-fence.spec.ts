import { describe, expect, it } from 'vitest'
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'
import { goalBlockedByClosedUniversalMission, unfinishedTodoRecoveryObjective } from '../src/mission-fence.ts'

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
describe('Goal recovery for abandoned checklists', () => {
  const request = { seq: 1, type: 'user/message', data: {
    source: { kind: 'user' }, content: [{ type: 'text', text: 'Publica el juego probado' }],
  } } as unknown as SessionEvent
  const pending = { seq: 2, type: 'todo/write', data: {
    todos: [{ content: 'Probar el salto', status: 'in_progress' }, { content: 'Publicar', status: 'pending' }],
  } } as unknown as SessionEvent
  const done = { seq: 2, type: 'todo/write', data: {
    todos: [{ content: 'Publicar', status: 'completed' }],
  } } as unknown as SessionEvent
  const end = { seq: 3, type: 'turn/end', data: { reason: { kind: 'completed' } } } as unknown as SessionEvent
  const stop = { seq: 3, type: 'turn/end', data: {
    reason: { kind: 'aborted', reason: { kind: 'user' } },
  } } as unknown as SessionEvent

  it('resumes only unfinished, human-authorized work after a completed turn', () => {
    expect(unfinishedTodoRecoveryObjective([request, pending, end])).toBe('Publica el juego probado')
    expect(unfinishedTodoRecoveryObjective([request, done, end])).toBeUndefined()
    expect(unfinishedTodoRecoveryObjective([request, pending, stop])).toBeUndefined()
    expect(unfinishedTodoRecoveryObjective([pending, end])).toBeUndefined()
    expect(unfinishedTodoRecoveryObjective([request, pending])).toBeUndefined()
  })
})

describe('UME terminal fence for automatic Goal rounds', () => {
  it('recovers an older prematurely partial mission only while its Goal is still active', () => {
    const goal = (seq: number, phase: string): SessionEvent => ({
      seq, type: 'goal/change', data: { operation: phase === 'complete' ? 'complete' : 'create',
        goal: { phase } },
    }) as unknown as SessionEvent
    const end = (kind: string): SessionEvent => ({
      seq: 3, type: 'turn/end', data: { reason: { kind } },
    }) as unknown as SessionEvent
    expect(goalBlockedByClosedUniversalMission(session([
      human(1), goal(2, 'active'), end('completed'), terminal(4, 'partial'),
    ]))).toBe(false)
    expect(goalBlockedByClosedUniversalMission(session([
      human(1), goal(2, 'blocked'), end('completed'), terminal(4, 'partial'),
    ]))).toBe(true)
    expect(goalBlockedByClosedUniversalMission(session([
      human(1), goal(2, 'active'), end('aborted'), terminal(4, 'partial'),
    ]))).toBe(true)
    expect(goalBlockedByClosedUniversalMission(session([
      human(1), goal(2, 'active'), end('completed'), terminal(4, 'cancelled'),
    ]))).toBe(true)
    expect(goalBlockedByClosedUniversalMission(session([
      human(1), goal(2, 'active'), end('completed'), terminal(4, 'completed'),
    ]))).toBe(true)
  })

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
  it.each(['completed', 'partial', 'failed', 'cancelled'])('treats %s as terminal', (phase) => {
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
