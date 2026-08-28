import type {
  CapabilityDescriptor,
  CapabilityId,
  CapabilityPermission,
} from '@deepseek-ai/dsh-hardness/src/types.ts'
import { OPENCLAW_DONOR_COMMIT, listOpenClawExtensions } from './catalog.ts'
import { toPhoenixCapabilities } from './capabilities.ts'
import type { PhoenixOpenClawCapabilityKind } from './capabilities.ts'

const OPENCLAW_VERSION = '2026.8.1'

function requiredPermissions(
  kind: PhoenixOpenClawCapabilityKind,
  extensionId: string,
): readonly CapabilityPermission[] {
  switch (kind) {
    case 'web-search':
      return [{ kind: 'network.access' }]
    case 'channel':
      return [{ kind: 'message.send', scope: extensionId }]
    case 'computer-use':
    case 'device':
      return [{ kind: 'device.control' }]
    case 'secrets':
      return [{ kind: 'credential.use' }]
    case 'memory':
      return [{ kind: 'memory.access' }]
    case 'work':
      return [{ kind: 'workspace.write' }]
    case 'integration':
      return [{ kind: 'integration.invoke', scope: extensionId }]
    case 'coding':
      return [{ kind: 'code.execute', scope: extensionId }]
    case 'model-provider':
      return [{ kind: 'model.invoke', scope: extensionId }]
    case 'local-inference':
      return [{ kind: 'compute.local', scope: extensionId }]
    case 'agent-protocol':
      return [{ kind: 'agent.invoke', scope: extensionId }]
    case 'voice':
      return [{ kind: 'media.voice', scope: extensionId }]
    case 'media':
      return [{ kind: 'media.generate', scope: extensionId }]
    case 'document':
      return [{ kind: 'document.read' }]
    case 'observability':
      return [{ kind: 'observability.access' }]
    case 'extension':
      return [{ kind: 'extension.invoke', scope: extensionId }]
  }
}

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
    requiredPermissions: [...requiredPermissions(capability.kind, entry.id)],
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