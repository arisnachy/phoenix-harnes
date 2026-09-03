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

describe('completion-gate procedural memory', () => {
  it('turns discovered completion failure patterns into procedural cognitive memory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-gate-learning-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    const session = ctx.sessions.create(SessionId('completion-gate-learning'), { meta: { cwd: '/workspace/phoenix' } })
    const append = session.append.bind(session) as (type: string, data: unknown) => unknown

    append('goal/completion-gate', {
      goalId: 'goal-1',
      revision: 1,
      round: 3,
      attemptId: 'gate-failure',
      checks: {
        requirements: 'pass',
        builderTests: 'pass',
        adversarialTests: 'fail',
        startup: 'pass',
        artifactIntegrity: 'pass',
        cleanRoom: 'fail',
      },
      evidenceLedger: [{
        criterionId: 'REQ-001',
        criterion: 'The packaged app starts outside the development workspace.',
        mandatory: true,
        status: 'failed',
        evidence: ['fresh extracted copy could not resolve a shipped dependency'],
      }],
      artifactFingerprint: 'sha256:broken-artifact',
      cleanRoomEvidence: 'fresh extracted copy failed startup',
      findings: ['Packaged artifact depends on a workspace-only link.'],
      proceduralLessons: ['Verify shipped dependencies from the extracted artifact instead of trusting workspace links.'],
    })

    await ctx.learningMemory.ready()
    const procedural = ctx.learningMemory.searchCognitive('shipped dependencies workspace links', 10, {
      layers: ['procedural'],
      projectId: 'phoenix',
    })

    expect(procedural.some(hit => hit.record.provenance.sourceEventType === 'goal/completion-gate')).toBe(true)
  })
})
