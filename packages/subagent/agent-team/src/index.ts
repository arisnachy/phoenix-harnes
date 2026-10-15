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
import { teamExecutionProof } from './execution-evidence.ts'
import { TeamJournal } from './journal.ts'
import { TeamRuntimeLifecycle } from './lifecycle.ts'
import { TeamMailbox } from './mailbox.ts'
import { TeamRoster } from './roster.ts'
import type { TeamMembership } from './roster.ts'
import { TeamTaskBoard } from './task-board.ts'
import { teamMissionClosed, unfinishedMissionTodos } from './mission-closure.ts'
import { UniversalMissionLedger } from './universal-mission.ts'
import type { UniversalMissionSnapshot } from './universal-mission.ts'
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
export { replayUniversalMission, universalMissionAcceptsEvent, universalMissionTerminal } from './universal-mission.ts'
export type { UniversalMissionPhase, UniversalMissionSnapshot } from './universal-mission.ts'
export { teammateBudgetForMission } from './mission-sizing.ts'
export type { MissionComplexity } from './mission-sizing.ts'
export { teamExecutionProof, teamExecutionRequirement } from './execution-evidence.ts'
export type { TeamExecutionProof, TeamExecutionRequirement } from './execution-evidence.ts'
export { foldTeam } from './fold.ts'
export { classifyTeamUserLanguage, teamUserLanguage, teamLanguageInstruction } from './language.ts'
export type { TeamUserLanguage } from './language.ts'
export {
  KIRA_SOCIAL_STYLE,
  TEAM_PERSONAS,
  TEAM_SKILL_POOLS,
  inferTeamSkill,
  selectTeamPersonaName,
  teamPersonaGender,
  teamSocialStyle,
} from './personas.ts'
export type { TeamPersonaGender, TeamPersonaKind, TeamSkill } from './personas.ts'

declare module '@phoenix-ai/cordis' {
  interface Context {
    agentTeams: TeamService
  }
}

// Kira remains the Lead; three specialists is the HARD concurrent ceiling.
// Mission sizing selects 1/2/3 specialists according to genuinely independent work.
const MAX_TEAMMATES = 3
const DEFAULT_MAX_MEMBERS = MAX_TEAMMATES
// Accept persisted pre-UME configurations up to five and clamp them safely to three.
const LEGACY_MAX_MEMBERS = 5
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

/** Reject Team concurrency settings beyond the universal one-to-five ceiling. */
function memberLimit(value: number): number {
  const limit = positiveLimit('maxMembers', value)
  return Math.min(limit, MAX_TEAMMATES)
}

/** Agent Teams service backed by the exact live Lead Session log. */
export class TeamService extends TypertRemoteService {
  static inject = ['agents', 'sessions', 'sessionPersistence', 'subagents']

