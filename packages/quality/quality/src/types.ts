/** Pure quality-assessment vocabulary shared by providers and consumers. */

import type { Branded } from '@phoenix-ai/dsh-brand'

/** Stable identity for one quality assessment across its revisions. */
export type QualityAssessmentId = Branded<'QualityAssessmentId'>

/** Construct a branded quality-assessment id after its owning boundary validates text. */
export function QualityAssessmentId(value: string): QualityAssessmentId {
  return value as QualityAssessmentId
}

/** Exact compare-and-set identity for one assessment revision. */
export interface QualityAssessmentRef {
  readonly id: QualityAssessmentId
  readonly revision: number
}

/** Depth of evidence and foresight required for one mission. */
export type QualityTaskClass = 'conversational' | 'bounded' | 'substantial' | 'living'

/** Why a criterion belongs to the quality target. */
export type QualityCriterionTier = 'requested' | 'professional' | 'excellent'

/** Current evidence state for one acceptance criterion. */
export type QualityCriterionStatus = 'pending' | 'implemented' | 'tested' | 'verified' | 'failed' | 'blocked_external'

/** One acceptance criterion with durable evidence references. */
export interface QualityCriterion {
  readonly id: string
  readonly text: string
  readonly tier: QualityCriterionTier
  readonly mandatory: boolean
  readonly status: QualityCriterionStatus
  readonly evidence: readonly string[]
}

/** Materiality assigned to an edge-case scenario. */
export type QualitySeverity = 'low' | 'medium' | 'high' | 'critical'

/** Execution state for one adversarial scenario. */
export type QualityScenarioStatus = 'pending' | 'pass' | 'fail' | 'untested' | 'accepted-risk'

/** Provenance of evidence supporting a scenario result. */
export type QualityEvidenceKind = 'static' | 'simulated' | 'live'

/** One concrete attempt to challenge the artifact beyond its happy path. */
export interface QualityScenario {
  readonly id: string
  readonly title: string
  readonly severity: QualitySeverity
  readonly status: QualityScenarioStatus
  readonly evidenceKind: QualityEvidenceKind
  readonly evidence: readonly string[]
  readonly blocker?: string
}

/** Relative forecast likelihood; it is not an observed probability. */
export type RiskLikelihood = 'low' | 'medium' | 'high'

/** Strength of evidence supporting a forecast. */
export type RiskConfidence = 'low' | 'medium' | 'high'

/** Current disposition of one predicted future failure. */
export type RiskForecastStatus = 'open' | 'mitigated' | 'accepted' | 'confirmed' | 'contradicted' | 'unknown'

/** Hypothesis about a plausible future failure and how to reduce its impact. */
export interface RiskForecast {
  readonly id: string
  readonly scenario: string
  readonly likelihood: RiskLikelihood
  readonly confidence: RiskConfidence
  readonly impact: QualitySeverity
  readonly evidence: readonly string[]
  readonly mitigation: string
  readonly status: RiskForecastStatus
}

/** Decision from the bounded post-completion innovation pass. */
export interface QualityInnovation {
  readonly status: 'pending' | 'implemented' | 'offered' | 'not-applicable'
  readonly rationale: string
  readonly evidence: readonly string[]
}

/** Whole durable state for one revision-bound quality assessment. */
export interface QualityAssessmentSnapshot extends QualityAssessmentRef {
  readonly objective: string
  readonly taskClass: QualityTaskClass
  readonly criteria: readonly QualityCriterion[]
  readonly scenarios: readonly QualityScenario[]
  readonly forecasts: readonly RiskForecast[]
  readonly requiredChanges: readonly string[]
  readonly innovation?: QualityInnovation
  readonly createdAt: number
  readonly updatedAt: number
}

/** Input used to open a fresh quality assessment. */
export interface StartQualityAssessmentRequest {
  readonly objective: string
  readonly taskClass: QualityTaskClass
  readonly criteria?: readonly QualityCriterion[]
}

/** Mutations accepted by the revision-bound provider. */
export type QualityMutation =
  | { readonly kind: 'criterion'; readonly value: QualityCriterion }
  | { readonly kind: 'scenario'; readonly value: QualityScenario }
  | { readonly kind: 'forecast'; readonly value: RiskForecast }
  | { readonly kind: 'required-changes'; readonly value: readonly string[] }
  | { readonly kind: 'innovation'; readonly value: QualityInnovation }

/** Durable whole-snapshot mutation for one quality assessment. */
export type QualityChange =
  | {
    readonly kind: 'quality/change'
    readonly version: 1
    readonly operation: 'start' | 'record'
    readonly assessment: QualityAssessmentSnapshot
  }
  | {
    readonly kind: 'quality/change'
    readonly version: 1
    readonly operation: 'clear'
    readonly cleared: QualityAssessmentRef
    readonly clearedAt: number
  }

declare module '@phoenix-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Full replayable quality state or a clear tombstone. */
    'quality/change': QualityChange
  }
}
