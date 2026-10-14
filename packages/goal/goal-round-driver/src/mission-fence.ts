/** Read-only mission continuation fence for the durable Goal round driver.
 *
 * Agent Teams owns UME writes. This projection consumes only public Session
 * events, so Goals does not acquire a circular runtime dependency on Teams.
 */
import type { Session } from '@phoenix-ai/dsh-session'

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
  // The latest matching checkpoint owns the fence. A NEW mission's active
  // checkpoint supersedes a previous terminal one without reviving old Goals.
  const validPhase = (data: unknown): string | undefined => {
    if (!isRecord(data) || data.version !== 1 || data.teamId !== session.id
      || !isRecord(data.snapshot) || data.snapshot.teamId !== session.id) return undefined
    return typeof data.snapshot.phase === 'string' ? data.snapshot.phase : undefined
  }
  const latest = session.events.findLast(event =>
    (event.type as string) === 'team/mission' && validPhase(event.data) !== undefined)
  if (latest === undefined) return false
  const lastHuman = session.events.findLast(event =>
    event.type === 'user/message' && event.data.source.kind === 'user')
  return TERMINAL.has(validPhase(latest.data) ?? '') && latest.seq > (lastHuman?.seq ?? -1)
}
