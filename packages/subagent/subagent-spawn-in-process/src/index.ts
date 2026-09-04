/**
 * The in-process SPAWN subagent backend: registers a provider that runs each
 * child as a fresh child Agent. Git worktree isolation is enabled by default
 * and becomes a no-op outside a Git workspace.
 * @module @phoenix-ai/dsh-subagent-spawn-in-process
 */

import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type {
  ContinuableCreateSpec,
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
} from '@phoenix-ai/dsh-subagent'
import { startInProcessRun } from '@phoenix-ai/dsh-subagent-in-process-driver'

export const name = 'subagent-spawn-in-process'
export const inject = ['subagents']

/** Configuration for the in-process spawn provider. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `spawn`). */
  providerName: string
  /** Isolate one-shot children in Git worktrees when the parent cwd is a repository. */
  worktreeIsolation?: boolean
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('spawn'),
  worktreeIsolation: z.boolean().default(true),
})

class SpawnInProcessProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }
  readonly inheritsParentContext = false

  constructor(readonly name: string, private readonly worktreeIsolation: boolean) {}

  start(request: ResolvedSubagentStartRequest) {
    return startInProcessRun(request, { worktreeIsolation: this.worktreeIsolation })
  }

  prepareContinuable(): Promise<ContinuableCreateSpec> {
    return Promise.resolve({})
  }
}

export function apply(ctx: Context, config: Config): void {
  ctx.subagents.registerProvider(new SpawnInProcessProvider(config.providerName, config.worktreeIsolation ?? true))
}
