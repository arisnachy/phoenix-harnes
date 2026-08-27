/** Safe, serializable projection of a verified HARDNESS route. */

import type { CapabilityRouteResult, CapabilitySurface } from './types.ts'

export function surfaceFromRoute(result: CapabilityRouteResult): CapabilitySurface | undefined {
  if (result.kind !== 'route') return undefined
  const { capability, modality, need, requiredPermissions } = result.route
  return Object.freeze({
    id: `${capability.id}@${capability.version}:${modality}`,
    need,
    capabilityId: capability.id,
    capabilityVersion: capability.version,
    modality,
    inputs: [...capability.inputs],
    outputs: [...capability.outputs],
    requiredPermissions: requiredPermissions.map(permission => ({ ...permission })),
    verification: capability.status,
  })
}
