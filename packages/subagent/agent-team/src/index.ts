/** Agent Teams service façade over roster, mailbox, task, and runtime lifecycle owners. */

import { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type {} from '@phoenix-ai/dsh-session-persistence'
import { TypertRemoteService, Remote } from '@phoenix-ai/dsh-typert-protocol'
import { teamChatParticipantsDefinition, teamChatReactionsDefinition } from './chat-projection.ts'
import { TeamChat } from './chat.ts'
import type { TeamChatReadResult, TeamChatReadRequest, TeamChatReactRequest, TeamChatReplyRequest } from './chat-types.ts'
import { TeamActivity } from './activity.ts'
import { errorMessage, TeamError } from './error.ts'
import { TeamJournal } from './journal.ts'
import { TeamRuntimeLifecycle } from './lifecycle.ts'
import { TeamMailbox } from './mailbox.ts'
import { TeamRoster } from './roster.ts'
import type { TeamMembership } from './roster.ts'
import { TeamTaskBoard } from './task-board.ts'
import { TeamId, TeamTaskId } from './types.ts'
import type {
  Config,
  CreateTeamTaskRequest,
  ReactToTeamMessageRequest,
  ReactToTeamMessageResult,
  SendTeamMessageRequest,
  SendTeamMessageResult,
  SpawnTeammateRequest,
  SpawnTeammateResult,
  TeamMemberView,
  TeamTaskView,
  TeamWaitResult,
  UpdateTeamTaskRequest,
} from './types.ts'

export type * from './types.ts'
export type { TeamMembership } from './roster.ts'
export { TeamId, TeamMessageId, TeamTaskId } from './types.ts'
export { TeamError } from './error.ts'
export { teamExecutionProof, teamExecutionRequirement } from './execution-evidence.ts'
export type { TeamExecutionProof, TeamExecutionRequirement } from './execution-evidence.ts'
export { foldTeam } from './fold.ts'
export {
  KIRA_SOCIAL_STYLE,
  TEAM_PERSONAS,
  TEAM_SKILL_POOLS,
  inferTeamSkill,
  selectTeamPersonaName,
  teamPersonaGender,
  teamSocialStyle,
  teamSocialStyleFromProfile,
} from './personas.ts'
export type { TeamPersonaGender, TeamPersonaKind, TeamSkill } from './personas.ts'
export {
  DEFAULT_TEAM_DESIGN,
  DEFAULT_TEAM_DESIGN_DOCUMENT,
  DEFAULT_TEAM_DESIGN_JSON,
  TEAM_DESIGN_MEMBER_IDS,
  TEAM_DESIGN_SETTINGS_NAMESPACE,
  activeTeamDesign,
  normalizeTeamDesign,
  normalizeTeamDesignDocument,
  parseTeamDesignDocument,
} from './design-types.ts'
export type {
  TeamDesign,
  TeamDesignAvatarId,
  TeamDesignDocument,
  TeamDesignGender,
  TeamDesignMemberId,
  TeamDesignMotion,
  TeamDesignPerson,
  TeamDesignSettingsEnvelope,
} from './design-types.ts'

declare module '@phoenix-ai/cordis' {
  interface Context {
    agentTeams: TeamService
  }
}

const MAX_TEAMMATES = 3
const DEFAULT_MAX_MEMBERS = MAX_TEAMMATES
const DEFAULT_MAX_TASKS = 256
const DEFAULT_MAX_PENDING_MESSAGES = 64
const DEFAULT_MAX_MESSAGE_BYTES = 65_536
const DEFAULT_DISPOSAL_TIMEOUT_MS = 5_000

/** Validate one positive safe-integer deployment limit. */
function positiveLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TeamError(`${name} must be a positive safe integer`, 'TEAM_INVALID_CONFIG')
  }
  return value
}

/** Keep the product Team budget aligned with Phoenix's 1 -> 2 -> 3 escalation ladder. */
function memberLimit(value: number): number {
  const limit = positiveLimit('maxMembers', value)
  if (limit > MAX_TEAMMATES) {
    throw new TeamError(`maxMembers must not exceed ${MAX_TEAMMATES}`, 'TEAM_INVALID_CONFIG')
  }
  return limit
}

/** Agent Teams service backed by the exact live Lead Session log. */
export class TeamService extends TypertRemoteService {
  static inject = ['agents', 'sessions', 'sessionPersistence', 'subagents']

