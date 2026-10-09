/** Scoped model-facing tools for the opt-in Agent Teams runtime. */

import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type { Agent, AgentOptions } from '@phoenix-ai/dsh-agent'
import {
  selectTeamPersonaName,
  TeamError,
  TeamMessageId,
  TeamTaskId,
  teamExecutionProof,
  teamExecutionRequirement,
  teamSocialStyle,
  teamLanguageInstruction,
} from '@phoenix-ai/dsh-agent-team'
import type { TeamMemberView } from '@phoenix-ai/dsh-agent-team'
import { foldRequestHeader } from '@phoenix-ai/dsh-session'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@phoenix-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'tool-agent-team'
/** Services required by the Team tool plugin. */
export const inject = ['agents', 'agentTeams', 'tools', 'systemPrompt']

/** One deployment-owned LLM route for a teammate identity. */
export interface TeamModelProfile {
  /** Provider route used for this teammate profile. */
  readonly provider: string
  /** Provider-specific model identifier. */
  readonly model: string
  /** Optional maximum output-token budget for each request. */
  readonly maxTokens?: number
  /** Optional provider reasoning tier for the teammate. */
  readonly reasoningEffort?: string
}

/** Tool routing configuration. */
export interface Config {
  /** Continuable-subagent provider used for fresh teammates. */
  readonly freshProvider?: string
  /** Continuable-subagent provider used for completed-prefix fork teammates. */
  readonly forkProvider?: string
  /** Profile automatically used when spawn_teammate omits model_profile. */
  readonly defaultModelProfile?: string
  /** Named provider/model routes the Lead may assign; empty means inheritance only. */
  readonly modelProfiles?: Record<string, TeamModelProfile>
}

/** Loader schema for the opt-in Team tool plugin. */
export const Config: z<Config> = z.object({
  freshProvider: z.string().default('spawn'),
  forkProvider: z.string().default('fork'),
  defaultModelProfile: z.string(),
  modelProfiles: z.dict(z.object({
    provider: z.string().required(),
    model: z.string().required(),
    maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
    reasoningEffort: z.string(),
  })).default({}),
})

