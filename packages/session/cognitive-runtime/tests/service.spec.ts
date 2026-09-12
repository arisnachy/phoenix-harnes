import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import LearningMemoryService from '@phoenix-ai/dsh-session-learning'
import CognitiveRuntime, { type Config } from '../src/index.ts'

const roots: string[] = []

const config: Config = {
  maxCandidates: 64,
  activeLimit: 2,
  backgroundLimit: 2,
  weights: {
    importance: 1,
    confidence: 1,
    recency: 1,
    urgency: 1,
    goalRelevance: 1,
    novelty: 1,
  },
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function setup(runtimeConfig: Config = config): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'phoenix-cognitive-runtime-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
  await ctx.plugin(CognitiveRuntime, runtimeConfig)
  return ctx
}

function userMessage(text: string): ReturnType<typeof createUserMessage> {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

describe('CognitiveRuntimeService', () => {
  it('reconstructs sessions that existed before startup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-cognitive-runtime-seed-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    const session = ctx.sessions.create(SessionId('seeded-session'), { meta: { cwd: 'C:\\workspace\\phoenix' } })
    session.append('user/message', userMessage('The seeded session remembers a pending mission.'), { surfaceOp: 'append' })
    await ctx.learningMemory.ready()

    await ctx.plugin(CognitiveRuntime, config)
    await ctx.cognitiveRuntime.ready()
    const state = ctx.cognitiveRuntime.get(session.id)

    expect(state?.sessionId).toBe(session.id)
    expect(state?.candidateCount).toBeGreaterThan(0)
    expect(state?.projectId).toBe('phoenix')
  })

  it('refreshes durable events but ignores assistant stream chunks', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('event-session'), { meta: {} })
    session.append('user/message', userMessage('first durable thought'), { surfaceOp: 'append' })
    await ctx.cognitiveRuntime.ready()
    const before = ctx.cognitiveRuntime.get(session.id)
    expect(before?.candidateCount).toBeGreaterThan(0)

    session.append('user/message', userMessage('second durable thought'), { surfaceOp: 'append' })
    await ctx.cognitiveRuntime.ready()
    const afterDurable = ctx.cognitiveRuntime.get(session.id)
    expect(afterDurable?.observedSeq).toBeGreaterThan(before?.observedSeq ?? -1)
    expect(afterDurable?.candidateCount).toBeGreaterThan(before?.candidateCount ?? 0)

    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    await ctx.cognitiveRuntime.ready()
    const beforeChunk = ctx.cognitiveRuntime.get(session.id)
    session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'stream' } })
    await ctx.learningMemory.ready()
    await ctx.cognitiveRuntime.ready()

    expect(ctx.cognitiveRuntime.get(session.id)).toEqual(beforeChunk)

    const duplicate = session.events.at(-1)!
    ctx.emit('session/event', session, { ...duplicate, ignorable: true })
    await ctx.cognitiveRuntime.ready()
    expect(ctx.cognitiveRuntime.get(session.id)).toEqual(beforeChunk)
  })

  it('keeps duplicate delivery idempotent and returns undefined for missing sessions', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('duplicate-session'), { meta: {} })
    expect(ctx.cognitiveRuntime.get(session.id)).toBeUndefined()
    session.append('user/message', userMessage('one event only'), { surfaceOp: 'append' })
    await ctx.cognitiveRuntime.ready()
    const event = session.events.at(-1)
    const before = ctx.cognitiveRuntime.get(session.id)
    expect(event).toBeDefined()
    ctx.emit('session/event', session, event!)
    await ctx.cognitiveRuntime.ready()

    expect(ctx.cognitiveRuntime.get(session.id)).toEqual(before)
    expect(await ctx.cognitiveRuntime.refresh(SessionId('missing-session'))).toBeUndefined()
    expect(ctx.cognitiveRuntime.get(SessionId('missing-session'))).toBeUndefined()
    ctx.emit('session/disposed', session)
    expect(ctx.cognitiveRuntime.get(session.id)).toBeUndefined()
  })

  it('retains the previous state after a failed refresh and recovers on a later event', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('recovery-session'), { meta: {} })
    session.append('user/message', userMessage('stable state'), { surfaceOp: 'append' })
    await ctx.cognitiveRuntime.ready()
    const before = ctx.cognitiveRuntime.get(session.id)
    const read = vi.spyOn(ctx.learningMemory, 'cognitiveForSession').mockImplementationOnce(() => {
      throw new Error('temporary ledger read failure')
    })

    expect(await ctx.cognitiveRuntime.refresh(session.id)).toEqual(before)
    expect(read).toHaveBeenCalledTimes(1)
    expect(ctx.cognitiveRuntime.get(session.id)).toEqual(before)

    session.append('user/message', userMessage('recovered state'), { surfaceOp: 'append' })
    await ctx.cognitiveRuntime.ready()
    expect(ctx.cognitiveRuntime.get(session.id)?.observedSeq).toBeGreaterThan(before?.observedSeq ?? -1)
    read.mockRestore()
  })

  it('settles the queue after an unexpected operation rejection', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('queue-recovery-session'), { meta: {} })
    session.append('user/message', userMessage('queue state'), { surfaceOp: 'append' })
    await ctx.cognitiveRuntime.ready()
    const read = vi.spyOn(ctx.learningMemory, 'cognitiveForSession').mockImplementationOnce(() => {
      throw new Error('unexpected queue failure')
    })
    const warn = ctx.logger.warn
    ctx.logger.warn = (() => { throw new Error('logger failure') }) as never

    await expect(ctx.cognitiveRuntime.refresh(session.id)).rejects.toThrow('logger failure')

    ctx.logger.warn = warn
    read.mockRestore()
    await expect(ctx.cognitiveRuntime.refresh(session.id)).resolves.toBeDefined()
  })

  it('exposes bounded resolved configuration', async () => {
    const ctx = await setup()
    expect(ctx.cognitiveRuntime.config).toEqual(config)
    expect(Object.isFrozen(ctx.cognitiveRuntime.config)).toBe(true)
    const empty = ctx.sessions.create(SessionId('empty-session'), { meta: {} })
    await ctx.cognitiveRuntime.ready()
    expect(ctx.cognitiveRuntime.get(empty.id)).toMatchObject({ candidateCount: 0, observedSeq: -1 })
  })

  it.each([
    { maxCandidates: 0 },
    { activeLimit: -1 },
    { backgroundLimit: -1 },
    { weights: { ...config.weights, urgency: Number.NaN } },
  ])('rejects invalid resolved configuration %j', (override) => {
    expect(() => new CognitiveRuntime(new Context(), { ...config, ...override } as Config)).toThrow(/cognitive-runtime/)
  })
})
