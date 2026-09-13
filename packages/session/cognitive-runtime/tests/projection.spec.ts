import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AgentRegistry, { agentEvents, Inbox, type Agent } from '@phoenix-ai/dsh-agent'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import LearningMemoryService from '@phoenix-ai/dsh-session-learning'
import CognitiveRuntime from '../src/index.ts'

const roots: string[] = []
const SIGNAL = new AbortController().signal

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function sessionAgent(ctx: Context, id: SessionId): Agent {
  const session = ctx.sessions.get(id)
  if (session === undefined) throw new Error('missing cognitive projection test session')
  return {
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('cognitive-runtime must append through pre-step') },
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function fire(ctx: Context, agent: Agent) {
  const proposed = createUserMessage({
    content: [{ type: 'text', text: 'request proposal' }],
    source: { kind: 'plugin', plugin: 'cognitive-runtime-test' },
  })
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [proposed], turn: 1, step: 1, signal: SIGNAL },
    () => Promise.resolve({ kind: 'enter' as const, messages: [proposed] }),
  )
}

describe('model-facing cognitive projection', () => {
  it('injects the active workspace once and keeps the snapshot durable/deduplicated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-cognitive-projection-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    await ctx.plugin(CognitiveRuntime, {
      maxCandidates: 64,
      activeLimit: 8,
      backgroundLimit: 16,
      weights: {
        importance: 1,
        confidence: 1,
        recency: 1,
        urgency: 1,
        goalRelevance: 1,
        novelty: 1,
      },
    })

    const id = SessionId('cognitive-projection-session')
    const session = ctx.sessions.create(id, { meta: { cwd: 'C:\\workspace\\phoenix' } })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Complete the OAuth mission and verify it before declaring done.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await ctx.learningMemory.ready()
    await ctx.cognitiveRuntime.ready()

    const agent = sessionAgent(ctx, id)
    const first = await fire(ctx, agent)
    expect(first.kind).toBe('enter')
    if (first.kind !== 'enter') throw new Error('cognitive pre-step was rejected')
    expect(first.messages).toHaveLength(2)
    const snapshot = first.messages[1]
    expect(snapshot?.source).toMatchObject({
      kind: 'plugin',
      plugin: 'cognitive-runtime',
      form: 'snapshot',
    })
    expect(snapshot?.content.find(block => block.type === 'text')?.text).toContain('<phoenix_cognitive_workspace>')
    if (snapshot === undefined) throw new Error('missing cognitive snapshot')
    session.append('user/message', snapshot, { surfaceOp: 'append' })
    await ctx.learningMemory.ready()
    await ctx.cognitiveRuntime.ready()

    const second = await fire(ctx, agent)
    expect(second.kind).toBe('enter')
    if (second.kind !== 'enter') throw new Error('second cognitive pre-step was rejected')
    expect(second.messages).toHaveLength(1)
  })
})
