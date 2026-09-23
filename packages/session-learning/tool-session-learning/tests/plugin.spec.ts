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

  it('automatically recalls durable cognitive corrections as silent, private evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-cognitive-context-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    await ctx.plugin(plugin, {})
    const session = ctx.sessions.create(SessionId('cognitive-context-session'), { meta: {} })

    await ctx.learningMemory.rememberCognitive({
      sessionId: String(session.id),
      eventSeq: session.seq,
      kind: 'lesson',
      layers: ['episodic', 'semantic', 'procedural', 'temporal'],
      content: 'A prior file task failed because the working directory was assumed instead of verified.',
      summary: 'Verify the actual working directory internally before file operations.',
      sourceEventType: 'adaptive/verified-correction',
      occurredAt: Date.now(),
      confidence: 0.97,
      importance: 0.95,
      subject: 'phoenix.learning.file-workdir',
      value: JSON.stringify({ version: 1, strategy: 'verify-workdir-silently' }),
    })

    const snapshot = renderContextSnapshot(await ctx.systemPrompt.assemble())
    expect(snapshot).toContain('Verify the actual working directory internally before file operations.')
    expect(snapshot).toMatch(/use relevant records silently/i)
    expect(snapshot).toMatch(/do not quote, enumerate, or explain this memory block/i)
    expect(snapshot).toMatch(/not as experience-derived discoveries/i)
    expect(snapshot).toMatch(/profile-like facts only as private context/i)
    expect(snapshot).not.toContain('cognitive-context-session')
    expect(snapshot).not.toContain('adaptive/verified-correction')
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
    const context = renderContextSnapshot(assembly)
    expect(context).toContain('{ {A=3;while(A!=3){A++;} }')
    expect(context).not.toContain('summary\":\"{{A=3')
  })

  it('registers guided procedural teaching with a procedure-specific contract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-teach-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    await ctx.plugin(plugin, {})

    const schema = ctx.tools.schemas().find(candidate => candidate.name === 'memory_teach')
    expect(schema).toBeDefined()
    expect(schema?.description).toMatch(/procedure/i)

    const computerSchema = ctx.tools.schemas().find(candidate => candidate.name === 'computer_learning')
    expect(computerSchema).toBeDefined()
    expect(computerSchema?.description).toMatch(/review or forget/i)
  })
})
