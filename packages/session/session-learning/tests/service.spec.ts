import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import { CallId, createToolResultMessage, createUserMessage } from '@phoenix-ai/dsh-llm'
import LearningMemoryService from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('LearningMemoryService', () => {
  it('learns from user interactions, successes, and failures in the durable session stream', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-service-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    const session = ctx.sessions.create(SessionId('learning-session'), { meta: {} })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Remember that I prefer concise answers.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/end', { turn: 2, reason: { kind: 'error', error: { message: 'sandbox failed', code: 'TIMEOUT' } } })
    session.append('tool/result', {
      turn: 3,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('call-success'),
        content: [{ type: 'text', text: 'created the requested artifact' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/result', {
      turn: 3,
      step: 2,
      message: createToolResultMessage({
        callId: CallId('call-failure'),
        content: [{ type: 'text', text: 'sandbox timed out' }],
        isError: true,
      }),
    }, { surfaceOp: 'append' })
    ctx.emit('agent/error', {
      agent: { id: 'agent-1', session } as never,
      turn: 2,
      step: 1,
      error: new Error('provider disconnected'),
    })

    await ctx.learningMemory.ready()
    expect((await ctx.learningMemory.search('concise'))[0]?.kind).toBe('preference')
    expect((await ctx.learningMemory.search('completed'))[0]?.kind).toBe('success')
    expect((await ctx.learningMemory.search('sandbox failed'))[0]?.kind).toBe('error')
    expect((await ctx.learningMemory.search('provider disconnected'))[0]?.kind).toBe('error')
    expect((await ctx.learningMemory.search('created requested artifact'))[0]?.kind).toBe('success')
    expect((await ctx.learningMemory.search('sandbox timed out'))[0]?.kind).toBe('error')
  })

  it('accepts explicit lessons and removes credentials before persistence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-explicit-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    const session = ctx.sessions.create(SessionId('explicit-learning-session'), { meta: {} })

    await ctx.learningMemory.remember({
      sessionId: String(session.id),
      eventSeq: session.seq,
      kind: 'preference',
      summary: 'The user prefers short status updates with api_key=do-not-store.',
      sourceEventType: 'memory/explicit',
      confidence: 0.95,
      occurredAt: Date.now(),
    })

    const result = (await ctx.learningMemory.search('short status updates'))[0]
    expect(result?.kind).toBe('preference')
    expect(result?.summary).not.toContain('do-not-store')
    expect(result?.summary).toContain('[redacted]')
  })

  it('promotes durable user signals to preference memory without an explicit remember tool call', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-important-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    const session = ctx.sessions.create(SessionId('important-learning-session'), { meta: {} })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Esto es importante: siempre usa el sandbox para ejecutar código.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    await ctx.learningMemory.ready()
    const result = (await ctx.learningMemory.search('sandbox ejecutar código'))[0]
    expect(result?.kind).toBe('preference')
    expect(result?.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('remembers stable user facts without requiring an explicit remember phrase', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-stable-fact-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    const session = ctx.sessions.create(SessionId('stable-fact-session'), { meta: {} })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Mi nombre es Aris y estoy trabajando en Phoenix.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    await ctx.learningMemory.ready()
    const result = (await ctx.learningMemory.search('nombre Aris Phoenix'))[0]
    expect(result?.kind).toBe('preference')
    expect(result?.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('archives every durable session event with project provenance and preserves project isolation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-cognitive-service-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    const alpha = ctx.sessions.create(SessionId('cognitive-alpha'), { meta: { cwd: 'C:\\workspace\\alpha' } })
    const beta = ctx.sessions.create(SessionId('cognitive-beta'), { meta: { cwd: 'C:\\workspace\\beta' } })
    alpha.append('turn/start', { turn: 1 })
    alpha.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Remember the alpha sandbox decision.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    beta.append('turn/start', { turn: 1 })
    beta.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Remember the beta sandbox decision.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    await ctx.learningMemory.ready()
    expect(ctx.learningMemory.allCognitiveRecords().length).toBeGreaterThanOrEqual(4)
    expect(ctx.learningMemory.searchCognitive('alpha decision', 10, { projectId: 'alpha' }).every(hit => hit.record.projectId === 'alpha')).toBe(true)
    expect(ctx.learningMemory.searchCognitive('beta', 10, { projectId: 'alpha' })).toEqual([])
    expect(ctx.learningMemory.timeline({ projectId: 'beta' }).every(record => record.provenance.projectId === 'beta')).toBe(true)
  })
})
