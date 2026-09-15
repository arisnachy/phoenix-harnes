import type { Branded } from '@phoenix-ai/dsh-brand'

export type QualityAssessmentId = Branded<'QualityAssessmentId'>
export type QualityTaskClass = 'conversational' | 'bounded' | 'substantial' | 'living'
export type QualityCriterionTier = 'requested' | 'professional' | 'excellent'
export type QualityCriterionStatus = 'pending' | 'implemented' | 'tested' | 'verified' | 'failed' | 'blocked_external'
export type QualityScenarioSeverity = 'low' | 'medium' | 'high' | 'critical'
export type QualityScenarioStatus = 'pending' | 'pass' | 'fail' | 'untested' | 'accepted-risk'
export type QualityEvidenceKind = 'static' | 'simulated' | 'live'
export type QualityLikelihood = 'low' | 'medium' | 'high'
export type QualityConfidence = 'low' | 'medium' | 'high'
export type QualityImpact = 'low' | 'medium' | 'high' | 'critical'
export type RiskForecastStatus = 'open' | 'mitigated' | 'accepted' | 'confirmed' | 'contradicted' | 'unknown'
export type QualityInnovationStatus = 'pending' | 'implemented' | 'offered' | 'not-applicable'

export interface QualityCriterion {
  readonly id: string
  readonly text: string
  readonly tier: QualityCriterionTier
  readonly mandatory: boolean
  readonly status: QualityCriterionStatus
  readonly evidence: readonly string[]
}

export interface QualityScenario {
  readonly id: string
  readonly title: string
  readonly severity: QualityScenarioSeverity
  readonly status: QualityScenarioStatus
  readonly evidenceKind?: QualityEvidenceKind
  readonly evidence: readonly string[]
  readonly blocker?: string
}

export interface RiskForecast {
  readonly id: string
  readonly scenario: string
  readonly likelihood: QualityLikelihood
  readonly confidence: QualityConfidence
  readonly impact: QualityImpact
  readonly evidence: readonly string[]
  readonly mitigation: string
  readonly status: RiskForecastStatus
  readonly detectability?: 'low' | 'medium' | 'high'
}

export interface QualityInnovation {
  readonly status: QualityInnovationStatus
  readonly rationale: string
  readonly evidence?: readonly string[]
}

export interface QualityAssessmentSnapshot {
  readonly id: QualityAssessmentId
  readonly revision: number
  readonly objective: string
  readonly taskClass: QualityTaskClass
  criteria: QualityCriterion[]
  scenarios: QualityScenario[]
  forecasts: RiskForecast[]
  requiredChanges: string[]
  innovation?: QualityInnovation
  readonly createdAt: number
  readonly updatedAt: number
}

export interface QualityReadiness {
  readonly ready: boolean
  readonly blockers: readonly string[]
}

function scenarioResolved(scenario: QualityScenario): boolean {
  if (scenario.severity !== 'high' && scenario.severity !== 'critical') return true
  return scenario.status === 'pass' || scenario.status === 'accepted-risk'
}

function forecastResolved(forecast: RiskForecast): boolean {
  if (forecast.impact !== 'high' && forecast.impact !== 'critical') return true
  return forecast.status !== 'open'
}

/**
 * Pure Definition-of-Done predicate for one revision-bound quality assessment.
 * Predictions remain hypotheses: this function only asks whether material
 * risks are mitigated/accepted, never whether a forecast was "true".
 */
export function qualityReadiness(snapshot: QualityAssessmentSnapshot): QualityReadiness {
  const blockers: string[] = []

  for (const criterion of snapshot.criteria) {
    if (criterion.mandatory && criterion.status !== 'verified') {
      blockers.push(`criterion ${criterion.id} is ${criterion.status}`)
    }
  }
  for (const scenario of snapshot.scenarios) {
    if (!scenarioResolved(scenario)) blockers.push(`scenario ${scenario.id} is ${scenario.status}`)
  }
  for (const forecast of snapshot.forecasts) {
    if (!forecastResolved(forecast)) blockers.push(`forecast ${forecast.id} is open with ${forecast.impact} impact`)
  }
  for (const change of snapshot.requiredChanges) blockers.push(`required change: ${change}`)

  if ((snapshot.taskClass === 'substantial' || snapshot.taskClass === 'living')
    && (snapshot.innovation === undefined || snapshot.innovation.status === 'pending')) {
    blockers.push('innovation disposition is pending')
  }

  return { ready: blockers.length === 0, blockers }
}
