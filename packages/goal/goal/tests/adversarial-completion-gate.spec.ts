import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AgentRegistry, { Inbox } from '@phoenix-ai/dsh-agent'
import type { Agent } from '@phoenix-ai/dsh-agent'
import SessionStore, { Session, SessionId } from '@phoenix-ai/dsh-session'
import GoalService from '@phoenix-ai/dsh-goal'
import type { GoalRef } from '@phoenix-ai/dsh-goal'

function stubAgent(rawId: string): { agent: Agent; session: Session } {
  const session = Session.create(SessionId(rawId))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(GoalService)
  const stub = stubAgent(`completion-gate-${Math.random()}`)
  ctx.agents.register(stub.agent)
  return { ctx, ...stub }
}

function refOf(goal: { id: GoalRef['id']; revision: number }): GoalRef {
  return { id: goal.id, revision: goal.revision }
}

function appendGate(session: Session, ref: GoalRef): void {
  session.append('goal/completion-gate', {
    goalId: ref.id,
    revision: ref.revision,
    round: 1,
    attemptId: 'gate-1',
    checks: {
      requirements: 'pass',
      builderTests: 'pass',
      adversarialTests: 'pass',
      startup: 'pass',
      artifactIntegrity: 'pass',
      cleanRoom: 'pass',
    },
    evidenceLedger: [{
      criterionId: 'REQ-001',
      criterion: 'Ship a verified artifact.',
      mandatory: true,
      status: 'verified',
      evidence: ['clean-room verification'],
    }],
    artifactFingerprint: 'sha256:test-artifact',
    cleanRoomEvidence: 'verified extracted artifact in a clean temporary directory',
    findings: [],
    proceduralLessons: [],
  })
}

function appendJudge(
  session: Session,
  ref: GoalRef,
  verdict: 'pass' | 'blocked' | 'needs_changes',
  callId: string,
): void {
  session.append('goal/judge', {
    callId: callId as never,
    goalId: ref.id,
    revision: ref.revision,
    round: 1,
    verdict,
    summary: verdict === 'pass' ? 'verified' : 'provider unavailable after settled review',
    findings: [],
    requiredChanges: [],
  })
}

describe('adversarial completion gate', () => {
  it('rejects completion when a judge passes without the six-check completion gate', async () => {
    const { ctx, agent, session } = await harness()
    const goal = ctx.goals.create(agent, { objective: 'Ship a verified artifact' })
    const ref = refOf(goal)
    appendJudge(session, ref, 'pass', 'judge-pass')

    expect(() => ctx.goals.complete(agent, ref)).toThrow(expect.objectContaining({
      code: 'GOAL_COMPLETION_GATE_NOT_VERIFIED',
    }))
  })

  it('keeps a settled pass authoritative when a later provider outage records blocked', async () => {
    const { ctx, agent, session } = await harness()
    const goal = ctx.goals.create(agent, { objective: 'Ship a verified artifact' })
    const ref = refOf(goal)
    appendGate(session, ref)
    appendJudge(session, ref, 'pass', 'judge-pass')
    appendJudge(session, ref, 'blocked', 'late-provider-outage')

    expect(ctx.goals.complete(agent, ref)).toMatchObject({ phase: 'complete' })
  })
})