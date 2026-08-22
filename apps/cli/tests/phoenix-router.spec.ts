import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import * as PhoenixRouter from '../src/phoenix-router.ts'
import {
  classifyTask,
  DEFAULT_EXTERNAL_SIGNALS,
  FORCE_FREE_PREFIX,
  FORCE_LOCAL_PREFIX,
} from '../src/phoenix-router.ts'
import { MockAdapter, textResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'

const policy = {
  externalMinChars: 80,
  externalSignalThreshold: 1,
  externalSignals: DEFAULT_EXTERNAL_SIGNALS,
}

describe('classifyTask()', () => {
  it('keeps routine work local and promotes length or a configured signal', () => {
    expect(classifyTask('rename this variable', policy)).toMatchObject({ lane: 'local', reason: 'default-local' })
    expect(classifyTask('x'.repeat(80), policy)).toMatchObject({ lane: 'free', reason: 'length' })
    expect(classifyTask('Review the architecture boundary.', policy)).toMatchObject({
      lane: 'free',
      reason: 'signals',
      matchedSignals: ['architecture'],
    })
  })

  it('gives explicit prefixes precedence over every heuristic', () => {
    expect(classifyTask(`${FORCE_LOCAL_PREFIX} architecture ${'x'.repeat(100)}`, policy))
      .toMatchObject({ lane: 'local', reason: 'forced-local' })
    expect(classifyTask(`${FORCE_FREE_PREFIX} hello`, policy))
      .toMatchObject({ lane: 'free', reason: 'forced-free' })
  })

  it('counts each normalized signal once', () => {
    expect(classifyTask('ARCHITECTURE architecture', { ...policy, externalSignalThreshold: 2 }))
      .toMatchObject({ lane: 'local', matchedSignals: ['architecture'] })
  })
})

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

async function harness(options: { freeFails?: boolean } = {}): Promise<{
  ctx: Context
  local: MockAdapter
  free: MockAdapter
  agent: Agent
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { persona: 'PHOENIX is running {{model}}.' },
  })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(PhoenixRouter, {
    local: { provider: 'phoenix-local', model: 'qwen3:8b' },
    free: { provider: 'phoenix-free', model: 'orcarouter/free' },
    externalMinChars: 80,
    externalSignalThreshold: 1,
    externalSignals: [...DEFAULT_EXTERNAL_SIGNALS],
  })
  const local = new MockAdapter([textResponse('local')])
  const free = new MockAdapter(options.freeFails === true ? [] : [textResponse('free')])
  ctx.llm.registerAdapter(['phoenix-local'], local)
  ctx.llm.registerAdapter(['phoenix-free'], free)
  const agent = ctx.agentLoop.create(SessionId('phoenix-routing'), {
    provider: 'seed',
    model: 'seed',
  })
  return { ctx, local, free, agent }
}

describe('PHOENIX router Agent composition', () => {
  it('routes before prompt assembly so persona, request header, and adapter agree', async () => {
    const { ctx, local, free, agent } = await harness()
    const idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Perform an architecture review.' }],
      source: { kind: 'user' },
    }))
    await idle

    expect(local.requests).toHaveLength(0)
    expect(free.requests).toHaveLength(1)
    expect(free.requests[0]).toMatchObject({
      provider: 'phoenix-free',
      model: 'orcarouter/free',
    })
    expect(free.requests[0]?.system).toContain('PHOENIX is running orcarouter/free.')
    const header = agent.session.events.find(event => event.type === 'request/header')
    expect(header).toMatchObject({
      type: 'request/header',
      data: {
        header: { config: { provider: 'phoenix-free', model: 'orcarouter/free' } },
      },
    })
  })

  it('routes a routine task locally even when the Agent seed names another model', async () => {
    const { ctx, local, free, agent } = await harness()
    const idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Rename this variable.' }],
      source: { kind: 'user' },
    }))
    await idle

    expect(free.requests).toHaveLength(0)
    expect(local.requests).toHaveLength(1)
    expect(local.requests[0]).toMatchObject({
      provider: 'phoenix-local',
      model: 'qwen3:8b',
    })
    expect(local.requests[0]?.system).toContain('PHOENIX is running qwen3:8b.')
  })

  it('fails closed on a free-lane error without attempting the local route', async () => {
    const { ctx, local, free, agent } = await harness({ freeFails: true })
    const idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: `${FORCE_FREE_PREFIX} Verify the failure boundary.` }],
      source: { kind: 'user' },
    }))
    await idle

    expect(free.requests.length).toBeGreaterThan(0)
    expect(free.requests.every(request => request.provider === 'phoenix-free'
      && request.model === 'orcarouter/free')).toBe(true)
    expect(local.requests).toHaveLength(0)
  })

  it('fails loud when every configured signal is blank', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await expect(ctx.plugin(PhoenixRouter, {
      local: { provider: 'local', model: 'local' },
      free: { provider: 'free', model: 'free' },
      externalSignals: [' ', ''],
    })).rejects.toThrow('must contain at least one non-empty signal')
  })

  it('covers existing agents, relay tasks, ignored notices, and idempotent lifecycle events', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx, {
      systemPrompt: { persona: 'PHOENIX is running {{model}}.' },
    })
    await ctx.plugin(AgentLoop, { agents: [] })
    const free = new MockAdapter([textResponse('free relay')])
    ctx.llm.registerAdapter(['phoenix-free'], free)
    const agent = ctx.agentLoop.create(SessionId('phoenix-existing'), {
      provider: 'seed',
      model: 'seed',
    })

    // Mount after creation: apply() must install the selection from agents.list().
    await ctx.plugin(PhoenixRouter, {
      local: { provider: 'phoenix-local', model: 'qwen3:8b' },
      free: { provider: 'phoenix-free', model: 'orcarouter/free' },
      externalMinChars: 80,
      externalSignalThreshold: 1,
      externalSignals: [...DEFAULT_EXTERNAL_SIGNALS],
    })
    // A repeated lifecycle notification must not install a second listener.
    agentEvents(ctx, agent).emit('agent/created', { agent })
    agent.inject(createUserMessage({
      content: [{ type: 'text', text: 'ordinary plugin notice' }],
      source: { kind: 'plugin', plugin: 'fixture', form: 'notice', summary: 'fixture' },
    }))
    const idle = waitForIdle(ctx, agent)
    agent.send(createUserMessage({
      content: [
        { type: 'reasoning', text: 'non-text block is ignored by task extraction' },
        { type: 'text', text: 'Architecture relay' },
      ],
      source: { kind: 'plugin', plugin: 'fixture', form: 'relay' },
    }), 'next-turn', true)
    await idle
    expect(free.requests).toHaveLength(1)

    // Package cleanup is idempotent, and an event after cleanup cannot mutate
    // a selection that the package no longer owns.
    agentEvents(ctx, agent).emit('agent/disposed', { agent })
    agentEvents(ctx, agent).emit('agent/disposed', { agent })
    agentEvents(ctx, agent).emit('agent/inbox/claimed', {
      message: createUserMessage({
        content: [{ type: 'text', text: 'architecture' }],
        source: { kind: 'user' },
      }),
      turn: 2,
    })
  })
})
