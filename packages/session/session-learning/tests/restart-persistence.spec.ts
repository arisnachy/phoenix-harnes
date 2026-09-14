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

describe('LearningMemoryService restart persistence', () => {
  it('loads durable semantic/procedural learning in a fresh runtime using the same ledger', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-restart-'))
    roots.push(root)
    const path = join(root, 'memory.jsonl')

    const beforeRestart = new Context()
    await beforeRestart.plugin(SessionStore)
    await beforeRestart.plugin(LearningMemoryService, { path })
    const firstSession = beforeRestart.sessions.create(SessionId('before-restart'), { meta: { cwd: 'C:\\workspace\\phoenix' } })
    await beforeRestart.learningMemory.rememberCognitive({
      sessionId: String(firstSession.id),
      eventSeq: firstSession.seq,
      kind: 'lesson',
      layers: ['episodic', 'semantic', 'procedural', 'temporal'],
      content: 'A verified file workflow checks the workspace before operating and verifies the result afterward.',
      summary: 'Check the workspace before file operations and verify the result afterward.',
      sourceEventType: 'procedural/experience/verified',
      occurredAt: 1_000,
      confidence: 0.96,
      importance: 0.98,
      projectId: 'phoenix',
      subject: 'phoenix.learning.procedure.restart-proof',
      value: JSON.stringify({ version: 1, status: 'active' }),
    })
    await beforeRestart.learningMemory.ready()

    const afterRestart = new Context()
    await afterRestart.plugin(SessionStore)
    await afterRestart.plugin(LearningMemoryService, { path })
    await afterRestart.learningMemory.ready()

    const hits = afterRestart.learningMemory.searchCognitive('workspace file operations verify result', 10, {
      projectId: 'phoenix',
      layers: ['procedural'],
    })

    expect(hits).toHaveLength(1)
    expect(hits[0]?.record.summary).toContain('Check the workspace before file operations')
    expect(hits[0]?.record.confidence).toBe(0.96)
  })
})
