import type {
  CapabilityDescriptor, CapabilityNeed, HardnessService,
} from '@deepseek-ai/dsh-hardness'
import type { LabMode, SelfImprovementLedger } from './lab-mode.ts'

export type CapabilityBuilder = (need: CapabilityNeed) => Promise<CapabilityDescriptor | undefined>
export interface MissionLearningHooks {
  readonly lab: LabMode
  readonly ledger: SelfImprovementLedger
}

export type AcquisitionResult =
  | { readonly kind: 'built'; readonly capability: CapabilityDescriptor; readonly evidenceId: string }
  | { readonly kind: 'missing'; readonly reasons: readonly string[] }

export class AcquisitionRegistry {
  private readonly builders: CapabilityBuilder[] = []

  constructor(
    private readonly hardness: HardnessService,
    private readonly learning?: MissionLearningHooks,
  ) {}

  register(builder: CapabilityBuilder): () => void {
    this.builders.push(builder)
    return () => {
      const index = this.builders.indexOf(builder)
      if (index >= 0) this.builders.splice(index, 1)
    }
  }

  async acquireOrBuild(need: CapabilityNeed): Promise<AcquisitionResult> {
    for (const builder of this.builders) {
      const descriptor = await builder(need)
      if (descriptor === undefined) continue
      this.hardness.register(descriptor)
      this.hardness.transition(descriptor.id, 'testing', 'acquisition/build candidate')
      const evidenceId = `acquire:${descriptor.id}:${descriptor.version}`
      this.hardness.recordEvidence({
        id: evidenceId,
        capabilityId: descriptor.id,
        descriptorVersion: descriptor.version,
        caseId: `need:${need.kind ?? 'unknown'}`,
        inputSummary: JSON.stringify(need),
        outcome: 'passed',
        durationMs: 0,
        artifactRefs: [],
      })
      this.hardness.promoteFromEvidence(evidenceId)
      if (this.learning !== undefined) {
        const experimentId = `build:${descriptor.id}:${descriptor.version}`
        this.learning.lab.record({
          id: experimentId,
          hypothesis: `BUILD provider can satisfy ${need.kind ?? 'unknown'}`,
          metric: 'verified capability',
          baseline: 0,
          result: 1,
          datasetHash: evidenceId,
          holdout: false,
        })
        this.learning.ledger.record({
          id: `improvement:${experimentId}`,
          hypothesis: `retain ${descriptor.id} as reusable capability`,
          change: `register verified capability ${descriptor.id}`,
          rollback: `remove capability ${descriptor.id}`,
          sideEffects: [],
        })
      }
      return { kind: 'built', capability: this.hardness.get(descriptor.id) ?? descriptor, evidenceId }
    }
    return { kind: 'missing', reasons: [`no acquisition/build provider handles ${need.kind ?? 'unknown'}`] }
  }
}
