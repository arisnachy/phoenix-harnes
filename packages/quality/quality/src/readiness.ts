/** Pure completion-readiness rules for PHOENIX quality assessments. */

import type { QualityAssessmentSnapshot } from './types.ts'

/** Result of evaluating whether quality evidence is sufficient for completion. */
export interface QualityReadiness {
  readonly ready: boolean
  readonly blockers: readonly string[]
}

/**
 * Evaluate the mechanically checkable quality requirements for one assessment.
 * Forecasts remain hypotheses; this function only checks whether material risk
 * has an explicit disposition before completion.
 * @param snapshot - Current revision-bound quality assessment.
 * @returns Readiness plus concrete blockers that must be repaired or resolved.
 */
export function qualityReadiness(snapshot: QualityAssessmentSnapshot): QualityReadiness {
  const blockers: string[] = []

  for (const criterion of snapshot.criteria) {
    if (criterion.mandatory && criterion.status !== 'verified') {
      blockers.push(`criterion ${criterion.id} is ${criterion.status}`)
    }
  }

  for (const scenario of snapshot.scenarios) {
    const material = scenario.severity === 'high' || scenario.severity === 'critical'
    if (material && scenario.status !== 'pass' && scenario.status !== 'accepted-risk') {
      blockers.push(`scenario ${scenario.id} is ${scenario.status}`)
    }
  }

  for (const forecast of snapshot.forecasts) {
    const material = forecast.impact === 'high' || forecast.impact === 'critical'
    if (material && forecast.status === 'open') {
      blockers.push(`forecast ${forecast.id} remains open`)
    }
  }

  for (const change of snapshot.requiredChanges) blockers.push(`required change: ${change}`)

  if (snapshot.taskClass === 'substantial' || snapshot.taskClass === 'living') {
    if (snapshot.innovation === undefined || snapshot.innovation.status === 'pending') {
      blockers.push('innovation pass has no final disposition')
    } else if (snapshot.innovation.status === 'implemented' && snapshot.innovation.evidence.length === 0) {
      blockers.push('implemented innovation has no verification evidence')
    }
  }

  return { ready: blockers.length === 0, blockers }
}
