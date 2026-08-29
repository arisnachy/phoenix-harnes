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

/** Choose a materially different strategy after a failed or reviewed round.
 * @param previous - most recently persisted strategy, when one exists.
 * @param failedRounds - number of previously admitted unsuccessful rounds.
 * @returns the next bounded strategy identifier.
 */
export function selectNextStrategy(previous: GoalStrategyId | undefined, failedRounds: number): GoalStrategyId {
  if (!Number.isSafeInteger(failedRounds) || failedRounds < 0) {
    throw new TypeError('failedRounds must be a non-negative safe integer')
  }
  if (previous === undefined) return GOAL_STRATEGIES[0] ?? 'baseline'
  const index = GOAL_STRATEGIES.indexOf(previous)
  if (index < 0) throw new TypeError(`unknown goal strategy: ${previous}`)
  const offset = Math.max(1, failedRounds) % GOAL_STRATEGIES.length || 1
  return GOAL_STRATEGIES[(index + offset) % GOAL_STRATEGIES.length] ?? 'baseline'
}

/** Rebuild the latest selected strategy for one exact goal and round history.
 * @param events - session events to replay.
 * @param goalId - goal identity whose strategy history is selected.
 * @returns the latest durable strategy selection, when present.
 */
export function replayGoalStrategy(
  events: readonly SessionEvent[],
  goalId: GoalId | string,
): GoalStrategySelection | undefined {
  return events.findLast((event): event is SessionEvent<'goal/strategy'> =>
    event.type === 'goal/strategy' && event.data.goalId === goalId)
    ?.data
}

/** Append the selected strategy before its model-visible prompt.
 * @param session - owning durable session.
 * @param selection - bounded strategy decision to append.
 */
export function recordGoalStrategy(session: Session, selection: GoalStrategySelection): void {
  if (selection.goalId.trim().length === 0 || !Number.isSafeInteger(selection.revision) || selection.revision < 1
    || !Number.isSafeInteger(selection.round) || selection.round < 1
    || selection.reason.trim().length === 0 || selection.reason.length > 500) {
    throw new TypeError('invalid goal strategy selection')
  }
  session.append('goal/strategy', selection)
}
