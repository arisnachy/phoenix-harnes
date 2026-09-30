import { describe, expect, it } from 'vitest'
import { GoalId, nextGoalMissionPlan, recordGoalMissionPlan, replayGoalMissionPlan } from '@phoenix-ai/dsh-goal'
import { Session, SessionId } from '@phoenix-ai/dsh-session'

describe('goal mission plan', () => {
  it('persists bounded whole-plan revisions independently from goal revisions', () => {
    const session = Session.create(SessionId('mission-plan-test'))
    const goal = { id: GoalId('goal-1'), revision: 3, objective: 'Ship Phoenix Mission Runtime' }
    const first = nextGoalMissionPlan(goal, undefined, {
      acceptanceCriteria: ['Runtime survives restart', 'Verification is evidence-backed'],
      steps: [{ id: 'core', title: 'Build mission capsule', status: 'active', writeScope: ['packages/goal'] }],
      decisions: ['Reuse the durable goal event log.'],
    }, 100)
    recordGoalMissionPlan(session, first)
    expect(replayGoalMissionPlan(session.events, goal.id)).toEqual(first)

    const second = nextGoalMissionPlan({ ...goal, revision: 4 }, first, {
      acceptanceCriteria: first.acceptanceCriteria,
      steps: [{ ...first.steps[0]!, status: 'done' }],
      decisions: [...first.decisions, 'Keep plan revisions independent from goal revisions.'],
    }, 200)
    recordGoalMissionPlan(session, second)
    expect(second.planRevision).toBe(2)
    expect(second.goalRevision).toBe(4)
    expect(replayGoalMissionPlan(session.events, goal.id)).toEqual(second)
  })

  it('rejects overlapping-dangerous absolute or parent scopes at the durable boundary', () => {
    const goal = { id: GoalId('goal-2'), revision: 1, objective: 'Safe plan' }
    expect(() => nextGoalMissionPlan(goal, undefined, {
      acceptanceCriteria: [],
      steps: [{ id: 'bad', title: 'Bad scope', status: 'pending', writeScope: ['../outside'] }],
    }, 1)).toThrow('relative workspace scopes')
  })
})
