import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SessionStore from '@phoenix-ai/dsh-session'
import LearningMemoryService from '@phoenix-ai/dsh-session-learning'
import { EpisodicMissionRecorder } from '../src/episodic.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

async function createMemoryRuntime(path: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LearningMemoryService, { path })
  await ctx.learningMemory.ready()
  return ctx
}

describe('durable mission recall across restart', () => {
  it('recovers a verified mission from a fresh runtime and explicit cross-project temporal search', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-episodic-restart-'))
    roots.push(root)
    const path = join(root, 'memory.jsonl')
    const first = await createMemoryRuntime(path)
    const recorder = new EpisodicMissionRecorder({
      async remember(input) {
        await first.learningMemory.rememberCognitive(input)
      },
    })

    recorder.observeUserMessage('mission-before-restart', 'Arregla los avatares vivos de KIRA en Phoenix.', {
      occurredAt: Date.parse('2026-09-14T18:00:00.000Z'),
      projectId: 'phoenix-harnes',
    })
    recorder.observeToolCall('mission-before-restart', 'github')
    await recorder.complete('mission-before-restart', {
      eventSeq: 9,
      occurredAt: Date.parse('2026-09-14T18:30:00.000Z'),
      verified: true,
      outcome: 'Reactive avatar states were verified.',
    })
    await first.learningMemory.ready()

    const restarted = await createMemoryRuntime(path)
    const hits = restarted.learningMemory.searchCognitive('', 20, {
      includeCrossProject: true,
      layers: ['episodic', 'temporal'],
      from: Date.parse('2026-09-14T04:00:00.000Z'),
      to: Date.parse('2026-09-15T03:59:59.999Z'),
    })

    expect(hits.some(hit => hit.record.kind === 'mission' && hit.record.summary.includes('avatares vivos de KIRA'))).toBe(true)
    expect(hits.some(hit => hit.record.projectId === 'phoenix-harnes')).toBe(true)
  })
})
