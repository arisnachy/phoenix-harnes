import { describe, expect, test } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AgentRegistry, { Inbox } from '@phoenix-ai/dsh-agent'
import type { Agent } from '@phoenix-ai/dsh-agent'
import GoalService, { GoalError } from '@phoenix-ai/dsh-goal'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import { goalQualityLedger, qualityReadiness } from '../src/quality.ts'

function stubAgent(rawId: string): Agent {
  const session = Session.create(SessionId(rawId))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  return {
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
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(GoalService)
  const agent = stubAgent(`quality-completion-${Math.random()}`)
  ctx.agents.register(agent)
  return { ctx, agent }
}

function certify(agent: Agent, goal: NonNullable<ReturnType<GoalService['get']>>): void {
  agent.session.append('goal/completion-gate', {
    goalId: goal.id,
    revision: goal.revision,
    round: goal.roundsStarted,
    attemptId: 'quality-gate',
    checks: {
      requirements: 'pass', builderTests: 'pass', adversarialTests: 'pass',
      startup: 'pass', artifactIntegrity: 'pass', cleanRoom: 'pass',
    },
    evidenceLedger: [{
      criterionId: 'REQ-1', criterion: 'Service starts', mandatory: true,
      status: 'verified', evidence: ['clean-room:start'],
    }],
    artifactFingerprint: 'sha256:quality-artifact',
    cleanRoomEvidence: 'clean-room:start',
    findings: [],
    proceduralLessons: [],
  })
  agent.session.append('goal/judge', {
    callId: 'quality-judge' as never,
    goalId: goal.id,
    revision: goal.revision,
    round: goal.roundsStarted,
    verdict: 'pass',
    summary: 'Independent review passed.',
    findings: [],
    requiredChanges: [],
  })
}

describe('quality-gated goal completion', () => {
  test('forbids DONE even after gate+judge until exact-revision quality is ready', async () => {
    const { ctx, agent } = await harness()
    const goal = ctx.goals.create(agent, { objective: 'Ship a resilient service' })
    certify(agent, goal)

    expect(() => ctx.goals.complete(agent, { id: goal.id, revision: goal.revision }))
      .toThrow(expect.objectContaining({ code: 'GOAL_QUALITY_NOT_READY' }))
  })

  test('accepts completion after requested evidence, edge case, and innovation disposition are ready', async () => {
    const { ctx, agent } = await harness()
    const goal = ctx.goals.create(agent, { objective: 'Ship a resilient service' })
    certify(agent, goal)
    const ledger = goalQualityLedger(ctx.goals)
    let quality = ledger.start(agent, {
      objective: goal.objective,
      taskClass: 'substantial',
      goalId: goal.id,
      goalRevision: goal.revision,
    })
    quality = ledger.record(agent, { id: quality.id, revision: quality.revision }, {
      kind: 'criterion',
      criterion: {
        id: 'REQ-1', text: 'Service starts', tier: 'requested', mandatory: true,
        status: 'verified', evidence: ['clean-room:start'],
      },
    })
    quality = ledger.record(agent, { id: quality.id, revision: quality.revision }, {
      kind: 'scenario',
      scenario: {
        id: 'EDGE-1', title: 'restart after crash', severity: 'high', status: 'pass',
        evidenceKind: 'simulated', evidence: ['test:restart'],
      },
    })
    quality = ledger.record(agent, { id: quality.id, revision: quality.revision }, {
      kind: 'innovation',
      innovation: { status: 'not-applicable', rationale: 'No responsible extra feature adds value.' },
    })

    expect(qualityReadiness(quality)).toEqual({ ready: true, blockers: [] })
    expect(ctx.goals.complete(agent, { id: goal.id, revision: goal.revision }).phase).toBe('complete')
  })

  test('rejects a ready assessment bound to a different goal revision', async () => {
    const { ctx, agent } = await harness()
    const goal = ctx.goals.create(agent, { objective: 'Ship a resilient service' })
    certify(agent, goal)
    const ledger = goalQualityLedger(ctx.goals)
    let quality = ledger.start(agent, {
      objective: goal.objective,
      taskClass: 'substantial',
      goalId: goal.id,
      goalRevision: goal.revision + 1,
    })
    quality = ledger.record(agent, { id: quality.id, revision: quality.revision }, {
      kind: 'criterion',
      criterion: { id: 'REQ-1', text: 'Service starts', tier: 'requested', mandatory: true, status: 'verified', evidence: ['x'] },
    })
    quality = ledger.record(agent, { id: quality.id, revision: quality.revision }, {
      kind: 'innovation', innovation: { status: 'not-applicable', rationale: 'No extra.' },
    })

    expect(qualityReadiness(quality).ready).toBe(true)
    expect(() => ctx.goals.complete(agent, { id: goal.id, revision: goal.revision }))
      .toThrow(GoalError)
  })
})
