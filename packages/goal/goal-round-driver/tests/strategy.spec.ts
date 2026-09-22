import { describe, expect, it } from 'vitest'
import { GoalId } from '@phoenix-ai/dsh-goal'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import {
  GOAL_STRATEGIES,
  measureGoalVerificationProgress,
  recordGoalStrategy,
  replayGoalStrategy,
  selectNextStrategy,
} from '../src/strategy.ts'

describe('progress-aware goal strategies', () => {
  it('keeps a productive strategy and rotates only after verification stagnates', () => {
    expect(selectNextStrategy(undefined, 0)).toBe('baseline')
    expect(selectNextStrategy('baseline', 0)).toBe('baseline')
    expect(selectNextStrategy('baseline', 1)).toBe('verification-first')
    expect(selectNextStrategy('verification-first', 2)).not.toBe('verification-first')
    expect(GOAL_STRATEGIES).toHaveLength(4)
  })

  it('rejects invalid stagnation counts', () => {
    expect(() => selectNextStrategy('baseline', -1)).toThrow(TypeError)
    expect(() => selectNextStrategy('baseline', 1.5)).toThrow(TypeError)
  })

  it('measures new verifier coverage instead of raw round count', () => {
    const events = [
      {
        type: 'goal/completion-gate',
        data: {
          goalId: 'goal-progress', revision: 1,
          checks: {
            requirements: 'pass', builderTests: 'fail', adversarialTests: 'fail',
            startup: 'pass', artifactIntegrity: 'pass', cleanRoom: 'fail',
          },
          evidenceLedger: [
            { criterionId: 'REQ-ROOT', mandatory: true, status: 'verified' },
          ],
          findings: ['unicode gap', 'zero progress gap'],
        },
      },
      {
        type: 'goal/completion-gate',
        data: {
          goalId: 'goal-progress', revision: 1,
          checks: {
            requirements: 'pass', builderTests: 'pass', adversarialTests: 'fail',
            startup: 'pass', artifactIntegrity: 'pass', cleanRoom: 'fail',
          },
          evidenceLedger: [
            { criterionId: 'REQ-ROOT', mandatory: true, status: 'verified' },
            { criterionId: 'EDGE-UNICODE', mandatory: true, status: 'verified' },
          ],
          findings: ['zero progress gap'],
        },
      },
      {
        type: 'goal/completion-gate',
        data: {
          goalId: 'goal-progress', revision: 1,
          checks: {
            requirements: 'pass', builderTests: 'pass', adversarialTests: 'fail',
            startup: 'pass', artifactIntegrity: 'pass', cleanRoom: 'fail',
          },
          evidenceLedger: [
            { criterionId: 'REQ-ROOT', mandatory: true, status: 'verified' },
            { criterionId: 'EDGE-UNICODE', mandatory: true, status: 'verified' },
          ],
          findings: ['zero progress gap'],
        },
      },
    ] as never

    expect(measureGoalVerificationProgress(events, GoalId('goal-progress'), 1)).toEqual({
      stagnantRounds: 1,
      verifiedCriteria: 2,
      passedChecks: 4,
    })
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
    expect(() => { recordGoalStrategy(session, {
      goalId: '', revision: 1, round: 1,
      strategy: 'baseline', reason: 'invalid',
    }) }).toThrow(TypeError)
    expect(() => { recordGoalStrategy(session, {
      goalId: 'goal', revision: 1, round: 1,
      strategy: 'baseline', reason: 'x'.repeat(501),
    }) }).toThrow(TypeError)
    expect(session.events).toHaveLength(0)
  })
})
