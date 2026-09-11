import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import AgentLoop from '@phoenix-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@phoenix-ai/dsh-agent-loop-testkit'
import GoalService from '@phoenix-ai/dsh-goal'
import { LlmAdapter } from '@phoenix-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@phoenix-ai/dsh-llm'
import { SessionId } from '@phoenix-ai/dsh-session'
import * as goalDriver from '../src/index.ts'

type ScriptEntry = StreamChunk[] | 'hang'

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: ScriptEntry[]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptedAdapter: script exhausted')
    if (entry === 'hang') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial before stall' }
      await new Promise<void>((_resolve, reject) => {
        if (options.signal?.aborted) {
          reject(new Error('aborted'))
          return
        }
        options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      })
      return
    }
    for (const chunk of entry) yield chunk
  }
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(context => context.fiber.dispose()))
})

async function harness(script: ScriptEntry[], stallTimeoutMs: number): Promise<{
  ctx: Context
  agent: Agent
  adapter: ScriptedAdapter
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(GoalService)
  await ctx.plugin(goalDriver, { stallTimeoutMs })
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = ctx.agentLoop.create(SessionId(`goal-watchdog-${Math.random()}`), {
    provider: 'mock',
    model: 'mock',
  })
  return { ctx, agent, adapter }
}

async function waitForRequests(adapter: ScriptedAdapter, count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(adapter.requests).toHaveLength(count)
  }, { timeout: 2_000 })
}

function stopAfterContinuation(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const stop = ctx.on('session/event', (session, event) => {
      if (session !== agent.session || event.type !== 'goal/continuation') return
      stop()
      const current = ctx.goals.get(agent)
      if (current?.phase === 'active' && current.activation === 'armed') ctx.goals.disarm(agent)
      resolve()
    })
  })
}

describe('goal supervisor inactivity watchdog', () => {
  it('cancels a stalled admitted round and automatically continues instead of pausing the mission', async () => {
    const test = await harness(['hang', textResponse('recovered after watchdog')], 25)
    const continued = stopAfterContinuation(test.ctx, test.agent)
    test.ctx.goals.create(test.agent, { objective: 'finish despite a hung worker', maxGoalRounds: 2 })

    await waitForRequests(test.adapter, 2)
    await continued
    await test.agent.whenIdle()

    expect(test.adapter.requests).toHaveLength(2)
    expect(test.agent.session.events.some(event => event.type === 'goal/change'
      && event.data.operation === 'pause')).toBe(false)
    expect(test.agent.session.events.some(event => event.type === 'goal/supervisor'
      && event.data.status === 'retrying'
      && event.data.nextAction === 'continue'
      && event.data.lastError?.includes('stalled'))).toBe(true)
  })
})
