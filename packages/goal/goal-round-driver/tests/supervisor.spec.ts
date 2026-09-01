import { describe, expect, it } from 'vitest'
import { GoalId } from '@phoenix-ai/dsh-goal'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import { recordGoalSupervisor, replayGoalSupervisor } from '../src/supervisor.ts'

const checkpoint = {
  goalId: GoalId('goal-supervisor'),
  revision: 2,
  roundsStarted: 1,
  status: 'awaiting-human' as const,
  nextAction: 'resume' as const,
  attempts: 2,
  lastError: 'provider stopped before producing a result',
}

describe('durable goal supervisor', () => {
  it('records and replays a bounded checkpoint', () => {
    const session = Session.create(SessionId('goal-supervisor-replay'))

    recordGoalSupervisor(session, checkpoint)

    expect(replayGoalSupervisor(session.events, checkpoint.goalId)).toEqual(checkpoint)
  })

  it('uses the latest checkpoint for the requested goal', () => {
    const session = Session.create(SessionId('goal-supervisor-latest'))
    recordGoalSupervisor(session, checkpoint)
    recordGoalSupervisor(session, { ...checkpoint, status: 'active', nextAction: 'continue', attempts: 3 })

    expect(replayGoalSupervisor(session.events, checkpoint.goalId)).toMatchObject({
      status: 'active',
      nextAction: 'continue',
      attempts: 3,
    })
    expect(replayGoalSupervisor(session.events, GoalId('other-goal'))).toBeUndefined()
  })

  it('rejects unbounded or malformed checkpoint data before append', () => {
    const session = Session.create(SessionId('goal-supervisor-invalid'))

    expect(() => { recordGoalSupervisor(session, { ...checkpoint, lastError: 'x'.repeat(501) }) }).toThrow(TypeError)
    expect(() => { recordGoalSupervisor(session, { ...checkpoint, attempts: -1 }) }).toThrow(TypeError)
    expect(session.events).toHaveLength(0)
  })
})
