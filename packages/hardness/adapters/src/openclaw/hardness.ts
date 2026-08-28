import type { CapabilityDescriptor, CapabilityId } from '@deepseek-ai/dsh-hardness/src/types.ts'
import { OPENCLAW_DONOR_COMMIT, listOpenClawExtensions } from './catalog.ts'
import { toPhoenixCapabilities } from './capabilities.ts'

const OPENCLAW_VERSION = '2026.8.1'

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
    version: OPENCLAW_VERSION,
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
