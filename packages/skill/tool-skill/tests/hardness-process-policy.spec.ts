import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import ToolRuntime, { defineContentToolFixture } from '@phoenix-ai/dsh-tools'
import AgentRegistry, { agentEvents, Inbox, type Agent } from '@phoenix-ai/dsh-agent'
import SkillRegistry from '@phoenix-ai/dsh-skill'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import * as toolSkill from '../src/index.ts'

function testAgent(): Agent {
  const id = SessionId('hardness-process-policy')
  const session = Session.create(id, [], { version: 0, id, createdAt: 0, cwd: '/workspace' })
  return {
    ctx: new Context(),
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

describe('skill catalog HARDNESS process policy', () => {
  it('defers process methodology to visible HARDNESS while keeping domain skills task-driven', async () => {
    const ctx = new Context()
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(toolSkill)
    ctx.tools.register(defineContentToolFixture({
      name: 'hardness_workflow',
      description: 'Select HARDNESS workflow.',
      parameters: {},
      async execute() {
        return [{ type: 'text', text: 'selected' }]
      },
    }))
    ctx.skills.register({
      name: 'brainstorming',
      description: 'Process skill for design work.',
      source: 'runtime',
      content: 'process',
    })
    ctx.skills.register({
      name: 'frontend-testing',
      description: 'Domain skill for browser UI verification.',
      source: 'runtime',
      content: 'domain',
    })

    const agent = testAgent()
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )
    if (decision.kind === 'reject') throw new Error('expected skill catalog')
    const catalog = decision.messages.find(message => message.source.kind === 'skill-catalog')
    const text = catalog?.content.find(block => block.type === 'text')?.text ?? ''

    expect(text).toContain('hardness_workflow')
    expect(text).toContain('process or methodology skills')
    expect(text).toContain('selected HARDNESS flows')
    expect(text).toContain('Domain skills')
    expect(text).toContain('Do not preload')
  })
})
