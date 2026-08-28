import type { CapabilityDescriptor, CapabilityId, CapabilityStatus } from '@deepseek-ai/dsh-hardness'

/** Relationship assigned to one deterministic census group. */
export type CapabilityCensusClassification = 'unique' | 'exact-duplicate' | 'overlapping'

/** One non-destructive group of semantically related capabilities. */
export interface CapabilityCensusGroup {
  readonly kind: string
  readonly classification: CapabilityCensusClassification
  readonly canonicalId: CapabilityId
  readonly memberIds: readonly CapabilityId[]
  readonly behavioralFingerprint?: string
}

/** Aggregate inventory facts suitable for ATLAS observability. */
export interface CapabilityCensus {
  readonly total: number
  /** Number of canonical semantic groups after grouping duplicates/variants. */
  readonly unique: number
  /** Number of non-canonical descriptors in exact-duplicate groups. */
  readonly duplicates: number
  /** Number of descriptors participating in overlapping same-kind groups. */
  readonly overlapping: number
  readonly groups: readonly CapabilityCensusGroup[]
}

const STATUS_PRIORITY: Readonly<Record<CapabilityStatus, number>> = {
  verified: 6,
  testing: 5,
  experimental: 4,
  broken: 3,
  quarantined: 2,
  deprecated: 1,
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function permissionKey(permission: CapabilityDescriptor['requiredPermissions'][number]): string {
  return permission.scope === undefined ? permission.kind : `${permission.kind}:${permission.scope}`
}

/**
 * Stable behavioral fingerprint deliberately excludes identity, provider,
 * status, prose, and version. Two independent grafts with the same semantic
 * family and declared contract are duplicates for routing purposes while all
 * original provenance remains in ATLAS.
 */
export function capabilityBehavioralFingerprint(descriptor: CapabilityDescriptor): string {
  return JSON.stringify({
    kind: descriptor.kind,
    inputs: sorted(descriptor.inputs),
    outputs: sorted(descriptor.outputs),
    dependencies: sorted(descriptor.dependencies),
    permissions: sorted(descriptor.requiredPermissions.map(permissionKey)),
    modalities: sorted(descriptor.modalities),
  })
}

function richness(descriptor: CapabilityDescriptor): number {
  return descriptor.inputs.length
    + descriptor.outputs.length
    + descriptor.dependencies.length
    + descriptor.requiredPermissions.length
    + descriptor.compatibility.length
    + descriptor.modalities.length
}

function compareCanonical(left: CapabilityDescriptor, right: CapabilityDescriptor): number {
  const status = STATUS_PRIORITY[right.status] - STATUS_PRIORITY[left.status]
  if (status !== 0) return status
  const contract = richness(right) - richness(left)
  if (contract !== 0) return contract
  const version = right.version.localeCompare(left.version, undefined, { numeric: true })
  if (version !== 0) return version
  return left.id.localeCompare(right.id)
}

function groupForKind(descriptors: readonly CapabilityDescriptor[]): CapabilityCensusGroup[] {
  if (descriptors.length === 1) {
    const only = descriptors[0]!
    return [{ kind: only.kind, classification: 'unique', canonicalId: only.id, memberIds: [only.id] }]
  }

  const byFingerprint = new Map<string, CapabilityDescriptor[]>()
  for (const descriptor of descriptors) {
    const fingerprint = capabilityBehavioralFingerprint(descriptor)
    const members = byFingerprint.get(fingerprint) ?? []
    members.push(descriptor)
    byFingerprint.set(fingerprint, members)
  }

  if (byFingerprint.size === 1) {
    const [fingerprint, members] = [...byFingerprint.entries()][0]!
    const ranked = [...members].sort(compareCanonical)
    return [{
      kind: ranked[0]!.kind,
      classification: 'exact-duplicate',
      canonicalId: ranked[0]!.id,
      memberIds: ranked.map(item => item.id),
      behavioralFingerprint: fingerprint,
    }]
  }

  const ranked = [...descriptors].sort(compareCanonical)
  return [{
    kind: ranked[0]!.kind,
    classification: 'overlapping',
    canonicalId: ranked[0]!.id,
    memberIds: ranked.map(item => item.id),
  }]
}

/**
 * Build a deterministic, non-destructive census over the current ATLAS
 * descriptor snapshot. No descriptor is mutated or removed.
 * @param descriptors - immutable capability inventory snapshot.
 * @returns grouped census with canonical recommendations and duplicate counts.
 */
export function buildCapabilityCensus(descriptors: readonly CapabilityDescriptor[]): CapabilityCensus {
  const byKind = new Map<string, CapabilityDescriptor[]>()
  for (const descriptor of descriptors) {
    const members = byKind.get(descriptor.kind) ?? []
    members.push(descriptor)
    byKind.set(descriptor.kind, members)
  }

  const groups = [...byKind.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, members]) => groupForKind(members))
  const duplicates = groups
    .filter(group => group.classification === 'exact-duplicate')
    .reduce((count, group) => count + Math.max(0, group.memberIds.length - 1), 0)
  const overlapping = groups
    .filter(group => group.classification === 'overlapping')
    .reduce((count, group) => count + group.memberIds.length, 0)

  return Object.freeze({
    total: descriptors.length,
    unique: groups.length,
    duplicates,
    overlapping,
    groups: Object.freeze(groups.map(group => Object.freeze({
      ...group,
      memberIds: Object.freeze([...group.memberIds]),
    }))),
  })
}