  static Config: z<Config> = z.object({
    maxMembers: z.number().step(1).min(1).max(LEGACY_MAX_MEMBERS).default(DEFAULT_MAX_MEMBERS),
    maxTasks: z.number().step(1).min(1).default(DEFAULT_MAX_TASKS),
    maxPendingMessagesPerMember: z.number().step(1).min(1).default(DEFAULT_MAX_PENDING_MESSAGES),
    maxMessageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_BYTES),
    disposalTimeoutMs: z.number().step(1).min(1).default(DEFAULT_DISPOSAL_TIMEOUT_MS),
  })

  /** Validated deployment limits used by every Team operation. */
  private readonly config: Required<Config>

  private readonly teamContext: Context
  private readonly activity: TeamActivity
  private readonly lifecycle: TeamRuntimeLifecycle
  private readonly journal: TeamJournal
  private readonly roster: TeamRoster
  private readonly mailbox: TeamMailbox
  private readonly tasks: TeamTaskBoard
  private readonly missions: UniversalMissionLedger
  private readonly chat: TeamChat
  private readonly pendingChat = new Set<Promise<unknown>>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'agentTeams')
    this.teamContext = ctx
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
    this.missions = new UniversalMissionLedger(this.journal)
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
      // Every genuine human root request belongs to one durable mission, even
      // when Kira does not need a specialist. Queue its journal transaction
      // synchronously so a same-tick turn/end cannot overtake mission creation.
      // Synthetic goal rounds, connector notices and teammate messages are NOT
      // permitted to create fresh human authority.
      if (session.header.origin !== 'subagent' && event.type === 'user/message'
        && event.data.source.kind === 'user') {
        const lead = ctx.agents.get(session.id)
        if (lead?.session === session) {
          const objective = event.data.content.flatMap(block =>
            block.type === 'text' ? [block.text] : []).join(' ').trim()
          if (objective.length > 0) {
            void this.missions.ensure(lead, objective, this.config.maxMembers).catch((error: unknown) => {
              ctx.logger.warn(`Universal mission opening failed: ${errorMessage(error)}`)
            })
          }
        }
      }
      // A completed model turn is not a completed mission when a real todo
      // checklist remains unfinished. Preserve teammate work and Goal recovery.
      // Late reviews after actual completion must not restart a closed mission.
      // The same teardown applies to explicit user cancellation.
      if (session.header.origin !== 'subagent' && event.type === 'turn/end'
        && (event.data.reason.kind === 'completed'
          || (event.data.reason.kind === 'aborted' && event.data.reason.reason.kind === 'user'))
        && !(event.data.reason.kind === 'completed' && unfinishedMissionTodos(session.events))) {
        const lead = ctx.agents.get(session.id)
        if (lead?.session === session) {
          // Capture the identity now: an awaited journal mutation may otherwise
          // run after a user has started the next mission on this same Lead.
          const closingMissionId = this.missions.read(lead)?.id
          void this.missions.close(
            lead,
            event.data.reason.kind === 'aborted',
            this.missionCompletionProof(lead),
            closingMissionId,
          ).catch((error: unknown) => {
            ctx.logger.warn(`Universal mission closure failed: ${errorMessage(error)}`)
          })
          for (const childId of this.roster.liveChildrenByRoot().get(lead) ?? []) {
            // An idle continuable child can still receive queued wakeups; cut it off too.
            if (ctx.agents.get(childId) === undefined) continue
            try {
              ctx.subagents.interrupt(childId, { kind: 'ancestor', agent: lead })
            } catch (error: unknown) {
              ctx.logger.warn(`Teammate cancellation failed: ${errorMessage(error)}`)
            }
          }
        }
      }
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

  /**
   * Read durable execution and verification receipts, not model-written claims.
   * This conservative gate closes unverifiable work as partial, never as success.
   * @param root - real Lead whose Team sessions contain tool receipts.
   * @returns verifiable evidence IDs and whether all assigned work was checked.
   */
  private missionCompletionProof(root: Agent): {
    readonly verified: boolean
    readonly evidenceIds: readonly string[]
  } {
    const state = this.journal.state(root)
    const mission = this.missions.read(root)
    if (mission === undefined) return { verified: false, evidenceIds: [] }
    // A Lead Session may contain several human missions. Never use old workers,
    // tasks or QA receipts to certify the next mission.
    const first = root.session.events.findLast(event =>
      event.type === 'team/mission' && event.data.snapshot.id === mission.id
      && event.data.snapshot.revision === 1)
    if (first === undefined) return { verified: false, evidenceIds: [] }
    const currentEvents = root.session.events.filter(event => event.seq > first.seq)
    const workerIds = new Set(currentEvents.flatMap(event =>
      event.type === 'team/member' && event.data.member.phase === 'provisioning'
        ? [event.data.member.id] : []))
    const taskIds = new Set(currentEvents.flatMap(event =>
      event.type === 'team/task' && event.data.task.revision === 1
        ? [event.data.task.id] : []))
    const children = [...state.members.values()].filter(member => workerIds.has(member.id))
    const tasks = [...state.tasks.values()].filter(task =>
      task.status !== 'deleted' && taskIds.has(task.id))
    const tasksDone = tasks.every(task => task.status === 'completed')
    const evidenceIds: string[] = []
    let hasConfirmation = false
    // A failed or never-started specialist cannot disappear from QA just because
    // other workers succeeded. Count every provisioned worker of this mission.
    let workersVerified = children.length > 0 && children.every(member => member.phase === 'active')
    for (const child of children) {
      if (child.phase !== 'active') continue
      const session = this.teamContext.sessions.get(child.id)
      if (session === undefined) { workersVerified = false; continue }
      const proof = teamExecutionProof(session.events)
      if (proof.requirement === 'none' || !proof.satisfied) { workersVerified = false; continue }
      const toolCalls = new Map<string, string>()
      for (const event of session.events) {
        if (event.type === 'tool/call') toolCalls.set(String(event.data.callId), event.data.name)
        if (event.type !== 'tool/result' || event.data.error !== undefined
          || event.data.message.content.some(block => block.isError === true)) continue
        const callId = String(event.data.message.source.callId)
        const name = toolCalls.get(callId)
        if (name !== undefined && proof.tools.some(tool => name.endsWith(tool))) {
          evidenceIds.push(`${child.id}:${callId}`)
          hasConfirmation ||= /(?:^|__|_|-)(?:verify|check|test|typecheck|build|inspect|read|wait_for|status)(?:$|_|-)/iu.test(name)
        }
      }
    }
    // Kira owns verification: a real successful check by the Lead also counts.
    // Check direct tool results, not only the child proof subset, because a GitHub
    // or design specialist's assignment matcher may exclude independent QA tools.
    const successfulConfirmation = (events: readonly import('@phoenix-ai/dsh-session').SessionEvent[]): boolean => {
      const calls = new Map<string, string>()
      for (const event of events) {
        if (event.type === 'tool/call') calls.set(String(event.data.callId), event.data.name)
        if (event.type !== 'tool/result' || event.data.error !== undefined
          || event.data.message.content.some(block => block.isError === true)) continue
        const tool = calls.get(String(event.data.message.source.callId))
        if (tool !== undefined
          && /(?:^|__|_|-)(?:verify|check|test|typecheck|build|inspect|read|wait_for|status)(?:$|_|-)/iu.test(tool)) {
          return true
        }
      }
      return false
    }
    hasConfirmation ||= successfulConfirmation(currentEvents)
    for (const child of children) {
      const session = this.teamContext.sessions.get(child.id)
      if (session !== undefined) hasConfirmation ||= successfulConfirmation(session.events)
    }
    return {
      verified: workersVerified && tasksDone && hasConfirmation && evidenceIds.length >= children.length,
      evidenceIds,
    }
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

  /** Publish the Lead's own concise reply to a real delivered specialist handoff.
   * @param actor - exact live Lead.
   * @param request - durable peer message and bounded reply.
   * @returns visible reply identity.
   */
  async replyToPeer(actor: Agent, request: { readonly messageId: string; readonly text: string }): Promise<{ messageId: string }> {
    return await this.trackChat(this.chat.replyToPeer(actor, request))
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
    const membership = this.roster.membership(caller)
    if (membership.role !== 'lead') throw new TeamError('only the Team Lead can create teammates', 'TEAM_LEAD_REQUIRED')
    if (teamMissionClosed(caller.session.events)) {
      throw new TeamError('the last mission is closed; a new user turn is required', 'TEAM_MISSION_CLOSED')
    }
    request.signal.throwIfAborted()
    await this.missions.ensure(membership.root, request.description, this.config.maxMembers)
    request.signal.throwIfAborted()
    return await this.roster.spawn(caller, request)
  }

  /**
   * Read the authoritative root-owned mission checkpoint without waking workers.
   * @param caller - any live teammate or Lead in the mission.
   * @returns durable state, or undefined before delegation.
   */
  missionSnapshot(caller: Agent): UniversalMissionSnapshot | undefined {
    return this.missions.read(this.roster.membership(caller).root)
  }

  /**
   * Queue one durable peer message, then attempt immediate delivery.
   * @param caller - exact live sending Team member.
   * @param request - target name, content, scheduling mode, and pre-queue cancellation.
   * @returns durable message identity and immediate-delivery observation.
   */
  async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> {
    if (teamMissionClosed(this.roster.membership(caller).root.session.events)) {
      throw new TeamError('the Team mission is closed; peer messages cannot reopen it', 'TEAM_MISSION_CLOSED')
    }
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
    const membership = this.roster.membership(caller)
    if (teamMissionClosed(membership.root.session.events)) {
      throw new TeamError('closed Team mission cannot create tasks', 'TEAM_MISSION_CLOSED')
    }
    return await this.tasks.create(membership, request)
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
    const membership = this.roster.membership(caller)
    if (teamMissionClosed(membership.root.session.events)) {
      throw new TeamError('closed Team mission cannot mutate tasks', 'TEAM_MISSION_CLOSED')
    }
    return await this.tasks.update(caller, membership, request)
  }

  /**
   * Wait for the next Team-domain or member-status change.
   * @param caller - exact live Team member waiting for activity.
   * @param timeoutMs - bounded wait duration from five seconds through one hour.
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
