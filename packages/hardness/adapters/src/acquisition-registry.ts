import type {
  CapabilityDescriptor, CapabilityNeed, HardnessService,
} from '@deepseek-ai/dsh-hardness'
import type { LabMode, SelfImprovementLedger } from './lab-mode.ts'

/** Provider that prepares one capability for a declared HARDNESS need. */
export type CapabilityBuilder = (
  need: CapabilityNeed,
  signal: AbortSignal,
) => Promise<CapabilityDescriptor | undefined>

/** Optional diagnostic source evaluated only when its builder returns no capability. */
export type CapabilityBuilderDiagnostics = (
  need: CapabilityNeed,
) => readonly string[]

/** Learning sinks that retain preparation experience without granting verification. */
export interface MissionLearningHooks {
  readonly lab: LabMode
  readonly ledger: SelfImprovementLedger
}

/** Result of attempting to prepare a capability that was not yet routable. */
export type AcquisitionResult =
  | { readonly kind: 'built'; readonly capability: CapabilityDescriptor; readonly preparationId: string }
  | { readonly kind: 'missing'; readonly reasons: readonly string[] }

interface RegisteredBuilder {
  readonly build: CapabilityBuilder
  readonly diagnostics?: CapabilityBuilderDiagnostics
}

function includesAll(values: readonly string[], required: readonly string[] | undefined): boolean {
  return required === undefined || required.every(value => values.includes(value))
}

function matchesToolIdentity(descriptor: CapabilityDescriptor, requestedKind: string | undefined): boolean {
  if (requestedKind === undefined) return true
  if (descriptor.kind === requestedKind || descriptor.name === requestedKind) return true
  return descriptor.id.slice('tool:'.length) === requestedKind
}

function matchesIndexedNativeTool(descriptor: CapabilityDescriptor, need: CapabilityNeed): boolean {
  if (!descriptor.id.startsWith('tool:')) return false
  if (descriptor.status !== 'experimental') return false
  if (!descriptor.modalities.includes('native')) return false
  if (!matchesToolIdentity(descriptor, need.kind)) return false
  if (!includesAll(descriptor.inputs, need.inputs)) return false
  if (!includesAll(descriptor.outputs, need.outputs)) return false
  return true
}

/**
 * Reuse an already indexed native tool as a one-pass acquisition candidate.
 * This is deliberately narrower than generic capability discovery: only
 * experimental `tool:*` descriptors with a compatible declared contract are
 * eligible. Semantic needs may name the real tool even though older source
 * adapters used the broad `tool` family kind. The AcquisitionRegistry moves
 * the selected descriptor to testing; real execution evidence remains required
 * for verification.
 * @param hardness - HARDNESS inventory containing previously indexed tools.
 * @returns acquisition provider for compatible native tools.
 */
export function createIndexedToolAcquisition(
  hardness: Pick<HardnessService, 'list'>,
): CapabilityBuilder {
  return async (need, signal) => {
    if (signal.aborted) return undefined
    return hardness.list()
      .filter(descriptor => matchesIndexedNativeTool(descriptor, need))
      .sort((left, right) => left.id.localeCompare(right.id))[0]
  }
}

/** Registry of governed providers capable of preparing missing HARDNESS capabilities. */
export class AcquisitionRegistry {
  private readonly builders: RegisteredBuilder[] = []

  constructor(
    private readonly hardness: HardnessService,
    private readonly learning?: MissionLearningHooks,
  ) {}

  /**
   * Register one preparation provider.
   * @param builder - governed provider that may prepare a requested capability.
   * @param diagnostics - optional secret-free reasons retained when the provider cannot prepare the need.
   * @returns disposer that removes the provider from this registry.
   */
  register(builder: CapabilityBuilder, diagnostics?: CapabilityBuilderDiagnostics): () => void {
    const entry: RegisteredBuilder = diagnostics === undefined ? { build: builder } : { build: builder, diagnostics }
    this.builders.push(entry)
    return () => {
      const index = this.builders.indexOf(entry)
      if (index >= 0) this.builders.splice(index, 1)
    }
  }

  /**
   * Prepare the first provider that can satisfy a need.
   * Preparation only advances the capability to `testing`; successful real
   * execution is the sole source of passed evidence and later verification.
   * @param need - capability requirements that were not already routable.
   * @param signal - cancellation signal propagated into preparation providers.
   * @returns built testing capability or explicit missing result.
   */
  async acquireOrBuild(
    need: CapabilityNeed,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<AcquisitionResult> {
    const reasons: string[] = []
    for (const provider of this.builders) {
      if (signal.aborted) return { kind: 'missing', reasons: ['capability acquisition cancelled'] }
      const descriptor = await provider.build(need, signal)
      if (descriptor === undefined) {
        if (provider.diagnostics !== undefined) reasons.push(...provider.diagnostics(need))
        continue
      }
      const existing = this.hardness.get(descriptor.id)
      if (existing === undefined) this.hardness.register(descriptor)
      this.hardness.transition(descriptor.id, 'testing', 'acquisition/build candidate')
      const preparationId = `prepare:${descriptor.id}:${descriptor.version}`
      if (this.learning !== undefined) {
        const experimentId = `build:${descriptor.id}:${descriptor.version}`
        this.learning.lab.record({
          id: experimentId,
          hypothesis: `BUILD provider can prepare ${need.kind ?? 'unknown'}`,
          metric: 'prepared testing capability',
          baseline: 0,
          result: 1,
          datasetHash: preparationId,
          holdout: false,
        })
        this.learning.ledger.record({
          id: `improvement:${experimentId}`,
          hypothesis: `retain ${descriptor.id} as a testing capability pending execution evidence`,
          change: `register testing capability ${descriptor.id}`,
          rollback: `remove capability ${descriptor.id}`,
          sideEffects: [],
        })
      }
      return {
        kind: 'built',
        capability: this.hardness.get(descriptor.id) ?? descriptor,
        preparationId,
      }
    }
    return {
      kind: 'missing',
      reasons: reasons.length > 0 ? [...new Set(reasons)] : [`no acquisition/build provider handles ${need.kind ?? 'unknown'}`],
    }
  }
}
