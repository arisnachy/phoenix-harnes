import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AgentRegistry, { agentEvents, Inbox } from '@phoenix-ai/dsh-agent'
import type { Agent, AgentStatus } from '@phoenix-ai/dsh-agent'
import GoalService from '@phoenix-ai/dsh-goal'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRuntime from '@phoenix-ai/dsh-tools'
import * as toolGoal from '@phoenix-ai/dsh-tool-goal'

interface StubAgent {
  readonly agent: Agent
  readonly session: Session
  setStatus(status: AgentStatus): void
}

function stubAgent(rawId: string): StubAgent {
  const session = Session.create(SessionId(rawId))
  let status: AgentStatus = 'running'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    get status() { return status },
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { this.inbox.append('next-step', input) },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session, setStatus(value) { status = value } }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(GoalService)
  await ctx.plugin(toolGoal, { requireJudge: true })
  const root = stubAgent(`automatic-supervisor-${Math.random()}`)
  ctx.agents.register(root.agent)
  return { ctx, root }
}

function openGoalRound(root: StubAgent, goal: NonNullable<ReturnType<GoalService['get']>>): number {
  const turn = 1
  const message = createUserMessage({
    content: [{ type: 'text', text: 'Execute the mission and verify the result.' }],
    source: { kind: 'goal', goalId: goal.id, revision: goal.revision, round: 1 },
  })
  root.session.append('turn/start', { turn })
  root.session.append('user/message', message, { surfaceOp: 'append' })
  return turn
}

describe('automatic mission supervisor', () => {
  it('reviews a completed autonomous goal round even when the executor never calls complete', async () => {
    const { ctx, root } = await harness()
    const created = ctx.goals.create(root.agent, { objective: 'Deliver a verified high-quality artifact' })
    const turn = openGoalRound(root, created)

    await agentEvents(ctx, root.agent).serial('agent/turn-stopping', {
      turn,
      reason: { kind: 'completed' },
      signal: new AbortController().signal,
    })

    const review = root.session.events.findLast(event => event.type === 'goal/judge')
    expect(review?.data).toMatchObject({
      goalId: created.id,
      revision: created.revision,
      round: 1,
      verdict: 'blocked',
    })
    expect(ctx.goals.get(root.agent)).toMatchObject({
      id: created.id,
      revision: created.revision,
      phase: 'active',
      roundsStarted: 1,
      activation: 'armed',
    })
  })

  it('does not review max-token attempt boundaries as candidate completion', async () => {
    const { ctx, root } = await harness()
    const created = ctx.goals.create(root.agent, { objective: 'Keep working past token boundaries' })
    const turn = openGoalRound(root, created)

    await agentEvents(ctx, root.agent).serial('agent/turn-stopping', {
      turn,
      reason: { kind: 'max-tokens' },
      signal: new AbortController().signal,
    })

    expect(root.session.events.some(event => event.type === 'goal/judge')).toBe(false)
    expect(ctx.goals.get(root.agent)?.phase).toBe('active')
  })
})
