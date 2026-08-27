/** HARDNESS capability registry and Tool Atlas service. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  CapabilityDescriptor,
  CapabilityId,
  CapabilityNeed,
  CapabilityRegistration,
  CapabilityResolution,
  HardnessService,
} from './types.ts'

export type * from './types.ts'

/** Cordis service that owns the provider-neutral HARDNESS capability seam. */
export class HardnessRegistry extends Service implements HardnessService {
  private readonly descriptors = new Map<CapabilityId, CapabilityDescriptor>()

  constructor(ctx: Context) {
    super(ctx, 'hardness')
  }

  register(descriptor: CapabilityDescriptor): CapabilityRegistration {
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

  resolveNeed(_need: CapabilityNeed): CapabilityResolution {
    return {
      kind: 'unknown',
      considered: [],
      reasons: ['capability resolver is not initialized'],
    }
  }
}

export default HardnessRegistry
