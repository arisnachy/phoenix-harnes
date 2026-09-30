/** Deterministic repeated-task habit policy for Phoenix. */

import type {
  ExperienceAggregate,
  ExperienceRunMetrics,
  PhoenixAutoExecutionStrategy,
} from './experience.ts'
import { paretoEfficientStrategies, type StrategyObservation } from './value-optimizer.ts'

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
  readonly phoenixAutoComparedStrategies: number
  readonly phoenixAutoEvidenceRuns: number
  readonly phoenixAutoPreferredStrategy?: PhoenixAutoExecutionStrategy
  readonly reason: string
}

/**
 * Decide whether Phoenix should keep learning, reuse a learned habit, or
 * temporarily return to deliberate reasoning because recent evidence drifted.
  * @param state - state supplied to this public operation.
  * @returns Result produced by this public operation.
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
  const autoPreference = phoenixAutoPreference(state.recentRuns)

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
      ...autoPreference,
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
      ...autoPreference,
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
    ...autoPreference,
    reason: 'repetition exists but has not accumulated enough verified evidence for habitual reuse',
  }
}

/**
 * Render bounded model context. Observe mode intentionally stays silent so
 * immature evidence does not bias a novel task.
  * @param assessment - assessment supplied to this public operation.
  * @returns Result produced by this public operation.
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
  const autoGuidance = phoenixAutoGuidance(assessment)

  if (assessment.mode === 'review') {
    return [
      'Phoenix repeated-task guidance: REVIEW.',
      baseline,
      'Prior experience is showing drift. Do not blindly replay the old habit.',
      'Inspect the changed context, reason deliberately around the difference, preserve the quality floor, and only update the learned procedure after verified completion.',
      autoGuidance,
    ].filter(Boolean).join(' ')
  }

  return [
    'Phoenix repeated-task guidance: REUSE.',
    baseline,
    'Prefer the relevant validated procedure and reuse known-good work instead of rediscovering it.',
    'Spend deliberate reasoning on genuinely novel or changed parts only; preserve output quality and verification.',
    assessment.optimizationCandidate
      ? 'Repeated friction remains material, so a cheap optimization opportunity may be evaluated only if its expected total lifecycle value is positive.'
      : 'Do not add optimization analysis merely because the task is repeated.',
    autoGuidance,
  ].filter(Boolean).join(' ')
}

function phoenixAutoPreference(runs: readonly ExperienceRunMetrics[]): {
  readonly phoenixAutoComparedStrategies: number
  readonly phoenixAutoEvidenceRuns: number
  readonly phoenixAutoPreferredStrategy?: PhoenixAutoExecutionStrategy
} {
  const grouped = new Map<PhoenixAutoExecutionStrategy, ExperienceRunMetrics[]>()
  for (const run of runs) {
    if (run.phoenixAutoStrategy === undefined || !run.qualityPassed || !run.verified) continue
    const group = grouped.get(run.phoenixAutoStrategy) ?? []
    group.push(run)
    grouped.set(run.phoenixAutoStrategy, group)
  }
  const eligible = [...grouped.entries()].filter(([, values]) => values.length >= 2)
  const evidenceRuns = eligible.reduce((sum, [, values]) => sum + values.length, 0)
  if (eligible.length < 2) {
    return {
      phoenixAutoComparedStrategies: eligible.length,
      phoenixAutoEvidenceRuns: evidenceRuns,
    }
  }

  const observations: StrategyObservation[] = eligible.map(([strategy, values]) => ({
    id: strategy,
    qualityPassed: values.every(value => value.qualityPassed && value.verified),
    totalTimeMs: average(values.map(value => value.wallTimeMs)),
    totalTokens: average(values.map(value => value.totalTokens)),
    toolCalls: average(values.map(value => value.toolCalls)),
    retries: average(values.map(value =>
      value.retries + value.failedToolCalls + (value.phoenixAutoRescues ?? 0))),
    userInterventions: average(values.map(value => value.userInterventions)),
  }))
  const efficient = paretoEfficientStrategies(observations)
  if (efficient.length !== 1) {
    return {
      phoenixAutoComparedStrategies: eligible.length,
      phoenixAutoEvidenceRuns: evidenceRuns,
    }
  }
  return {
    phoenixAutoComparedStrategies: eligible.length,
    phoenixAutoEvidenceRuns: evidenceRuns,
    phoenixAutoPreferredStrategy: efficient[0]!.id as PhoenixAutoExecutionStrategy,
  }
}

function phoenixAutoGuidance(assessment: HabitAssessment): string {
  const strategy = assessment.phoenixAutoPreferredStrategy
  if (strategy === undefined) return ''
  const instruction = strategy === 'serial'
    ? 'Prefer serial Luna Max execution; add a worker only if the current task contains a new material independent branch.'
    : strategy === 'parallel-1'
      ? 'Prefer one bounded Luna Max worker beside the Luna root when the same kind of independent branch is present.'
      : 'Prefer up to two bounded Luna Max workers only when the current task still contains two genuinely independent branches.'
  return [
    'Phoenix Auto learned routing:',
    `strategy=${strategy}`,
    `evidence_runs=${assessment.phoenixAutoEvidenceRuns}`,
    `compared_strategies=${assessment.phoenixAutoComparedStrategies}.`,
    'This strategy uniquely dominated the compared verified alternatives on end-to-end value without lowering the verified quality floor.',
    instruction,
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