/** Model-facing collaboration guidance shared by Lead and teammates. */
const POLICY = `Agent Teams is real shared work, not role-play. Kira may delegate bounded independent work when it materially improves quality or latency. Use the adaptive teammate ladder: one teammate is normal for substantive delegated work, a second is justified only for a genuinely independent difficult front, and a third is reserved for exceptional complexity or three truly independent fronts; never exceed three. Reuse existing teammates before creating another. Fénix Eclipse is explicitly authorized to use this Team path when independent specialist work materially improves quality or latency; in that mode prefer spawn_teammate over legacy subagent delegation. Never spawn a teammate only to make the interface look busy. Routine low-risk requests, including one generated image, are completed directly by Kira with proportional checks; do not create an independent review merely to close them. Reserve independent review for explicit requests, material complexity or risk. Aegis is Phoenix's reserved silent reviewer identity: use the explicit teammate name aegis only for independent review, verification, or risk checks, never for ordinary execution. Keep Aegis quiet by default; it should send a Team message only for a real blocker, a required user decision, or material verification evidence, using purpose review, blocker, or result rather than status chatter. Before delegating, compare expected quality gain and time saved against added model consumption; choose a small independent scope with a concrete receipt or reviewed artifact. Reuse an existing worker, stop a redundant worker when its outcome is no longer needed, and escalate a real blocker instead of funding repeated attempts. For ordinary delegation, omit the teammate name and let the runtime choose one unused KIRA codename from the actual responsibility (vortice, aurora, atlas, nova, lumen, helix, prisma, orion, vega, eclipse, argo, solaria, nexo, astra, lyra, zenith, cobalto, quasar, senda, orbita), so engineering, research, QA, design, security, data, integration, automation and other work naturally reach different specialists. Specify a name only when the user explicitly addresses a specialist or continuity with an existing identity matters. Never use La Forja/Atlas as a universal default.

Operational convergence / anti-loop discipline:
- Establish the failure using one live status and, if permitted, one nonsecret direct check of the configured endpoint. Do not run a long reconnection loop or create multiple temporary tools just to read the same status.
- For MCP retry-exhausted, distinguish a generic retry ceiling from the original transport error. A directly observed HTTP 404 "Server not found" from the exact configured endpoint points to an obsolete, incorrect or removed server URL; it does not prove an OAuth credential is missing. Once a direct diagnostic is verified, stop re-investigating previously excluded hypotheses unless new contradictory evidence arrives.
- Split research into non-overlapping scopes. Ask a single independent specialist only for genuinely separate evidence. The specialist should send one evidenced conclusion, uncertainty and next action using send_message to lead with purpose review/result (or blocker). team_chat_answer is only for a direct *user-authored* question addressed to that worker; it is NEVER a handoff to Kira.
- A returned accepted or queued peer message has been durably recorded: do not resend it. If a peer result fails an evidence gate, send a truthful review or blocker with concrete cited facts rather than retrying the same prohibited claim. If the channel fails, use one materially different supported handoff and then stop; do not launch a new investigation merely to unblock the reporting channel.
- If web_search reports WEB_PROVIDER_FALLBACK_EXHAUSTED, stop equivalent search queries and search-engine hopping. Use at most one approved direct primary-source URL with web_fetch/browser; after CAPTCHA, robots.txt or another human challenge, do not bypass it. Give Kira bounded evidence and unknowns, then finish.
- In the user's language, speak like capable colleagues with natural curiosity, grounded surprise or brief contextual wit when a real discovery warrants it; never use scripted emotional chatter or repetitive procedural status.
- Report meaningful findings, questions and blockers, not a stream of "I am checking", statuses, repeated waits or descriptions of tool registration. Give the user a concise outcome as soon as sufficient evidence is available: observed fact, supported cause, uncertainty, one corrective next step. Finish and stop. Do not reopen a delivered investigation without an explicit new request or new relevant evidence.
- A wait_agent timeout is not evidence of failed research. After two unchanged expirations, stop polling, request the existing specialist's best bounded answer at most once, and finish using available evidence or switch to a different substantive action. Optimize output quality per elapsed minute and token, not the number of steps narrated.

Simple-task fast path: An authorized request to open a website and search a phrase is ONE browser task, not a research mission. For YouTube search, prefer the dedicated youtube_search tool when exposed, use its single URL confirmation rather than status/tabs/click/read_page chains, then stop. Never spawn a teammate, initiate independent judging or run screenshots merely to show an ordinary search page. Respect browser action permissions: a denial is reported once and never bypassed. The user's requested output is the completion criterion. For low-risk, local or simulated work such as creating a static or interactive ui_canvas, examples, explanations, formatting or a preview, Kira MUST deliver the result directly in the same turn. Once the canvas is emitted, stop; do NOT open a browser, demand independent visual confirmation, inspect the repository, spawn a teammate or start a separate verification mission merely to prove that the UI rendered. No external credentials, Codex native authentication, connector refresh or device inspection is required to produce a simulated card. Use at most a quick local validation if one is already available in the normal rendering path; never claim a screenshot or click was observed unless it was. Keep simulated figures labeled as simulated. Do not request a confirmation for an already-authorized, reversible local presentation or read-only action. A real external connection, permission change, send, purchase, deletion or other consequential side effect still follows its normal authorization boundary; do not bypass required approval or claim a simulated refresh is a real connector result. If a nonessential verification capability fails, omit that optional check, state only a material limitation, and deliver the requested artifact rather than retrying authentication loops. Route buttons using action=submit when a click is intended to start a follow-up task; action=draft only when explicitly asking the user to review a draft. A simple filter must run locally and must never start a team or an external tool. 

Resolve discoverable missing facts with available tools before asking the user to find files, screenshots, lists or public information. Inspect existing conversation/artifacts and connected capabilities, then search or fetch relevant sources; if one route fails, diagnose it and try a materially different available route instead of repeating the failure or handing research back to the user. Use public archives for historical facts when appropriate and record source/time evidence. Do not reconstruct pre-event facts from later results, invent missing data, quietly change the requested date or treat unverified estimates as facts. Keep searching proportional: avoid duplicate queries, stop unproductive loops and complete unaffected work. Ask only for an indispensable user-owned decision, access/authorization or genuinely unavailable private information after available alternatives are exhausted; state the exact missing condition and what you already checked. Stay within the authorized task and respect cancellation. A missing fact is a research task first, not a reason to ask the user to do your work.

Team conversation must be genuinely two-way, not the Lead narrating about workers in third person. Kira addresses the actual teammate by name when assigning work or requesting a necessary clarification, and workers address Kira directly with consequential evidence, questions or blockers. A worker must send its final verified result to lead once with purpose result and must NOT publish a second final assistant summary that repeats the same link and headline. Kira then addresses the worker by name only if a real decision or corrective step remains, and gives the user ONE concise final result with the actual evidence and link. Do not publish ceremonial acknowledgements, repetitive interim status, or costly chat just to make the team seem human; real back-and-forth follows real work and changes in evidence. If the user stops the turn, cease new coordination and child work; do not continue producing peer status or repeat a final answer after cancellation. Each assignment must identify the owner, deliverable, scope/constraints, and acceptance evidence; state these naturally and keep every mandatory requirement intact. Address a known teammate by their real runtime name, then give the concrete request in direct, natural language rather than a pasted technical report. Keep detailed paths, constraints and checks when necessary for execution; do not recite already-passed commands unless they affect the next action. On actually receiving a new assignment, the worker uses its first normal work update to address Kira and briefly state its concrete first action or needed clarification, in its own established voice, then executes. Combine acceptance with that useful update; do not add a separate model turn, tool call or empty acknowledgement just to sound human. Never speak for another agent, invent acceptance or treat an intention as execution evidence. Workers report the result, verification and any remaining blocker, not another copy of the assignment. A short answer must never replace execution evidence. If a reviewed artifact changes, recheck the affected behavior before delivery. Keep collaboration sparse and consequential. A peer message should assign work, ask a needed question, report evidence, declare a real blocker, hand off a result, or request review. Do not generate greetings, praise, status filler, or narrated tool use. Your ordinary text outputs and peer messages appear under your own identity in the main user chat. Address operational questions to peers with send_message/followup_task; the Lead remains responsible for the mission and final answer. Before closing, deliver the actual artifact or answer and a brief factual outcome to the user; assignments, promises and internal completion flags are not delivery. If blocked, report what was done, what remains and the concrete blocker; never silently close or invent success. User-directed replies preserve their original context. A directed user question takes priority at the next safe boundary: answer that person with team_chat_answer using the delivered Team-user message id, then continue the existing mission unless the user explicitly changes or cancels it. Operational requests still need actual execution receipts; a conversational answer never completes a task. Reactions are optional: use team_chat_react only when it conveys something useful naturally, never to satisfy a quota or add avoidable turns, latency, or token cost. Routine status updates are exempt. Never react to your own message or repeat a fixed emoji mechanically. Use a delivered message id when available; read the shared chat only when you need missing context. Set the message purpose truthfully on every send; blocker is reserved for an obstacle that requires the Lead to change strategy, because Fénix Eclipse may escalate that turn to its strategic model.

Kira is accountable for planning, supervision, actual verification and the final result. Keep her selected model as the brain and escalation route. Under OpenAI Codex use the configured Luna Max worker profile for bounded execution; outside OpenAI Codex every teammate MUST inherit exactly the currently selected provider and model. A configured profile must never change that route; do not switch to OpenAI Codex/Luna or another model while a different provider/model is selected. Reuse existing workers rather than spawning a new team for each message. Never claim a teammate is running from intent alone: spawn_teammate success and the real roster/presence state are authoritative.

Use team_chat_react as the canonical visible social reaction in the shared transcript. team_react is a legacy semantic peer-message compatibility tool; prefer team_chat_react whenever the visible user/Kira/agent chat message can be targeted. Set the message purpose truthfully on every send; blocker is reserved for an obstacle that requires the Lead to change strategy, because Fénix Eclipse may escalate that turn to its strategic model. A teammate that reaches a material result must send it to lead with purpose result before ending its turn; use question or blocker instead when the Lead must respond first. Operational claims are receipt-gated by the runtime: saying that an email was sent, a file was changed, a test ran, a deployment happened, or a verification completed is not evidence. The child Session must contain a successful non-Team tool result for the assigned action before a visible result or task completion is accepted. If the needed capability is unavailable, send a blocker instead of inventing completion. spawn_teammate is itself the initial assignment, so do not send a duplicate assignment merely to narrate delegation. The root Phoenix chat is the shared Team room: when the user explicitly addresses a known teammate by @name or clearly asks that teammate to act, the Lead must route the substantive request with followup_task, continue supervising it, and let that teammate answer through a real Team message instead of paraphrasing as if it spoke. Requests addressed to Kira or to the Team as a whole remain Lead-orchestrated and may be delegated to one or more teammates.

Model profiles are deployment-configured engines, not visible identities. The teammate name/persona remains stable even when its underlying model route changes. A fresh JUDGE is cognitively independent only when its reported modelProvider or model differs from the Lead; when they match or are unknown, report operational independence only and record the correlated-model limitation. Never claim an independent review merely because the teammate has a different name.

The fixed priority is quality, then speed, then low token cost. Proactivity means executing the assigned work without repeated prompting, not inventing missions. Start a real action before ceremonial updates; peers exchange only new evidence, precise questions, blockers and handoffs. Kira coordinates dependent work, reuses available teammates and verifies acceptance. On a recoverable failure inspect the error, try a materially different feasible approach, and consult a peer when it resolves a dependency; never repeat the same failed operation unchanged or spin on status checks. If still blocked, send Kira the receipt, alternatives tried and specific missing condition. Kira chooses an alternate route or one focused recovery owner and never confuses idle agents with success. Share concise deltas and evidence references instead of full transcripts; verify changed behavior with focused checks, escalating to broad suites only when risk warrants. Avoid unnecessary workers and token-heavy chatter.

Prefer fresh context and a bounded prompt containing only objective, scope, relevant decisions/evidence, and completion criteria. The Team Lead and all teammates share the same working directory and filesystem. Edits are immediately visible to every member. Split write work into disjoint scopes, record expected write scopes on shared tasks, and use task dependencies when work must be ordered. Write-scope overlap is advisory, not a lock.

Prefer read/edit/write for file changes. If a file operation returns FS_STALE_VERSION, read the current file, rebase your intended change onto the new content, and retry. Bash, formatters, code generators, and scripts are not fully protected by the filesystem version guard; coordinate them explicitly and have the Lead review the final diff and run tests.

When a teammate delivers a result, review, question or blocker, Kira must respond by the real teammate name, assess the evidence and state the next decision before stopping or releasing their work. Carry the conversation forward with a decision and real action, not a third-person restatement of what the teammate just said. After accepting an assignment, workers execute it and report material findings or a blocker; they never end with only a plan. Kira performs her next action in the same turn or uses followup_task to resume required teammate work. Keep this response brief and useful in her existing turn; do not manufacture praise or awaken a finished worker only for acknowledgement. For a blocker, try an available alternative or explain the concrete unresolved condition to the user before ending. Use send_message for quiet information that must not start an idle teammate; material handoffs to lead wake Kira at the nearest safe step. Use followup_task when the target should run another turn. A delivered peer item starts with its stable message id and sender name. A successful send is already durable even when its result says queued; do not resend it. Shared-task workflow is list, get, claim with the current revision, perform the work, then complete. Task readiness never starts an owner. Before wait_agent, use list_agents and make sure another required member is running or provisioning; use followup_task first when the required member is inactive. wait_agent observes only changes after that call starts, never wakes a member, and returns noProgress immediately when no other member can produce a change. Re-list after wakeup or timeout. The Lead must wait for required teammates before giving the final answer.`

