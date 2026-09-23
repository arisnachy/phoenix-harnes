/** Quality-preserving efficiency and learning-investment economics for Phoenix. */

/**
 * One strategy observation. totalTimeMs MUST be end-to-end and therefore
 * include attributable execution, analysis, learning, and verification time.
 */
export interface StrategyObservation {
  readonly id: string
  readonly qualityPassed: boolean
  readonly qualityScore?: number
  readonly totalTimeMs: number
  readonly totalTokens: number
  readonly toolCalls: number
  readonly retries: number
  readonly userInterventions: number
  readonly monetaryCost?: number
}

/** Allowed quality loss when comparing two otherwise successful strategies. */
export interface QualityConstraint {
  readonly maximumScoreRegression?: number
}

/** Economics for deciding whether optimization analysis should happen at all. */
export interface OptimizationInvestment {
  readonly expectedFutureRuns: number
  readonly qualityFloorSatisfied: boolean
  readonly monetaryInvestment?: number
  readonly monetarySavingPerRun?: number
  readonly timeInvestmentMs?: number
  readonly timeSavingPerRunMs?: number
}

/** Payback result that keeps money and time separate rather than hiding one inside the other. */
export interface OptimizationDecision {
  readonly worthIt: boolean
  readonly monetaryBreakEvenRuns?: number
  readonly timeBreakEvenRuns?: number
  readonly requiredRuns: number
}

/**
 * Return true only when candidate is at least as good on quality and no worse
 * on every comparable resource dimension, with a strict improvement somewhere.
 * @param constraint - The constraint value.
 * @param baseline - The baseline value.
 * @param candidate - The candidate value.
 * @returns The resulting value.
 */
export function dominatesStrategy(
  candidate: StrategyObservation,
  baseline: StrategyObservation,
  constraint: QualityConstraint = {},
): boolean {
  if (!candidate.qualityPassed || !baseline.qualityPassed) return false
  const tolerance = constraint.maximumScoreRegression ?? 0
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new TypeError('maximumScoreRegression must be non-negative')
  if (
    candidate.qualityScore !== undefined
    && baseline.qualityScore !== undefined
    && candidate.qualityScore + tolerance < baseline.qualityScore
  ) return false

  const comparable: Array<readonly [number, number]> = [
    [candidate.totalTimeMs, baseline.totalTimeMs],
    [candidate.totalTokens, baseline.totalTokens],
    [candidate.toolCalls, baseline.toolCalls],
    [candidate.retries, baseline.retries],
    [candidate.userInterventions, baseline.userInterventions],
  ]
  if (candidate.monetaryCost !== undefined && baseline.monetaryCost !== undefined) {
    comparable.push([candidate.monetaryCost, baseline.monetaryCost])
  }
  if (comparable.some(([next, old]) => next > old)) return false

  const qualityImproved = candidate.qualityScore !== undefined
    && baseline.qualityScore !== undefined
    && candidate.qualityScore > baseline.qualityScore
  return qualityImproved || comparable.some(([next, old]) => next < old)
}

/**
 * Keep only quality-passing strategies that are not dominated by another observation.
 * @param constraint - The constraint value.
 * @param observations - The observations value.
 * @returns The resulting value.
 */
export function paretoEfficientStrategies(
  observations: readonly StrategyObservation[],
  constraint: QualityConstraint = {},
): StrategyObservation[] {
  return observations
    .filter(observation => observation.qualityPassed)
    .filter((observation, index, all) => !all.some((other, otherIndex) =>
      otherIndex !== index && dominatesStrategy(other, observation, constraint)))
    .map(observation => ({ ...observation }))
}

/**
 * Decide whether learning/optimization overhead can pay for itself inside the
 * expected remaining workload. Money and wall time each have their own gate:
 * saving dollars never excuses making the user wait longer than the expected
 * time savings can amortize, and vice versa.
 * @param input - The input value.
 * @returns The resulting value.
 */
export function shouldInvestInOptimization(input: OptimizationInvestment): OptimizationDecision {
  const runs = requireNonNegativeInteger(input.expectedFutureRuns, 'expectedFutureRuns')
  if (!input.qualityFloorSatisfied) return { worthIt: false, requiredRuns: Number.POSITIVE_INFINITY }

  const monetaryInvestment = nonNegativeFinite(input.monetaryInvestment ?? 0, 'monetaryInvestment')
  const monetarySaving = nonNegativeFinite(input.monetarySavingPerRun ?? 0, 'monetarySavingPerRun')
  const timeInvestment = nonNegativeFinite(input.timeInvestmentMs ?? 0, 'timeInvestmentMs')
  const timeSaving = nonNegativeFinite(input.timeSavingPerRunMs ?? 0, 'timeSavingPerRunMs')

  const monetaryBreakEvenRuns = monetaryInvestment === 0
    ? 0
    : monetarySaving === 0 ? Number.POSITIVE_INFINITY : Math.ceil(monetaryInvestment / monetarySaving)
  const timeBreakEvenRuns = timeInvestment === 0
    ? 0
    : timeSaving === 0 ? Number.POSITIVE_INFINITY : Math.ceil(timeInvestment / timeSaving)
  const requiredRuns = Math.max(monetaryBreakEvenRuns, timeBreakEvenRuns)

  return {
    worthIt: Number.isFinite(requiredRuns) && runs >= requiredRuns,
    ...monetaryInvestment === 0 ? {} : { monetaryBreakEvenRuns },
    ...timeInvestment === 0 ? {} : { timeBreakEvenRuns },
    requiredRuns,
  }
}

function requireNonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer`)
  return value
}

function nonNegativeFinite(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${field} must be a non-negative finite number`)
  return value
}
