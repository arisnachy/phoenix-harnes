/** Deterministic META checks over independent reviewer output and observed route availability. */
export interface MetaReviewRoute { readonly provider: string; readonly model: string }
type Verdict = 'pass' | 'needs_changes' | 'blocked'

/** Check a judge for logical consistency, not semantic correctness. */
export function validMetaVerdict(input: {
  readonly verdict: Verdict
  readonly evidence: readonly string[]
  readonly requiredChanges: readonly string[]
  readonly failedCriterion?: boolean
  readonly qualityFailed?: boolean
}): boolean {
  if (input.verdict === 'pass') return input.evidence.length > 0 && input.requiredChanges.length === 0
    && input.failedCriterion !== true && input.qualityFailed !== true
  return input.verdict !== 'needs_changes' || input.requiredChanges.length > 0
}

/** Require distinct review findings; duplicate IDs or conflicting rows are invalid. */
export function uniqueMetaCriteria(rows: readonly { readonly id: string }[]): boolean {
  return new Set(rows.map(row => row.id.trim())).size === rows.length
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Fail closed unless a configured distinct route has recent provider quota and registration.
 * Quota percentages are advisory, not a guarantee or authorization for paid usage.
 * @param route - Owner-configured route for optional independent review.
 * @param primary - Current serving route, when known.
 * @param ai - Secret-free live Reality Context AI projection.
 * @param now - Current wall time.
 * @returns Whether the existing review budget may consider the configured route.
 */
export function metaRouteEligible(route: MetaReviewRoute, primary: MetaReviewRoute | undefined, ai: unknown, now: number): boolean {
  if (primary === undefined || (route.provider === primary.provider && route.model === primary.model)) return false
  const value = record(ai)
  if (value?.stale !== false || typeof value.expiresAt !== 'string' || typeof value.observedAt !== 'string') return false
  const expiry = Date.parse(value.expiresAt), observed = Date.parse(value.observedAt)
  if (!Number.isFinite(now) || !Number.isFinite(expiry) || !Number.isFinite(observed) || expiry <= now || observed > now) return false
  if (!Array.isArray(value.registeredProviders) || !value.registeredProviders.some(row => record(row)?.id === route.provider)) return false
  if (!Array.isArray(value.quotaBudget)) return false
  const accounts = value.quotaBudget.map(record).filter(row => row?.provider === route.provider)
  // Ambiguous account selection cannot prove the account used by the adapter.
  if (accounts.length !== 1) return false
  const windows = accounts[0]?.windows
  return Array.isArray(windows) && windows.length > 0 && windows.every(raw => {
    const window = record(raw)
    return window?.status === 'observed' && typeof window.remainingPercent === 'number'
      && Number.isFinite(window.remainingPercent) && window.remainingPercent >= 15 && window.remainingPercent <= 100
  })
}

/** A second opinion cannot outvote a concrete negative finding. */
export function combineMetaVerdicts(first: Verdict, second: Verdict): Verdict {
  if (first === 'needs_changes' || second === 'needs_changes') return 'needs_changes'
  if (first === 'blocked' || second === 'blocked') return 'blocked'
  return 'pass'
}

/** Common anti-anchoring and counterfactual protocol, no extra model call. */
export const META_REVIEW_PROTOCOL = 'META audit: derive your own checklist from the original objective before reading any worker conclusion. '
  + 'Search for a concrete disconfirming observation and a plausible alternative explanation or design; apply the same acceptance criteria to both. '
  + 'For material counterfactuals, state the changed assumption, hold other constraints fixed, distinguish observed evidence from predicted outcomes, and identify a feasible discriminating test. '
  + 'Check selection bias, missing negative cases, anchoring, shared-source dependence, and circular evidence when relevant. Do not invent bias findings or causal certainty. '
  + 'A pass with unresolved mandatory changes or contradictory failed criteria is invalid. Agreement between reviewers is not independent proof.'