  static Config: z<Config> = z.object({
    maxMembers: z.number().step(1).min(1).max(MAX_TEAMMATES).default(DEFAULT_MAX_MEMBERS),
    maxTasks: z.number().step(1).min(1).default(DEFAULT_MAX_TASKS),
    maxPendingMessagesPerMember: z.number().step(1).min(1).default(DEFAULT_MAX_PENDING_MESSAGES),
    maxMessageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_BYTES),
    disposalTimeoutMs: z.number().step(1).min(1).default(DEFAULT_DISPOSAL_TIMEOUT_MS),
  })

  /** Validated deployment limits used by every Team operation. */
  private readonly config: Required<Config>

  private readonly activity: TeamActivity
  private readonly lifecycle: TeamRuntimeLifecycle
  private readonly journal: TeamJournal
  private readonly roster: TeamRoster
  private readonly mailbox: TeamMailbox
  private readonly tasks: TeamTaskBoard
  private readonly chat: TeamChat
  private readonly pendingChat = new Set<Promise<unknown>>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'agentTeams')
    this.config = {
      maxMembers: memberLimit(config.maxMembers ?? DEFAULT_MAX_MEMBERS),
      maxTasks: positiveLimit('maxTasks', config.maxTasks ?? DEFAULT_MAX_TASKS),
      maxPendingMessagesPerMember: positiveLimit(
        'maxPendingMessagesPerMember',
        config.maxPendingMessagesPerMember ?? DEFAULT_MAX_PENDING_MESSAGES,
      ),
      maxMessageBytes: positiveLimit('maxMessageBytes', config.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES),
      disposalTimeoutMs: positiveLimit(
        'disposalTimeoutMs',
        config.disposalTimeoutMs ?? DEFAULT_DISPOSAL_TIMEOUT_MS,
      ),
    }

    this.activity = new TeamActivity()
    this.lifecycle = new TeamRuntimeLifecycle(this.config.disposalTimeoutMs)
    this.journal = new TeamJournal(ctx, (root) => { this.activity.notify(TeamId(root.id)) })
    this.roster = new TeamRoster(ctx, this.journal, this.lifecycle, this.config.maxMembers, this.config.maxMessageBytes)
    this.mailbox = new TeamMailbox(
      ctx,
      this.journal,
      this.roster,
      this.lifecycle,
      this.config.maxPendingMessagesPerMember,
      this.config.maxMessageBytes,
    )
    this.tasks = new TeamTaskBoard(this.journal, this.config.maxTasks)
    this.chat = new TeamChat(ctx, this.journal, this.config.maxMessageBytes, this.config.maxMembers, this.lifecycle.signal)
    ctx.inject(['sessionProjections'], (child) => {
      child.sessionProjections.register(teamChatReactionsDefinition)
      child.sessionProjections.register(teamChatParticipantsDefinition)
    })

    ctx.on('session/event', (session, event) => {
      if (this.lifecycle.disposed) return
      this.mailbox.observeSessionEvent(session, event)
      const parentId = session.header.parentSession
      const root = parentId === undefined ? undefined : ctx.sessions.get(parentId)
      if (root !== undefined && session.header.origin === 'subagent' && (event.type === 'subagent/descriptor' || event.type === 'turn/start' || event.type === 'turn/end')) {
        void this.trackChat(this.chat.presence(root, session, event)).catch((error: unknown) => { ctx.logger.warn(`Team presence publication failed: ${errorMessage(error)}`) })
      }
      if (root !== undefined && (event.type === 'assistant/message' || event.type === 'tool/call' || event.type === 'tool/result')) {
        void this.trackChat(this.chat.capture(root, session.header, session.events.slice(0, event.seq + 1))).catch((error: unknown) => {
          ctx.logger.warn(`Team chat publication failed: ${errorMessage(error)}`)
        })
      }
    })
    ctx.on('agent/session-start', ({ agent }) => { this.scheduleRecovery(agent) })
    ctx.on('agent/status', ({ agent }) => {
      const membership = this.roster.tryMembership(agent)
      if (membership !== undefined) this.activity.notify(membership.id)
    })
    ctx.effect(() => () => this.disposeRuntime(), 'agentTeams.runtimeLifecycle()')
    for (const agent of ctx.agents.list()) this.scheduleRecovery(agent)
  }

  /** Read actual team outputs without starting agents.
   * @param request - root identity.
   * @returns durable transcript.
   */
  @Remote('chatMessages')
  async chatMessages(request: TeamChatReadRequest): Promise<TeamChatReadResult> {
    return await this.trackChat(this.chat.read(request.sessionId, request.limit))
  }

  /** Read a bounded transcript for the exact live caller.
   * @param actor - actual agent.
   * @param limit - protocol message bound.
   * @returns bounded rows.
   */
  async readChatFor(actor: Agent, limit: number): Promise<TeamChatReadResult> {
    return await this.trackChat(this.chat.readFor(actor, limit))
  }

  /** Answer an accepted directed human question while retaining the caller's mission.
   * @param actor - Exact live addressed child.
   * @param request - Durable human request identity and bounded answer.
   * @returns Stable visible answer identity.
   */
  async answerChat(actor: Agent, request: { readonly messageId: string; readonly text: string }): Promise<{ messageId: string }> {
    return await this.trackChat(this.chat.answer(actor, request))
  }

  /** Set/remove a human reaction.
   * @param request - message and Unicode emoji.
   */
  @Remote('chatReact')
  async chatReact(request: TeamChatReactRequest): Promise<void> { await this.trackChat(this.chat.react(request)) }

  /** Reply from the main composer to a direct child.
   * @param request - target and reply context.
   * @returns accepted identity.
   */
  @Remote('chatReply')
  async chatReply(request: TeamChatReplyRequest): Promise<{ messageId: string; queued: boolean }> {
    return await this.trackChat(this.chat.reply(request))
  }

  /** Set/remove a real agent reaction.
   * @param actor - exact live actor.
   * @param request - target mutation.
   */
  async reactToChat(actor: Agent, request: TeamChatReactRequest): Promise<void> { await this.trackChat(this.chat.react(request, actor)) }

  /**
   * Resolve one exact live Agent's Team role.
   * @param agent - exact live Agent used as the authority credential.
   * @returns its root, Team identity, role, and model-facing name.
   */
  membership(agent: Agent): TeamMembership {
    return this.roster.membership(agent)
  }

  /**
   * List the runtime-enriched roster visible to one Team member.
   * @param agent - exact live Team member.
   * @returns Lead and teammate rows in creation order.
   */
  listMembers(agent: Agent): TeamMemberView[] {
    return this.roster.list(this.roster.membership(agent))
  }

  /**
   * Create one named, continuable direct child of the Team Lead.
   * @param caller - exact live Lead Agent.
   * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
   * @returns the active roster row.
   */
  async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult> {
    return await this.roster.spawn(caller, request)
  }

  /**
   * Queue one durable peer message, then attempt immediate delivery.
   * @param caller - exact live sending Team member.
   * @param request - target name, content, scheduling mode, and pre-queue cancellation.
   * @returns durable message identity and immediate-delivery observation.
   */
  async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> {
    return await this.mailbox.send(caller, request)
  }

  /**
   * Attach one lightweight semantic reaction to another member's durable message.
   * A reaction is journal state, not a generated assistant turn, so acknowledgement
   * does not consume an extra prose response.
   * @param caller - exact live Team member reacting.
   * @param request - target message, semantic reaction, and cancellation signal.
   * @returns the committed reaction receipt.
   */
  async reactToMessage(
    caller: Agent,
    request: ReactToTeamMessageRequest,
  ): Promise<ReactToTeamMessageResult> {
    const membership = this.roster.membership(caller)
    request.signal.throwIfAborted()
    return await this.journal.transact(membership.root.id, async () => {
      request.signal.throwIfAborted()
      const state = this.journal.state(membership.root)
      const message = state.messages.get(request.messageId)
      if (message === undefined) {
        throw new TeamError(`team message "${request.messageId}" not found`, 'TEAM_MESSAGE_NOT_FOUND')
      }
      if (message.senderId === caller.id) {
        throw new TeamError('a Team member cannot react to its own message', 'TEAM_SELF_REACTION')
      }
      const prior = state.reactions.get(request.messageId) ?? []
      if (prior.some(item => item.reactorId === caller.id)) {
        throw new TeamError('a Team member may react to a message only once', 'TEAM_REACTION_EXISTS')
      }
      const reaction = {
        messageId: request.messageId,
        reactorId: caller.id,
        reactorName: membership.name,
        reaction: request.reaction,
      } as const
      await this.journal.appendAndFlush(membership.root, 'team/reaction', {
        version: 1,
        teamId: membership.id,
        reaction,
      })
      return {
        messageId: reaction.messageId,
        reactorName: reaction.reactorName,
        reaction: reaction.reaction,
      }
    })
  }

  /**
   * Create one unowned pending task in the Team Lead log.
   * @param caller - exact live Team member creating the task.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the revision-one task view.
   */
  async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.create(this.roster.membership(caller), request)
  }

  /**
   * Return one task, including a deleted tombstone.
   * @param caller - exact live Team member reading the task.
   * @param id - Team-local task identity.
   * @returns the latest task value and derived readiness diagnostics.
   */
  getTask(caller: Agent, id: TeamTaskId): TeamTaskView {
    return this.tasks.get(this.roster.membership(caller), id)
  }

  /**
   * List current non-deleted tasks in numeric creation order.
   * @param caller - exact live Team member reading the board.
   * @returns detached current task views.
   */
  listTasks(caller: Agent): TeamTaskView[] {
    return this.tasks.list(this.roster.membership(caller))
  }

  /**
   * Compare-and-set one authorized task transition.
   * @param caller - exact live Team member authorizing the mutation.
   * @param request - task identity, expected revision, action, and action fields.
   * @returns the committed next task revision.
   */
  async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.update(caller, this.roster.membership(caller), request)
  }

  /**
   * Wait for the next Team-domain or member-status change.
   * @param caller - exact live Team member waiting for activity.
   * @param timeoutMs - bounded wait duration from ten seconds through one hour.
   * @param signal - caller cancellation for the wait only.
   * @returns one observed change or a timeout result.
   */
  async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult> {
    const membership = this.roster.membership(caller)
    return await this.activity.wait(membership.id, timeoutMs, signal)
  }

  /**
   * Interrupt one live teammate turn without clearing its pending inbox.
   * @param caller - exact live Lead Agent.
   * @param targetName - durable teammate name.
   * @returns the target status sampled before cancellation.
   */
  interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' } {
    return this.roster.interrupt(caller, targetName)
  }

  /**
   * Resolve a caller without throwing, used by scoped-tool installation and observers.
   * @param agent - candidate exact live Agent.
   * @returns Team membership, or undefined for non-Team subagents and stale identities.
   */
  tryMembership(agent: Agent): TeamMembership | undefined {
    return this.roster.tryMembership(agent)
  }

  /** Retain admitted chat operations until the shared runtime has settled. */
  private trackChat<T>(operation: Promise<T>): Promise<T> {
    this.pendingChat.add(operation)
    void operation.then(() => this.pendingChat.delete(operation), () => this.pendingChat.delete(operation))
    return operation
  }

  /** Queue one contained recovery pass after publication has unwound. */
  private scheduleRecovery(agent: Agent): void {
    queueMicrotask(() => {
      if (this.lifecycle.disposed) return
      void this.recoverFor(agent).catch((error: unknown) => {
        if (this.lifecycle.disposed) return
        this.ctx.logger.warn(`Agent Teams recovery for "${agent.id}" failed: ${errorMessage(error)}`)
      })
    })
  }

  /** Reconcile roster provisioning before retrying that member's pending mailbox. */
  private async recoverFor(agent: Agent): Promise<void> {
    await this.roster.recoverFor(agent, this.lifecycle.signal)
    await this.mailbox.recoverFor(agent, this.lifecycle.signal)
    await this.trackChat(this.chat.recover(agent))
  }

  /** Stop Team-owned live branches and release every waiter before service disposal completes. */
  private async disposeRuntime(): Promise<void> {
    this.lifecycle.close()
    this.activity.close()

    const failures: unknown[] = []
    await this.lifecycle.settle(this.roster.pendingCreations(), failures)
    await this.lifecycle.settle(this.mailbox.pendingDispatches(), failures)
    await this.lifecycle.settle([...this.pendingChat], failures)
    for (const [root, childIds] of this.roster.liveChildrenByRoot()) {
      try {
        await this.roster.stopTeammates(root, childIds)
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Agent Teams runtime disposal failed')
  }
}

export default TeamService
