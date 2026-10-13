/** Durable, domain-neutral mission ledger on the existing Lead Session.
 * No alternate persistence, synthetic agents, or new autonomous scheduler.
 */
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { SessionEvent } from '@phoenix-ai/dsh-session'
import { TeamError } from './error.ts'
import type { TeamJournal } from './journal.ts'
import { TeamId } from './types.ts'

/** Universal mission phases; terminal states cannot be revived by automated work. */
export type UniversalMissionPhase =
  | 'running' | 'blocked' | 'verifying' | 'completed' | 'partial' | 'failed' | 'cancelled'

/** A compact audit snapshot; evidence IDs reference real receipts, not model narration. */
export interface UniversalMissionSnapshot {
  readonly id: string
  readonly teamId: TeamId
  readonly userMessageId: string
  /** Most recent real human steering request, without replacing the original objective. */
  readonly lastHumanMessageId?: string
  readonly objective: string
  readonly origin: 'chat' | 'voice' | 'telegram' | 'schedule' | 'connector' | 'api'
  readonly phase: UniversalMissionPhase
  readonly revision: number
  readonly cancellationEpoch: number
  readonly maxTeammates: number
  readonly evidenceIds: readonly string[]
  readonly blockers: readonly string[]
  readonly verified: boolean
}

/** Fully typed append-only mission state used by Session persistence and replay. */
export interface UniversalMissionEvent {
  readonly version: 1
  readonly teamId: TeamId
  readonly snapshot: UniversalMissionSnapshot
}

declare module '@phoenix-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Versioned root-owned universal mission checkpoint. */
    'team/mission': UniversalMissionEvent
  }
}

const TERMINAL = new Set<UniversalMissionPhase>(['completed', 'partial', 'failed', 'cancelled'])
const PHASES = new Set<UniversalMissionPhase>([
  'running', 'blocked', 'verifying', 'completed', 'partial', 'failed', 'cancelled',
])

/**
 * Check whether a mission reached a terminal phase.
 * @param phase - persisted mission phase.
 * @returns true if no asynchronous event may reactivate the mission.
 */
export function universalMissionTerminal(phase: UniversalMissionPhase): boolean {
  return TERMINAL.has(phase)
}

function validMission(value: UniversalMissionSnapshot): boolean {
  return value !== null && typeof value === 'object'
    && typeof value.id === 'string' && value.id.length > 0
    && typeof value.teamId === 'string' && value.teamId.length > 0
    && typeof value.objective === 'string' && value.objective.length > 0
    && typeof value.userMessageId === 'string' && value.userMessageId.length > 0
    && (value.lastHumanMessageId === undefined || typeof value.lastHumanMessageId === 'string')
    && PHASES.has(value.phase)
    && Number.isSafeInteger(value.revision) && value.revision > 0
    && Number.isSafeInteger(value.cancellationEpoch) && value.cancellationEpoch >= 0
    && Number.isSafeInteger(value.maxTeammates) && value.maxTeammates >= 1 && value.maxTeammates <= 5
    && Array.isArray(value.evidenceIds) && value.evidenceIds.every(x => typeof x === 'string')
    && Array.isArray(value.blockers) && value.blockers.every(x => typeof x === 'string')
    && typeof value.verified === 'boolean'
}

/**
 * Replay only valid same-root, strictly versioned mission checkpoints.
 * Historical closed mission IDs never reopen, including after Host restart.
 * @param teamId - exact Lead Session ID.
 * @param events - durable Team Lead event stream.
 * @returns latest valid mission state, or undefined before any delegation.
 */
export function replayUniversalMission(
  teamId: string,
  events: readonly SessionEvent[],
): UniversalMissionSnapshot | undefined {
  let state: UniversalMissionSnapshot | undefined
  const closed = new Set<string>()
  for (const event of events) {
    if (event.type !== 'team/mission' || event.data.version !== 1 || event.data.teamId !== teamId) continue
    const snapshot = event.data.snapshot
    if (!validMission(snapshot) || snapshot.teamId !== teamId || closed.has(snapshot.id)) continue
    if (state === undefined || state.id !== snapshot.id) {
      if (state !== undefined && !universalMissionTerminal(state.phase)) continue
      if (snapshot.revision !== 1 || (state?.userMessageId === snapshot.userMessageId)) continue
      state = snapshot
    } else {
      if (snapshot.revision !== state.revision + 1
        || snapshot.cancellationEpoch < state.cancellationEpoch
        || snapshot.userMessageId !== state.userMessageId
        || snapshot.objective !== state.objective) continue
      state = snapshot
    }
    if (universalMissionTerminal(snapshot.phase)) closed.add(snapshot.id)
  }
  return state
}

