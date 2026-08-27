/** Declarative modality router layered over the HARDNESS resolver. */

import type {
  CapabilityDescriptor,
  CapabilityNeed,
  CapabilityRouteOptions,
  CapabilityRouteResult,
  HardnessService,
} from './types.ts'
import { compareCapabilityVersions } from './registry.ts'

const DEFAULT_MODALITIES = ['native'] as const

function selectModality(descriptor: CapabilityDescriptor, preferred: readonly string[]): string | undefined {
  return preferred.find(modality => descriptor.modalities.includes(modality))
}

/** Route a need to a verified capability and modality without execution authority. */
export function routeCapabilityNeed(
  hardness: HardnessService,
  need: CapabilityNeed,
  options: CapabilityRouteOptions = {},
): CapabilityRouteResult {
  const resolution = options.permissions === undefined
    ? hardness.resolveNeed(need)
    : hardness.resolveNeed(need, { permissions: options.permissions })
  if (resolution.kind === 'unknown' || resolution.kind === 'missing') {
    return { kind: resolution.kind, considered: resolution.considered, reasons: resolution.reasons }
  }
  if (resolution.capability === undefined) {
    return { kind: 'missing', considered: resolution.considered, reasons: ['resolver returned no capability'] }
  }

  const preferred = options.modalities ?? DEFAULT_MODALITIES
  const modality = selectModality(resolution.capability, preferred)
  if (modality === undefined) {
    return {
      kind: 'missing',
      considered: resolution.considered,
      reasons: [...resolution.reasons, `capability has no requested modality: ${preferred.join(', ')}`],
    }
  }

  return {
    kind: 'route',
    route: {
      need,
      capability: resolution.capability,
      modality,
      requiredPermissions: resolution.capability.requiredPermissions,
    },
  }
}

/** Stable comparison retained for future multi-candidate resolver results. */
export function compareRoutableCapabilities(left: CapabilityDescriptor, right: CapabilityDescriptor): number {
  const version = compareCapabilityVersions(right.version, left.version)
  return version !== 0 ? version : left.id.localeCompare(right.id)
}
