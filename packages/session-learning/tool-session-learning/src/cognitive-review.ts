/** Evidence-only cognitive review derived from the existing durable experience ledger.
 * No new model calls, storage, agent scheduler, permissions, or inferred mental states. */
import type { ExperienceAggregate, ExperienceRunMetrics } from './experience.ts'
import { assessMetaEvidence, compareMetaExperience } from './metacognition.ts'

type NextAction = 'discover' | 'diagnose' | 'verify' | 'compare' | 'reuse'

/** Derive a bounded review; historical costs are not live quota or causal predictions. */
export function reviewCognition(state: ExperienceAggregate | undefined) {
  const evidence = assessMetaEvidence(state ?? { runs: 0, verifiedSuccesses: 0, failures: 0 })
  const rows = evidence.attempts === 0 ? [] : state?.recentRuns.slice(-12) ?? []
  const recent = rows.slice(-3)
  const verified = rows.filter(row => row.verified && row.qualityPassed)
  const friction = (row: ExperienceRunMetrics) => row.failedToolCalls > 0 || row.retries > 0
  const repeatedFriction = recent.filter(friction).length >= 2
  const recentQualityLoss = recent.length >= 2 && recent.filter(row => !row.verified || !row.qualityPassed).length >= 2
  const comparison = compareMetaExperience(rows)
  const ratio = (previous: number | null, current: number | null) =>
    previous !== null && previous > 0 && current !== null ? current / previous : null
  const wallRatio = comparison === undefined ? null : ratio(comparison.earlier.averageWallMs, comparison.recent.averageWallMs)
  const tokenRatio = comparison === undefined ? null : ratio(comparison.earlier.averageReportedTokens, comparison.recent.averageReportedTokens)
  const costRegression = (wallRatio !== null && wallRatio >= 1.5) || (tokenRatio !== null && tokenRatio >= 1.5)
  const next: NextAction = rows.length === 0 ? 'discover'
    : repeatedFriction ? 'diagnose'
    : recentQualityLoss ? 'verify'
    : costRegression ? 'compare'
    : evidence.sufficientForReuse && recent.length > 0 && recent.every(row => row.verified && row.qualityPassed) ? 'reuse' : 'verify'
  return {
    schema: 'phoenix.cognition.review.v1',
    evidence,
    consolidation: {
      sampledEpisodes: rows.length,
      qualityVerifiedEpisodes: verified.length,
      reusableCandidate: next === 'reuse',
      derivedFrom: 'existing-experience-ledger',
      lastObservedAt: rows.at(-1)?.occurredAt ?? null,
    },
    homeostasis: { repeatedFriction, costRegression, wallRatio, tokenRatio, liveQuota: 'not-observed' },
    foresight: { repeatedFriction, recentQualityLoss, costRegression, predictiveProbability: null },
    agency: { next, executionAuthority: 'existing-policy-only', autonomousDispatch: false },
    plasticity: { changeCandidate: next === 'diagnose' || next === 'compare', requiresVerifiedOutcome: true, causalConclusion: false },
    autobiographical: { observedEpisodes: evidence.attempts, verifiedEpisodes: evidence.verified, lastObservedAt: rows.at(-1)?.occurredAt ?? null },
    uncertainty: { userEmotion: 'not-inferred', userIntent: 'use-current-explicit-request', worldState: 'not-observed' },
  } as const
}

/** Inject only actionable guidance for a matched task, never raw task history. */
export function cognitionGuidance(state: ExperienceAggregate | undefined): string {
  if (state === undefined) return ''
  const review = reviewCognition(state)
  switch (review.agency.next) {
    case 'diagnose': return 'Cognitive review: recurring tool/retry friction observed. Diagnose the cause using available evidence; do not repeat the same failed route.'
    case 'verify': return 'Cognitive review: evidence does not justify automatic procedure reuse. Preserve partial progress and verify the current outcome against the actual user goal.'
    case 'compare': return 'Cognitive review: historical verified episodes show possible resource regression. Compare a bounded alternative under the same quality criteria; check live quota separately.'
    case 'reuse': return 'Cognitive review: recent quality-verified experience supports considering the matched procedure. Recheck current applicability, permissions and acceptance criteria.'
    default: return ''
  }
}
