import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import LearningMemoryService from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('cognitive runtime snapshot memory isolation', () => {
  it('keeps the durable session event but does not derive memory from Phoenix cognitive snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-cognitive-feedback-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    const session = ctx.sessions.create(SessionId('cognitive-feedback-session'), { meta: { cwd: 'C:\\workspace\\phoenix' } })
    const text = '<phoenix_cognitive_workspace>pending mission snapshot</phoenix_cognitive_workspace>'

    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text }],
      source: {
        kind: 'plugin',
        plugin: 'cognitive-runtime',
        form: 'snapshot',
        sections: [{ name: 'cognitive-runtime:workspace', text }],
      },
    }), { surfaceOp: 'append' })

    await ctx.learningMemory.ready()

    expect(session.events.some(event => event.type === 'user/message')).toBe(true)
    expect(ctx.learningMemory.allCognitiveRecords()).toEqual([])
    expect(await ctx.learningMemory.search('pending mission snapshot')).toEqual([])
  })
})
