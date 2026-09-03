/** Deterministic, permission-aware NEED resolver for HARDNESS. */

import type {
  CapabilityDescriptor,
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

  const selected = candidates[0]
  if (selected !== undefined) return { kind: 'have', capability: selected, considered: considered.map(item => item.id), reasons }
  return { kind: 'missing', considered: considered.map(item => item.id), reasons: reasons.length > 0 ? reasons : ['no usable capability matches the declared need'] }
}