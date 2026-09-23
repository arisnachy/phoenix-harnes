/** Bounded, durable strategy selection for goal recovery rounds. */

import type { GoalStrategySelection } from '@phoenix-ai/dsh-goal'
import type { GoalId } from '@phoenix-ai/dsh-goal/types'
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'

/** One strategy the supervisor may select for a continuation round. */
export type GoalStrategyId = GoalStrategySelection['strategy']

/** Stable strategy order used by automatic recovery. */
export const GOAL_STRATEGIES: readonly GoalStrategyId[] = Object.freeze([
  'baseline',
  'verification-first',
  'alternate-tool',
  'minimal-change',
])

/** Evidence-growth summary for the current exact goal revision. */
export interface GoalVerificationProgress {
  readonly stagnantRounds: number
  readonly verifiedCriteria: number
  readonly passedChecks: number
}

/**
 * Measure useful verification progress from durable completion gates. More
 * rounds are not a failure signal by themselves: only rounds that add no new
 * verified criterion, no new passed gate dimension, and resolve no finding
 * count as stagnant.
 * @param revision - The revision value.
 * @param goalId - The goal id value.
 * @param events - The events value.
 * @returns The resulting value.
 */
export function measureGoalVerificationProgress(
  events: readonly SessionEvent[],
  goalId: GoalId | string,
  revision: number,
): GoalVerificationProgress {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('revision must be a positive safe integer')
  const gates = events.filter((event): event is SessionEvent<'goal/completion-gate'> =>
    event.type === 'goal/completion-gate'
      && event.data.goalId === goalId
      && event.data.revision === revision)

  const verified = new Set<string>()
  let bestPassedChecks = 0
  let previousFindings: number | undefined
  let stagnantRounds = 0

  for (const gate of gates) {
    const newlyVerified = gate.data.evidenceLedger
      .filter(entry => entry.mandatory && entry.status === 'verified' && !verified.has(entry.criterionId))
    const passedChecks = Object.values(gate.data.checks).filter(value => value === 'pass').length
    const resolvedFinding = previousFindings !== undefined && gate.data.findings.length < previousFindings
    const progressed = newlyVerified.length > 0 || passedChecks > bestPassedChecks || resolvedFinding

    for (const entry of newlyVerified) verified.add(entry.criterionId)
    bestPassedChecks = Math.max(bestPassedChecks, passedChecks)
    previousFindings = gate.data.findings.length
    stagnantRounds = progressed ? 0 : stagnantRounds + 1
  }

  return { stagnantRounds, verifiedCriteria: verified.size, passedChecks: bestPassedChecks }
}

/**
 * Keep the current strategy while independent evidence is still increasing.
 * Rotate only after a verifier round adds no new useful coverage.
 * @param stagnantRounds - The stagnant rounds value.
 * @param previous - The previous value.
 * @returns The resulting value.
 */
export function selectNextStrategy(previous: GoalStrategyId | undefined, stagnantRounds: number): GoalStrategyId {
  if (!Number.isSafeInteger(stagnantRounds) || stagnantRounds < 0) {
    throw new TypeError('stagnantRounds must be a non-negative safe integer')
  }
  if (previous === undefined) return GOAL_STRATEGIES[0] ?? 'baseline'
  const index = GOAL_STRATEGIES.indexOf(previous)
  if (index < 0) throw new TypeError('unknown goal strategy: ' + previous)
  if (stagnantRounds === 0) return previous
  const offset = ((stagnantRounds - 1) % Math.max(1, GOAL_STRATEGIES.length - 1)) + 1
  return GOAL_STRATEGIES[(index + offset) % GOAL_STRATEGIES.length] ?? 'baseline'
}

/**
 * Rebuild the latest selected strategy for one exact goal and round history.
 * @param goalId - The goal id value.
 * @param events - The events value.
 * @returns The resulting value.
 */
export function replayGoalStrategy(
  events: readonly SessionEvent[],
  goalId: GoalId | string,
): GoalStrategySelection | undefined {
  return events.findLast((event): event is SessionEvent<'goal/strategy'> =>
    event.type === 'goal/strategy' && event.data.goalId === goalId)
    ?.data
}

/**
 * Append the selected strategy before its model-visible prompt.
 * @param selection - The selection value.
 * @param session - The session value.
 */
export function recordGoalStrategy(session: Session, selection: GoalStrategySelection): void {
  if (selection.goalId.trim().length === 0 || !Number.isSafeInteger(selection.revision) || selection.revision < 1
    || !Number.isSafeInteger(selection.round) || selection.round < 1
    || selection.reason.trim().length === 0 || selection.reason.length > 500) {
    throw new TypeError('invalid goal strategy selection')
  }
  session.append('goal/strategy', selection)
}
