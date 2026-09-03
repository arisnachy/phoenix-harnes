import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AgentRegistry, { Inbox } from '@phoenix-ai/dsh-agent'
import type { Agent } from '@phoenix-ai/dsh-agent'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import GoalService from '@phoenix-ai/dsh-goal'

const LEGACY_UNAVAILABLE_SUMMARY
  = 'Independent verification is not ready yet; the mission remains active and will continue automatically.'

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(GoalService)
  const session = ctx.sessions.create(SessionId(`legacy-judge-${Math.random()}`))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  const agent: Agent = {
    id: session.id,
    options: { provider: 'openrouter', model: 'qwen/qwen3-coder' },
    session,
    inbox,
    ctx: new Context(),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: message => { inbox.append('next-step', message) },
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return { ctx, agent, session }
}

describe('legacy unavailable goal judge recovery', () => {
  it('does not let the old synthetic unavailable row mask an earlier real PASS for the exact revision', async () => {
    const { ctx, agent, session } = await harness()
    const goal = ctx.goals.create(agent, { objective: 'Finish and verify the deliverable' })

    session.append('goal/judge', {
      callId: 'real-pass' as never,
      goalId: goal.id,
      revision: goal.revision,
      round: 2,
      verdict: 'pass',
      summary: 'Independent evidence covers the full objective.',
      findings: [],
      requiredChanges: [],
    })
    session.append('goal/judge', {
      callId: 'legacy-provider-miss' as never,
      goalId: goal.id,
      revision: goal.revision,
      round: 2,
      verdict: 'blocked',
      summary: LEGACY_UNAVAILABLE_SUMMARY,
      findings: [],
      requiredChanges: [],
    })

    expect(() => ctx.goals.complete(agent, goal)).not.toThrow()
    expect(ctx.goals.get(agent)).toMatchObject({ phase: 'complete' })
  })
})
