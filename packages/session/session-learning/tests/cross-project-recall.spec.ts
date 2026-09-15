import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import LearningMemoryService from '../src/index.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe('cross-project cognitive recall', () => {
  it('keeps automatic recall project scoped but allows explicit autobiographical cross-project search', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-cross-project-memory-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })

    const alpha = ctx.sessions.create(SessionId('alpha-memory'), { meta: { cwd: 'C:\\workspace\\alpha' } })
    alpha.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Arregla el actualizador del proyecto alpha.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const beta = ctx.sessions.create(SessionId('beta-memory'), { meta: { cwd: 'C:\\workspace\\beta' } })
    beta.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Arregla los avatares del proyecto beta.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    await ctx.learningMemory.ready()

    expect(ctx.learningMemory.searchCognitive('proyecto', 20).every(hit => hit.record.projectId === 'beta')).toBe(true)
    const crossProject = ctx.learningMemory.searchCognitive('proyecto', 20, { includeCrossProject: true })
    expect(new Set(crossProject.map(hit => hit.record.projectId))).toEqual(new Set(['alpha', 'beta']))
  })
})
