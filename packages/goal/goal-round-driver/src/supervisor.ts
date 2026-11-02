/** Durable mission-supervisor checkpoints and replay helpers. */

import type { GoalSupervisorCheckpoint } from '@phoenix-ai/dsh-goal'
import type { GoalId } from '@phoenix-ai/dsh-goal/types'
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'

const MAX_ERROR_LENGTH = 500

/** State reconstructed from the latest checkpoint for one goal. */
export type GoalSupervisorState = GoalSupervisorCheckpoint

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && value === value.trim()
}

function decodeCheckpoint(value: unknown): GoalSupervisorCheckpoint | undefined {
  if (!isRecord(value)
    || !validString(value['goalId'], 200)
    || !Number.isSafeInteger(value['revision']) || (value['revision'] as number) < 1
    || !Number.isSafeInteger(value['roundsStarted']) || (value['roundsStarted'] as number) < 0
    || !Number.isSafeInteger(value['attempts']) || (value['attempts'] as number) < 0
    || !['active', 'awaiting-human', 'retrying', 'blocked', 'complete'].includes(value['status'] as string)
    || !['continue', 'resume', 'review', 'blocked', 'none'].includes(value['nextAction'] as string)) {
    return undefined
  }
  const lastError = value['lastError']
  if (lastError !== undefined && !validString(lastError, MAX_ERROR_LENGTH)) return undefined
  return {
    goalId: value['goalId'],
    revision: value['revision'],
    roundsStarted: value['roundsStarted'],
    status: value['status'],
    nextAction: value['nextAction'],
    attempts: value['attempts'],
    ...lastError === undefined ? {} : { lastError },
  } as GoalSupervisorCheckpoint
}

/** Rebuild the latest valid supervisor checkpoint for one goal.
 * @param events - session events to replay.
 * @param goalId - goal identity whose checkpoints are selected.
 * @returns the latest valid checkpoint, when present.
 */
export function replayGoalSupervisor(
  events: readonly SessionEvent[],
  goalId: GoalId | string,
): GoalSupervisorState | undefined {
  const event = events.findLast(candidate => candidate.type === 'goal/supervisor'
    && candidate.data.goalId === goalId)
  return event === undefined ? undefined : decodeCheckpoint(event.data)
}

/** Append one bounded, secret-free checkpoint to the owning session.
 * @param session - owning durable session.
 * @param checkpoint - validated supervisor state to append.
 */
export function recordGoalSupervisor(session: Session, checkpoint: GoalSupervisorCheckpoint): void {
  const decoded = decodeCheckpoint(checkpoint)
  if (decoded === undefined) throw new TypeError('invalid goal supervisor checkpoint')
  session.append('goal/supervisor', decoded)
}
