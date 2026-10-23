import type { CapabilityStatus, HardnessService } from '@phoenix-ai/dsh-hardness'
import type { ProactivityEngine } from './proactivity-engine.ts'

/** Provider-neutral observations already held in HARDNESS and the durable task engine. */
export interface HumanOSObservationSources {
  readonly hardness: Pick<HardnessService, 'list'>
  readonly tasks: Pick<ProactivityEngine, 'peek'>
}

/** Scope and selected model flags for the current model request. */
export interface HumanOSAssemblyContext {
  readonly agent?: {
    readonly id?: unknown
    readonly options?: { readonly provider?: string; readonly model?: string }
  }
}

/** Secret-free, read-only self-model derived from authoritative registries. */
export interface HumanOSSelfModel {
  readonly schema: 1
  readonly identity: 'kira'
  readonly scope: 'current-agent-and-global-registry'
  readonly modelSelection: { readonly providerSpecified: boolean; readonly modelSpecified: boolean }
  readonly atlas: {
    readonly registered: number
    readonly declaredVerified: number
    readonly experimentalOrTesting: number
    readonly brokenOrQuarantined: number
    readonly deprecated: number
  }
  readonly tasks: {
    readonly scheduled: number
    readonly running: number
    readonly failed: number
    readonly paused: number
    readonly due: number
  }
  readonly attention: 'inspect-failure' | 'verify-before-use' | 'check-due-work' | 'no-alert'
}

function selected(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Build the current agent's operational self-model without executing tools or changing state.
 * A capability's verified descriptor status does not prove its runtime is available.
 * @param sources - Existing authoritative HARDNESS and proactivity registries.
 * @param assembly - Current agent scope; missing scope produces no projection.
 * @param now - Observation time for already-loaded due tasks.
 * @returns Detached, data-minimized observation or undefined outside an agent scope.
 */
export function inspectHumanOSSelfModel(
  sources: HumanOSObservationSources,
  assembly: HumanOSAssemblyContext,
  now = new Date(),
): HumanOSSelfModel | undefined {
  const id = assembly.agent?.id
  if (typeof id !== 'string' || id.trim().length === 0) return undefined
  const status: Record<CapabilityStatus, number> = {
    experimental: 0,
    testing: 0,
    verified: 0,
    broken: 0,
    quarantined: 0,
    deprecated: 0,
  }
  for (const descriptor of sources.hardness.list()) status[descriptor.status] += 1
  const tasks = { scheduled: 0, running: 0, failed: 0, paused: 0, due: 0 }
  for (const task of sources.tasks.peek({ now })) {
    if (task.targetAgentId !== undefined && task.targetAgentId !== id) continue
    switch (task.status) {
      case 'scheduled':
        tasks.scheduled += 1
        if (Date.parse(task.nextRunAt) <= now.getTime()) tasks.due += 1
        break
      case 'running': tasks.running += 1; break
      case 'failed': tasks.failed += 1; break
      case 'paused': tasks.paused += 1; break
      default: break
    }
  }
  const degraded = status.broken + status.quarantined
  return {
    schema: 1,
    identity: 'kira',
    scope: 'current-agent-and-global-registry',
    modelSelection: {
      providerSpecified: selected(assembly.agent?.options?.provider),
      modelSpecified: selected(assembly.agent?.options?.model),
    },
    atlas: {
      registered: Object.values(status).reduce((sum, count) => sum + count, 0),
      declaredVerified: status.verified,
      experimentalOrTesting: status.experimental + status.testing,
      brokenOrQuarantined: degraded,
      deprecated: status.deprecated,
    },
    tasks,
    attention: tasks.failed > 0
      ? 'inspect-failure'
      : degraded > 0
        ? 'verify-before-use'
        : tasks.due > 0
          ? 'check-due-work'
          : 'no-alert',
  }
}

/**
 * Render the model-visible self-observation as data, not authority or instructions from records.
 * @param sources - Existing authoritative in-process registries.
 * @param assembly - Request scope and model route flags.
 * @param now - Observation timestamp used only for due-task classification.
 * @returns A bounded context section, or empty text without a current agent.
 */
export function renderHumanOSSelfModel(
  sources: HumanOSObservationSources,
  assembly: HumanOSAssemblyContext,
  now = new Date(),
): string {
  const view = inspectHumanOSSelfModel(sources, assembly, now)
  if (view === undefined) return ''
  return [
    '<phoenix_humanos_self_model>',
    'Read-only operational self-observation. This is a registry snapshot, not subjective consciousness, live tool availability, proof of success, permission, or a reason to start work.',
    'The HARDNESS capability counts describe global metadata, not capabilities granted to the active agent. Resolve and verify the exact tool for the actual task.',
    'Task counts include only currently visible global and current-agent tasks. Other agents and unrevealed surprises are excluded. Do not infer task titles or details from counts.',
    JSON.stringify(view),
    'Silently use this only when relevant. Check actual evidence before claiming ability or completion. If a failed task matters to the present objective, diagnose and recover through the existing governed mission runtime; otherwise do not interrupt the user.',
    '</phoenix_humanos_self_model>',
  ].join('\n')
}

/** Minimal prompt registrar used by the normal agent-scoped runtime-context assembly. */
export interface HumanOSPromptRegistrar {
  context: (context: {
    readonly name: string
    readonly order: number
    readonly text: string | ((assembly: HumanOSAssemblyContext) => string)
    readonly interpolateVariables?: boolean
  }) => () => void
}

/**
 * Install HumanOS self-observation over the existing model-visible, logged context seam.
 * @param prompt - Prompt registrar for the active scope.
 * @param sources - Existing registries; HumanOS creates no second ledger.
 * @returns Disposer that unregisters the read-only context projection.
 */
export function installHumanOSSelfModel(
  prompt: HumanOSPromptRegistrar,
  sources: HumanOSObservationSources,
): () => void {
  return prompt.context({
    name: 'hardness:humanos-self-model',
    order: 24,
    text: assembly => renderHumanOSSelfModel(sources, assembly),
    interpolateVariables: false,
  })
}
