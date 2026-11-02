import type { CapabilityDescriptor, CapabilityId } from '@phoenix-ai/dsh-hardness/src/types.ts'
import { OPENCLAW_DONOR_COMMIT, listOpenClawExtensions } from './catalog.ts'
import { toPhoenixCapabilities } from './capabilities.ts'

// The donor remains pinned at 2026.8.1. This is the Phoenix descriptor
// revision, which must advance when the projected metadata changes so a live
// process can replace a stale descriptor during resume or HMR.
const HARDNESS_DESCRIPTOR_VERSION = '2026.8.2'

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
