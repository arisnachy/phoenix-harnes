/** HARDNESS capability registry and Tool Atlas service. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  CapabilityDescriptor,
  CapabilityEvidence,
  CapabilityId,
  CapabilityNeed,
  CapabilityRegistration,
  CapabilityResolution,
  CapabilityResolutionContext,
  CapabilityStatus,
  HardnessAtlasSnapshot,
  HardnessService,
} from './types.ts'
import {
  compareCapabilityVersions,
  transitionCapability,
  validateCapabilityDescriptor,
} from './registry.ts'
import { resolveCapabilityNeed } from './resolver.ts'
import { evidenceForCapability, freezeEvidence } from './evidence.ts'

export type * from './types.ts'

/** Cordis service that owns the provider-neutral HARDNESS capability seam. */
export class HardnessRegistry extends Service implements HardnessService {
  private readonly descriptors = new Map<CapabilityId, CapabilityDescriptor>()
  private readonly evidence = new Map<string, CapabilityEvidence>()

  constructor(ctx: Context) {
    super(ctx, 'hardness')
  }

  register(descriptor: CapabilityDescriptor): CapabilityRegistration {
    validateCapabilityDescriptor(descriptor)
    const previous = this.descriptors.get(descriptor.id)
    if (previous !== undefined && compareCapabilityVersions(descriptor.version, previous.version) <= 0) {
      throw new Error(`capability descriptor version ${descriptor.version} is not newer than ${previous.version}`)
    }
    this.descriptors.set(descriptor.id, descriptor)
    return {
      dispose: () => {
        if (this.descriptors.get(descriptor.id) === descriptor) this.descriptors.delete(descriptor.id)
      },
    }
  }

  get(id: CapabilityId): CapabilityDescriptor | undefined {
    return this.descriptors.get(id)
  }

  list(): readonly CapabilityDescriptor[] {
    return [...this.descriptors.values()]
  }

  resolveNeed(need: CapabilityNeed, context: CapabilityResolutionContext = {}): CapabilityResolution {
    return resolveCapabilityNeed(this.list(), need, context)
  }

  transition(id: CapabilityId, status: CapabilityStatus, reason: string, evidenceId?: string): void {
    const descriptor = this.descriptors.get(id)
    if (descriptor === undefined) throw new Error(`unknown capability: ${id}`)
    this.descriptors.set(id, transitionCapability(descriptor, status, reason, evidenceId))
  }

  recordEvidence(value: CapabilityEvidence): CapabilityEvidence {
    const evidence = freezeEvidence(value)
    if (this.evidence.has(evidence.id)) throw new Error(`duplicate evidence: ${evidence.id}`)
    this.evidence.set(evidence.id, evidence)
    return evidence
  }

  evidenceFor(id: CapabilityId): readonly CapabilityEvidence[] {
    return evidenceForCapability(this.evidence, id)
  }

  promoteFromEvidence(evidenceId: string): void {
    const evidence = this.evidence.get(evidenceId)
    if (evidence === undefined) throw new Error(`unknown evidence: ${evidenceId}`)
    if (evidence.outcome !== 'passed') throw new Error(`evidence ${evidenceId} did not pass verification`)
    const descriptor = this.descriptors.get(evidence.capabilityId)
    if (descriptor === undefined) throw new Error(`unknown capability: ${evidence.capabilityId}`)
    if (descriptor.version !== evidence.descriptorVersion) throw new Error(`stale evidence version for ${evidence.capabilityId}`)
    this.transition(evidence.capabilityId, 'verified', 'verification evidence', evidenceId)
  }

  snapshot(): HardnessAtlasSnapshot {
    return {
      formatVersion: 1,
      capabilities: this.list(),
      evidence: [...this.evidence.values()],
    }
  }

  restore(snapshot: HardnessAtlasSnapshot): void {
    const descriptors = new Map<CapabilityId, CapabilityDescriptor>()
    for (const descriptor of snapshot.capabilities) {
      validateCapabilityDescriptor(descriptor)
      if (descriptors.has(descriptor.id)) throw new Error(`duplicate capability in snapshot: ${descriptor.id}`)
      descriptors.set(descriptor.id, descriptor)
    }
    const evidence = new Map<string, CapabilityEvidence>()
    for (const value of snapshot.evidence) {
      const item = freezeEvidence(value)
      if (evidence.has(item.id)) throw new Error(`duplicate evidence in snapshot: ${item.id}`)
      evidence.set(item.id, item)
    }
    this.descriptors.clear()
    this.evidence.clear()
    for (const [id, descriptor] of descriptors) this.descriptors.set(id, descriptor)
    for (const [id, item] of evidence) this.evidence.set(id, item)
  }
}

export default HardnessRegistry
