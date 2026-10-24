import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import AgentLoop from '@phoenix-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@phoenix-ai/dsh-agent-loop-testkit'
import GoalService from '@phoenix-ai/dsh-goal'
import type { GoalView } from '@phoenix-ai/dsh-goal'
import { LlmAdapter, LlmError, QUOTA_EXCEEDED_CODE } from '@phoenix-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@phoenix-ai/dsh-llm'
import { SessionId } from '@phoenix-ai/dsh-session'
import * as goalDriver from '../src/index.ts'
import { quotaResumeTarget } from '../src/quota-resume.ts'

class QuotaAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly quotaMessage = 'The usage limit has been reached') { super() }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.requests.length === 1) {
      throw new LlmError(this.quotaMessage, QUOTA_EXCEEDED_CODE)
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'unexpected retry' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(context => context.fiber.dispose()))
})

async function harness(quotaMessage?: string): Promise<{ ctx: Context; agent: Agent; adapter: QuotaAdapter }> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(GoalService)
  await ctx.plugin(goalDriver)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new QuotaAdapter(quotaMessage)
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = ctx.agentLoop.create(SessionId(`quota-goal-${Math.random()}`), {
    provider: 'mock',
    model: 'mock',
  })
  return { ctx, agent, adapter }
}

async function waitForGoal(
  ctx: Context,
  agent: Agent,
  predicate: (goal: GoalView | undefined) => boolean,
): Promise<GoalView | undefined> {
  await vi.waitFor(() => {
    expect(predicate(ctx.goals.get(agent))).toBe(true)
  })
  return ctx.goals.get(agent)
}

describe('terminal provider quota handling', () => {
  it('recognizes only the canonical quota error as terminal for automatic goal continuation', () => {
    expect(goalDriver.isTerminalGoalQuota(new LlmError('limit', QUOTA_EXCEEDED_CODE))).toBe(true)
    expect(goalDriver.isTerminalGoalQuota(new LlmError('slow down', 'RATE_LIMIT'))).toBe(false)
    expect(goalDriver.isTerminalGoalQuota(new Error('limit'))).toBe(false)
  })

  it('preserves a provider-stated 239 minute recovery target without retrying immediately', async () => {
    const realNow = Date.now()
    const test = await harness('You have hit your ChatGPT usage limit (plus plan). Try again in ~239 min.')
    test.ctx.goals.create(test.agent, { objective: 'resume editorial research after quota', maxGoalRounds: 4 })
    const goal = await waitForGoal(test.ctx, test.agent, current => current?.phase === 'blocked')
    await test.agent.whenIdle()
    const expected = new Date(realNow + 239 * 60_000 + 30_000).getTime()
    const actual = quotaResumeTarget(goal?.blockedReason?.message ?? '')
    expect(actual).toBeDefined()
    expect(Math.abs(actual! - expected)).toBeLessThan(15_000)
    expect(goal?.phase).toBe('blocked')
    expect(test.adapter.requests).toHaveLength(1)
  })

  it('blocks the active goal after one quota failure and never injects another round', async () => {
    const test = await harness()
    test.ctx.goals.create(test.agent, {
      objective: 'finish without looping on exhausted quota',
      maxGoalRounds: 4,
    })

    const goal = await waitForGoal(test.ctx, test.agent, current => current?.phase === 'blocked')
    await test.agent.whenIdle()

    expect(goal).toMatchObject({ phase: 'blocked', activation: 'disarmed', roundsStarted: 1 })
    expect(goal?.blockedReason).toEqual({
      code: 'provider-quota-exhausted',
      message: 'Automatic continuation stopped because the model provider quota is exhausted: The usage limit has been reached',
    })
    expect(test.adapter.requests).toHaveLength(1)
    expect(test.agent.session.events.filter(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'goal'
      && event.data.source.round > 0)).toHaveLength(1)
  })
})
