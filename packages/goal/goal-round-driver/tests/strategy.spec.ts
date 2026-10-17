import { describe, expect, it } from 'vitest'
import { GoalId } from '@phoenix-ai/dsh-goal'
import { CallId, createToolResultMessage, createUserMessage } from '@phoenix-ai/dsh-llm'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import {
  GOAL_STRATEGIES,
  measureGoalVerificationProgress,
  measureGoalWorkProgress,
  recordGoalStrategy,
  replayGoalStrategy,
  selectNextStrategy,
} from '../src/strategy.ts'

describe('progress-aware goal strategies', () => {
  it('distinguishes real work and new evidence from repetitive model narration', () => {
    const session = Session.create(SessionId('goal-work-progress'))
    const goalId = GoalId('goal-work')
    session.append('goal/change', {
      kind: 'goal/change', version: 1, operation: 'create',
      goal: { id: goalId, revision: 1, objective: 'ship', phase: 'active', maxGoalRounds: 2 },
      roundsStarted: 0, createdAt: 1, updatedAt: 1,
    })
    const addRound = (round: number, effect?: { name: string; args: string; result?: string }) => {
      const turn = round
      session.append('turn/start', { turn })
      session.append('user/message', createUserMessage({
        source: { kind: 'goal', goalId, revision: 1, round },
        content: [{ type: 'text', text: 'continue' }],
      }), { surfaceOp: 'append' })
      if (effect !== undefined) {
        const callId = CallId(`call-${round}`)
        session.append('tool/call', { turn, step: 1, callId, name: effect.name, arguments: effect.args })
        session.append('tool/result', { turn, step: 1,
          message: createToolResultMessage({
            callId, content: [{ type: 'text', text: effect.result ?? 'ok' }], isError: false,
          }),
        }, { surfaceOp: 'append' })
      }
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }
    addRound(1)
    addRound(2)
    expect(measureGoalWorkProgress(session.events, goalId)).toEqual({
      stagnantRounds: 2, completedRounds: 2, repeatedOperations: [],
    })
    addRound(3, { name: 'read', args: '{"path":"a"}' })
    expect(measureGoalWorkProgress(session.events, goalId).stagnantRounds).toBe(0)
    addRound(4, { name: 'read', args: '{"path":"a"}' })
    expect(measureGoalWorkProgress(session.events, goalId)).toEqual({
      stagnantRounds: 1, completedRounds: 4, repeatedOperations: ['read'],
    })
    addRound(5, { name: 'edit', args: '{"path":"a","replace":"fixed"}' })
    expect(measureGoalWorkProgress(session.events, goalId).stagnantRounds).toBe(0)
    // New arguments alone do not make repeated, unchanged tool output useful.
    addRound(6, { name: 'edit', args: '{"path":"b","replace":"fixed"}' })
    expect(measureGoalWorkProgress(session.events, goalId)).toMatchObject({
      stagnantRounds: 1, repeatedOperations: ['edit'],
    })
    addRound(7, { name: 'press_key', args: '{"key":"PageDown"}',
      result: '{"status":"dispatched","verified":false}' })
    expect(measureGoalWorkProgress(session.events, goalId)).toMatchObject({
      stagnantRounds: 2,
    })
    addRound(8, { name: 'press_key', args: '{"key":"End"}',
      result: '{"status":"dispatched","verified":false}' })
    expect(measureGoalWorkProgress(session.events, goalId)).toMatchObject({
      stagnantRounds: 3, repeatedOperations: ['press_key'],
    })
  })

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
