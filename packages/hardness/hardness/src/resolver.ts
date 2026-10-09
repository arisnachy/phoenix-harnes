/** Deterministic, permission-aware NEED resolver for HARDNESS. */

import type {
  CapabilityDescriptor,
  CapabilityEvidence,
  CapabilityNeed,
  CapabilityResolution,
  CapabilityResolutionContext,
} from './types.ts'

const usableStatuses = new Set(['verified', 'testing'])

function includesAll(values: readonly string[], required: readonly string[] | undefined): boolean {
  return required === undefined || required.every(value => values.includes(value))
}

function permissionsSatisfied(
  descriptor: CapabilityDescriptor,
  context: CapabilityResolutionContext,
): boolean {
  const granted = new Set(context.permissions ?? [])
  return descriptor.requiredPermissions.every(permission => granted.has(permission.kind))
}

function isExactToolKind(descriptor: CapabilityDescriptor, need: CapabilityNeed): boolean {
  return need.kind !== undefined
    && descriptor.kind === 'tool'
    && descriptor.id === `tool:${need.kind}`
}

function kindMatches(descriptor: CapabilityDescriptor, need: CapabilityNeed): boolean {
  return need.kind === undefined || descriptor.kind === need.kind || isExactToolKind(descriptor, need)
}


interface MeasuredCapability {
  readonly successRate: number
  readonly medianPassedMs: number
}

/** Use only current-version independent verification cases, not repeated copies of one receipt. */
function measuredCapability(
  descriptor: CapabilityDescriptor,
  evidence: readonly CapabilityEvidence[],
): MeasuredCapability | undefined {
  const cases = new Map<string, CapabilityEvidence>()
  for (const record of evidence) {
    if (record.capabilityId !== descriptor.id || record.descriptorVersion !== descriptor.version
      || record.outcome === 'denied') continue
    cases.set(record.caseId, record)
  }
  // Sparse or unavailable evidence must preserve deterministic baseline routing.
  if (cases.size < 3) return undefined
  const observations = [...cases.values()]
  const passed = observations.filter(record => record.outcome === 'passed')
  const times = passed.map(record => record.durationMs).sort((left, right) => left - right)
  const middle = Math.floor(times.length / 2)
  const medianPassedMs = times.length === 0
    ? Number.POSITIVE_INFINITY
    : times.length % 2 === 1
      ? times[middle]!
      : (times[middle - 1]! + times[middle]!) / 2
  return { successRate: passed.length / observations.length, medianPassedMs }
}

/**
 * Resolve one need against a stable descriptor snapshot. An exact `tool:<kind>`
 * id is also a semantic provider for that kind; its JSON tool schema owns its
 * argument/output validation, so free-form mission descriptions are not
 * reinterpreted as ATLAS input/output tags for that exact-name route.
 * @param descriptors - immutable capability descriptors considered for resolution.
 * @param need - declarative capability requirements.
 * @param context - ambient permission facts available to the resolver.
 * @returns explicit have, missing, or unknown capability resolution.
 */
export function resolveCapabilityNeed(
  descriptors: readonly CapabilityDescriptor[],
  need: CapabilityNeed,
  context: CapabilityResolutionContext = {},
  evidence: readonly CapabilityEvidence[] = [],
): CapabilityResolution {
  const kindKnown = need.kind === undefined || descriptors.some(descriptor => kindMatches(descriptor, need))
  if (!kindKnown) {
    return { kind: 'unknown', considered: [], reasons: [`unknown capability kind: ${need.kind}`] }
  }

  const considered = descriptors
    .filter(descriptor => kindMatches(descriptor, need))
    .sort((left, right) => left.id.localeCompare(right.id))
  const reasons: string[] = []
  const candidates: CapabilityDescriptor[] = []

  for (const descriptor of considered) {
    const exactTool = isExactToolKind(descriptor, need)
    if (!usableStatuses.has(descriptor.status) || (need.requiredStatus !== undefined && descriptor.status !== need.requiredStatus)) {
      reasons.push(`${descriptor.id}: status is not usable`)
      continue
    }
    if (!exactTool && !includesAll(descriptor.inputs, need.inputs)) {
      reasons.push(`${descriptor.id}: input is not supported`)
      continue
    }
    if (!exactTool && !includesAll(descriptor.outputs, need.outputs)) {
      reasons.push(`${descriptor.id}: output is not supported`)
      continue
    }
    if (need.permissions !== undefined && !need.permissions.every(permission => (context.permissions ?? []).includes(permission))) {
      reasons.push(`${descriptor.id}: required permission is not granted`)
      continue
    }
    if (!permissionsSatisfied(descriptor, context)) {
      reasons.push(`${descriptor.id}: required permission is not granted`)
      continue
    }
    if (descriptor.dependencies.some(dependency => !descriptors.some(candidate => candidate.id === dependency && candidate.status === 'verified'))) {
      reasons.push(`${descriptor.id}: dependency is missing or unverified`)
      continue
    }
    candidates.push(descriptor)
  }

  // Verification status and permissions remain authoritative. Within one status,
  // prefer sufficiently evidenced success, then lower successful wall time.
  const measurements = new Map(candidates.map(candidate => [
    candidate.id, measuredCapability(candidate, evidence),
  ] as const))
  candidates.sort((left, right) => {
    const status = (left.status === 'verified' ? 0 : 1) - (right.status === 'verified' ? 0 : 1)
    if (status !== 0) return status
    const leftEvidence = measurements.get(left.id)
    const rightEvidence = measurements.get(right.id)
    // Unmeasured adapters are neutral: do not invent a success-rate advantage.
    const quality = (rightEvidence?.successRate ?? 0.5) - (leftEvidence?.successRate ?? 0.5)
    if (quality !== 0) return quality
    if (leftEvidence !== undefined && rightEvidence !== undefined
      && leftEvidence.medianPassedMs !== rightEvidence.medianPassedMs) {
      return leftEvidence.medianPassedMs - rightEvidence.medianPassedMs
    }
    return left.dependencies.length - right.dependencies.length || left.id.localeCompare(right.id)
  })
  const selected = candidates[0]
  if (selected !== undefined) return { kind: 'have', capability: selected, considered: considered.map(item => item.id), reasons }
  return { kind: 'missing', considered: considered.map(item => item.id), reasons: reasons.length > 0 ? reasons : ['no usable capability matches the declared need'] }
}
