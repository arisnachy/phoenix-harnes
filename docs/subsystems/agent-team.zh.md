# Agent Teams

[English](agent-team.md) | 中文

稳定的隐式 Root Team 领域、模型工具与宿主适配器共享的类型。[Agent Teams Agent Note](../../.agents/notes/implemented/feature/2026-08-05-agent-teams.zh.md)负责身份、mailbox、task 与共享 checkout 决策；本页记录 [`packages/subagent/agent-team/src/types.ts`](../../packages/subagent/agent-team/src/types.ts) 中的字面持久形式。

## 身份与 roster

`TeamId` 是具有独立[品牌](core.zh.md#branded-ids)的 Root `SessionId`。`TeamTaskId` 在 Team 内按 `task-<n>` 单调分配；`TeamMessageId` 是全局随机值。teammate 的 Session id 始终是持久身份，而 `name` 是不可变的模型／UI 标签。

```ts type-equiv
/** Whole durable value written on every teammate lifecycle change. */
interface TeamMemberSnapshot {
  readonly id: SessionId
  readonly name: string
  readonly description: string
  readonly provider: string
  readonly context: 'fresh' | 'fork'
  readonly phase: TeamMemberPhase
  readonly error?: string
}
```

每个 member 都从 `provisioning` 开始，并且只到达一个终态 roster phase：`active` 或 `failed`。运行时 `running`／`idle`／`inactive` 状态单独派生，绝不会重写该记录。

## 持久 mailbox

Lead Session 首先存储完整 queued message。只有 target 的 pending inbox 条目或已记录用户消息完成持久化，才会写入独立 acknowledgement event，queued-minus-delivered 因而构成恢复 mailbox。

```ts type-equiv
/** One peer message retained until its target Session records it. */
interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  /** Human-stable Team name captured at send time for transcript presentation. */
  readonly targetName?: string
  /** Optional for backward replay and direct API callers; model-facing Team tools always persist one semantic purpose. */
  readonly purpose?: TeamMessagePurpose
  readonly delivery: 'quiet' | 'wakeup'
  readonly content: ContentBlock[]
}
```

target Session 会在 pending inbox 条目和最终用户消息上保留消息身份与发送者归因。跨 inbox 与历史折叠该 source 构成 target 侧去重键；模型可见的 framing 会重复 id 和发送者。

```ts type-equiv
/** Source retained by the target Session for durable mailbox de-duplication. */
interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  /** Semantic purpose survives delivery so Phoenix Auto can route Kira without another classifier call. */
  readonly purpose?: TeamMessagePurpose
}
```

## 共享任务 DAG

每条 task event 都存储完整快照。`revision` 是 compare-and-set 值，每次变更递增 1。`blockedBy` edge 必须指向未删除任务，并维持无环图。`writeScopes` 是规范化的提示性路径前缀，不是锁。

```ts type-equiv
/** Whole durable task snapshot; every mutation increments {@link revision}. */
interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}
```

`pending` 表示尚未开始或已经释放，`in_progress` 携带 owner，`completed` 满足 blocker，`deleted` 是保留的 tombstone。view 会添加 owner name、readiness 和 write-scope 重叠警告，但不会改变持久快照。

## 回放

`foldTeam()` 把一个 Root Session 回放成每个 Team 操作所读取的 roster、任务板与 queued-minus-delivered mailbox。它按 `TeamId` 选取记录，因此普通 fork 继承的 event 保留 ancestor id，绝不会进入新 Root 的状态。Session event 的 `seq` 与 `time` 继续负责顺序和时间记录，Team snapshot 不再重复保存它们。roster 与 task 读取以 view 形式到达调用方，附带 owner name、readiness 与 write-scope 警告，而 pending 邮件仅供投递与恢复内部使用。包 [README](../../packages/subagent/agent-team/README.zh.md)负责 operation、authorization、recovery 和限制行为。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentteams--teamservice"></a>

### `ctx.agentTeams` — `TeamService`

Agent Teams service backed by the exact live Lead Session log.

```ts cordis-catalog
/** Read actual team outputs without starting agents.
 * @param request - root identity.
 * @returns durable transcript.
 */
@Remote('chatMessages') async chatMessages(request: TeamChatReadRequest): Promise<TeamChatReadResult>

/** Read a bounded transcript for the exact live caller.
 * @param actor - actual agent.
 * @param limit - protocol message bound.
 * @returns bounded rows.
 */
async readChatFor(actor: Agent, limit: number): Promise<TeamChatReadResult>

/** Answer an accepted directed human question while retaining the caller's mission.
 * @param actor - Exact live addressed child.
 * @param request - Durable human request identity and bounded answer.
 * @returns Stable visible answer identity.
 */
async answerChat(actor: Agent, request: { readonly messageId: string; readonly text: string }): Promise<{ messageId: string }>

/** Set/remove a human reaction.
 * @param request - message and Unicode emoji.
 */
@Remote('chatReact') async chatReact(request: TeamChatReactRequest): Promise<void>

/** Reply from the main composer to a direct child.
 * @param request - target and reply context.
 * @returns accepted identity.
 */
@Remote('chatReply') async chatReply(request: TeamChatReplyRequest): Promise<{ messageId: string; queued: boolean }>

/** Set/remove a real agent reaction.
 * @param actor - exact live actor.
 * @param request - target mutation.
 */
async reactToChat(actor: Agent, request: TeamChatReactRequest): Promise<void>

/**
 * Resolve one exact live Agent's Team role.
 * @param agent - exact live Agent used as the authority credential.
 * @returns its root, Team identity, role, and model-facing name.
 */
membership(agent: Agent): TeamMembership

/**
 * List the runtime-enriched roster visible to one Team member.
 * @param agent - exact live Team member.
 * @returns Lead and teammate rows in creation order.
 */
listMembers(agent: Agent): TeamMemberView[]

/**
 * Create one named, continuable direct child of the Team Lead.
 * @param caller - exact live Lead Agent.
 * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
 * @returns the active roster row.
 */
async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult>

/**
 * Queue one durable peer message, then attempt immediate delivery.
 * @param caller - exact live sending Team member.
 * @param request - target name, content, scheduling mode, and pre-queue cancellation.
 * @returns durable message identity and immediate-delivery observation.
 */
async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult>

/**
 * Attach one lightweight semantic reaction to another member's durable message.
 * A reaction is journal state, not a generated assistant turn, so acknowledgement
 * does not consume an extra prose response.
 * @param caller - exact live Team member reacting.
 * @param request - target message, semantic reaction, and cancellation signal.
 * @returns the committed reaction receipt.
 */
async reactToMessage( caller: Agent, request: ReactToTeamMessageRequest, ): Promise<ReactToTeamMessageResult>

/**
 * Create one unowned pending task in the Team Lead log.
 * @param caller - exact live Team member creating the task.
 * @param request - task text, blockers, and advisory write scopes.
 * @returns the revision-one task view.
 */
async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Return one task, including a deleted tombstone.
 * @param caller - exact live Team member reading the task.
 * @param id - Team-local task identity.
 * @returns the latest task value and derived readiness diagnostics.
 */
getTask(caller: Agent, id: TeamTaskId): TeamTaskView

/**
 * List current non-deleted tasks in numeric creation order.
 * @param caller - exact live Team member reading the board.
 * @returns detached current task views.
 */
listTasks(caller: Agent): TeamTaskView[]

/**
 * Compare-and-set one authorized task transition.
 * @param caller - exact live Team member authorizing the mutation.
 * @param request - task identity, expected revision, action, and action fields.
 * @returns the committed next task revision.
 */
async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Wait for the next Team-domain or member-status change.
 * @param caller - exact live Team member waiting for activity.
 * @param timeoutMs - bounded wait duration from ten seconds through one hour.
 * @param signal - caller cancellation for the wait only.
 * @returns one observed change or a timeout result.
 */
async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult>

/**
 * Interrupt one live teammate turn without clearing its pending inbox.
 * @param caller - exact live Lead Agent.
 * @param targetName - durable teammate name.
 * @returns the target status sampled before cancellation.
 */
interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' }

/**
 * Resolve a caller without throwing, used by scoped-tool installation and observers.
 * @param agent - candidate exact live Agent.
 * @returns Team membership, or undefined for non-Team subagents and stale identities.
 */
tryMembership(agent: Agent): TeamMembership | undefined
```

Types: [Agent](core.zh.md)

Source: [`packages/subagent/agent-team/src/index.ts`](../../packages/subagent/agent-team/src/index.ts)
<!-- END GENERATED cordis-surface -->

<a id="main-conversation"></a>

## 主会话

对模型隐藏的公开会话记录保留规范身份、源所有权及每个目标的接收记录。带版本的事件和表情、参与者投影共享现有 Session 流。浏览器及根会话恢复会重用回复请求身份；重复消息快照属于同一会话行的更新。

```ts type-equiv
/** Durable, model-hidden conversation records shared by the team and ordinary chat. */
interface TeamChatReaction {
  readonly id: string
  readonly messageId: string
  readonly reactorId: string
  readonly reactorName: string
  readonly reactorKind: 'user' | 'kira' | 'agent'
  readonly emoji: string
  readonly createdAt: number
}
```

```ts type-equiv
/** A public root transcript row; later durable snapshots keep the same identity. */
interface TeamChatMessage {
  readonly id: string
  readonly senderId: string
  readonly senderName: string
  readonly senderKind: 'user' | 'kira' | 'agent'
  readonly avatar?: string | undefined
  readonly role?: string | undefined
  readonly missionId?: string | undefined
  readonly text: string
  readonly time: number
  readonly sourceSeq: number
  readonly targetId?: string | undefined
  readonly replyTo?: string | undefined
  readonly replyQuote?: string | undefined
  readonly mentions: readonly string[]
  readonly supervised?: boolean | undefined
  readonly deliveries?: readonly {
    readonly targetId: string
    readonly accepted: boolean
    readonly error?: string | undefined
  }[] | undefined
  readonly reactions: readonly TeamChatReaction[]
}
```

```ts type-equiv
/** A stable mission-owned identity retained after the child completes. */
interface TeamChatParticipant {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly status: string
  readonly avatar?: string | undefined
  readonly task?: string | undefined
  readonly missionId?: string | undefined
}
```

```ts type-equiv
/** Detached public transcript and real participant identities; reading never wakes agents. */
interface TeamChatReadResult { readonly messages: TeamChatMessage[]
  readonly participants: TeamChatParticipant[] }
```

```ts type-equiv
/** A live root identity and optional bounded message count (1–200). */
interface TeamChatReadRequest { readonly sessionId: string
  readonly limit?: number }
```

```ts type-equiv
/** A per-actor Unicode emoji set/remove on an existing public message. */
interface TeamChatReactRequest extends TeamChatReadRequest {
  readonly messageId: string
  readonly emoji: string
  readonly active: boolean
}
```

```ts type-equiv
/** A retry-stable human request to existing continuable direct children. */
interface TeamChatReplyRequest extends TeamChatReadRequest {
  readonly requestId: string
  readonly targetId: string
  readonly targetIds?: readonly string[]
  readonly text: string
  readonly replyTo?: string | undefined
}
```
