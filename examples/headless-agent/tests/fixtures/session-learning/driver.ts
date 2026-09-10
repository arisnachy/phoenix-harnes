#!/usr/bin/env node
/** Boot the real session-learning composition and record model requests plus durable logs. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import type { AgentHandle } from '@phoenix-ai/dsh-agent'
import type { Context } from '@phoenix-ai/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@phoenix-ai/dsh-app-boot'
import type {} from '@phoenix-ai/dsh-session'
import { SessionId } from '@phoenix-ai/dsh-session'
import type {} from '@phoenix-ai/dsh-session-learning'
import type {} from '@phoenix-ai/dsh-session-persistence'
import { drainCaptures, type MemoryCapture } from './mock-llm.ts'

const NAME = 'session-learning-test-driver'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error(`${NAME}: expected <config-path>`)

interface StableMemory {
  readonly sessionId: string
  readonly kind: string
  readonly summary: string
}

interface StoredRow {
  readonly type?: string
  readonly data?: {
    readonly header?: { readonly system?: string }
    readonly content?: readonly { readonly type?: string; readonly text?: string }[]
  }
}

function relevantMemories(system: string | undefined): StableMemory[] {
  const match = system?.match(/<phoenix-memory>\n([\s\S]*?)\n<\/phoenix-memory>/u)
  if (match?.[1] === undefined) return []
  const parsed = JSON.parse(match[1]) as { memories?: readonly { session_id?: unknown; kind?: unknown; summary?: unknown }[] }
  return (parsed.memories ?? []).flatMap(item => typeof item.session_id === 'string'
    && typeof item.kind === 'string'
    && typeof item.summary === 'string'
    && item.summary.startsWith('MEMORY_')
    ? [{ sessionId: item.session_id, kind: item.kind, summary: item.summary }]
    : [])
}

async function runTurn(handle: AgentHandle, task: string, ctx: Context): Promise<void> {
  await handle.agent.whenIdle()
  handle.agent.followup(createUserMessage({
    content: [{ type: 'text', text: task }],
    source: { kind: 'user' },
  }))
  await handle.agent.whenIdle()
  await ctx.sessions.flush(handle.agent.session)
}

async function remember(ctx: Context, sessionId: string, summary: string, occurredAt: number): Promise<void> {
  await ctx.learningMemory.remember({
    sessionId,
    eventSeq: 0,
    kind: 'lesson',
    summary,
    sourceEventType: 'fixture/learning-memory',
    confidence: 0.95,
    occurredAt,
  })
}

async function storedMemories(ctx: Context, sessionId: string): Promise<StableMemory[]> {
  const artifact = await ctx.sessionPersistence.readRaw(SessionId(sessionId))
  if (artifact === undefined) throw new Error(`missing durable log for ${sessionId}`)
  const rows = artifact.content.trimEnd().split('\n').map(line => JSON.parse(line) as StoredRow)
  return rows.flatMap(row => row.type === 'user/message'
    ? row.data?.content?.flatMap(block => block.type === 'text' ? relevantMemories(block.text) : []) ?? []
    : [])
}

async function ledgerMemories(ctx: Context): Promise<StableMemory[]> {
  const text = await readFile(ctx.learningMemory.storagePath, 'utf8')
  return text.trimEnd().split('\n').filter(Boolean).flatMap((line) => {
    const row = JSON.parse(line) as { op?: string; record?: { sessionId?: unknown; kind?: unknown; summary?: unknown } }
    const record = row.record
    return row.op === 'upsert' && record !== undefined
      && typeof record.sessionId === 'string'
      && typeof record.kind === 'string'
      && typeof record.summary === 'string'
      && record.summary.startsWith('MEMORY_')
      ? [{ sessionId: record.sessionId, kind: record.kind, summary: record.summary }]
      : []
  })
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
const handles: AgentHandle[] = []
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const projectA = join(process.cwd(), 'a', 'same-name')
  const projectB = join(process.cwd(), 'b', 'same-name')

  const firstA = await ctx.agents.create({
    sessionId: SessionId('learning-a-first'),
    agentOptions: { provider: 'learning-mock', model: 'learning-mock' },
    meta: { cwd: projectA },
  })
  handles.push(firstA)
  await remember(ctx, 'learning-a-first', 'MEMORY_PROJECT_A_ONLY', 1_000)
  await runTurn(firstA, 'Read the project A memory.', ctx)

  const secondA = await ctx.agents.create({
    sessionId: SessionId('learning-a-second'),
    agentOptions: { provider: 'learning-mock', model: 'learning-mock' },
    meta: { cwd: projectA },
  })
  handles.push(secondA)
  await runTurn(secondA, 'Continue in the same project.', ctx)

  const firstB = await ctx.agents.create({
    sessionId: SessionId('learning-b-first'),
    agentOptions: { provider: 'learning-mock', model: 'learning-mock' },
    meta: { cwd: projectB },
  })
  handles.push(firstB)
  await remember(ctx, 'learning-b-first', 'MEMORY_PROJECT_B_ONLY', 2_000)
  await runTurn(firstB, 'Read the project B memory.', ctx)

  await ctx.learningMemory.ready()
  const requests = drainCaptures().map((capture: MemoryCapture) => ({
    sessionId: capture.sessionId,
    memories: capture.memories.filter(memory => memory.summary.startsWith('MEMORY_')),
  }))
  const logs = []
  for (const sessionId of ['learning-a-first', 'learning-a-second', 'learning-b-first']) {
    logs.push({ sessionId, memories: await storedMemories(ctx, sessionId) })
  }
  process.stdout.write(`${JSON.stringify({
    type: 'learning_memory_snapshot',
    requests,
    logs,
    ledger: await ledgerMemories(ctx),
  })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  for (const handle of handles.reverse()) await handle.dispose()
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
