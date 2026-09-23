/** Deterministic repeated-task habit policy for Phoenix. */

import type { ExperienceAggregate, ExperienceRunMetrics } from './experience.ts'

/** How Phoenix should treat a repeated task before invoking expensive reasoning. */
export type HabitMode = 'observe' | 'reuse' | 'review'

/** Cheap, evidence-backed recommendation derived from repeated-task history. */
export interface HabitAssessment {
  readonly mode: HabitMode
  readonly verifiedRuns: number
  readonly confidence: number
  readonly driftDetected: boolean
  readonly optimizationCandidate: boolean
  readonly averageWallTimeMs: number
  readonly averageTokens: number
  readonly averageToolCalls: number
  readonly averageFriction: number
  readonly reason: string
}

/**
 * Decide whether Phoenix should keep learning, reuse a learned habit, or
 * temporarily return to deliberate reasoning because recent evidence drifted.
 * @param state - The state value.
 * @returns The resulting value.
 */
export function assessHabitExperience(state: ExperienceAggregate): HabitAssessment {
  const runs = Math.max(1, state.runs)
  const averageWallTimeMs = Math.round(state.totalWallTimeMs / runs)
  const averageTokens = Math.round(state.totalTokens / runs)
  const averageToolCalls = state.totalToolCalls / runs
  const averageFriction = (
    state.totalFailedToolCalls
    + state.totalRetries
    + state.totalUserInterventions
  ) / runs
  const driftDetected = detectDrift(state.recentRuns)
  const successRate = state.verifiedSuccesses / Math.max(1, state.verifiedSuccesses + state.failures)
  const confidence = Math.max(0, Math.min(1, maturityConfidence(state.maturity) * successRate))

  if (driftDetected) {
    return {
      mode: 'review',
      verifiedRuns: state.verifiedSuccesses,
      confidence,
      driftDetected: true,
      optimizationCandidate: false,
      averageWallTimeMs,
      averageTokens,
      averageToolCalls,
      averageFriction,
      reason: 'recent verified runs degraded relative to the earlier repeated-task baseline',
    }
  }

  if (state.maturity === 'validated' || state.maturity === 'habitual') {
    return {
      mode: 'reuse',
      verifiedRuns: state.verifiedSuccesses,
      confidence,
      driftDetected: false,
      optimizationCandidate: state.maturity === 'habitual' && averageFriction > 0.25,
      averageWallTimeMs,
      averageTokens,
      averageToolCalls,
      averageFriction,
      reason: 'the task has enough verified repeated experience to avoid rediscovering the workflow from scratch',
    }
  }

  return {
    mode: 'observe',
    verifiedRuns: state.verifiedSuccesses,
    confidence,
    driftDetected: false,
    optimizationCandidate: false,
    averageWallTimeMs,
    averageTokens,
    averageToolCalls,
    averageFriction,
    reason: 'repetition exists but has not accumulated enough verified evidence for habitual reuse',
  }
}

/**
 * Render bounded model context. Observe mode intentionally stays silent so
 * immature evidence does not bias a novel task.
 * @param assessment - The assessment value.
 * @returns The resulting value.
 */
export function formatHabitGuidance(assessment: HabitAssessment): string {
  if (assessment.mode === 'observe') return ''
  const baseline = [
    `verified_runs=${assessment.verifiedRuns}`,
    `confidence=${assessment.confidence.toFixed(2)}`,
    `avg_wall_ms=${assessment.averageWallTimeMs}`,
    `avg_tokens=${assessment.averageTokens}`,
    `avg_tool_calls=${assessment.averageToolCalls.toFixed(1)}`,
  ].join(' ')

  if (assessment.mode === 'review') {
    return [
      'Phoenix repeated-task guidance: REVIEW.',
      baseline,
      'Prior experience is showing drift. Do not blindly replay the old habit.',
      'Inspect the changed context, reason deliberately around the difference, preserve the quality floor, and only update the learned procedure after verified completion.',
    ].join(' ')
  }

  return [
    'Phoenix repeated-task guidance: REUSE.',
    baseline,
    'Prefer the relevant validated procedure and reuse known-good work instead of rediscovering it.',
    'Spend deliberate reasoning on genuinely novel or changed parts only; preserve output quality and verification.',
    assessment.optimizationCandidate
      ? 'Repeated friction remains material, so a cheap optimization opportunity may be evaluated only if its expected total lifecycle value is positive.'
      : 'Do not add optimization analysis merely because the task is repeated.',
  ].join(' ')
}

function detectDrift(runs: readonly ExperienceRunMetrics[]): boolean {
  if (runs.length < 4) return false
  const split = Math.floor(runs.length / 2)
  const baseline = runs.slice(0, split)
  const recent = runs.slice(split)
  const baselineTime = average(baseline.map(run => run.wallTimeMs))
  const recentTime = average(recent.map(run => run.wallTimeMs))
  const baselineFriction = average(baseline.map(friction))
  const recentFriction = average(recent.map(friction))
  const timeDrift = baselineTime > 0
    && recentTime >= baselineTime * 1.5
    && recentTime - baselineTime >= 250
  const frictionDrift = recentFriction >= baselineFriction + 0.75
  return timeDrift || frictionDrift
}

function friction(run: ExperienceRunMetrics): number {
  return run.failedToolCalls + run.retries + run.userInterventions
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function maturityConfidence(maturity: ExperienceAggregate['maturity']): number {
  if (maturity === 'habitual') return 0.98
  if (maturity === 'validated') return 0.93
  if (maturity === 'candidate') return 0.82
  if (maturity === 'repeated') return 0.72
  return 0.6
}
