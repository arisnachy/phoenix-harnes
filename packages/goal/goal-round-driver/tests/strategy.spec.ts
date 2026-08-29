import { describe, expect, it } from 'vitest'
import { GoalId } from '@phoenix-ai/dsh-goal'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import {
  GOAL_STRATEGIES,
  recordGoalStrategy,
  replayGoalStrategy,
  selectNextStrategy,
} from '../src/strategy.ts'

describe('bounded goal strategies', () => {
  it('rotates deterministically and never repeats the previous strategy', () => {
    expect(selectNextStrategy(undefined, 0)).toBe('baseline')
    expect(selectNextStrategy('baseline', 1)).toBe('verification-first')
    expect(selectNextStrategy('verification-first', 2)).toBe('minimal-change')
    expect(selectNextStrategy('alternate-tool', 4)).not.toBe('alternate-tool')
    expect(GOAL_STRATEGIES).toHaveLength(4)
  })

  it('rejects invalid failure counts', () => {
    expect(() => selectNextStrategy('baseline', -1)).toThrow(TypeError)
    expect(() => selectNextStrategy('baseline', 1.5)).toThrow(TypeError)
  })

  it('records and replays the last strategy for a goal', () => {
    const session = Session.create(SessionId('goal-strategy-replay'))
    recordGoalStrategy(session, {
      goalId: GoalId('goal-strategy'), revision: 1, round: 1,
      strategy: 'baseline', reason: 'start the mission',
    })
    recordGoalStrategy(session, {
      goalId: GoalId('goal-strategy'), revision: 1, round: 2,
      strategy: 'verification-first', reason: 'verify the previous result',
    })

    expect(replayGoalStrategy(session.events, GoalId('goal-strategy'))).toMatchObject({
      round: 2, strategy: 'verification-first',
    })
    expect(replayGoalStrategy(session.events, GoalId('other'))).toBeUndefined()
  })

  it('rejects malformed selections before they enter durable history', () => {
    const session = Session.create(SessionId('goal-strategy-invalid'))
    expect(() => recordGoalStrategy(session, {
      goalId: '', revision: 1, round: 1,
      strategy: 'baseline', reason: 'invalid',
    })).toThrow(TypeError)
    expect(() => recordGoalStrategy(session, {
      goalId: 'goal', revision: 1, round: 1,
      strategy: 'baseline', reason: 'x'.repeat(501),
    })).toThrow(TypeError)
    expect(session.events).toHaveLength(0)
  })
})
