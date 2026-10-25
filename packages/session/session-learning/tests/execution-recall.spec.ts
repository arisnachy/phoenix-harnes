import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import type { Session } from '@phoenix-ai/dsh-session'
import LearningMemoryService from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('execution-scoped cognitive recall', () => {
  it('requires a registered session and isolates full cwd plus host profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-execution-recall-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    const alpha = ctx.sessions.create(SessionId('execution-alpha'), {
      meta: { cwd: executionCwd('A/project'), agentPreset: 'priority-codex' },
    })
    const sameCwd = ctx.sessions.create(SessionId('execution-alpha-same-cwd'), {
      meta: { cwd: executionCwd('A/project', true), agentPreset: 'priority-codex' },
    })
    const sameBasename = ctx.sessions.create(SessionId('execution-beta'), {
      meta: { cwd: executionCwd('B/project'), agentPreset: 'priority-codex' },
    })
    const otherProfile = ctx.sessions.create(SessionId('execution-other-profile'), {
      meta: { cwd: executionCwd('A/project'), agentPreset: 'openclaw' },
    })

    await Promise.all([
      remember(ctx.learningMemory, alpha, 'Alpha workspace procedure'),
      remember(ctx.learningMemory, sameCwd, 'Shared workspace procedure'),
      remember(ctx.learningMemory, sameBasename, 'Foreign workspace procedure'),
      remember(ctx.learningMemory, otherProfile, 'Other profile procedure'),
    ])
    await ctx.learningMemory.ready()

    const cognitive = Reflect.get(ctx.learningMemory, 'cognitive') as { search: (query: unknown) => unknown }
    const search = vi.spyOn(cognitive, 'search')
    const result = ctx.learningMemory.recallForExecution(alpha, 'workspace procedure', 4_096)
    expect(search).toHaveBeenCalledTimes(1)
    expect((search.mock.calls[0]?.[0] as { sessionIds?: readonly string[] }).sessionIds).toEqual(expect.arrayContaining([
      String(alpha.id), String(sameCwd.id),
    ]))
    expect(result.content).toContain('Alpha workspace procedure')
    expect(result.content).toContain('Shared workspace procedure')
    expect(result.content).not.toContain('Foreign workspace procedure')
    expect(result.content).not.toContain('Other profile procedure')
    expect(result.memoryIds).toHaveLength(2)

    const clone = { ...alpha, header: { ...alpha.header } } as unknown as Session
    expect(ctx.learningMemory.recallForExecution(clone, 'workspace procedure', 4_096)).toEqual({ content: '', memoryIds: [] })
    const unknown = { id: SessionId('unknown-execution'), header: alpha.header } as unknown as Session
    expect(ctx.learningMemory.recallForExecution(unknown, 'workspace procedure', 4_096)).toEqual({ content: '', memoryIds: [] })
  })

  it('returns only active high-confidence procedural records within a UTF-8 budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-execution-budget-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    const session = ctx.sessions.create(SessionId('execution-budget'), {
      meta: { cwd: executionCwd('A/project'), agentPreset: 'priority-codex' },
    })

    await Promise.all([
      remember(ctx.learningMemory, session, 'Procedural café lesson 🦊 api_key=hidden-value'),
      ctx.learningMemory.rememberCognitive({
        sessionId: String(session.id),
        eventSeq: 1,
        kind: 'lesson',
        layers: ['semantic'],
        content: 'Semantic-only procedure should not be returned.',
        summary: 'Semantic-only procedure should not be returned.',
        sourceEventType: 'memory/explicit',
        occurredAt: Date.now(),
        confidence: 0.99,
        importance: 0.99,
      }),
      ctx.learningMemory.rememberCognitive({
        sessionId: String(session.id),
        eventSeq: 2,
        kind: 'lesson',
        layers: ['procedural'],
        content: 'Low confidence procedure should not be returned.',
        summary: 'Low confidence procedure should not be returned.',
        sourceEventType: 'memory/explicit',
        occurredAt: Date.now(),
        confidence: 0.79,
        importance: 0.99,
      }),
    ])
    await ctx.learningMemory.ready()

    const result = ctx.learningMemory.recallForExecution(session, 'procedural café lesson', 256)
    expect(result.memoryIds).toHaveLength(1)
    expect(result.content).toContain('Procedural café lesson')
    expect(result.content).not.toContain('hidden-value')
    expect(Buffer.byteLength(result.content, 'utf8')).toBeLessThanOrEqual(256)
  })

  it('does not index derived execution context events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-execution-context-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    const session = ctx.sessions.create(SessionId('execution-context'), {
      meta: { cwd: executionCwd('A/project'), agentPreset: 'priority-codex' },
    })
    const append = session.append.bind(session) as (type: string, data: unknown) => unknown
    append('team/execution-context', {
      version: 1,
      executionId: 'execution-1',
      content: 'derived procedure context must not be learned',
      memoryIds: [],
    })

    await ctx.learningMemory.ready()
    expect(ctx.learningMemory.allCognitiveRecords().some(record => record.provenance.sourceEventType === 'team/execution-context')).toBe(false)
  })
})

async function remember(service: LearningMemoryService, session: Session, text: string): Promise<void> {
  await service.rememberCognitive({
    sessionId: String(session.id),
    eventSeq: 0,
    kind: 'lesson',
    layers: ['procedural'],
    content: text,
    summary: text,
    sourceEventType: 'memory/explicit',
    occurredAt: Date.now(),
    confidence: 0.95,
    importance: 0.95,
  })
}

function executionCwd(path: string, alternateCase = false): string {
  if (process.platform === 'win32') return `${alternateCase ? 'c' : 'C'}:/${path}`
  return `/${path}`
}
