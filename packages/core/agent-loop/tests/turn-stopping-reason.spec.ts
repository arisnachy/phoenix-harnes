import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AgentLoop from '@phoenix-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@phoenix-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter } from '@phoenix-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@phoenix-ai/dsh-llm'
import { SessionId } from '@phoenix-ai/dsh-session'

class ScriptedAdapter extends LlmAdapter {
  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  override async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const chunks = this.script.shift()
    if (chunks === undefined) throw new Error('ScriptedAdapter: script exhausted')
    for (const chunk of chunks) yield chunk
  }
}

function response(text: string, kind: 'stop' | 'max-tokens'): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind } },
  ]
}

const contexts: Context[] = []
afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('agent turn-stopping reason', () => {
  it('publishes completed and max-tokens as distinct attempt boundaries', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['mock'], new ScriptedAdapter([
      response('first result', 'stop'),
      response('second result', 'max-tokens'),
    ]))
    const agent = ctx.agentLoop.create(SessionId(`turn-stopping-reason-${Math.random()}`), {
      provider: 'mock',
      model: 'mock',
    })
    const reasons: Array<'completed' | 'max-tokens' | undefined> = []
    ctx.on('agent/turn-stopping', ({ agent: subject, reason }) => {
      if (subject === agent) reasons.push(reason?.kind)
    })

    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'first' }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'second' }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()

    expect(reasons).toEqual(['completed', 'max-tokens'])
  })
})
