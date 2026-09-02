import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import LearningMemoryService from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('false-pass procedural memory', () => {
  it('indexes every goal false-pass as procedural memory for future missions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-false-pass-memory-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    const session = ctx.sessions.create(SessionId('false-pass-learning-session'), { meta: { cwd: '/workspace/phoenix' } })
    const append = session.append.bind(session) as (type: string, data: unknown) => unknown

    append('goal/false-pass', {
      goalId: 'goal-1',
      revision: 3,
      detectedRound: 7,
      priorArtifactFingerprint: 'sha256:old',
      observedArtifactFingerprint: 'sha256:new',
      failureFingerprint: 'cleanRoom:blocked',
      findings: ['Packaged runtime asset was missing from the delivered archive.'],
      candidateProceduralLessons: ['Verify generated runtime assets from the extracted artifact, never only from the builder workspace.'],
    })

    await ctx.learningMemory.ready()
    const hits = ctx.learningMemory.searchCognitive('generated runtime assets', 10, {
      projectId: 'phoenix',
      layers: ['procedural'],
    })

    expect(hits.some(hit => hit.record.sourceEventType === 'goal/false-pass')).toBe(true)
  })
})
