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

export type QualityAssessmentId = string & { readonly __qualityAssessmentId: unique symbol }

export interface QualityEvidence {
  id: string
  kind: QualityEvidenceKind
  reference: string
}

export interface QualityCriterion {
  id: string
  text: string
  tier: QualityCriterionTier
  mandatory: boolean
  status: QualityCriterionStatus
  evidence: string[]
}

export interface QualityScenario {
  id: string
  title: string
  severity: QualityScenarioSeverity
  status: QualityScenarioStatus
  evidenceKind?: QualityEvidenceKind
  evidence: string[]
  blocker?: string
}

export interface RiskForecast {
  id: string
  scenario: string
  likelihood: QualityLikelihood
  confidence: QualityConfidence
  impact: QualityImpact
  evidence: string[]
  mitigation: string
  status: RiskForecastStatus
  detectability?: 'low' | 'medium' | 'high'
}

export interface QualityInnovation {
  status: QualityInnovationStatus
  rationale: string
  evidence?: string[]
}

export interface QualityAssessmentSnapshot {
  id: QualityAssessmentId
  revision: number
  objective: string
  taskClass: QualityTaskClass
  criteria: QualityCriterion[]
  scenarios: QualityScenario[]
  forecasts: RiskForecast[]
  requiredChanges: string[]
  innovation?: QualityInnovation
  createdAt: number
  updatedAt: number
}

export interface QualityReadiness {
  ready: boolean
  blockers: string[]
}
