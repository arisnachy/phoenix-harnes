import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SessionStore from '@phoenix-ai/dsh-session'
import SystemPrompt, { renderContextSnapshot } from '@phoenix-ai/dsh-system-prompt'
import ToolRegistry from '@phoenix-ai/dsh-tools'
import LearningMemoryService from '@phoenix-ai/dsh-session-learning'
import * as plugin from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function createRuntime(memoryPath: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LearningMemoryService, { path: memoryPath })
  await ctx.plugin(plugin, {})
  await ctx.learningMemory.ready()
  return ctx
}

describe('durable experiential recall across restart', () => {
  it('reloads a verified learned correction into a fresh runtime and keeps provenance private', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-restart-'))
    roots.push(root)
    const memoryPath = join(root, 'memory.jsonl')

    const firstRuntime = await createRuntime(memoryPath)
    await firstRuntime.learningMemory.rememberCognitive({
      sessionId: 'experience-before-restart',
      eventSeq: 7,
      kind: 'lesson',
      layers: ['episodic', 'semantic', 'procedural', 'temporal'],
      content: 'A prior file operation failed because the working directory was assumed instead of verified.',
      summary: 'Verify the actual working directory silently before file operations when location matters.',
      sourceEventType: 'adaptive/verified-correction',
      occurredAt: Date.now(),
      confidence: 0.98,
      importance: 0.96,
      subject: 'phoenix.learning.file-workdir',
      value: JSON.stringify({ version: 1, strategy: 'verify-workdir-silently' }),
    })
    await firstRuntime.learningMemory.ready()

    // A brand-new Context using the same durable ledger simulates a Phoenix restart.
    const restartedRuntime = await createRuntime(memoryPath)
    const persisted = restartedRuntime.learningMemory.searchCognitive('working directory', 10, {
      includeHistory: false,
    })
    expect(persisted.some(hit => hit.record.summary.includes('Verify the actual working directory silently'))).toBe(true)

    const snapshot = renderContextSnapshot(await restartedRuntime.systemPrompt.assemble())
    expect(snapshot).toContain('Verify the actual working directory silently before file operations when location matters.')
    expect(snapshot).toMatch(/apply relevant learned memory silently/i)
    expect(snapshot).toMatch(/experience and verified outcomes/i)
    expect(snapshot).not.toContain('experience-before-restart')
    expect(snapshot).not.toContain('adaptive/verified-correction')
  })
})
