/** Explicit-grant evaluator; this is not a grant store or execution broker. */

import type { CapabilityPermission, CapabilitySurface } from '@deepseek-ai/dsh-hardness'

/** Result of checking declared capability permissions against explicit grants. */
export type PermissionDecision =
  | { readonly kind: 'approved' }
  | { readonly kind: 'denied'; readonly missing: readonly string[] }

function permissionKey(permission: CapabilityPermission): string {
  return permission.scope === undefined ? permission.kind : `${permission.kind}:${permission.scope}`
}

/** Pure evaluator that never persists or grants permissions itself. */
export class PermissionGate {
  /**
   * Evaluate one capability surface against explicit grant keys.
   * @param surface - capability surface declaring required permissions.
   * @param explicitGrants - grant keys already approved by the authoritative broker.
   * @returns approved when every requirement is granted, otherwise missing keys.
   */
  evaluate(surface: CapabilitySurface, explicitGrants: readonly string[]): PermissionDecision {
    const grants = new Set(explicitGrants)
    const missing = surface.requiredPermissions
      .map(permissionKey)
      .filter(key => !grants.has(key))
    return missing.length === 0 ? { kind: 'approved' } : { kind: 'denied', missing }
  }
}
