import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import AgentLoop from '@phoenix-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@phoenix-ai/dsh-agent-loop-testkit'
import GoalService from '@phoenix-ai/dsh-goal'
import { CallId, createUserMessage, LlmAdapter } from '@phoenix-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@phoenix-ai/dsh-llm'
import { SessionId } from '@phoenix-ai/dsh-session'
import { defineContentToolFixture } from '@phoenix-ai/dsh-tools'
import * as goalSession from '../src/index.ts'

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const chunks = this.script.shift()
    if (chunks === undefined) throw new Error('ScriptedAdapter: script exhausted')
    for (const chunk of chunks) yield chunk
  }
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallResponse(rawCallId: string, name: string, args: object): StreamChunk[] {
  const callId = CallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(context => context.fiber.dispose()))
})

async function harness(script: StreamChunk[][]): Promise<{ ctx: Context; agent: Agent; adapter: ScriptedAdapter }> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(GoalService)
  await ctx.plugin(goalSession)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'patch_profile',
    description: 'Apply a safe profile patch.',
    parameters: {},
    async execute() {
      return [{ type: 'text', text: 'profile patch prepared' }]
    },
  }))
  const agent = ctx.agentLoop.create(SessionId(`mission-debt-${Math.random()}`), {
    provider: 'mock',
    model: 'mock',
  })
  return { ctx, agent, adapter }
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

describe('mission debt stop fence', () => {
  it('converts a Hostinger-style pending handoff into a persistent goal before the turn can settle', async () => {
    const test = await harness([
      toolCallResponse('patch-1', 'patch_profile', {}),
      textResponse('Parche preparado.\n\n**Pendiente:** copiarlo al perfil, configurar la variable y verificar el buzón.'),
    ])
    test.ctx.on('goal/changed', ({ agent, change }) => {
      if (agent === test.agent && change.operation === 'create') test.ctx.goals.disarm(agent)
    })

    send(test.agent, 'Configura Hostinger y verifica el buzón')
    await test.agent.whenIdle()

    expect(test.adapter.requests).toHaveLength(2)
    expect(test.ctx.goals.get(test.agent)).toMatchObject({
      objective: 'Configura Hostinger y verifica el buzón',
      phase: 'active',
      activation: 'disarmed',
      roundsStarted: 0,
    })
    expect(test.agent.session.events.some(event => event.type === 'tool/call')).toBe(true)
  })

  it('allows verified executable work to end normally when the final response carries no debt', async () => {
    const test = await harness([
      toolCallResponse('patch-2', 'patch_profile', {}),
      textResponse('Listo. El perfil quedó aplicado y verificado. No hay nada pendiente.'),
    ])

    send(test.agent, 'Aplica y verifica el parche')
    await test.agent.whenIdle()
    await vi.waitFor(() => expect(test.agent.status).toBe('idle'))

    expect(test.adapter.requests).toHaveLength(2)
    expect(test.ctx.goals.get(test.agent)).toBeUndefined()
  })
})
