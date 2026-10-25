import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@phoenix-ai/dsh-llm'
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

  it('does not relearn derived runtime-context snapshots as new memory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-derived-context-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    const session = ctx.sessions.create(SessionId('derived-context-session'), { meta: {} })

    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'The CI guard is still pending.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{
        type: 'text',
        text: 'Background runtime context: <phoenix_initiative_context> pending CI guard pending CI guard </phoenix_initiative_context>',
      }],
      source: {
        kind: 'plugin',
        plugin: '@phoenix-ai/dsh-system-prompt',
        form: 'snapshot',
        sections: [{ name: 'hardness:initiative-context', text: 'pending CI guard' }],
      },
    }), { surfaceOp: 'append' })

    await ctx.learningMemory.ready()
    const matching = ctx.learningMemory.allCognitiveRecords()
      .filter(record => record.sessionId === String(session.id) && record.content.includes('CI guard'))

    expect(matching).toHaveLength(1)
    expect(matching[0]?.content).toBe('The CI guard is still pending.')
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

  it('reads only active cognitive records for one session in bounded chronological order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-cognitive-session-read-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    const alpha = ctx.sessions.create(SessionId('cognitive-read-alpha'), { meta: {} })
    const beta = ctx.sessions.create(SessionId('cognitive-read-beta'), { meta: {} })

    for (const text of ['alpha first', 'alpha second', 'alpha third']) {
      alpha.append('user/message', createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
    }
    beta.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'beta only' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    await ctx.learningMemory.ready()
    const records = ctx.learningMemory.cognitiveForSession(alpha.id, 2)

    expect(records.map(record => record.sessionId)).toEqual([String(alpha.id), String(alpha.id)])
    expect(records.map(record => record.content)).toEqual(['alpha second', 'alpha third'])
    expect(records.every(record => record.status === 'active')).toBe(true)
    expect(ctx.learningMemory.cognitiveForSession(beta.id).map(record => record.content)).toEqual(['beta only'])
    expect(ctx.learningMemory.cognitiveForSession(alpha.id, 128)).toHaveLength(3)
    expect(() => ctx.learningMemory.cognitiveForSession(alpha.id, 129)).toThrow(TypeError)
    expect(() => ctx.learningMemory.cognitiveForSession(alpha.id, 0)).toThrow(TypeError)
    expect(() => ctx.learningMemory.cognitiveForSession(alpha.id, 1.5)).toThrow(TypeError)
    expect(() => ctx.learningMemory.cognitiveForSession(alpha.id, Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError)
  })
  it('persists a Milwaukee favorite as an assistant decision, not a user preference, across restarts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-sports-decision-'))
    roots.push(root)
    const path = join(root, 'memory.jsonl')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path })
    const sports = ctx.sessions.create(SessionId('sports-pick-alpha'), { meta: { cwd: '/workspace/sports' } })
    sports.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '¿Cuál es tu favorito en Brewers–Rays?' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const assistant = (text: string) => createAssistantMessage({
      content: [{ type: 'text', text }],
      source: { provider: 'test', model: 'test-model' },
    })
    sports.append('assistant/message', { turn: 1, step: 1, message: assistant('Mi favorito para Brewers–Rays es Milwaukee Brewers.') }, { surfaceOp: 'append' })
    sports.append('assistant/message', { turn: 1, step: 2, message: assistant('No tengo favorito todavía en el otro encuentro.') }, { surfaceOp: 'append' })
    sports.append('assistant/message', { turn: 1, step: 3, message: assistant('Prefiero respuestas breves.') }, { surfaceOp: 'append' })
    const unrelated = ctx.sessions.create(SessionId('sports-pick-other'), { meta: { cwd: '/workspace/other' } })
    unrelated.append('assistant/message', { turn: 1, step: 1, message: assistant('Mi favorito para Dodgers–Mets es Los Angeles Dodgers.') }, { surfaceOp: 'append' })

    await ctx.learningMemory.ready()
    expect(ctx.learningMemory.projectIdForSession(String(sports.id))).toBe('sports')
    expect(ctx.learningMemory.projectIdForSession(String(unrelated.id))).toBe('other')
    const choices = ctx.learningMemory.searchCognitive('Brewers Rays Milwaukee', 10, {
      kind: 'decision', projectId: 'sports',
    })
    expect(choices).toHaveLength(1)
    expect(choices[0]?.record.summary).toContain('Milwaukee Brewers')
    expect(choices[0]?.record.provenance.sourceEventType).toBe('assistant/decision')
    expect(ctx.learningMemory.searchCognitive('', 10, { kind: 'decision', projectId: 'other' })
      .some(hit => hit.record.summary.includes('Milwaukee'))).toBe(false)
    expect(ctx.learningMemory.searchCognitive('', 10, { kind: 'preference', projectId: 'sports' })
      .some(hit => hit.record.content.includes('Prefiero respuestas breves.'))).toBe(false)

    const restarted = new Context()
    await restarted.plugin(SessionStore)
    await restarted.plugin(LearningMemoryService, { path })
    await restarted.learningMemory.ready()
    expect(restarted.learningMemory.searchCognitive('Milwaukee', 10, { kind: 'decision', projectId: 'sports' }))
      .toHaveLength(1)
  })

  it('replays an older assistant pick into the new decision index idempotently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-decision-replay-'))
    roots.push(root)
    const path = join(root, 'memory.jsonl')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path })
    const session = ctx.sessions.create(SessionId('historic-game'), { meta: { cwd: '/workspace/sports' } })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '¿Quién es tu favorito para Brewers–Rays?' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({
      content: [{ type: 'text', text: 'Voy con Milwaukee.' }],
      source: { provider: 'test', model: 'test-model' },
    }) }, { surfaceOp: 'append' })
    await ctx.learningMemory.ready()
    const decision = ctx.learningMemory.searchCognitive('Milwaukee', 10, { kind: 'decision', projectId: 'sports' })
    expect(decision).toHaveLength(1)
    expect(ctx.learningMemory.searchCognitive('Brewers Rays', 10, { kind: 'decision', projectId: 'sports' }))
      .toHaveLength(1)
    const recordsBefore = ctx.learningMemory.allCognitiveRecords().length
    // Reload and session-event replay must not duplicate the decision record.
    await ctx.learningMemory.ready()
    expect(ctx.learningMemory.allCognitiveRecords()).toHaveLength(recordsBefore)
  })

})
