import type {
  CapabilityDescriptor, CapabilityNeed, HardnessService,
} from '@deepseek-ai/dsh-hardness'

export type CapabilityBuilder = (need: CapabilityNeed) => Promise<CapabilityDescriptor | undefined>
export type AcquisitionResult =
  | { readonly kind: 'built'; readonly capability: CapabilityDescriptor; readonly evidenceId: string }
  | { readonly kind: 'missing'; readonly reasons: readonly string[] }

export class AcquisitionRegistry {
  private readonly builders: CapabilityBuilder[] = []

  constructor(private readonly hardness: HardnessService) {}

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
      return { kind: 'built', capability: this.hardness.get(descriptor.id) ?? descriptor, evidenceId }
    }
    return { kind: 'missing', reasons: [`no acquisition/build provider handles ${need.kind ?? 'unknown'}`] }
  }
}
