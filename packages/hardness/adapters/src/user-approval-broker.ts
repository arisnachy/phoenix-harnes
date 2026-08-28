import type { Agent } from '@deepseek-ai/dsh-agent'
import type ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { CapabilityPermission, CapabilitySurface } from '@deepseek-ai/dsh-hardness'
import type { PermissionBrokerResult } from './permission-broker.ts'

/** Live agent and optional cancellation signal for one user-approval request. */
export interface UserApprovalContext {
  readonly agent: Agent
  readonly signal?: AbortSignal
}

/** HARDNESS-facing approval adapter backed by PHOENIX user approval. */
export interface UserApprovalBroker {
  request: (surface: CapabilitySurface, context: UserApprovalContext) => Promise<PermissionBrokerResult>
}

function permissionKey(permission: CapabilityPermission): string {
  return permission.scope === undefined ? permission.kind : `${permission.kind}:${permission.scope}`
}

function reason(surface: CapabilitySurface): string {
  return `Capability requires: ${surface.requiredPermissions.map(permissionKey).join(', ')}`
}

/**
 * Adapt the canonical PHOENIX approval service to the HARDNESS permission-broker result contract.
 * @param approval - Canonical user-approval request service.
 * @returns HARDNESS approval broker that grants only an explicit allowed-once decision.
 */
export function createUserApprovalBroker(approval: Pick<ApprovalService, 'request'>): UserApprovalBroker {
  return {
    request: async (surface, context) => {
      const request = {
        agent: context.agent,
        toolName: surface.capabilityId,
        reason: reason(surface),
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      }
      const outcome: ApprovalOutcome = await approval.request(request)
      if (outcome !== 'allowed-once') return { kind: 'denied', reason: outcome }
      return { kind: 'approved', grants: surface.requiredPermissions.map(permissionKey) }
    },
  }
}
