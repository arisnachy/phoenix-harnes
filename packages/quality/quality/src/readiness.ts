import type {
  QualityAssessmentSnapshot,
  QualityReadiness,
  QualityScenario,
  RiskForecast,
} from './types.ts'

function scenarioResolved(scenario: QualityScenario): boolean {
  if (scenario.severity !== 'high' && scenario.severity !== 'critical') return true
  return scenario.status === 'pass' || scenario.status === 'accepted-risk'
}

function forecastResolved(forecast: RiskForecast): boolean {
  if (forecast.impact !== 'high' && forecast.impact !== 'critical') return true
  return forecast.status !== 'open'
}

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
