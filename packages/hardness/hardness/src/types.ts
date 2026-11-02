/** Public capability and Tool Atlas contracts for HARDNESS. */

/** Opaque identifier for one capability registered in HARDNESS. */
export type CapabilityId = string & { readonly __capabilityId: unique symbol }
/** Provider-neutral capability family identifier. */
export type CapabilityKind = string
/** Supported execution or presentation modality for a capability. */
export type CapabilityModality = 'native' | 'visual' | 'workspace' | 'sandbox' | 'generative-ui' | (string & {})
/** Lifecycle status enforced by the HARDNESS registry. */
export type CapabilityStatus = 'experimental' | 'testing' | 'verified' | 'broken' | 'quarantined' | 'deprecated'

/** Permission declaration required by a capability without granting authority. */
export interface CapabilityPermission {
  readonly kind: string
  readonly scope?: string
}

/** Complete declarative capability record stored in the Tool Atlas. */
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

/** Immutable evidence attached to one capability execution or verification case. */
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

/** Declarative capability requirements supplied to resolution. */
export interface CapabilityNeed {
  readonly kind?: CapabilityKind
  readonly inputs?: readonly string[]
  readonly outputs?: readonly string[]
  readonly requiredStatus?: CapabilityStatus
  readonly permissions?: readonly string[]
}

/** Ambient facts available to capability resolution. */
export interface CapabilityResolutionContext {
  readonly permissions?: readonly string[]
}

/** Provider-neutral result of resolving one capability need. */
export interface CapabilityResolution {
  readonly kind: 'have' | 'missing' | 'unknown'
  readonly capability?: CapabilityDescriptor
  readonly considered: readonly string[]
  readonly reasons: readonly string[]
}

/** Routing preferences layered over capability resolution. */
export interface CapabilityRouteOptions extends CapabilityResolutionContext {
  readonly modalities?: readonly CapabilityModality[]
}

/** Safe route selected for one capability need without execution authority. */
export interface CapabilityRoute {
  readonly need: CapabilityNeed
  readonly capability: CapabilityDescriptor
  readonly modality: CapabilityModality
  readonly requiredPermissions: readonly CapabilityPermission[]
}

/** Serializable capability projection that can cross into presentation surfaces. */
export interface CapabilitySurface {
  readonly id: string
  readonly need: CapabilityNeed
  readonly capabilityId: CapabilityId
  readonly capabilityVersion: string
  readonly modality: CapabilityModality
  readonly inputs: readonly string[]
  readonly outputs: readonly string[]
  readonly requiredPermissions: readonly CapabilityPermission[]
  readonly verification: CapabilityStatus
}

/** Optional safe capability surface produced only for a routed capability. */
export type CapabilitySurfaceResult = CapabilitySurface | undefined

/** Result of capability routing, including explicit missing and unknown states. */
export type CapabilityRouteResult =
  | { readonly kind: 'route'; readonly route: CapabilityRoute }
  | { readonly kind: 'missing'; readonly considered: readonly string[]; readonly reasons: readonly string[] }
  | { readonly kind: 'unknown'; readonly considered: readonly string[]; readonly reasons: readonly string[] }

/** Disposable registration returned when a capability enters the registry. */
export interface CapabilityRegistration {
  readonly dispose: () => void
}

/** Durable versioned snapshot of the HARDNESS Tool Atlas. */
export interface HardnessAtlasSnapshot {
  readonly formatVersion: 1
  readonly capabilities: readonly CapabilityDescriptor[]
  readonly evidence: readonly CapabilityEvidence[]
}

/** Canonical provider-neutral HARDNESS registry, resolution, routing, and evidence service. */
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
  surface(result: CapabilityRouteResult): CapabilitySurfaceResult
}
