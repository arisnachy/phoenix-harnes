import type { CapabilityDescriptor, CapabilityId } from '@phoenix-ai/dsh-hardness/src/types.ts'
import { OPENCLAW_DONOR_COMMIT, listOpenClawExtensions } from './catalog.ts'
import { toPhoenixCapabilities } from './capabilities.ts'

// The donor is pinned to the verified OpenClaw 2026.9.6 stable release.
// This Phoenix descriptor revision advances with projected metadata so a live
// process can replace stale descriptors during resume or HMR.
const HARDNESS_DESCRIPTOR_VERSION = '2026.9.6'

/**
 * Project every pinned donor extension into non-routable HARDNESS metadata.
 * @returns Experimental descriptors visible to ATLAS until individually verified.
 */
export function toHardnessCapabilityDescriptors(): CapabilityDescriptor[] {
  return listOpenClawExtensions().flatMap(entry => toPhoenixCapabilities(entry).map(capability => ({
    id: capability.id as CapabilityId,
    kind: capability.kind,
    name: `OpenClaw · ${entry.id}`,
    description: `OpenClaw extension ${entry.id}, exposed through the Phoenix compatibility boundary.`,
    inputs: [],
    outputs: [capability.kind],
    dependencies: [],
    requiredPermissions: [],
    provider: 'openclaw',
    location: entry.sourcePath,
    version: HARDNESS_DESCRIPTOR_VERSION,
    compatibility: [
      `donor:${OPENCLAW_DONOR_COMMIT}`,
      'phoenix:openclaw-compat-v1',
    ],
    limitations: [
      'experimental compatibility descriptor; activation remains Phoenix capability-gated',
    ],
    modalities: ['native'],
    status: 'experimental',
  })))
}
