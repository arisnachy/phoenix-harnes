/** Public capability and Tool Atlas contracts for HARDNESS. */

export type CapabilityId = string & { readonly __capabilityId: unique symbol }
export type CapabilityKind = string
export type CapabilityModality = 'native' | 'visual' | 'workspace' | 'sandbox' | 'generative-ui' | (string & {})
export type CapabilityStatus = 'experimental' | 'testing' | 'verified' | 'broken' | 'quarantined' | 'deprecated'

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
  readonly modalities: readonly CapabilityModality[]
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

export interface CapabilityResolutionContext {
  readonly permissions?: readonly string[]
}

export interface CapabilityResolution {
  readonly kind: 'have' | 'missing' | 'unknown'
  readonly capability?: CapabilityDescriptor
  readonly considered: readonly string[]
  readonly reasons: readonly string[]
}

export interface CapabilityRouteOptions extends CapabilityResolutionContext {
  readonly modalities?: readonly CapabilityModality[]
}

export interface CapabilityRoute {
  readonly need: CapabilityNeed
  readonly capability: CapabilityDescriptor
  readonly modality: CapabilityModality
  readonly requiredPermissions: readonly CapabilityPermission[]
}

export type CapabilityRouteResult =
  | { readonly kind: 'route'; readonly route: CapabilityRoute }
  | { readonly kind: 'missing'; readonly considered: readonly string[]; readonly reasons: readonly string[] }
  | { readonly kind: 'unknown'; readonly considered: readonly string[]; readonly reasons: readonly string[] }

export interface CapabilityRegistration {
  readonly dispose: () => void
}

export interface HardnessAtlasSnapshot {
  readonly formatVersion: 1
  readonly capabilities: readonly CapabilityDescriptor[]
  readonly evidence: readonly CapabilityEvidence[]
}

export interface HardnessService {
  register(descriptor: CapabilityDescriptor): CapabilityRegistration
  get(id: CapabilityId): CapabilityDescriptor | undefined
  list(): readonly CapabilityDescriptor[]
  resolveNeed(need: CapabilityNeed, context?: CapabilityResolutionContext): CapabilityResolution
  transition(id: CapabilityId, status: CapabilityStatus, reason: string, evidenceId?: string): void
  recordEvidence(evidence: CapabilityEvidence): CapabilityEvidence
  evidenceFor(id: CapabilityId): readonly CapabilityEvidence[]
  promoteFromEvidence(evidenceId: string): void
  snapshot(): HardnessAtlasSnapshot
  restore(snapshot: HardnessAtlasSnapshot): void
  route(need: CapabilityNeed, options?: CapabilityRouteOptions): CapabilityRouteResult
}
