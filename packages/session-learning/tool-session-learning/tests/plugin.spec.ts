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

async function createLearningContext(prefix: string): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
  await ctx.plugin(plugin, {})
  return ctx
}

describe('tool-session-learning plugin', () => {
  it('adds recent non-interaction evidence to the assembled model context', async () => {
    const ctx = await createLearningContext('phoenix-learning-plugin-')
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

  it('automatically reuses cognitive memories written by autonomous learning', async () => {
    const ctx = await createLearningContext('phoenix-learning-cognitive-')
    const session = ctx.sessions.create(SessionId('cognitive-context-session'), { meta: {} })
    await ctx.learningMemory.rememberCognitive({
      sessionId: String(session.id),
      eventSeq: session.seq,
      kind: 'preference',
      layers: ['autobiographical', 'semantic', 'temporal'],
      content: 'Prefiero que actúes directamente cuando ya tienes suficiente contexto.',
      summary: 'Prefiero que actúes directamente cuando ya tienes suficiente contexto.',
      sourceEventType: 'autonomous/user-preference',
      occurredAt: Date.now(),
      confidence: 0.95,
      importance: 0.95,
      subject: 'phoenix.learning.autonomous.preference.direct-action',
      value: JSON.stringify({ version: 1, kind: 'preference' }),
    })

    const snapshot = renderContextSnapshot(await ctx.systemPrompt.assemble())
    expect(snapshot).toContain('actúes directamente cuando ya tienes suficiente contexto')
    expect(snapshot).toContain('"origin":"preference"')
    expect(snapshot).not.toContain('autonomous/user-preference')
    expect(snapshot).not.toContain('cognitive-context-session')
  })

  it('instructs the model to apply learning silently and classify memory internally', async () => {
    const ctx = await createLearningContext('phoenix-learning-silent-policy-')
    const prompt = renderContextSnapshot(await ctx.systemPrompt.assemble())

    expect(prompt).toMatch(/apply relevant learned preferences.*silently/i)
    expect(prompt).toMatch(/never ask the user which memory category/i)
    expect(prompt).toMatch(/act instead of asking the user to choose a memory layer/i)
    expect(prompt).toMatch(/distinguish experience-derived learning from configured instructions/i)
    expect(prompt).toMatch(/do not expose private profile fields/i)
  })

  it('keeps literal template-looking code in learned context', async () => {
    const ctx = await createLearningContext('phoenix-learning-template-code-')
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
    const context = renderContextSnapshot(assembly)
    expect(context).toContain('{ {A=3;while(A!=3){A++;} }')
    expect(context).not.toContain('summary\":\"{{A=3')
  })

  it('registers guided procedural teaching and tells the model when to use it', async () => {
    const ctx = await createLearningContext('phoenix-learning-teach-')

    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('memory_teach')
    const prompt = renderContextSnapshot(await ctx.systemPrompt.assemble())
    expect(prompt).toContain('memory_teach')
    expect(prompt).toMatch(/teach|demonstration|procedure/i)
  })
})
