import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import AgentLoop from '@phoenix-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@phoenix-ai/dsh-agent-loop-testkit'
import { CallId, createUserMessage } from '@phoenix-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@phoenix-ai/dsh-session'
import { defineContentToolFixture } from '@phoenix-ai/dsh-tools'
import * as QualityPolicy from '@phoenix-ai/dsh-quality-policy'
import { classifyQualityActivity, inferQualityDomains } from '@phoenix-ai/dsh-quality-policy'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: current, status }) => {
      if (current === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function notices(agent: Agent): string[] {
  return [...agent.session.events]
    .filter((event): event is SessionEvent<'user/message'> =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'quality-policy')
    .map(event => event.data.content
      .map(block => block.type === 'text' ? block.text : '')
      .join(''))
}

async function harness(maxStopNudges = 1): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(QualityPolicy, { maxStopNudges })
  ctx.tools.register(defineContentToolFixture({
    name: 'write',
    description: 'write fixture',
    parameters: { path: { type: 'string', required: true } },
    async execute() { return [{ type: 'text' as const, text: 'written' }] },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'read',
    description: 'read fixture',
    parameters: { path: { type: 'string', required: true } },
    async execute() { return [{ type: 'text' as const, text: 'read' }] },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'verify',
    description: 'verify fixture',
    parameters: {},
    async execute() { return [{ type: 'text' as const, text: 'verified' }] },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'probe',
    description: 'probe fixture',
    parameters: {},
    async execute() { return [{ type: 'text' as const, text: 'ok' }] },
  }))
  return ctx
}

describe('classification', () => {
  it('classifies named and shell activity', () => {
    expect(classifyQualityActivity('write', { path: 'a.ts' })).toBe('mutation')
    expect(classifyQualityActivity('verify_ci', {})).toBe('verification')
    expect(classifyQualityActivity('read', { path: 'README.md' })).toBe('inspection')
    expect(classifyQualityActivity('probe', {})).toBe('other')
    expect(classifyQualityActivity('bash', { command: 'pnpm run test' })).toBe('verification')
    expect(classifyQualityActivity('bash', { command: 'rm -rf dist' })).toBe('mutation')
    expect(classifyQualityActivity('run_code', { code: 'return 1' })).toBe('other')
  })

  it('infers supported domains and generic fallback', () => {
    expect(inferQualityDomains({ path: 'src/App.tsx' })).toEqual(['web', 'code'])
    expect(inferQualityDomains({ path: 'README.md' })).toEqual(['docs'])
    expect(inferQualityDomains({ path: 'data/report.csv' })).toEqual(['data'])
    expect(inferQualityDomains({ path: 'config/app.yaml' })).toEqual(['config'])
    expect(inferQualityDomains({ value: 1 })).toEqual(['generic'])
  })
})

describe('quality-policy evidence freshness', () => {
  it('adds one in-band mutation reminder and accepts later automated verification', async () => {
    const ctx = await harness()
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('w1', 'write', { path: 'src/a.ts' }),
      toolCallResponse('v1', 'verify', {}),
      textResponse('done'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('verified'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = notices(agent)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('verification evidence is now stale')
    expect(found[0]).toContain('focused automated check')
  })

  it('steers exactly once when code mutation reaches stop without fresh automated verification', async () => {
    const ctx = await harness()
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('w1', 'write', { path: 'src/a.ts' }),
      textResponse('premature done'),
      textResponse('final done'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('nudged'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = notices(agent)
    expect(found).toHaveLength(2)
    expect(found[1]).toContain('successful mutations after its latest accepted verification')
  })

  it('does not treat inspection as sufficient for code, but it is sufficient for docs', async () => {
    const codeCtx = await harness()
    codeCtx.llm.registerAdapter(['mock-code'], new MockAdapter([
      toolCallResponse('w1', 'write', { path: 'src/a.ts' }),
      toolCallResponse('r1', 'read', { path: 'src/a.ts' }),
      textResponse('done'),
      textResponse('after nudge'),
    ]))
    const codeAgent = codeCtx.agentLoop.create(SessionId('code'), { provider: 'mock-code', model: 'mock' })
    codeAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(codeCtx, codeAgent)
    expect(notices(codeAgent)).toHaveLength(2)

    const docsCtx = await harness()
    docsCtx.llm.registerAdapter(['mock-docs'], new MockAdapter([
      toolCallResponse('w1', 'write', { path: 'README.md' }),
      toolCallResponse('r1', 'read', { path: 'README.md' }),
      textResponse('done'),
    ]))
    const docsAgent = docsCtx.agentLoop.create(SessionId('docs'), { provider: 'mock-docs', model: 'mock' })
    docsAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(docsCtx, docsAgent)
    expect(notices(docsAgent)).toHaveLength(1)
  })

  it('invalidates evidence after a later mutation without duplicate dirty reminders', async () => {
    const ctx = await harness()
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('w1', 'write', { path: 'src/a.ts' }),
      toolCallResponse('w2', 'write', { path: 'src/b.ts' }),
      toolCallResponse('v1', 'verify', {}),
      toolCallResponse('w3', 'write', { path: 'src/c.ts' }),
      toolCallResponse('v2', 'verify', {}),
      textResponse('done'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('generations'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(notices(agent).filter(text => text.includes('verification evidence is now stale'))).toHaveLength(2)
  })

  it('ignores failed mutation, blocked verification, direct calls, and unrelated tools', async () => {
    const ctx = await harness(0)
    ctx.tools.register(defineContentToolFixture({
      name: 'update_file',
      description: 'fails',
      parameters: {},
      async execute() { throw new Error('no write') },
    }))
    const direct = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('direct'),
      name: 'write',
      arguments: { path: 'src/direct.ts' },
    })
    expect(direct.isError).toBe(false)

    let blockVerify = true
    ctx.on('tools/post-execute', async (exec, _result, next) => {
      if (exec.name === 'verify' && blockVerify) {
        blockVerify = false
        return { kind: 'block' as const, feedback: [{ type: 'text' as const, text: 'blocked' }] }
      }
      return next()
    })

    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('u1', 'update_file', {}),
      toolCallResponse('p1', 'probe', {}),
      toolCallResponse('w1', 'write', { path: 'src/a.ts' }),
      toolCallResponse('v1', 'verify', {}),
      toolCallResponse('v2', 'verify', {}),
      textResponse('done'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('failure-cases'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(notices(agent)).toHaveLength(1)
  })

  it('resets task-local evidence on a new direct user prompt', async () => {
    const ctx = await harness(1)
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('w1', 'write', { path: 'src/a.ts' }),
      textResponse('done one'),
      textResponse('after nudge one'),
      toolCallResponse('w2', 'write', { path: 'README.md' }),
      textResponse('done two'),
      textResponse('after nudge two'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('reset'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(notices(agent).filter(text => text.includes('successful mutations'))).toHaveLength(2)
  })

  it('invalid direct construction config fails loud', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(QualityPolicy, { maxStopNudges: 4 })).rejects.toThrow(/0 through 3/)
  })
})
