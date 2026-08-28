import type { CapabilityDescriptor, CapabilityStatus } from '@deepseek-ai/dsh-hardness'

/** Compact model/UI-facing projection of one ATLAS search result. */
export interface CapabilitySearchMatch {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly description: string
  readonly status: CapabilityStatus
  readonly provider: string
  readonly executable: boolean
  readonly requiredPermissions: readonly string[]
  readonly limitations: readonly string[]
  readonly score: number
}

const STATUS_SCORE: Readonly<Record<CapabilityStatus, number>> = {
  verified: 16,
  testing: 10,
  experimental: 3,
  broken: -20,
  quarantined: -30,
  deprecated: -40,
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[_./:-]+/gu, ' ').replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/gu, ' ').trim()
}

function tokens(value: string): readonly string[] {
  const normalized = normalize(value)
  return normalized.length === 0 ? [] : normalized.split(' ')
}

function tokenOverlapScore(queryTokens: readonly string[], value: string, weight: number): number {
  if (queryTokens.length === 0) return 0
  const haystack = new Set(tokens(value))
  return queryTokens.reduce((score, token) => score + (haystack.has(token) ? weight : 0), 0)
}

function permissionLabel(permission: CapabilityDescriptor['requiredPermissions'][number]): string {
  return permission.scope === undefined ? permission.kind : `${permission.kind}:${permission.scope}`
}

function scoreCapability(descriptor: CapabilityDescriptor, query: string, queryTokens: readonly string[]): number {
  const normalizedQuery = normalize(query)
  if (normalizedQuery.length === 0) return 0
  const id = normalize(descriptor.id)
  const kind = normalize(descriptor.kind)
  const name = normalize(descriptor.name)
  const description = normalize(descriptor.description)
  const compatibility = normalize(descriptor.compatibility.join(' '))

  let relevance = 0
  if (kind === normalizedQuery) relevance += 120
  if (name === normalizedQuery || id === normalizedQuery || id.endsWith(` ${normalizedQuery}`)) relevance += 110
  if (kind.includes(normalizedQuery)) relevance += 55
  if (name.includes(normalizedQuery) || id.includes(normalizedQuery)) relevance += 45
  if (description.includes(normalizedQuery)) relevance += 24
  relevance += tokenOverlapScore(queryTokens, `${descriptor.kind} ${descriptor.name} ${descriptor.id}`, 18)
  relevance += tokenOverlapScore(queryTokens, descriptor.description, 7)
  relevance += tokenOverlapScore(queryTokens, compatibility, 3)
  return relevance === 0 ? 0 : relevance + STATUS_SCORE[descriptor.status]
}

/**
 * Search a HARDNESS snapshot without copying the complete inventory into model context.
 * The algorithm is deterministic and dependency-free: exact semantic identity wins,
 * then token/prose overlap and lifecycle confidence. Unsafe states remain visible for
 * diagnosis but are explicitly marked non-executable.
 * @param descriptors - immutable ATLAS descriptor snapshot.
 * @param query - user/mission capability intent.
 * @param limit - maximum results to project; clamped to 1..12.
 * @returns ranked compact capability projections.
 */
export function searchCapabilityAtlas(
  descriptors: readonly CapabilityDescriptor[],
  query: string,
  limit = 6,
): readonly CapabilitySearchMatch[] {
  const boundedLimit = Math.max(1, Math.min(12, Number.isSafeInteger(limit) ? limit : 6))
  const queryTokens = tokens(query)
  if (queryTokens.length === 0) return []

  return descriptors
    .map(descriptor => ({ descriptor, score: scoreCapability(descriptor, query, queryTokens) }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.descriptor.id.localeCompare(right.descriptor.id))
    .slice(0, boundedLimit)
    .map(({ descriptor, score }) => Object.freeze({
      id: descriptor.id,
      kind: descriptor.kind,
      name: descriptor.name,
      description: descriptor.description,
      status: descriptor.status,
      provider: descriptor.provider,
      executable: descriptor.status === 'verified' || descriptor.status === 'testing',
      requiredPermissions: Object.freeze(descriptor.requiredPermissions.map(permissionLabel)),
      limitations: Object.freeze([...descriptor.limitations]),
      score,
    }))
}