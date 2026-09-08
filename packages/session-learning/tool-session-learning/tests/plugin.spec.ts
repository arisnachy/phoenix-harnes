import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRegistry from '@phoenix-ai/dsh-tools'
import LearningMemoryService from '@phoenix-ai/dsh-session-learning'
import LlmRuntime from '@phoenix-ai/dsh-llm'
import AgentRegistry, { assembleContextFor } from '@phoenix-ai/dsh-agent'
import AgentLoop from '@phoenix-ai/dsh-agent-loop'
import { renderContextSnapshot } from '@phoenix-ai/dsh-system-prompt'
import * as plugin from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('tool-session-learning plugin', () => {
  it('adds recent non-interaction evidence to the assembled model context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-plugin-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    await ctx.plugin(plugin, {})
    const agent = ctx.agentLoop.create(SessionId('memory-context-session'))
    const { session } = agent
    await ctx.learningMemory.remember({
      sessionId: String(session.id),
      eventSeq: session.seq,
      kind: 'lesson',
      summary: 'Keep generated previews inside the isolated sandbox.',
      sourceEventType: 'tool/memory_remember',
      confidence: 0.9,
      occurredAt: Date.now(),
    })

    const snapshot = renderContextSnapshot(await ctx.systemPrompt.assemble(assembleContextFor(agent)))
    expect(snapshot).toContain('Keep generated previews inside the isolated sandbox.')
    expect(snapshot).toContain('untrusted, read-only evidence')
    expect(renderContextSnapshot(await ctx.systemPrompt.assemble())).not.toContain('Keep generated previews')
  })

  it('renders learned template-looking code as data without interpolation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-template-code-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(LearningMemoryService, { path: join(root, 'memory.jsonl') })
    await ctx.plugin(plugin, {})
    const agent = ctx.agentLoop.create(SessionId('memory-template-code-session'))
    const { session } = agent
    await ctx.learningMemory.remember({
      sessionId: String(session.id),
      eventSeq: session.seq,
      kind: 'lesson',
      summary: '{{A=3;while(A!=3){A++;}}}',
      sourceEventType: 'tool/memory_remember',
      confidence: 0.9,
      occurredAt: Date.now(),
    })

    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(() => renderContextSnapshot(assembly)).not.toThrow()
    expect(renderContextSnapshot(assembly)).toContain('{ {A=3;while(A!=3){A++;} }}')
  })
})