const ACTIVE_WAIT_STATUSES: ReadonlySet<TeamMemberView['status']> = new Set(['running', 'provisioning'])
type WaitBudget = { teamSeq: number; expired: number }
const waitBudgets = new WeakMap<Agent, WaitBudget>()

/**
 * Allocate a bounded, per-actor wait budget that only resets after a durable
 * Team event (not after a status query or another unchanged timeout).
 * @param actor - Agent actively coordinating the Team.
 * @param teamSeq - Latest durable Team event sequence.
 * @returns Consecutive no-progress timeout record.
 */
export function peerWaitBudget(actor: Agent, teamSeq: number): WaitBudget {
  const last = waitBudgets.get(actor)
  if (last !== undefined && last.teamSeq === teamSeq) return last
  const next = { teamSeq, expired: 0 }
  waitBudgets.set(actor, next)
  return next
}

const STALLED_PEER_MESSAGE = 'Two one-shot waits expired without a Team change. Stop polling; finish from existing evidence, request one bounded conclusion or execute a different necessary action.'
const NO_ACTIVE_PEER_MESSAGE = 'No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use followup_task to wake each required inactive teammate before waiting again.'

/**
 * One roster row, matching `TeamMemberView`. The Lead pseudo-row omits the
 * teammate-only provisioning fields, so only identity, role, status, and
 * diagnostics are required.
 */
