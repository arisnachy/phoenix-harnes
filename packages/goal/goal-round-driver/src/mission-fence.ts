/** Read-only mission continuation fence for the durable Goal round driver.
 *
 * Agent Teams owns UME writes. This projection consumes only public Session
 * events, so Goals does not acquire a circular runtime dependency on Teams.
 */
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'

const TERMINAL = new Set(['completed', 'partial', 'failed', 'cancelled'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * True when the owning Team mission is terminal and no later real human input
 * has authorized a new mission. Plugin notices, recovery and goal followups
 * cannot lift the fence, including after a Host restart.
 * @param session - canonical Lead Session and its append-only event log.
 * @returns whether automatic Goal continuation must be disarmed or rejected.
 */
export function goalBlockedByClosedUniversalMission(
  session: Pick<Session, 'id' | 'events'>,
): boolean {
  let lastHumanSeq = -1
  let lastTerminalSeq = -1
  for (const event of session.events) {
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      lastHumanSeq = event.seq
      continue
    }
    // Team types are an extension of the shared SessionEventMap; the Goal
    // package intentionally does not import Teams or load its Host runtime.
    if ((event.type as string) !== 'team/mission') continue
    const data: unknown = event.data
    if (!isRecord(data) || data.version !== 1 || data.teamId !== session.id) continue
    const snapshot = data.snapshot
    if (!isRecord(snapshot) || snapshot.teamId !== session.id
      || typeof snapshot.phase !== 'string' || !TERMINAL.has(snapshot.phase)) continue
    lastTerminalSeq = event.seq
  }
  return lastTerminalSeq > lastHumanSeq
}
