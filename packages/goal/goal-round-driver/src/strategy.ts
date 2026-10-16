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
 * @param events - durable session events containing completion-gate history.
 * @param goalId - exact goal identity whose revision is being measured.
 * @param revision - positive goal revision to include.
 * @returns progress counters for verified criteria, passed checks, and stagnation.
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
 * Measurable operational progress, independent of final verification gates.
 * A model turn, narration, fresh plan or repeated identical read is NOT work.
 */
export interface GoalWorkProgress {
  readonly stagnantRounds: number
  readonly completedRounds: number
  readonly repeatedOperations: readonly string[]
}

/**
 * Inspect persisted Goal rounds across execution-window revisions. A unique
 * successful tool invocation, a newly completed task, or fresh verification
 * evidence advances work. Repeated same-name/same-arguments tool calls do not.
 * The explicit human-authorized resume resets this recovery window.
 *
 * @param events - canonical append-only Lead session.
 * @param goalId - goal being supervised.
 * @returns bounded, deterministic stall diagnostics.
 */
export function measureGoalWorkProgress(
  events: readonly SessionEvent[],
  goalId: GoalId | string,
): GoalWorkProgress {
  const first = events.findLastIndex(event => event.type === 'goal/change'
    && event.data.goal.id === goalId && (event.data.operation === 'create' || event.data.operation === 'resume'))
  // If the Goal has not been created yet, no automatic round is attributable.
  if (first < 0) return { stagnantRounds: 0, completedRounds: 0, repeatedOperations: [] }
  const calls = new Map<string, { name: string; args: string }>()
  const observed = new Set<string>()
  const verified = new Set<string>()
  const completedTasks = new Set<string>()
  let bestCompletedTodos = 0
  let bestChecks = 0
  let completedRounds = 0
  let stagnantRounds = 0
  let repeatedOperations: string[] = []
  let round: { progressed: boolean; repeated: string[] } | undefined

  for (const event of events.slice(first + 1)) {
    if (event.type === 'user/message' && event.data.source.kind === 'goal'
      && event.data.source.goalId === goalId && event.data.source.round > 0) {
      round = { progressed: false, repeated: [] }
      continue
    }
    if (event.type === 'tool/call') {
      calls.set(String(event.data.callId), { name: event.data.name, args: event.data.arguments })
    } else if (event.type === 'tool/result'
      && event.data.error === undefined
      && event.data.message.content.every(block => block.isError !== true)) {
      const call = calls.get(String(event.data.message.source.callId))
      if (call !== undefined) {
        // Pair with the original arguments rather than the call ID. A new ID
        // for the same read does not mean the file, answer or artifact changed.
        const fingerprint = JSON.stringify([call.name, call.args])
        const novel = !observed.has(fingerprint)
        if (round !== undefined) {
          if (novel) round.progressed = true
          else if (!round.repeated.includes(call.name)) round.repeated.push(call.name)
        }
        observed.add(fingerprint)
      }
    } else if (event.type === 'todo/write') {
      const completed = event.data.todos.filter(todo => todo.status === 'completed').length
      if (round !== undefined && completed > bestCompletedTodos) round.progressed = true
      bestCompletedTodos = Math.max(bestCompletedTodos, completed)
    } else if (event.type === 'team/task') {
      if (event.data.task.status === 'completed' && !completedTasks.has(event.data.task.id)) {
        if (round !== undefined) round.progressed = true
        completedTasks.add(event.data.task.id)
      }
    } else if (event.type === 'goal/completion-gate' && event.data.goalId === goalId) {
      const fresh = event.data.evidenceLedger.filter(entry =>
        entry.mandatory && entry.status === 'verified' && !verified.has(entry.criterionId))
      const passed = Object.values(event.data.checks).filter(check => check === 'pass').length
      if (round !== undefined && (fresh.length > 0 || passed > bestChecks)) round.progressed = true
      for (const entry of fresh) verified.add(entry.criterionId)
      bestChecks = Math.max(bestChecks, passed)
    } else if (event.type === 'turn/end' && round !== undefined) {
      if (event.data.reason.kind === 'completed' || event.data.reason.kind === 'max-tokens') {
        completedRounds += 1
        stagnantRounds = round.progressed ? 0 : stagnantRounds + 1
        repeatedOperations = round.repeated.slice(0, 4)
      }
      round = undefined
    }
  }
  return { stagnantRounds, completedRounds, repeatedOperations }
}

/**
 * Keep the current strategy while independent evidence is still increasing.
 * Rotate only after a verifier round adds no new useful coverage.
 * @param previous - strategy used by the preceding round, when one exists.
 * @param stagnantRounds - consecutive rounds without useful verification growth.
 * @returns the bounded strategy selected for the next round.
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
 * @param events - durable session events to replay.
 * @param goalId - exact goal whose latest strategy is requested.
 * @returns the latest recorded selection, or undefined when none exists.
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
 * @param session - durable session receiving the strategy event.
 * @param selection - validated strategy decision to persist.
 */
export function recordGoalStrategy(session: Session, selection: GoalStrategySelection): void {
  if (selection.goalId.trim().length === 0 || !Number.isSafeInteger(selection.revision) || selection.revision < 1
    || !Number.isSafeInteger(selection.round) || selection.round < 1
    || selection.reason.trim().length === 0 || selection.reason.length > 500) {
    throw new TypeError('invalid goal strategy selection')
  }
  session.append('goal/strategy', selection)
}
