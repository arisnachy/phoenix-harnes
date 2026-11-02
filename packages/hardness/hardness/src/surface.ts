/** Safe, serializable projection of a verified HARDNESS route. */

import type { CapabilityRouteResult, CapabilitySurface } from './types.ts'

/**
 * Project a routed capability into a serializable UI-safe surface.
 * @param result - capability routing result to project.
 * @returns frozen surface for a routed capability, otherwise undefined.
 */
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
