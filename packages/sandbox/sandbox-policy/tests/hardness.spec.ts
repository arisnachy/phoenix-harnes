/** PHOENIX HARDNESS self-protection tests for the shared sandbox policy. */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import SandboxPolicyService from '@phoenix-ai/dsh-sandbox-policy'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'

const previousRuntimeRoot = process.env.PHOENIX_RUNTIME_ROOT
const previousEvolutionRoot = process.env.PHOENIX_EVOLUTION_ROOT
const previousDshHome = process.env.DSH_HOME

function restoreEnv(name: 'PHOENIX_RUNTIME_ROOT' | 'PHOENIX_EVOLUTION_ROOT' | 'DSH_HOME', value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name)
  else process.env[name] = value
}

afterEach(() => {
  restoreEnv('PHOENIX_RUNTIME_ROOT', previousRuntimeRoot)
  restoreEnv('PHOENIX_EVOLUTION_ROOT', previousEvolutionRoot)
  restoreEnv('DSH_HOME', previousDshHome)
})

function activeSession(id: string, cwd: string): Session {
  const sessionId = SessionId(id)
  return Session.create(sessionId, undefined, {
    version: 0,
    id: sessionId,
    createdAt: 0,
    cwd,
  })
}

async function mounted(defaultMode: 'read-only' | 'workspace-write' | 'danger-full-access' = 'danger-full-access'): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SandboxPolicyService, { mode: defaultMode })
  return ctx
}

async function promptMounted(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SandboxPolicyService, { mode: 'danger-full-access' })
  return ctx
}

function agentFor(session: Session): Agent {
  return { session } as unknown as Agent
}

function createLayout(): { root: string; runtime: string; data: string; evolution: string; project: string } {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-hardness-'))
  const runtime = join(root, 'runtime')
  const data = join(root, 'data')
  const evolution = join(root, 'evolution')
  const project = join(root, 'project')
  for (const path of [runtime, data, evolution, project]) mkdirSync(path)
  return { root, runtime, data, evolution, project }
}

function enableHardness(layout: { runtime: string; data: string; evolution?: string }): void {
  process.env.PHOENIX_RUNTIME_ROOT = layout.runtime
  process.env.DSH_HOME = layout.data
  if (layout.evolution === undefined) delete process.env.PHOENIX_EVOLUTION_ROOT
  else process.env.PHOENIX_EVOLUTION_ROOT = layout.evolution
}

describe('PHOENIX HARDNESS sandbox policy', () => {
  it('preserves normal danger-full-access semantics when the launcher did not enable HARDNESS', async () => {
    delete process.env.PHOENIX_RUNTIME_ROOT
    delete process.env.PHOENIX_EVOLUTION_ROOT
    const layout = createLayout()
    try {
      process.env.DSH_HOME = layout.data
      const ctx = await mounted()
      expect(ctx.sandboxPolicy.resolve({ session: activeSession('normal', layout.project) })).toEqual({
        mode: 'danger-full-access',
        workspaceRoot: resolve(layout.project),
        sessionId: 'normal',
      })
    } finally {
      rmSync(layout.root, { recursive: true, force: true })
    }
  })

  it('clamps danger-full-access to workspace-write for ordinary projects while HARDNESS is active', async () => {
    const layout = createLayout()
    try {
      enableHardness(layout)
      const ctx = await mounted()
      expect(ctx.sandboxPolicy.resolve({ session: activeSession('project', layout.project) })).toEqual({
        mode: 'workspace-write',
        workspaceRoot: resolve(layout.project),
        sessionId: 'project',
      })
    } finally {
      rmSync(layout.root, { recursive: true, force: true })
    }
  })

  it('redirects a writable live-runtime session to the isolated evolution worktree', async () => {
    const layout = createLayout()
    try {
      enableHardness(layout)
      const ctx = await mounted('workspace-write')
      expect(ctx.sandboxPolicy.resolve({ session: activeSession('self-edit', layout.runtime) })).toEqual({
        mode: 'workspace-write',
        workspaceRoot: resolve(layout.evolution),
        sessionId: 'self-edit',
      })
    } finally {
      rmSync(layout.root, { recursive: true, force: true })
    }
  })

  it('redirects durable PHOENIX-home mutation to the same isolated evolution worktree', async () => {
    const layout = createLayout()
    try {
      enableHardness(layout)
      const ctx = await mounted()
      expect(ctx.sandboxPolicy.resolve({ session: activeSession('data-home', layout.data) })).toEqual({
        mode: 'workspace-write',
        workspaceRoot: resolve(layout.evolution),
        sessionId: 'data-home',
      })
    } finally {
      rmSync(layout.root, { recursive: true, force: true })
    }
  })

  it('fails self-modification closed when no evolution worktree is available', async () => {
    const layout = createLayout()
    try {
      enableHardness({ runtime: layout.runtime, data: layout.data })
      const ctx = await mounted()
      expect(ctx.sandboxPolicy.resolve({ session: activeSession('no-evolution', layout.runtime) })).toEqual({
        mode: 'read-only',
        workspaceRoot: resolve(layout.runtime),
        sessionId: 'no-evolution',
      })
    } finally {
      rmSync(layout.root, { recursive: true, force: true })
    }
  })

  it('rejects an evolution root that overlaps the live runtime', async () => {
    const layout = createLayout()
    const unsafeEvolution = join(layout.runtime, 'unsafe-evolution')
    mkdirSync(unsafeEvolution)
    try {
      enableHardness({ runtime: layout.runtime, data: layout.data, evolution: unsafeEvolution })
      const ctx = await mounted()
      expect(ctx.sandboxPolicy.resolve({ session: activeSession('unsafe-evolution', layout.runtime) }).mode).toBe('read-only')
    } finally {
      rmSync(layout.root, { recursive: true, force: true })
    }
  })

  it('keeps an explicitly read-only live-runtime session read-only even when an evolution worktree exists', async () => {
    const layout = createLayout()
    try {
      enableHardness(layout)
      const ctx = await mounted('read-only')
      expect(ctx.sandboxPolicy.resolve({ session: activeSession('readonly', layout.runtime) })).toEqual({
        mode: 'read-only',
        workspaceRoot: resolve(layout.runtime),
        sessionId: 'readonly',
      })
    } finally {
      rmSync(layout.root, { recursive: true, force: true })
    }
  })

  it('tells the model where self-evolution is allowed when HARDNESS redirects the runtime workspace', async () => {
    const layout = createLayout()
    try {
      enableHardness(layout)
      const ctx = await promptMounted()
      const assembly = await ctx.systemPrompt.assemble({ agent: agentFor(activeSession('prompt', layout.runtime)) })
      const policy = assembly.contexts.find(context => context.name === 'sandbox:policy')?.text
      expect(policy).toContain('PHOENIX HARDNESS runtime protection is active')
      expect(policy).toContain(resolve(layout.evolution))
      expect(policy).toContain('isolated evolution worktree')
    } finally {
      rmSync(layout.root, { recursive: true, force: true })
    }
  })

  it('tells the model self-modification is unavailable when the safe worktree could not be created', async () => {
    const layout = createLayout()
    try {
      enableHardness({ runtime: layout.runtime, data: layout.data })
      const ctx = await promptMounted()
      const assembly = await ctx.systemPrompt.assemble({ agent: agentFor(activeSession('prompt-readonly', layout.runtime)) })
      const policy = assembly.contexts.find(context => context.name === 'sandbox:policy')?.text
      expect(policy).toContain('No isolated evolution worktree is currently available')
      expect(policy).toContain('read-only')
    } finally {
      rmSync(layout.root, { recursive: true, force: true })
    }
  })
})