/**
 * Reject late watcher and retry events for closed or stale mission epochs.
 * @param state - authoritative durable mission snapshot.
 * @param missionId - event mission identity.
 * @param cancellationEpoch - epoch captured before asynchronous work began.
 * @returns true only while the same mission remains active.
 */
export function universalMissionAcceptsEvent(
  state: UniversalMissionSnapshot | undefined,
  missionId: string,
  cancellationEpoch: number,
): boolean {
  return state !== undefined && state.id === missionId
    && state.cancellationEpoch === cancellationEpoch && !universalMissionTerminal(state.phase)
}

/** Durable mission lifecycle using the existing transaction and Session flush owner. */
export class UniversalMissionLedger {
  /** @param journal - single-writer Team Session journal. */
  constructor(private readonly journal: TeamJournal) {}

  /** 
   * Return the latest persisted mission without allocating workers.
   * @param root - exact owning Team Lead.
   * @returns validated mission, if any.
   */
  read(root: Agent): UniversalMissionSnapshot | undefined {
    return replayUniversalMission(root.id, root.session.events)
  }

  /**
   * Open a mission on first real Team delegation. Subsequent spawns reuse the
   * same mission; a new human turn is required to replace a terminal mission.
   * @param root - exact Lead.
   * @param objective - actionable real assignment, used only if no user message exists.
   * @param maxTeammates - configured hard ceiling.
   * @returns persisted current mission.
   */
  async ensure(root: Agent, objective: string, maxTeammates: number): Promise<UniversalMissionSnapshot> {
    return await this.journal.transact(root.id, async () => {
      const prior = this.read(root)
      const request = root.session.events.findLast(event =>
        event.type === 'user/message' && event.data.source.kind === 'user')
      const requestId = request?.type === 'user/message'
        ? String(request.data.id) : 'direct-team-assignment'
      if (prior !== undefined && !universalMissionTerminal(prior.phase)) {
        if (requestId === 'direct-team-assignment'
          || requestId === (prior.lastHumanMessageId ?? prior.userMessageId)) return prior
        // A human steers the EXISTING mission; no new plan, workers, or side effects are invented.
        const steered: UniversalMissionSnapshot = {
          ...prior, lastHumanMessageId: requestId, revision: prior.revision + 1,
        }
        await this.journal.appendAndFlush(root, 'team/mission', {
          version: 1, teamId: TeamId(root.id), snapshot: steered,
        })
        return steered
      }
      if (prior !== undefined && prior.userMessageId === requestId) {
        throw new TeamError('closed mission requires a new authentic user request', 'TEAM_MISSION_CLOSED')
      }
      const userText = request?.type === 'user/message'
        ? request.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join(' ').trim()
        : ''
      const selectedObjective = (userText || objective).trim().slice(0, 2_000)
      if (selectedObjective.length === 0) throw new TeamError('mission needs an objective', 'TEAM_INVALID_ARGUMENT')
      const state: UniversalMissionSnapshot = {
        id: `${root.id}:mission:${requestId}`,
        teamId: TeamId(root.id),
        userMessageId: requestId,
        objective: selectedObjective,
        origin: 'chat',
        phase: 'running',
        revision: 1,
        cancellationEpoch: 0,
        maxTeammates,
        evidenceIds: [],
        blockers: [],
        verified: false,
      }
      await this.journal.appendAndFlush(root, 'team/mission', { version: 1, teamId: TeamId(root.id), snapshot: state })
      return state
    })
  }

  /**
   * Close the exact active mission and fence late async completions; a normal
   * turn end is not proof that all requirements were verified.
   * @param root - exact owning Lead.
   * @param cancelled - whether the human explicitly aborted the turn.
   * @returns terminal checkpoint when one existed.
   */
  async close(
    root: Agent,
    cancelled: boolean,
    completion: { readonly verified: boolean; readonly evidenceIds: readonly string[] } = {
      verified: false, evidenceIds: [],
    },
  ): Promise<UniversalMissionSnapshot | undefined> {
    return await this.journal.transact(root.id, async () => {
      const prior = this.read(root)
      if (prior === undefined || universalMissionTerminal(prior.phase)) return prior
      const snapshot: UniversalMissionSnapshot = {
        ...prior,
        phase: cancelled ? 'cancelled' : completion.verified ? 'completed' : 'partial',
        verified: !cancelled && completion.verified,
        evidenceIds: cancelled ? prior.evidenceIds : [...new Set(completion.evidenceIds)].slice(0, 100),
        revision: prior.revision + 1,
        cancellationEpoch: prior.cancellationEpoch + 1,
      }
      await this.journal.appendAndFlush(root, 'team/mission', { version: 1, teamId: TeamId(root.id), snapshot })
      return snapshot
    })
  }
}
