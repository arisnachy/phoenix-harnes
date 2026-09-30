import { describe, expect, it } from 'vitest'
import { GoalId, nextGoalMissionPlan } from '@phoenix-ai/dsh-goal'
import type { GoalView } from '@phoenix-ai/dsh-goal'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import { buildMissionCapsule } from '../src/mission-capsule.ts'

describe('mission capsule', () => {
  it('reconstructs plan, verification, review, strategy, supervisor and steering from durable events', () => {
    const session = Session.create(SessionId('mission-capsule-test'))
    const goal: GoalView = {
      id: GoalId('goal-1'),
      revision: 2,
      objective: 'Finish the durable mission',
      phase: 'active',
      maxGoalRounds: 8,
      roundsStarted: 2,
      createdAt: 1,
      updatedAt: 2,
      activation: 'armed',
    }
    const plan = nextGoalMissionPlan(goal, undefined, {
      acceptanceCriteria: ['Tests pass'],
      steps: [{ id: 'verify', title: 'Verify the output', status: 'active' }],
      decisions: ['Use deterministic checks first.'],
    }, 3)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Change course: keep the reviewer read-only.' }],
      source: { kind: 'user' },
    }))
    session.append('goal/strategy', {
      goalId: goal.id, revision: goal.revision, round: 2,
      strategy: 'verification-first', reason: 'fresh evidence is required',
    })
    session.append('goal/supervisor', {
      goalId: goal.id, revision: goal.revision, roundsStarted: 2,
      status: 'active', nextAction: 'continue', attempts: 2,
    })
    session.append('goal/judge', {
      callId: 'judge-1' as never, goalId: goal.id, revision: goal.revision, round: 2,
      verdict: 'needs_changes', summary: 'One fix remains.', findings: ['Missing proof'], requiredChanges: ['Add proof'],
    })
    session.append('goal/completion-gate', {
      goalId: goal.id, revision: goal.revision, round: 2, attemptId: 'gate-1',
      checks: {
        requirements: 'pass', builderTests: 'pass', adversarialTests: 'fail',
        startup: 'pass', artifactIntegrity: 'pass', cleanRoom: 'pass',
      },
      evidenceLedger: [{
        criterionId: 'REQ-1', criterion: 'Tests pass', mandatory: true,
        status: 'tested', evidence: ['unit suite'],
      }],
      artifactFingerprint: 'sha256:abc', findings: ['Adversarial test remains'], proceduralLessons: [],
    })

    const capsule = JSON.parse(buildMissionCapsule(session.events, goal, plan)) as Record<string, any>
    expect(capsule.masterPlan.revision).toBe(1)
    expect(capsule.strategy.id).toBe('verification-first')
    expect(capsule.independentReview.requiredChanges).toEqual(['Add proof'])
    expect(capsule.verification.artifactFingerprint).toBe('sha256:abc')
    expect(capsule.recentHumanSteering).toEqual(['Change course: keep the reviewer read-only.'])
  })
})
