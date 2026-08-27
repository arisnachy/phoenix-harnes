/** One-shot approval bridge; persistence and execution stay outside HARDNESS. */

import type { CapabilityPermission, CapabilitySurface } from '@deepseek-ai/dsh-hardness'

export type PermissionApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
export type PermissionApprovalRequest = (surface: CapabilitySurface) => Promise<PermissionApprovalOutcome>
export type PermissionBrokerResult =
  | { readonly kind: 'approved'; readonly grants: readonly string[] }
  | { readonly kind: 'denied'; readonly reason: Exclude<PermissionApprovalOutcome, 'allowed-once'> }

function key(permission: CapabilityPermission): string {
  return permission.scope === undefined ? permission.kind : `${permission.kind}:${permission.scope}`
}

export class PermissionBroker {
  constructor(private readonly requestApproval: PermissionApprovalRequest) {}

  async request(surface: CapabilitySurface): Promise<PermissionBrokerResult> {
    const outcome = await this.requestApproval(surface)
    if (outcome !== 'allowed-once') return { kind: 'denied', reason: outcome }
    return { kind: 'approved', grants: surface.requiredPermissions.map(key) }
  }
}
