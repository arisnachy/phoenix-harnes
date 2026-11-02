/** One-shot approval bridge; persistence and execution stay outside HARDNESS. */

import type { CapabilityPermission, CapabilitySurface } from '@phoenix-ai/dsh-hardness'

/** One-shot outcome returned by the host approval surface. */
export type PermissionApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
/** Host approval callback for one capability surface. */
export type PermissionApprovalRequest = (surface: CapabilitySurface) => Promise<PermissionApprovalOutcome>
/** Permission broker result expressed as explicit grants or a denial reason. */
export type PermissionBrokerResult =
  | { readonly kind: 'approved'; readonly grants: readonly string[] }
  | { readonly kind: 'denied'; readonly reason: Exclude<PermissionApprovalOutcome, 'allowed-once'> }

function key(permission: CapabilityPermission): string {
  return permission.scope === undefined ? permission.kind : `${permission.kind}:${permission.scope}`
}

/** Converts one-shot host approval into explicit capability grant keys. */
export class PermissionBroker {
  constructor(private readonly requestApproval: PermissionApprovalRequest) {}

  /**
   * Request one-shot approval for a capability surface.
   * @param surface - capability surface declaring the permissions it requires.
   * @returns explicit grants when allowed once, otherwise a typed denial.
   */
  async request(surface: CapabilitySurface): Promise<PermissionBrokerResult> {
    const outcome = await this.requestApproval(surface)
    if (outcome !== 'allowed-once') return { kind: 'denied', reason: outcome }
    return { kind: 'approved', grants: surface.requiredPermissions.map(key) }
  }
}
