/** HARDNESS capability registry and Tool Atlas service. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  CapabilityDescriptor,
  CapabilityId,
  CapabilityNeed,
  CapabilityRegistration,
  CapabilityResolution,
  CapabilityResolutionContext,
  CapabilityStatus,
  HardnessService,
} from './types.ts'
import {
  compareCapabilityVersions,
  transitionCapability,
  validateCapabilityDescriptor,
} from './registry.ts'
import { resolveCapabilityNeed } from './resolver.ts'

export type * from './types.ts'

/** Cordis service that owns the provider-neutral HARDNESS capability seam. */
export class HardnessRegistry extends Service implements HardnessService {
  private readonly descriptors = new Map<CapabilityId, CapabilityDescriptor>()

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
}

export default HardnessRegistry
