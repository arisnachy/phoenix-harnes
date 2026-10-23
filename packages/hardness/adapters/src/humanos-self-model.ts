import type { CapabilityStatus, HardnessService } from '@phoenix-ai/dsh-hardness'
import type { ProactivityEngine } from './proactivity-engine.ts'

/** Provider-neutral observations already held in HARDNESS and the durable task engine. */
export interface HumanOSObservationSources {
  readonly hardness: Pick<HardnessService, 'snapshot'>
  readonly tasks: Pick<ProactivityEngine, 'peek'>
}

/** Scope and selected model flags for the current model request. */
export interface HumanOSAssemblyContext {
  readonly agent?: {
    readonly id?: unknown
    readonly options?: { readonly provider?: string; readonly model?: string }
    /** Existing session log; only own tool-result envelopes are inspected. */
    readonly session?: { readonly events?: readonly { readonly type: string; readonly data?: unknown }[] }
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
  readonly verification: {
    /** This is audit evidence for descriptor versions, not proof of runtime availability. */
    readonly examinedCapabilities: number
    readonly unexaminedCapabilities: number
    readonly samplePage: number
    readonly totalPages: number
    readonly sampleStrategy: 'current-evidence-first'
    readonly currentPasses: number
    readonly currentFailures: number
    readonly currentDenials: number
    readonly outdatedVersionRecords: number
    readonly capabilitiesWithoutCurrentEvidence: number
    readonly capabilitiesWithConflictingEvidence: number
  }
  /** Observed session results, NOT formally verified capabilities. */
  readonly toolActivity: {
    readonly inspectedResults: number
    readonly succeeded: number
    readonly failed: number
    readonly unclassified: number
    readonly sampleLimit: 128
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

/** Limit registry observation cost even when providers publish very large catalogs. */
const MAX_VERIFICATION_CAPABILITIES = 64
const MAX_EVIDENCE_PER_CAPABILITY = 12
const MAX_SESSION_TOOL_RESULTS = 128

function selected(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Build the current agent's operational self-model without executing tools or changing state.
 * A capability's verified descriptor status does not prove its runtime is available.
 * @param sources - Existing authoritative HARDNESS and proactivity registries.
 * @param assembly - Current agent scope; missing scope produces no projection.
 * @param now - Observation time for already-loaded due tasks.
 * @param page - Zero-based bounded sample page for inspection of larger registries.
 * @returns Detached, data-minimized observation or undefined outside an agent scope.
 */
export function inspectHumanOSSelfModel(
  sources: HumanOSObservationSources,
  assembly: HumanOSAssemblyContext,
  now = new Date(),
  page = 0,
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
  const snapshot = sources.hardness.snapshot()
  const descriptors = snapshot.capabilities
  // Prefer capabilities with evidence for the *current descriptor version*.
  // Otherwise a large atlas can report zero examined passes even when known
  // evidence sits after the first 64 registrations. Keep every sample bounded.
  const versionById = new Map(descriptors.map(item => [item.id, item.version]))
  const withCurrentEvidence = new Set<string>()
  for (const evidence of snapshot.evidence) {
    if (versionById.get(evidence.capabilityId) === evidence.descriptorVersion) {
      withCurrentEvidence.add(evidence.capabilityId)
    }
  }
  const ordered = [
    ...descriptors.filter(item => withCurrentEvidence.has(item.id)),
    ...descriptors.filter(item => !withCurrentEvidence.has(item.id)),
  ]
  const totalPages = Math.max(1, Math.ceil(descriptors.length / MAX_VERIFICATION_CAPABILITIES))
  const samplePage = Number.isSafeInteger(page) && page >= 0 ? Math.min(page, totalPages - 1) : 0
  const offset = samplePage * MAX_VERIFICATION_CAPABILITIES
  const sample = ordered.slice(offset, offset + MAX_VERIFICATION_CAPABILITIES)
  const examined = new Set(sample.map(item => item.id))
  const evidenceById = new Map<string, typeof snapshot.evidence[number][]>()
  for (const evidence of snapshot.evidence) {
    if (!examined.has(evidence.capabilityId)) continue
    const bucket = evidenceById.get(evidence.capabilityId) ?? []
    if (bucket.length >= MAX_EVIDENCE_PER_CAPABILITY) bucket.shift()
    bucket.push(evidence)
    evidenceById.set(evidence.capabilityId, bucket)
  }
  const verification = {
    examinedCapabilities: 0,
    unexaminedCapabilities: descriptors.length - sample.length,
    samplePage,
    totalPages,
    sampleStrategy: 'current-evidence-first' as const,
    currentPasses: 0,
    currentFailures: 0,
    currentDenials: 0,
    outdatedVersionRecords: 0,
    capabilitiesWithoutCurrentEvidence: 0,
    capabilitiesWithConflictingEvidence: 0,
  }
  for (const descriptor of descriptors) {
    if (Object.hasOwn(status, descriptor.status)) status[descriptor.status] += 1
  }
  for (const descriptor of sample) {
    verification.examinedCapabilities += 1
    // Versions and outcomes come from the authoritative registry, never model claims.
    const records = evidenceById.get(descriptor.id) ?? []
    let passes = 0
    let failures = 0
    for (const evidence of records) {
      if (evidence.descriptorVersion !== descriptor.version) {
        verification.outdatedVersionRecords += 1
        continue
      }
      switch (evidence.outcome) {
        case 'passed': verification.currentPasses += 1; passes += 1; break
        case 'failed': verification.currentFailures += 1; failures += 1; break
        case 'denied': verification.currentDenials += 1; break
      }
    }
    const current = passes + failures + records.filter(
      evidence => evidence.descriptorVersion === descriptor.version && evidence.outcome === 'denied',
    ).length
    if (current === 0) verification.capabilitiesWithoutCurrentEvidence += 1
    if (passes > 0 && failures > 0) verification.capabilitiesWithConflictingEvidence += 1
  }
  // Read only this agent's durable session events. Tool execution success is
  // NOT an independently verified HARDNESS capability and must never promote a
  // descriptor. Ignore nested payloads, input arguments, identities, and text.
  const toolActivity = {
    inspectedResults: 0,
    succeeded: 0,
    failed: 0,
    unclassified: 0,
    sampleLimit: MAX_SESSION_TOOL_RESULTS as 128,
  }
  const entries = assembly.agent?.session?.events ?? []
  // Traverse newest-first with fixed output and allocation bounds. Do not
  // materialize all tool messages in a potentially long persisted session.
  let sampled = 0
  for (let index = entries.length - 1; index >= 0 && sampled < MAX_SESSION_TOOL_RESULTS; index--) {
    const event = entries[index]
    if (event?.type !== 'tool/result') continue
    sampled += 1
    const envelope = event.data
    const data = typeof envelope === 'object' && envelope !== null
      ? envelope as Record<string, unknown> : undefined
    const message = data?.message
    const record = typeof message === 'object' && message !== null
      ? message as Record<string, unknown> : undefined
    const blocks = record?.content
    const block = Array.isArray(blocks) ? blocks[0] : undefined
    if (typeof block !== 'object' || block === null || (block as Record<string, unknown>).type !== 'tool-result') continue
    toolActivity.inspectedResults += 1
    const result = block as Record<string, unknown>
    if (result.isError === true) toolActivity.failed += 1
    else if (result.isError === false) toolActivity.succeeded += 1
    else toolActivity.unclassified += 1
  }
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
      registered: descriptors.length,
      declaredVerified: status.verified,
      experimentalOrTesting: status.experimental + status.testing,
      brokenOrQuarantined: degraded,
      deprecated: status.deprecated,
    },
    verification,
    toolActivity,
    tasks,
    attention: tasks.failed > 0
      ? 'inspect-failure'
      : degraded > 0 || verification.currentFailures > 0 || verification.capabilitiesWithConflictingEvidence > 0
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
    'HARDNESS descriptor counts are global metadata, not current-agent access. The verification sample prioritizes records for current descriptor versions and can be inspected page by page; other pages remain unexamined. Verification outcome counts describe a bounded sample of existing recorded cases and exact descriptor versions, not live ability, statistical probabilities or model confidence.',
    'A failed, denied, missing, stale or contradictory verification case calls for task-specific rechecking, not an automatic tool retry or permission escalation. Resolve the exact capability with the existing permission gates.',
    'toolActivity reports only bounded current-session tool-result envelopes; successful tool calls do not count as formal HARDNESS verification. Task counts include only currently visible global and current-agent tasks. Other agents and unrevealed surprises are excluded. Do not infer task titles or details from counts.',
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
