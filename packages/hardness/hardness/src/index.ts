/** HARDNESS capability registry and Tool Atlas service. */

import { isDeepStrictEqual } from 'node:util'

import { Service, type Context } from '@phoenix-ai/cordis'
import type {
  CapabilityDescriptor,
  CapabilityEvidence,
  CapabilityId,
  CapabilityNeed,
  CapabilityRegistration,
  CapabilityResolution,
  CapabilityResolutionContext,
  CapabilityRouteOptions,
  CapabilityRouteResult,
  CapabilityStatus,
  CapabilitySurface,
  HardnessAtlasSnapshot,
  HardnessService,
} from './types.ts'
import {
  compareCapabilityVersions,
  transitionCapability,
  validateCapabilityDescriptor,
} from './registry.ts'
import { resolveCapabilityNeed } from './resolver.ts'
import { routeCapabilityNeed } from './capability-router.ts'
import { surfaceFromRoute } from './surface.ts'
import { evidenceForCapability, freezeEvidence } from './evidence.ts'

export {
  HARDNESS_PROTOCOL_STEPS,
  evaluateHardnessProtocol,
  renderHardnessProtocol,
} from './operating-protocol.ts'
export type {
  HardnessApprovalState,
  HardnessAuditState,
  HardnessExecutionState,
  HardnessInspectionState,
  HardnessPlanningState,
  HardnessPresentationState,
  HardnessProtocolInput,
  HardnessProtocolOutcome,
  HardnessProtocolStep,
  HardnessProtocolView,
  HardnessVerificationState,
} from './operating-protocol.ts'

export type * from './types.ts'

function sameDescriptorRevision(left: CapabilityDescriptor, right: CapabilityDescriptor): boolean {
  return isDeepStrictEqual({ ...left, status: 'experimental' }, { ...right, status: 'experimental' })
}

function changedDescriptorFields(left: CapabilityDescriptor, right: CapabilityDescriptor): string[] {
  return (Object.keys(left) as Array<keyof CapabilityDescriptor>)
    .filter(key => !isDeepStrictEqual(left[key], right[key]))
    .map(String)
}

/** Cordis service that owns the provider-neutral HARDNESS capability seam. */
export class HardnessRegistry extends Service implements HardnessService {
  private readonly descriptors = new Map<CapabilityId, CapabilityDescriptor>()
  private readonly registrations = new Map<CapabilityId, { descriptor: CapabilityDescriptor; owners: number }>()
  private readonly evidence = new Map<string, CapabilityEvidence>()

  constructor(ctx: Context) {
    super(ctx, 'hardness')
  }

  register(descriptor: CapabilityDescriptor): CapabilityRegistration {
    validateCapabilityDescriptor(descriptor)
    const previous = this.descriptors.get(descriptor.id)
    const versionOrder = previous === undefined ? 1 : compareCapabilityVersions(descriptor.version, previous.version)
    if (versionOrder < 0) {
      throw new Error(`capability descriptor version ${descriptor.version} is not newer than ${previous?.version ?? 'an existing revision'}`)
    }
    if (previous !== undefined && versionOrder === 0 && !sameDescriptorRevision(descriptor, previous)) {
      const fields = changedDescriptorFields(descriptor, previous)
      throw new Error(
        `capability descriptor ${descriptor.id} version ${descriptor.version} is not newer than ${previous.version}`
        + `; changed fields: ${fields.join(', ') || 'unknown'}`,
      )
    }
    const owner = versionOrder === 0 && previous !== undefined ? previous : descriptor
    if (versionOrder > 0) {
      this.descriptors.set(descriptor.id, owner)
      this.registrations.set(descriptor.id, { descriptor: owner, owners: 1 })
    } else {
      const registration = this.registrations.get(descriptor.id)
      if (registration === undefined || registration.descriptor.version !== owner.version) {
        this.registrations.set(descriptor.id, { descriptor: owner, owners: 1 })
      } else {
        registration.descriptor = owner
        registration.owners += 1
      }
    }
    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        const current = this.registrations.get(descriptor.id)
        if (current === undefined || current.descriptor.version !== owner.version) return
        current.owners -= 1
        if (current.owners === 0) {
          this.registrations.delete(descriptor.id)
          this.descriptors.delete(descriptor.id)
        }
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

  route(need: CapabilityNeed, options: CapabilityRouteOptions = {}): CapabilityRouteResult {
    return routeCapabilityNeed(this, need, options)
  }

  surface(result: CapabilityRouteResult): CapabilitySurface | undefined {
    return surfaceFromRoute(result)
  }

  transition(id: CapabilityId, status: CapabilityStatus, reason: string, evidenceId?: string): void {
    const descriptor = this.descriptors.get(id)
    if (descriptor === undefined) throw new Error(`unknown capability: ${id}`)
    this.descriptors.set(id, transitionCapability(descriptor, status, reason, evidenceId))
  }

  /**
   * Validate, freeze, and store one evidence record.
   * @param value - evidence record to persist in the in-memory index.
   * @returns immutable evidence stored by the registry.
   */
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
    this.registrations.clear()
    this.evidence.clear()
    for (const [id, descriptor] of descriptors) {
      this.descriptors.set(id, descriptor)
      this.registrations.set(id, { descriptor, owners: 1 })
    }
    for (const [id, item] of evidence) this.evidence.set(id, item)
  }
}

export default HardnessRegistry
