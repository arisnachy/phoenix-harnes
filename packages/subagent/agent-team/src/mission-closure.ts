/** Durable Team admission boundary: a settled lead turn is not a new assignment. */
import type { SessionEvent } from '@phoenix-ai/dsh-session'

/**
 * A finished or aborted Lead turn closes its Team mission for new work.
 * Only a later, real human request or a new turn/start reopens admission.
 * Internal Team handoffs, model-generated text and recovery replays do not.
 * @param events - Current Lead Session log, including the real turn lifecycle.
 * @returns Whether automatic Team spawning/dispatch must stay dormant.
 */
export function teamMissionClosed(events: readonly SessionEvent[]): boolean {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'turn/start') return false
    if (event?.type === 'user/message' && event.data.source.kind === 'user') return false
    if (event?.type === 'turn/end') {
      return event.data.reason.kind === 'completed' || event.data.reason.kind === 'aborted'
    }
  }
  return false
}
