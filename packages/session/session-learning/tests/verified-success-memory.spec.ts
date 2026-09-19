import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import { CallId, createToolResultMessage } from '@phoenix-ai/dsh-llm'
import LearningMemoryService from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function setup(name: string): Promise<{ ctx: Context; session: ReturnType<Context['sessions']['create']> }> {
  const root = await mkdtemp(join(tmpdir(), `phoenix-${name}-`))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
  const session = ctx.sessions.create(SessionId(name), { meta: { cwd: '/workspace/phoenix' } })
  return { ctx, session }
}

describe('verified success memory', () => {
  it('does not call bare tool completion or turn completion verified success', async () => {
    const { ctx, session } = await setup('unverified-completion')
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('call-unverified'),
        content: [{ type: 'text', text: 'wrote the requested file' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await ctx.learningMemory.ready()

    expect((await ctx.learningMemory.search('wrote requested file'))[0]?.kind).toBe('interaction')
    expect((await ctx.learningMemory.search('turn completed'))[0]?.kind).toBe('interaction')
    expect(ctx.learningMemory.searchCognitive('wrote requested file', 10).some(hit => hit.record.kind === 'success')).toBe(false)
  })

  it('promotes a fully passing completion gate as verified success and procedural evidence', async () => {
    const { ctx, session } = await setup('verified-completion')
    const append = session.append.bind(session) as (type: string, data: unknown) => unknown
    append('goal/completion-gate', {
      goalId: 'goal-verified',
      revision: 4,
      round: 6,
      attemptId: 'attempt-verified',
      checks: {
        requirements: 'pass',
        builderTests: 'pass',
        adversarialTests: 'pass',
        startup: 'pass',
        artifactIntegrity: 'pass',
        cleanRoom: 'pass',
      },
      evidenceLedger: [
        {
          criterionId: 'criterion-1',
          criterion: 'Phoenix starts and the deliverable survives clean-room verification.',
          mandatory: true,
          status: 'verified',
          evidence: ['ci:static', 'ci:windows', 'artifact:sha256:verified'],
        },
      ],
      artifactFingerprint: 'sha256:verified',
      cleanRoomEvidence: 'fresh extraction passed startup verification',
      findings: [],
      proceduralLessons: ['Require clean-room startup evidence before declaring a deliverable complete.'],
    })

    await ctx.learningMemory.ready()

    expect((await ctx.learningMemory.search('verified completion gate'))[0]?.kind).toBe('success')
    const hits = ctx.learningMemory.searchCognitive('clean-room startup evidence', 10, {
      projectId: 'phoenix',
      layers: ['procedural'],
    })
    expect(hits.some(hit => hit.record.kind === 'success' && hit.record.provenance.sourceEventType === 'goal/completion-gate')).toBe(true)
  })

  it('does not promote a completion gate with any failed dimension', async () => {
    const { ctx, session } = await setup('failed-completion-gate')
    const append = session.append.bind(session) as (type: string, data: unknown) => unknown
    append('goal/completion-gate', {
      goalId: 'goal-failed',
      revision: 2,
      round: 3,
      attemptId: 'attempt-failed',
      checks: {
        requirements: 'pass',
        builderTests: 'pass',
        adversarialTests: 'fail',
        startup: 'pass',
        artifactIntegrity: 'pass',
        cleanRoom: 'pass',
      },
      evidenceLedger: [],
      artifactFingerprint: 'sha256:not-verified',
      findings: ['adversarial regression failed'],
      proceduralLessons: [],
    })

    await ctx.learningMemory.ready()

    expect((await ctx.learningMemory.search('completion gate'))[0]?.kind).not.toBe('success')
    expect(ctx.learningMemory.searchCognitive('adversarial regression failed', 10).some(hit => hit.record.kind === 'success')).toBe(false)
  })
})
