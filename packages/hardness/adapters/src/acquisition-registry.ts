import type {
  CapabilityDescriptor, CapabilityId, CapabilityNeed, HardnessService,
} from '@phoenix-ai/dsh-hardness'
import type { LabMode, SelfImprovementLedger } from './lab-mode.ts'

/** Provider that prepares one capability for a declared HARDNESS need. */
export type CapabilityBuilder = (
  need: CapabilityNeed,
  signal: AbortSignal,
) => Promise<CapabilityDescriptor | undefined>

/** Learning sinks that retain preparation experience without granting verification. */
export interface MissionLearningHooks {
  readonly lab: LabMode
  readonly ledger: SelfImprovementLedger
}

/** Result of attempting to prepare a capability that was not yet routable. */
export type AcquisitionResult =
  | { readonly kind: 'built'; readonly capability: CapabilityDescriptor; readonly preparationId: string }
  | { readonly kind: 'missing'; readonly reasons: readonly string[] }

/** Registry of governed providers capable of preparing missing HARDNESS capabilities. */
export class AcquisitionRegistry {
  private readonly builders: CapabilityBuilder[] = []

  constructor(
    private readonly hardness: HardnessService,
    private readonly learning?: MissionLearningHooks,
  ) {}

  /**
   * Register one preparation provider.
   * @param builder - governed provider that may prepare a requested capability.
   * @returns disposer that removes the provider from this registry.
   */
  register(builder: CapabilityBuilder): () => void {
    this.builders.push(builder)
    return () => {
      const index = this.builders.indexOf(builder)
      if (index >= 0) this.builders.splice(index, 1)
    }
  }

  private prepareCandidate(descriptor: CapabilityDescriptor, need: CapabilityNeed): AcquisitionResult {
    const existing = this.hardness.get(descriptor.id)
    if (existing?.status === 'quarantined' || existing?.status === 'broken') {
      return { kind: 'missing', reasons: [`${descriptor.id} is ${existing.status}`] }
    }
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

  /**
   * Prepare the first provider that can satisfy a need. Existing tools whose
   * canonical id is exactly `tool:<need.kind>` are valid local acquisition
   * candidates, so a model-facing tool does not become an external dependency
   * merely because its generic ATLAS descriptor kind is `tool`.
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
    for (const builder of this.builders) {
      if (signal.aborted) return { kind: 'missing', reasons: ['capability acquisition cancelled'] }
      const descriptor = await builder(need, signal)
      if (descriptor === undefined) continue
      const existing = this.hardness.get(descriptor.id)
      // A provider that returns the same quarantined or broken descriptor is
      // not an alternative route. Keep searching ATLAS for another provider
      // instead of reviving the exact strategy that just failed.
      if (existing?.status === 'quarantined' || existing?.status === 'broken') continue
      return this.prepareCandidate(descriptor, need)
    }

    if (need.kind !== undefined) {
      const tool = this.hardness.get(`tool:${need.kind}` as CapabilityId)
      if (tool?.kind === 'tool' && tool.status !== 'quarantined' && tool.status !== 'broken') {
        return this.prepareCandidate(tool, need)
      }
    }

    return { kind: 'missing', reasons: [`no acquisition/build provider handles ${need.kind ?? 'unknown'}`] }
  }
}