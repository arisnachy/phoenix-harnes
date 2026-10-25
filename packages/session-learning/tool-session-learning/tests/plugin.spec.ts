import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRegistry from '@phoenix-ai/dsh-tools'
import { CallId, createAssistantMessage, createUserMessage } from '@phoenix-ai/dsh-llm'
import LearningMemoryService from '@phoenix-ai/dsh-session-learning'
import { renderContextSnapshot } from '@phoenix-ai/dsh-system-prompt'
import * as plugin from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('tool-session-learning plugin', () => {
  it('recalls task-relevant memory on request without scanning the entire archive', async () => {
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

    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Recuerda cómo guardábamos generated previews en el isolated sandbox.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const snapshot = renderContextSnapshot(await ctx.systemPrompt.assemble({
      agent: { id: String(session.id), session },
    } as never))
    expect(snapshot).toContain('Keep generated previews inside the isolated sandbox.')
    expect(snapshot).toContain('untrusted, read-only evidence')
  })

  it('recalls durable cognitive corrections when the task asks for past experience', async () => {
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

    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Recuerda la corrección previa del working directory en file operations.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const snapshot = renderContextSnapshot(await ctx.systemPrompt.assemble({
      agent: { id: String(session.id), session },
    } as never))
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

    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Recuerda el fragmento {{A=3;while(A!=3){A++;}}' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const assembly = await ctx.systemPrompt.assemble({
      agent: { id: String(session.id), session },
    } as never)
    expect(() => renderContextSnapshot(assembly)).not.toThrow()
    const context = renderContextSnapshot(assembly)
    expect(context).toContain('{ {A=3;while(A!=3){A++;} }')
    expect(context).not.toContain('summary\":\"{{A=3')
  })

  it('keeps the full memory on disk but avoids all memory context for an unrelated greeting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-cold-index-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    await ctx.plugin(plugin, {})
    const session = ctx.sessions.create(SessionId('memory-cold-session'), { meta: {} })
    await ctx.learningMemory.remember({
      sessionId: String(session.id),
      eventSeq: session.seq,
      kind: 'lesson',
      summary: 'The saved production repair involved verifying workdir and git status before editing.',
      sourceEventType: 'tool/memory_remember',
      confidence: 0.99,
      occurredAt: Date.now(),
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Hola, Kira' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const prompt = renderContextSnapshot(await ctx.systemPrompt.assemble({
      agent: { id: String(session.id), session },
    } as never))
    expect(prompt).not.toContain('The saved production repair')
    expect(prompt).not.toContain('<phoenix-memory>')
    expect(ctx.tools.schemas().map(item => item.name)).toContain('memory_search')
    // Retrieval is a projection. The canonical entry is still present.
    expect(ctx.learningMemory.recall(10).some(item => item.summary.includes('production repair'))).toBe(true)
    const found = ctx.learningMemory.searchCognitive('production repair', 5)
    expect(found.some(hit => hit.record.summary.includes('production repair'))).toBe(true)

    // The same session can retrieve the stored lesson when explicitly asked.
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '¿Cuál fue la solución anterior del production repair?' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const recalledPrompt = renderContextSnapshot(await ctx.systemPrompt.assemble({
      agent: { id: String(session.id), session },
    } as never))
    expect(recalledPrompt).toContain('The saved production repair')
    const manual = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('memory-on-demand'),
      name: 'memory_search',
      agent: { id: session.id, session } as never,
      arguments: { query: 'production repair' },
    })
    expect(manual.isError).toBe(false)
    expect(manual.value).toContain('The saved production repair')
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
  })
  it('retrieves a prior Brewers–Rays choice in its own conversation without leaking another project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-sports-context-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    await ctx.plugin(plugin, {})
    const alpha = ctx.sessions.create(SessionId('sports-memory-alpha'), { meta: { cwd: '/workspace/sports' } })
    const beta = ctx.sessions.create(SessionId('sports-memory-beta'), { meta: { cwd: '/workspace/other' } })
    const assistant = (text: string) => createAssistantMessage({
      content: [{ type: 'text', text }],
      source: { provider: 'test', model: 'test-model' },
    })
    alpha.append('assistant/message', { turn: 1, step: 1, message: assistant('Mi favorito para Brewers–Rays es Milwaukee Brewers.') }, { surfaceOp: 'append' })
    beta.append('assistant/message', { turn: 1, step: 1, message: assistant('Mi favorito para Dodgers–Mets es Los Angeles Dodgers.') }, { surfaceOp: 'append' })
    alpha.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '¿Cuál fue tu favorito en Brewers–Rays?' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await ctx.learningMemory.ready()

    const snapshot = renderContextSnapshot(await ctx.systemPrompt.assemble({
      agent: { id: String(alpha.id), session: alpha },
    } as never))
    expect(snapshot).toContain('Milwaukee Brewers')
    expect(snapshot).not.toContain('Los Angeles Dodgers')
    expect(snapshot).toContain('Kira decision:')
  })

})
