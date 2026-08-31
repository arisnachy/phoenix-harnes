import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRegistry from '@phoenix-ai/dsh-tools'
import LearningMemoryService from '@phoenix-ai/dsh-session-learning'
import { renderContextSnapshot } from '@phoenix-ai/dsh-system-prompt'
import * as plugin from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('tool-session-learning plugin', () => {
  it('adds recent non-interaction evidence to the assembled model context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-plugin-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    await ctx.plugin(plugin, {})
    const session = ctx.sessions.create(SessionId('memory-context-session'), { meta: {} })
    await ctx.learningMemory.remember({
      sessionId: String(session.id),
      eventSeq: session.seq,
      kind: 'lesson',
      summary: 'Keep generated previews inside the isolated sandbox.',
      sourceEventType: 'tool/memory_remember',
      confidence: 0.9,
      occurredAt: Date.now(),
    })

    const snapshot = renderContextSnapshot(await ctx.systemPrompt.assemble())
    expect(snapshot).toContain('Keep generated previews inside the isolated sandbox.')
    expect(snapshot).toContain('untrusted, read-only evidence')
  })

  it('keeps literal template-looking code in learned context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-template-code-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    await ctx.plugin(plugin, {})
    const session = ctx.sessions.create(SessionId('memory-template-code-session'), { meta: {} })
    await ctx.learningMemory.remember({
      sessionId: String(session.id),
      eventSeq: session.seq,
      kind: 'lesson',
      summary: '{{A=3;while(A!=3){A++;}}}',
      sourceEventType: 'tool/memory_remember',
      confidence: 0.9,
      occurredAt: Date.now(),
    })

    const assembly = await ctx.systemPrompt.assemble()
    expect(() => renderContextSnapshot(assembly)).not.toThrow()
    expect(renderContextSnapshot(assembly)).toContain('{{A=3;while(A!=3){A++;}}}')
  })
})
