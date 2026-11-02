/** Provider selection helpers for independent structured subagent reviews. */

import type { SubagentProvider } from './types.ts'

/** Minimal provider registry needed to resolve a review-capable provider. */
export interface StructuredProviderRegistry {
  /** Look up one registered provider. */
  getProvider(name: string): SubagentProvider | undefined
  /** Return registered provider names in stable registration order. */
  list(): string[]
}

/** A provider selected for an independent structured review. */
export interface ResolvedStructuredProvider {
  /** Name accepted by the subagent runtime. */
  readonly name: string
  /** Registered provider behind the name. */
  readonly provider: SubagentProvider
}

function canReview(provider: SubagentProvider): boolean {
  return provider.capabilities.outputSchema && provider.capabilities.toolFilter
}

/**
 * Resolve the requested review provider, falling back to a registered provider
 * that can produce structured output and enforce a read-only tool filter.
 * Fresh providers are preferred so an inherited conversation cannot become
 * the sole evidence for an independent review.
 * @param registry - provider registry used by the current host composition.
 * @param requested - configured provider name, preferred when usable.
 * @returns a capable provider, or undefined when the composition has none.
 */
export function resolveStructuredProvider(
  registry: StructuredProviderRegistry,
  requested: string,
): ResolvedStructuredProvider | undefined {
  const names = [...new Set([requested, ...registry.list()])]
  const candidates = names.flatMap((name) => {
    const provider = registry.getProvider(name)
    return provider === undefined || !canReview(provider) ? [] : [{ name, provider }]
  })
  return candidates.find(candidate => !candidate.provider.inheritsParentContext) ?? candidates[0]
}