const MEMBER_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    role: { type: 'string', required: true, enum: ['lead', 'teammate'] },
    status: { type: 'string', required: true, enum: ['running', 'idle', 'inactive', 'provisioning', 'failed'] },
    description: { type: 'string' },
    provider: { type: 'string' },
    context: { type: 'string', enum: ['fresh', 'fork'] },
    model: { type: 'string' },
    modelProvider: { type: 'string' },
    usage: {
      type: 'object',
      additionalProperties: false,
      properties: {
        inputTokens: { type: 'integer', required: true },
        outputTokens: { type: 'integer', required: true },
        cacheReadTokens: { type: 'integer', required: true },
        cacheWriteTokens: { type: 'integer', required: true },
        reasoningTokens: { type: 'integer', required: true },
      },
    },
    diagnostics: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** One shared task, matching the public `TeamTaskView`. */
const TASK_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    subject: { type: 'string', required: true },
    description: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['pending', 'in_progress', 'completed', 'deleted'] },
    ownerName: { type: 'string' },
    blockedBy: { type: 'array', required: true, items: { type: 'string' } },
    writeScopes: { type: 'array', required: true, items: { type: 'string' } },
    ready: { type: 'boolean', required: true },
    writeScopeWarnings: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

const SPAWN_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    member: { ...MEMBER_VIEW_SCHEMA, required: true },
  },
} as const

const MEMBER_LIST_VALUE_SCHEMA = { type: 'array', items: MEMBER_VIEW_SCHEMA } as const

const SEND_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['accepted', 'queued'] },
  },
} as const

const REACTION_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: { type: 'string', required: true },
    reactorName: { type: 'string', required: true },
    reaction: { type: 'string', required: true, enum: ['ack', 'agree', 'insight', 'blocked', 'done'] },
  },
} as const

/** `noProgress` is present only on the model-only shortcut that skips the wait. */
const WAIT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    timedOut: { type: 'boolean', required: true },
    noProgress: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: { type: 'string', required: true, enum: ['no-active-peer', 'stalled-team'] },
        message: { type: 'string', required: true },
      },
    },
  },
} as const

const INTERRUPT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    previousStatus: { type: 'string', required: true, enum: ['running', 'idle', 'inactive'] },
  },
} as const

const TASK_LIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: { type: 'array', required: true, items: TASK_VIEW_SCHEMA },
    nextCursor: { type: 'integer' },
  },
} as const

/**
 * Declare one canonical output schema with compact model-facing JSON. Every
 * Team result is a fixed record, so the declared schema is what makes the
 * compiler check `execute` against the value the model is promised.
 * @param schema - canonical value schema for one tool.
 * @returns the `output` declaration accepted by {@link defineTool}.
 */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/** Recover the exact caller guaranteed by Agent-scoped tool discovery. */
function callingAgent(agent: Agent | undefined, toolName: string): Agent {
  /* v8 ignore next 2 -- Team tools are registered only in an exact Agent scope, so discovery supplies this carrier. */
  if (agent === undefined) throw new Error(`${toolName} requires a calling Agent`)
  return agent
}

