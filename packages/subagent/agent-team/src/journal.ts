/** Serialized Team transactions over the exact live Lead Session log. */

import type { Agent } from '@phoenix-ai/dsh-agent'
import type { Context } from '@phoenix-ai/cordis'
import type { SessionEventMap, SessionId } from '@phoenix-ai/dsh-session'
import { foldTeam } from './fold.ts'
import type { TeamFoldState } from './fold.ts'

type AppendTeamEvent = <T extends MutableTeamEventType>(type: T, data: SessionEventMap[T]) => void
type MutableTeamEventType = 'team/member' | 'team/task' | 'team/message/queued' | 'team/message/delivered' | 'team/reaction' | 'team/chat-message' | 'team/mission' | 'team/execution' | 'team/execution-progress' | 'team/execution-context' | 'team/execution-input'

/** Owns per-Lead transaction order and committed Team event publication. */
export class TeamJournal {
  private readonly tails = new Map<SessionId, Promise<void>>()
  private readonly pendingExecutionFlush = new Map<SessionId, Agent>()

  /**
   * @param ctx - Team service context with the injected Session service.
   * @param onCommit - synchronous notification after the Team event flush succeeds.
   */
  constructor(
    private readonly ctx: Context,
    private readonly onCommit: (root: Agent) => void,
  ) {}

  /**
   * Fold authoritative Team state for one exact live Lead.
   * @param root - exact live Team Lead.
   * @returns current replay state selected by the Lead Team id.
   */
  state(root: Agent): TeamFoldState {
    return foldTeam(root.id, root.session.events)
  }

  /**
   * Serialize one Lead's asynchronous mutation operation.
   * @param rootId - Lead Session identity selecting the transaction queue.
   * @param operation - complete read-check-append operation.
   * @returns the operation result.
   */
  async transact<T>(rootId: SessionId, operation: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(rootId) ?? Promise.resolve()
    const guarded = async (): Promise<T> => {
      const pending = this.pendingExecutionFlush.get(rootId)
      if (pending !== undefined) {
        if (!await this.ctx.sessions.flush(pending.session)) throw new Error('Execution persistence remains unavailable')
        this.pendingExecutionFlush.delete(rootId)
        this.onCommit(pending)
      }
      return await operation()
    }
    const run = prior.then(guarded, guarded)
    const tail = run.then(() => undefined, () => undefined)
    this.tails.set(rootId, tail)
    try {
      return await run
    } finally {
      if (this.tails.get(rootId) === tail) this.tails.delete(rootId)
    }
  }

  /** Unflushed execution mutations cannot be presented as committed receipts.
   * @param root - Owning Lead whose latest execution receipts must be durable.
   */
  assertDurable(root: Agent): void {
    if (this.pendingExecutionFlush.has(root.id)) throw new Error('Execution receipt has not been durably persisted')
  }

  /** Teardown cannot certify success while an execution barrier remains failed. */
  assertAllExecutionsDurable(): void {
    if (this.pendingExecutionFlush.size > 0) throw new Error('Execution teardown has uncommitted receipts')
  }

  /**
   * Append and checkpoint one root-owned Team event before publication.
   * @param root - exact live Lead whose Session owns the event.
   * @param type - Team event discriminant.
   * @param data - payload correlated with the event type.
   */
  async appendAndFlush<T extends MutableTeamEventType>(
    root: Agent,
    type: T,
    data: SessionEventMap[T],
  ): Promise<void> {
    // Team events are not generic append-surface messages. They remain domain
    // journal records; an optional KIRA UI Conversation Definition may project
    // selected message/reaction records into chat without changing model history.
    // This narrower local
    // preserving the event-key/payload correlation.
    const append = root.session.append.bind(root.session) as unknown as AppendTeamEvent
    append(type, data)
    if (type.startsWith('team/execution')) this.pendingExecutionFlush.set(root.id, root)
    const persisted = await this.ctx.sessions.flush(root.session)
    if (!persisted && type.startsWith('team/execution')) {
      throw new Error('execution dispatch requires a durable Session flush listener')
    }
    if (persisted) this.pendingExecutionFlush.delete(root.id)
    this.onCommit(root)
  }
}
