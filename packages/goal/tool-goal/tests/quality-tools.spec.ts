import { describe, expect, test } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AgentRegistry, { Inbox } from '@phoenix-ai/dsh-agent'
import type { Agent } from '@phoenix-ai/dsh-agent'
import GoalService from '@phoenix-ai/dsh-goal'
import { createUserMessage, CallId } from '@phoenix-ai/dsh-llm'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRuntime from '@phoenix-ai/dsh-tools'
import { registerQualityTools } from '../src/quality-tools.ts'

const signal = new AbortController().signal

function stubAgent(rawId: string): Agent {
  const session = Session.create(SessionId(rawId))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  return {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    status: 'running',
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject(input) { inbox.append('next-step', input) },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
}

function openHumanTurn(agent: Agent): void {
  const message = createUserMessage({ content: [{ type: 'text', text: 'Build it' }], source: { kind: 'user' } })
  agent.inbox.append('next-turn', message)
  const claimed = agent.inbox.claim('next-turn', 1)
  agent.session.append('turn/start', { turn: 1 })
  for (const item of claimed) agent.session.append('user/message', item, { surfaceOp: 'append' })
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(GoalService)
  registerQualityTools(ctx)
  const agent = stubAgent(`quality-tool-${Math.random()}`)
  ctx.agents.register(agent)
  openHumanTurn(agent)
  return { ctx, agent }
}

async function execute(ctx: Context, agent: Agent, name: string, args: unknown) {
  return ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    signal,
    callId: CallId(`quality-${Math.random()}`),
    name,
    arguments: args,
    agent,
  }))
}

function value(result: Awaited<ReturnType<typeof execute>>): Record<string, unknown> {
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected quality tool success')
  return result.value as Record<string, unknown>
}

describe('quality model tools', () => {
  test('registers quality tools and standing evidence/foresight policy', async () => {
    const { ctx } = await harness()
    expect(ctx.tools.get('quality_get')?.name).toBe('quality_get')
    expect(ctx.tools.get('quality_record')?.name).toBe('quality_record')

    const assembly = await ctx.systemPrompt.assemble()
    const quality = assembly.sections.find(section => section.name === 'tool:quality')?.text ?? ''
    expect(quality).toContain('static')
    expect(quality).toContain('simulated')
    expect(quality).toContain('live')
    expect(quality).toContain('hypotheses')
    expect(quality).toContain('Innovation')
    expect(quality).toContain('never substitute')
  })

  test('starts and reads a durable substantial quality assessment', async () => {
    const { ctx, agent } = await harness()
    const started = value(await execute(ctx, agent, 'quality_record', {
      action: 'start',
      task_class: 'substantial',
      objective: 'Ship a resilient service',
    }))
    const assessment = started.assessment as Record<string, unknown>
    expect(assessment.taskClass).toBe('substantial')
    expect(assessment.revision).toBe(1)

    const read = value(await execute(ctx, agent, 'quality_get', {}))
    expect((read.assessment as Record<string, unknown>).id).toBe(assessment.id)
  })
})
