/** Public capability and Tool Atlas contracts for HARDNESS. */

export type CapabilityId = string & { readonly __capabilityId: unique symbol }

export type CapabilityKind = string

export type CapabilityStatus =
  | 'experimental'
  | 'testing'
  | 'verified'
  | 'broken'
  | 'quarantined'
  | 'deprecated'

export interface CapabilityPermission {
  readonly kind: string
  readonly scope?: string
}

export interface CapabilityDescriptor {
  readonly id: CapabilityId
  readonly kind: CapabilityKind
  readonly name: string
  readonly description: string
  readonly inputs: readonly string[]
  readonly outputs: readonly string[]
  readonly dependencies: readonly CapabilityId[]
  readonly requiredPermissions: readonly CapabilityPermission[]
  readonly provider: string
  readonly location: string
  readonly version: string
  readonly compatibility: readonly string[]
  readonly limitations: readonly string[]
  readonly status: CapabilityStatus
}

export interface CapabilityEvidence {
  readonly id: string
  readonly capabilityId: CapabilityId
  readonly descriptorVersion: string
  readonly caseId: string
  readonly inputSummary: string
  readonly outcome: 'passed' | 'failed' | 'denied'
  readonly durationMs: number
  readonly artifactRefs: readonly string[]
}

export interface CapabilityNeed {
  readonly kind?: CapabilityKind
  readonly inputs?: readonly string[]
  readonly outputs?: readonly string[]
  readonly requiredStatus?: CapabilityStatus
  readonly permissions?: readonly string[]
}

export interface CapabilityResolution {
  readonly kind: 'have' | 'missing' | 'unknown'
  readonly capability?: CapabilityDescriptor
  readonly considered: readonly string[]
  readonly reasons: readonly string[]
}

export interface CapabilityRegistration {
  readonly dispose: () => void
}

export interface HardnessService {
  register(descriptor: CapabilityDescriptor): CapabilityRegistration
  get(id: CapabilityId): CapabilityDescriptor | undefined
  list(): readonly CapabilityDescriptor[]
  resolveNeed(need: CapabilityNeed): CapabilityResolution
  transition(id: CapabilityId, status: CapabilityStatus, reason: string, evidenceId?: string): void
}