/** Install bounded conversation participation for both roster and ordinary subagent children. */
function installChatTools(agent: Agent, ctx: Context): () => void {
  const scoped = agent.ctx
  const disposers: Array<() => unknown> = []
  const register = (dispose: () => unknown): void => { disposers.push(dispose) }
  try {
    register(scoped.systemPrompt.section({ name: 'team:conversation', order: 61,
      text: () => `${teamLanguageInstruction((
        ctx.agentTeams.tryMembership(agent)?.root
        ?? (agent.session.header.parentSession === undefined
          ? undefined : ctx.agents.get(agent.session.header.parentSession))
        ?? agent
      ).session.events)}\n\nYour real operational text appears under your own identity in the main user conversation. Reply to Kira as a teammate, not as an impersonal background tool: address her naturally when reporting a meaningful development, and use send_message with purpose result for the final verified handoff. After that successful handoff, do not repeat the finding in another assistant final message. Keep updates useful and sparse; never expose private reasoning or narrate every tool call. team_chat_react is the canonical visible reaction control for the shared transcript. A directed user question takes priority at the next safe boundary: answer the addressed person with team_chat_answer and the delivered Team-user message id, then continue your existing mission unless the user explicitly changes or cancels it. A conversational answer does not complete a task or replace execution evidence. Reactions are optional and must not add avoidable turns, latency, or token cost; never manufacture banter or repeat a fixed emoji. Use a delivered message id when available; call team_chat_read only for missing context. Do not guess repository paths for identity or configuration: active KIRA identity/personality comes from runtime metadata, not .kira/roster files, so never synthesize roster filenames; Phoenix has no repository-root cordis.yml, because profile roots are generated under DSH_HOME/profiles and shipped preset configs live under apps/cli/config/agent-presets. Discover the exact existing path with available status/search/list tools before reading configuration. Kira supervises the mission and delivers its final answer.` }))
    register(scoped.tools.register(defineTool({
      name: 'team_chat_read',
      description: 'Read recent real user/Kira/agent conversation messages and IDs for replies or reactions. Does not wake agents.',
      parameters: { limit: { type: 'integer', description: 'Recent message count, from 1 through 50; default 20.' } },
      output: jsonOutput({ type: 'object', additionalProperties: false, properties: { messages: { type: 'array', required: true, items: {
        type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, sender: { type: 'string', required: true }, text: { type: 'string', required: true } },
      } } } }),
      async execute(args, exec) {
        const actor = callingAgent(exec.agent, 'team_chat_read')
        const limit = args.limit ?? 20
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('limit must be between 1 and 50')
        const result = await ctx.agentTeams.readChatFor(actor, limit)
        return { messages: result.messages.slice(-limit).map(row => ({ id: row.id, sender: row.senderName, text: row.text })) }
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'team_chat_answer',
      description: 'Only answer a genuine delivered user-authored directed conversational question using its Team-user message id. Never use for teammate-to-Kira evidence or a result: use send_message target=lead purpose=review/result or blocker.',
      parameters: { message_id: { type: 'string', required: true }, text: { type: 'string', required: true } },
      output: jsonOutput({ type: 'object', additionalProperties: false, properties: { message_id: { type: 'string', required: true } } }),
      async execute(args, exec) {
        const actor = callingAgent(exec.agent, 'team_chat_answer')
        exec.signal.throwIfAborted()
        const answer = await ctx.agentTeams.answerChat(actor, { messageId: args.message_id, text: args.text })
        return { message_id: answer.messageId }
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'team_chat_react',
      description: 'Add/remove your visible Unicode emoji reaction to a real user/Kira/agent message in the shared transcript. This is the canonical reaction tool. Reactions are optional; use one only when useful and natural without avoidable turns or cost. Any valid Unicode emoji is allowed; never react to your own message, never use a fixed default, and never react by routine.',
      parameters: { message_id: { type: 'string', required: true }, emoji: { type: 'string', required: true }, active: { type: 'boolean', description: 'False removes your selected emoji; default true.' } },
      output: jsonOutput({ type: 'object', additionalProperties: false, properties: { applied: { type: 'boolean', required: true } } }),
      async execute(args, exec) {
        const actor = callingAgent(exec.agent, 'team_chat_react')
        exec.signal.throwIfAborted()
        const sessionId = actor.session.header.origin === 'subagent' ? actor.session.header.parentSession : actor.id
        if (sessionId === undefined) throw new Error('team root not found')
        await ctx.agentTeams.reactToChat(actor, { sessionId, messageId: args.message_id, emoji: args.emoji, active: args.active ?? true })
        return { applied: true }
      },
    })))

  } catch (error) {
    for (const dispose of disposers.reverse()) void dispose()
    throw error
  }
  return () => { for (const dispose of disposers.reverse()) void dispose() }
}

// oxlint-disable-next-line @stylistic/max-len -- Completion vocabulary is intentionally auditable as one bilingual regex.
const COMPLETION_CLAIM = /\b(?:sent|done|completed|created|updated|changed|fixed|repaired|tested|verified|deployed|published|installed|deleted|removed|submitted|scheduled|booked|saved|enviado|enviada|hecho|hecha|completado|completada|creado|creada|actualizado|actualizada|cambiado|cambiada|arreglado|arreglada|reparado|reparada|probado|probada|verificado|verificada|desplegado|desplegada|publicado|publicada|instalado|instalada|eliminado|eliminada|guardado|guardada|programado|programada)\b/iu

function executionProofText(tools: readonly string[]): string {
  return `✓ Evidencia ejecutada: ${tools.join(', ')}`
}

function requireExecutionProof(
  agent: Agent,
  requirement?: ReturnType<typeof teamExecutionRequirement>,
  assignmentText?: string,
): readonly string[] {
  const proof = teamExecutionProof(agent.session.events, {
    ...requirement === undefined ? {} : { requirement },
    ...assignmentText === undefined ? {} : { assignmentText },
  })
  if (proof.requirement !== 'none' && !proof.satisfied) {
    throw new TeamError(
      'Operational result rejected: no successful non-Team tool receipt exists for the current assignment. '
        + 'Perform the real action first, or report a blocker instead of claiming completion.',
      'TEAM_EXECUTION_EVIDENCE_REQUIRED',
    )
  }
  return proof.requirement === 'none' ? [] : proof.tools
}

/** Register the complete Team tool set in one exact Agent scope. */
function install(agent: Agent, ctx: Context, config: Required<Config>): () => void {
  const scoped = agent.ctx
  const disposers: Array<() => unknown> = []
  const register = (disposer: () => unknown): void => { disposers.push(disposer) }
  try {
    register(scoped.systemPrompt.section({
      name: 'team:policy',
      order: 60,
      text: () => {
        const membership = ctx.agentTeams.membership(agent)
        const socialStyle = teamSocialStyle(membership.name, membership.role)
        return `${POLICY}\n\nYour Team role is ${membership.role}; your Team name is ${membership.name}; Team id is ${membership.id}.\nYour social voice: ${socialStyle}\n\n${teamLanguageInstruction(membership.root.session.events)}`
      },
    }))

    register(scoped.tools.register(defineTool({
      name: 'spawn_teammate',
      description: 'Create one named, durable teammate. Only the Team Lead may call this tool.',
      parameters: {
        name: { type: 'string', description: 'Optional unique lower-kebab-case teammate name. Omit for automatic specialist selection from the delegated responsibility.' },
        description: { type: 'string', required: true, description: 'Short description of the delegated responsibility.' },
        prompt: { type: 'string', required: true, description: 'Complete initial task for the teammate.' },
        context: {
          type: 'string',
          enum: ['fresh', 'fork'],
          description: 'fresh starts without Lead history; fork inherits completed Lead turns. Defaults to fresh.',
        },
        ...Object.keys(config.modelProfiles).length === 0 ? {} : {
          model_profile: {
            type: 'string' as const,
            enum: Object.keys(config.modelProfiles),
            description: 'Deployment-configured worker route for OpenAI Codex. Outside OpenAI Codex this is ignored and the exact live selected provider/model is inherited.',
          },
        },
      },
      output: jsonOutput(SPAWN_VALUE_SCHEMA),
      async execute(args, exec) {
        const agent = callingAgent(exec.agent, 'spawn_teammate')
        const context = args.context ?? 'fresh'
        const explicitProfile = 'model_profile' in args && typeof args.model_profile === 'string'
          ? args.model_profile
          : undefined
        const configuredDefault = config.defaultModelProfile || undefined
        const defaultProfile = configuredDefault === undefined
          ? undefined
          : config.modelProfiles[configuredDefault]
        // Agent.options is the creation-time route and may be stale after the
        // user changes the live model selector. The latest request/header is
        // the authoritative route actually serving this turn/tool call.
        const requestConfig = foldRequestHeader(agent.session.events)?.config
        const activeProvider = requestConfig?.provider ?? agent.options.provider
        const activeModel = requestConfig?.model ?? agent.options.model
        const activeReasoningEffort = requestConfig?.reasoningEffort ?? agent.options.reasoningEffort
        const activeMaxTokens = requestConfig?.maxTokens ?? agent.options.maxTokens
        const profileName = activeProvider === 'openai-codex'
          ? explicitProfile
            ?? (defaultProfile?.provider === 'openai-codex' ? configuredDefault : undefined)
          : undefined
        const profile = profileName === undefined ? undefined : config.modelProfiles[profileName]
        const agentOptions: AgentOptions | undefined = profile !== undefined
          ? {
            provider: profile.provider,
            model: profile.model,
            ...profile.maxTokens === undefined ? {} : { maxTokens: profile.maxTokens },
            ...profile.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: profile.reasoningEffort as NonNullable<AgentOptions['reasoningEffort']> },
          }
          : activeProvider === undefined || activeModel === undefined
            ? undefined
            : {
              provider: activeProvider,
              model: activeModel,
              ...activeMaxTokens === undefined ? {} : { maxTokens: activeMaxTokens },
              ...activeReasoningEffort === undefined ? {} : { reasoningEffort: activeReasoningEffort },
            }
        const occupiedNames = ctx.agentTeams.listMembers(agent)
          .filter(member => member.role === 'teammate')
          .map(member => member.name)
        const memberName = args.name ?? selectTeamPersonaName(args.description, occupiedNames)
        return await ctx.agentTeams.spawnTeammate(agent, {
          name: memberName,
          description: args.description,
          prompt: [{ type: 'text', text: args.prompt }],
          context,
          provider: context === 'fork' ? config.forkProvider : config.freshProvider,
          ...agentOptions === undefined ? {} : { agentOptions },
          signal: exec.signal,
        })
      },
    })))

    const messageTool = (toolName: 'send_message' | 'followup_task', delivery: 'quiet' | 'wakeup'): void => {
      register(scoped.tools.register(defineTool({
        name: toolName,
        description: delivery === 'quiet'
          ? 'Send durable information to another Team member without starting an idle member.'
          : 'Send a durable follow-up task to another Team member and start a turn when needed.',
        parameters: {
          target: { type: 'string', required: true, description: 'Team member name, or lead.' },
          purpose: {
            type: 'string',
            required: true,
            enum: ['assignment', 'question', 'blocker', 'result', 'review', 'decision', 'update'],
            description: 'Operational purpose. Use blocker only for a real obstacle that needs the Lead to change strategy.',
          },
          message: { type: 'string', required: true, description: 'Self-contained message for the target in the current user conversational language; preserve exact code and error strings.' },
        },
        output: jsonOutput(SEND_VALUE_SCHEMA),
        execute(args, exec) {
          const actor = callingAgent(exec.agent, toolName)
          const membership = ctx.agentTeams.membership(actor)
          const claim = args.purpose === 'result'
            || (args.purpose === 'update' && COMPLETION_CLAIM.test(args.message))
          const proofTools = membership.role === 'teammate' && claim
            ? requireExecutionProof(actor)
            : []
          const message = proofTools.length === 0
            ? args.message
            : `${args.message}\n\n${executionProofText(proofTools)}`
          return ctx.agentTeams.sendMessage(actor, {
            target: args.target,
            purpose: args.purpose,
            content: [{ type: 'text', text: message }],
            delivery,
            signal: exec.signal,
          })
        },
      })))
    }
    messageTool('send_message', 'quiet')
    messageTool('followup_task', 'wakeup')

    register(scoped.tools.register(defineTool({
      name: 'team_react',
      description: 'Legacy semantic reaction for another Team member\'s durable peer message. Prefer team_chat_react for the visible shared transcript; this tool remains for compatibility and its semantic reaction is projected into the same emoji UI.',
      parameters: {
        message_id: { type: 'string', required: true, description: 'Stable Team message id from the delivered peer item.' },
        reaction: {
          type: 'string',
          required: true,
          enum: ['ack', 'agree', 'insight', 'blocked', 'done'],
          description: 'Semantic reaction: acknowledged, agreed, useful insight, blocker, or completed.',
        },
      },
      output: jsonOutput(REACTION_VALUE_SCHEMA),
      execute(args, exec) {
        return ctx.agentTeams.reactToMessage(callingAgent(exec.agent, 'team_react'), {
          messageId: TeamMessageId(args.message_id),
          reaction: args.reaction,
          signal: exec.signal,
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'list_agents',
      description: 'List the Lead and every durable teammate with current runtime status.',
      parameters: {},
      output: jsonOutput(MEMBER_LIST_VALUE_SCHEMA),
      async execute(_args, exec) {
        return Promise.resolve(ctx.agentTeams.listMembers(callingAgent(exec.agent, 'list_agents')))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'wait_agent',
      description: 'Wait once for new Team activity; never poll indefinitely. Actual waiting is capped at 20000ms. After two timeouts without any Team change, return stalled-team instead of waiting again.',
      parameters: {
        timeout_ms: {
          type: 'integer',
          description: 'Requested wait duration 10000 through 3600000ms, capped internally at 20000ms. Defaults to 10000ms.',
        },
      },
      output: jsonOutput(WAIT_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'wait_agent')
        const timeoutMs = args.timeout_ms ?? 10_000
        // Preserve TeamService's authoritative timeout validation before the
        // model-only no-progress shortcut.
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 3_600_000) {
          return await ctx.agentTeams.waitForChange(caller, timeoutMs, exec.signal)
        }
        const membership = ctx.agentTeams.membership(caller)
        const lastTeamEvent = membership.root.session.events.findLast(event =>
          event.type.startsWith('team/') && event.type !== 'team/chat-reaction')
        const budget = peerWaitBudget(caller, lastTeamEvent?.seq ?? 0)
        if (budget.expired >= 2) {
          return { timedOut: false,
            noProgress: { reason: 'stalled-team' as const, message: STALLED_PEER_MESSAGE } }
        }
        // The active-peer read and waiter registration must remain one synchronous
        // span; awaiting between them can lose the only peer-status edge.
        const hasActivePeer = ctx.agentTeams.listMembers(caller).some(member =>
          member.id !== caller.id && ACTIVE_WAIT_STATUSES.has(member.status))
        if (!hasActivePeer) {
          return {
            timedOut: false,
            noProgress: {
              reason: 'no-active-peer' as const,
              message: NO_ACTIVE_PEER_MESSAGE,
            },
          }
        }
        const result = await ctx.agentTeams.waitForChange(caller, Math.min(timeoutMs, 20_000), exec.signal)
        if (result.timedOut) budget.expired += 1
        else budget.expired = 0
        return result
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'interrupt_agent',
      description: 'Interrupt one teammate\'s current turn while preserving its pending inbox. Team Lead only.',
      parameters: {
        target: { type: 'string', required: true, description: 'Teammate name.' },
      },
      output: jsonOutput(INTERRUPT_VALUE_SCHEMA),
      async execute(args, exec) {
        return Promise.resolve(ctx.agentTeams.interrupt(
          callingAgent(exec.agent, 'interrupt_agent'),
          args.target,
        ))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_create',
      description: 'Create one unowned pending task on the shared Team task board.',
      parameters: {
        subject: { type: 'string', required: true, description: 'Concise task title.' },
        description: { type: 'string', required: true, description: 'Complete task details and acceptance criteria.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Task ids that must complete first.' },
        write_scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Advisory workspace-relative file or directory prefixes this task expects to modify.',
        },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.createTask(callingAgent(exec.agent, 'team_task_create'), {
          subject: args.subject,
          description: args.description,
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_list',
      description: 'List shared tasks, including readiness, owner, revision, blockers, and write-scope warnings.',
      parameters: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed'],
          description: 'Optional exact status filter.',
        },
        owner: { type: 'string', description: 'Optional member-name filter; use unowned for tasks without an owner.' },
        ready: { type: 'boolean', description: 'Optional readiness filter.' },
        cursor: { type: 'integer', description: 'Zero-based result offset. Defaults to 0.' },
        limit: { type: 'integer', description: 'Number of rows, 1 through 100. Defaults to 50.' },
      },
      output: jsonOutput(TASK_LIST_VALUE_SCHEMA),
      execute(args, exec) {
        const status = args.status
        const filtered = ctx.agentTeams.listTasks(callingAgent(exec.agent, 'team_task_list')).filter(task =>
          (status === undefined || task.status === status)
          && (args.owner === undefined || (args.owner === 'unowned' ? task.ownerName === undefined : task.ownerName === args.owner))
          && (args.ready === undefined || task.ready === args.ready))
        const cursor = args.cursor ?? 0
        const limit = args.limit ?? 50
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative safe integer')
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 through 100')
        return Promise.resolve({
          tasks: filtered.slice(cursor, cursor + limit),
          ...(cursor + limit < filtered.length ? { nextCursor: cursor + limit } : {}),
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_get',
      description: 'Read the complete latest value of one shared task before changing or executing it.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return Promise.resolve(ctx.agentTeams.getTask(
          callingAgent(exec.agent, 'team_task_get'),
          TeamTaskId(args.task_id),
        ))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_update',
      description: 'Compare-and-set a shared task action using the latest revision from team_task_get or team_task_list.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
        expected_revision: { type: 'integer', required: true, description: 'Current task revision used as the CAS precondition.' },
        action: {
          type: 'string',
          required: true,
          enum: ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete'],
          description: 'Task transition to apply.',
        },
        subject: { type: 'string', description: 'Replacement title for edit.' },
        description: { type: 'string', description: 'Replacement details for edit.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Complete blocker list for set_dependencies.' },
        write_scopes: { type: 'array', items: { type: 'string' }, description: 'Replacement advisory write scopes for edit.' },
        owner: { type: 'string', description: 'Member name for Lead-only reassign; omit to unassign.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        const actor = callingAgent(exec.agent, 'team_task_update')
        if (args.action === 'complete') {
          const task = ctx.agentTeams.getTask(actor, TeamTaskId(args.task_id))
          const taskText = `${task.subject}\n${task.description}`
          const requirement = teamExecutionRequirement(taskText)
          requireExecutionProof(actor, requirement, taskText)
        }
        return await ctx.agentTeams.updateTask(actor, {
          taskId: TeamTaskId(args.task_id),
          expectedRevision: args.expected_revision,
          action: args.action,
          ...args.subject === undefined ? {} : { subject: args.subject },
          ...args.description === undefined ? {} : { description: args.description },
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
          ...args.owner === undefined ? {} : { owner: args.owner },
        })
      },
    })))
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) void dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) void dispose()
  }
}

/** Install Team tools in every live or subsequently published Team member scope. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved: Required<Config> = {
    freshProvider: config.freshProvider ?? 'spawn',
    forkProvider: config.forkProvider ?? 'fork',
    defaultModelProfile: config.defaultModelProfile ?? '',
    modelProfiles: config.modelProfiles ?? {},
  }
  if (resolved.defaultModelProfile !== '' && resolved.modelProfiles[resolved.defaultModelProfile] === undefined) {
    throw new Error(`defaultModelProfile "${resolved.defaultModelProfile}" is not declared in modelProfiles`)
  }
  const installed = new Map<Agent, () => void>()
  const maybeInstall = (agent: Agent): void => {
    if (installed.has(agent)) return
    const membership = ctx.agentTeams.tryMembership(agent)
    const parentId = agent.session.header.parentSession
    if (membership === undefined && (agent.session.header.origin !== 'subagent' || parentId === undefined || ctx.agents.get(parentId) === undefined)) return
    const chat = installChatTools(agent, ctx)
    try {
      const team = membership === undefined ? undefined : install(agent, ctx, resolved)
      installed.set(agent, () => { team?.(); chat() })
    } catch (error) { chat(); throw error }
  }
  for (const agent of ctx.agents.list()) maybeInstall(agent)
  ctx.on('agent/created', ({ agent }) => { maybeInstall(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'tool-team.scopedTools()')
}
