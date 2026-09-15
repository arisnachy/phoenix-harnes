import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import SystemPrompt, { renderContextSnapshot } from '@phoenix-ai/dsh-system-prompt'
import ToolRegistry from '@phoenix-ai/dsh-tools'
import LearningMemoryService from '@phoenix-ai/dsh-session-learning'
import { EpisodicMissionRecorder } from '../src/episodic.ts'
import * as plugin from '../src/index.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

async function createRuntime(path: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LearningMemoryService, { path })
  await ctx.plugin(plugin, {})
  await ctx.learningMemory.ready()
  return ctx
}

describe('directed autobiographical recall runtime', () => {
  it('injects prior mission evidence naturally after restart without memory plumbing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-directed-recall-'))
    roots.push(root)
    const path = join(root, 'memory.jsonl')
    const first = await createRuntime(path)
    const recorder = new EpisodicMissionRecorder({
      async remember(input) {
        await first.learningMemory.rememberCognitive(input)
      },
    })
    const now = Date.now()
    recorder.observeUserMessage('prior-private-session', 'Mejora los avatares reactivos de KIRA y verifica sus estados.', {
      occurredAt: now - 60_000,
      projectId: 'phoenix-harnes',
    })
    await recorder.complete('prior-private-session', {
      eventSeq: 14,
      occurredAt: now - 30_000,
      verified: true,
      outcome: 'Reactive states were verified.',
    })
    await first.learningMemory.ready()

    const restarted = await createRuntime(path)
    const querySession = restarted.sessions.create(SessionId('history-query-session'), { meta: { cwd: 'C:\\workspace\\other-project' } })
    querySession.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '¿Qué hicimos en los proyectos anteriores?' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await restarted.learningMemory.ready()

    const snapshot = renderContextSnapshot(await restarted.systemPrompt.assemble())
    expect(snapshot).toContain('Mejora los avatares reactivos de KIRA')
    expect(snapshot).toContain('Reactive states were verified.')
    expect(snapshot).toContain('Answer directly and conversationally')
    expect(snapshot).not.toContain('prior-private-session')
    expect(snapshot).not.toContain('episodic/mission/verified')
    expect(snapshot).not.toContain('session://')
  })
})
