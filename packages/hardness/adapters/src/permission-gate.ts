/** Explicit-grant evaluator; this is not a grant store or execution broker. */

import type { CapabilityPermission, CapabilitySurface } from '@deepseek-ai/dsh-hardness'

export type PermissionDecision =
  | { readonly kind: 'approved' }
  | { readonly kind: 'denied'; readonly missing: readonly string[] }

function permissionKey(permission: CapabilityPermission): string {
  return permission.scope === undefined ? permission.kind : `${permission.kind}:${permission.scope}`
}

export class PermissionGate {
  evaluate(surface: CapabilitySurface, explicitGrants: readonly string[]): PermissionDecision {
    const grants = new Set(explicitGrants)
    const missing = surface.requiredPermissions
      .map(permissionKey)
      .filter(key => !grants.has(key))
    return missing.length === 0 ? { kind: 'approved' } : { kind: 'denied', missing }
  }
}
