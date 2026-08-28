import type {
  CapabilityDescriptor, CapabilityNeed, HardnessService,
} from '@deepseek-ai/dsh-hardness'
import type { LabMode, SelfImprovementLedger } from './lab-mode.ts'

/** Provider that prepares one capability for a declared HARDNESS need. */
export type CapabilityBuilder = (need: CapabilityNeed) => Promise<CapabilityDescriptor | undefined>

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

  /** Register one preparation provider and return its disposer. */
  register(builder: CapabilityBuilder): () => void {
    this.builders.push(builder)
    return () => {
      const index = this.builders.indexOf(builder)
      if (index >= 0) this.builders.splice(index, 1)
    }
  }

  /**
   * Prepare the first provider that can satisfy a need.
   * Preparation only advances the capability to `testing`; successful real
   * execution is the sole source of passed evidence and later verification.
   */
  async acquireOrBuild(need: CapabilityNeed): Promise<AcquisitionResult> {
    for (const builder of this.builders) {
      const descriptor = await builder(need)
      if (descriptor === undefined) continue
      this.hardness.register(descriptor)
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
    return { kind: 'missing', reasons: [`no acquisition/build provider handles ${need.kind ?? 'unknown'}`] }
  }
}
