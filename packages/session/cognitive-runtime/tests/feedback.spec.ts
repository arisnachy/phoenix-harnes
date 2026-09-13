import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import LearningMemoryService from '@phoenix-ai/dsh-session-learning'
import CognitiveRuntime from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('cognitive snapshot feedback isolation', () => {
  it('keeps PHOENIX snapshots out of its own attention workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-cognitive-feedback-'))
    roots.push(root)
    const ctx = new Context()
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
    const session = ctx.sessions.create(SessionId('cognitive-feedback-session'), { meta: { cwd: 'C:\\workspace\\phoenix' } })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Finish the OAuth mission and verify restart persistence.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await ctx.cognitiveRuntime.ready()
    const before = ctx.cognitiveRuntime.get(session.id)
    expect(before?.candidateCount).toBeGreaterThan(0)

    const snapshot = '<phoenix_cognitive_workspace>derived cognitive snapshot</phoenix_cognitive_workspace>'
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: snapshot }],
      source: {
        kind: 'plugin',
        plugin: 'cognitive-runtime',
        form: 'snapshot',
        sections: [{ name: 'cognitive-runtime:workspace', text: snapshot }],
      },
    }), { surfaceOp: 'append' })
    await ctx.learningMemory.ready()
    await ctx.cognitiveRuntime.ready()

    const after = ctx.cognitiveRuntime.get(session.id)
    expect(after?.candidateCount).toBe(before?.candidateCount)
    expect(after?.focus?.record.content).not.toContain('<phoenix_cognitive_workspace>')
    expect(after?.active.every(candidate => !candidate.record.content.includes('<phoenix_cognitive_workspace>'))).toBe(true)
    expect(after?.background.every(candidate => !candidate.record.content.includes('<phoenix_cognitive_workspace>'))).toBe(true)
  })
})
