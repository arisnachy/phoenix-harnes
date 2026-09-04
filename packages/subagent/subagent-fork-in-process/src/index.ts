/**
 * The in-process FORK subagent backend: runs each child seeded with the
 * parent's balanced completed-turn prefix. One-shot fork children use Git
 * worktree isolation by default when the parent cwd belongs to a repository.
 * @module @phoenix-ai/dsh-subagent-fork-in-process
 */

import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type { SessionEvent } from '@phoenix-ai/dsh-session'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type {
  ContinuableCreateRequest,
  ContinuableCreateSpec,
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
} from '@phoenix-ai/dsh-subagent'
import { startInProcessRun } from '@phoenix-ai/dsh-subagent-in-process-driver'

export const name = 'subagent-fork-in-process'
export const inject = ['subagents']

export interface Config {
  /** Provider name on `ctx.subagents` (default `fork`). */
  providerName: string
  /** Isolate one-shot children in Git worktrees when the parent cwd is a repository. */
  worktreeIsolation?: boolean
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('fork'),
  worktreeIsolation: z.boolean().default(true),
})

function completedTurnPrefix(parent: Agent): SessionEvent[] {
  const events = parent.session.events
  const lastEnd = events.findLast(e => e.type === 'turn/end')
  if (lastEnd === undefined) return []
  return events.slice(0, lastEnd.seq + 1)
}

class ForkInProcessProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }
  readonly inheritsParentContext = true

  constructor(readonly name: string, private readonly worktreeIsolation: boolean) {}

  start(request: ResolvedSubagentStartRequest) {
    const seed = completedTurnPrefix(request.parent)
    return startInProcessRun(request, {
      ...seed.length > 0 ? { seed } : {},
      worktreeIsolation: this.worktreeIsolation,
    })
  }

  // Continuable fork semantics remain shared-workspace today because that path
  // is owned by the continuation manager rather than this one-shot driver.
  prepareContinuable(request: ContinuableCreateRequest): Promise<ContinuableCreateSpec> {
    const seed = completedTurnPrefix(request.parent)
    return Promise.resolve(seed.length > 0 ? { seed } : {})
  }
}

export function apply(ctx: Context, config: Config): void {
  ctx.subagents.registerProvider(new ForkInProcessProvider(config.providerName, config.worktreeIsolation ?? true))
}
