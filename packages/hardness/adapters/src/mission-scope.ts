/** Opt-in scope fence for Phoenix-generated scheduled work.
 * User-requested recurring tasks remain independent authorized automations.
 */
import type { Session } from '@phoenix-ai/dsh-session'

/** Durable identity captured by a non-user-generated task in one active mission. */
export interface ScheduledMissionScope {
  readonly sessionId: string
  readonly missionId: string
  readonly epoch: number
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function lastMission(session: Pick<Session, 'id' | 'events'>) {
  let snapshot: Record<string, unknown> | undefined
  let missionSeq = -1
  let lastHumanSeq = -1
  for (const event of session.events) {
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      lastHumanSeq = event.seq
      continue
    }
    if ((event.type as string) !== 'team/mission') continue
    const data: unknown = event.data
    if (!record(data) || data.version !== 1 || data.teamId !== session.id
      || !record(data.snapshot) || data.snapshot.teamId !== session.id) continue
    snapshot = data.snapshot
    missionSeq = event.seq
  }
  return { snapshot, missionSeq, lastHumanSeq }
}

/**
 * Capture an active root mission for *mission-owned* proactive work only.
 * @param session - real executing root agent Session.
 * @returns retry-stable mission scope, or undefined when none is safely active.
 */
export function activeScheduledMissionScope(
  session: Pick<Session, 'id' | 'events'>,
): ScheduledMissionScope | undefined {
  const { snapshot, missionSeq, lastHumanSeq } = lastMission(session)
  if (snapshot === undefined || missionSeq < lastHumanSeq
    || snapshot.phase !== 'running' && snapshot.phase !== 'blocked' && snapshot.phase !== 'verifying'
    || typeof snapshot.id !== 'string' || typeof snapshot.cancellationEpoch !== 'number'
    || !Number.isSafeInteger(snapshot.cancellationEpoch) || snapshot.cancellationEpoch < 0) return undefined
  return {
    sessionId: session.id,
    missionId: snapshot.id,
    epoch: snapshot.cancellationEpoch,
  }
}

/**
 * Deny execution after cancellation, closure, new-user revision or root change.
 * @param session - persisted/live exact owning Session.
 * @param scope - scope captured when the non-user schedule was created.
 * @returns true only if the same mission and epoch are still active.
 */
export function scheduledMissionScopeActive(
  session: Pick<Session, 'id' | 'events'>,
  scope: ScheduledMissionScope,
): boolean {
  if (session.id !== scope.sessionId) return false
  const current = activeScheduledMissionScope(session)
  return current !== undefined && current.missionId === scope.missionId
    && current.epoch === scope.epoch
}
