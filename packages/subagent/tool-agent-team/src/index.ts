/** Scoped model-facing tools for the opt-in Agent Teams runtime. */

import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import {
  PHOENIX_CODEX_AUTO_MODEL, PHOENIX_CODEX_AUTO_WORKER_MODEL, adaptiveCodexReasoningEffort, isPhoenixCodexAutoSelection,
  latestModelSelectionPreference,
} from '@phoenix-ai/dsh-agent'
import type { EclipseRoutingSettings } from '@phoenix-ai/dsh-agent'
import type { Agent, AgentOptions } from '@phoenix-ai/dsh-agent'
import {
  selectTeamPersonaName,
  teammateBudgetForMission,
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

/** User-owned Eclipse routing overrides the single deployment subagent profile
 * only when explicitly enabled.
 * @param settings - Optional saved Eclipse settings.
 * @param memberName - Retained for call-site compatibility; specialists do not
 * receive per-name model overrides.
 * @param fallback - Deployment-default worker model.
 * @param adaptiveEffort - Request-sensitive effort for an omitted hybrid tier.
 * @returns The configured subagent route or deployment fallback.
 */
export function resolveEclipseTeammateProfile(
  settings: EclipseRoutingSettings | undefined,
  _memberName: string,
  fallback: TeamModelProfile | undefined,
  adaptiveEffort?: string,
): TeamModelProfile | undefined {
  if (settings?.mode === undefined || settings.mode === 'automatic') return fallback
  const route = settings.subagent
  if (route === undefined) {
    return settings.mode === 'hybrid' && fallback?.provider === 'openai-codex' && adaptiveEffort !== undefined
      ? { ...fallback, reasoningEffort: adaptiveEffort } : fallback
  }
  if (route.provider !== 'openai-codex' || route.model === PHOENIX_CODEX_AUTO_MODEL) return fallback
  return route.reasoningEffort === undefined && settings.mode === 'hybrid' && adaptiveEffort !== undefined
    ? { ...route, reasoningEffort: adaptiveEffort }
    : route
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
const POLICY = 'Agent Teams is real shared work, not role-play. Kira is the single coordinator identity: she plans, supervises, executes and verifies the user\'s mission through the configured coordinator route. Fénix Eclipse has exactly two model roles: coordinator for Kira and subagent for every child; a child name never changes its model route. Delegate only when independent work materially improves quality or latency, choose the smallest sufficient team, reuse workers, and keep three simultaneous specialists as the hard limit. Routine low-risk requests stay with Kira and do not create artificial teams. Kira owns acceptance and verifies real evidence; never fabricate tools, peer dialogue, completion or model independence. Preserve the selected provider, model and explicit reasoning effort in hybrid/manual mode. In hybrid mode an omitted effort may use the request-sensitive automatic tier; in manual mode an omitted effort uses the provider default. Automatic effort is cheap for ordinary strategy and increases only when task evidence warrants it. Do not make a model call merely to classify a task. A normal peer result, question or wait stays on the coordinator route; a bounded strategy review is allowed only for a substantive blocker or explicit corrective request. Use concise Spanish when the user does. Keep collaboration sparse, evidence-based and truthful.'

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

const STALLED_PEER_MESSAGE = 'Two one-shot waits expired without a Team change. Stop polling, do not summon a strategy model merely for waiting; deliver the available evidence or request one bounded conclusion if substantive work remains.'
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
  const rootEvents = () => (
    ctx.agentTeams.tryMembership(agent)?.root
    ?? (agent.session.header.parentSession === undefined
      ? undefined : ctx.agents.get(agent.session.header.parentSession))
    ?? agent
  ).session.events
  try {
    // A late, dynamically evaluated system section counters English-heavy
    // provider/tool output without changing the human conversation language.
    register(scoped.systemPrompt.section({
      name: 'team:language-lock', order: 1_000, text: () => teamLanguageInstruction(rootEvents()),
    }))
    register(scoped.systemPrompt.section({ name: 'team:conversation', order: 61,
      text: () => `${teamLanguageInstruction(rootEvents())}\n\nYour real operational text appears under your own identity in the main user conversation. Reply to Kira as a teammate, not as an impersonal background tool: address her naturally when reporting a meaningful development, and use send_message with purpose result for the final verified handoff. After that successful handoff, do not repeat the finding in another assistant final message. Keep updates useful and sparse; never expose private reasoning or narrate every tool call. team_chat_react is the canonical visible reaction control for the shared transcript. A directed user question takes priority at the next safe boundary: answer the addressed person with team_chat_answer and the delivered Team-user message id, then continue your existing mission unless the user explicitly changes or cancels it. A conversational answer does not complete a task or replace execution evidence. Reactions are optional and must not add avoidable turns, latency, or token cost; never manufacture banter or repeat a fixed emoji. Use a delivered message id when available; call team_chat_read only for missing context. Do not guess repository paths for identity or configuration: active KIRA identity/personality comes from runtime metadata, not .kira/roster files, so never synthesize roster filenames; Phoenix has no repository-root cordis.yml, because profile roots are generated under DSH_HOME/profiles and shipped preset configs live under apps/cli/config/agent-presets. Discover the exact existing path with available status/search/list tools before reading configuration. Kira supervises the mission and delivers its final answer.` }))
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
      name: 'team_chat_reply_to_peer',
      description: 'Only Kira: publish one real direct answer to an actually delivered teammate result, question, blocker or review without waking that teammate. Requires the original Team message id, one meaningful acceptance/decision, no invented speech. For new work use send_message or followup_task.',
      parameters: {
        message_id: { type: 'string', required: true, description: 'Id of the actual delivered specialist-to-Kira handoff.' },
        text: { type: 'string', required: true, description: 'Brief answer addressed to the specialist in the user language, maximum 800 UTF-8 bytes.' },
      },
      output: jsonOutput({ type: 'object', additionalProperties: false, properties: { message_id: { type: 'string', required: true } } }),
      async execute(args, exec) {
        const actor = callingAgent(exec.agent, 'team_chat_reply_to_peer')
        exec.signal.throwIfAborted()
        const reply = await ctx.agentTeams.replyToPeer(actor, { messageId: args.message_id, text: args.text })
        return { message_id: reply.messageId }
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
      description: 'Create one REAL durable specialist. Kira chooses the smallest warranted team (1 simple, 2 medium, 3 difficult/exceptional); no role-play or token-wasting workers. Only the Team Lead may call this tool.',
      parameters: {
        name: { type: 'string', description: 'Optional unique lower-kebab-case teammate name. Omit for automatic specialist selection from the delegated responsibility.' },
        description: { type: 'string', required: true, description: 'Short description of the delegated responsibility.' },
        mission_complexity: {
          type: 'string',
          enum: ['simple', 'medium', 'difficult', 'exceptional'],
          description: 'Classify the real mission before spawning. The runtime caps teammates at 1/2/3/3 for simple/medium/difficult/exceptional; exceptional never exceeds three independent workstreams. Omit for legacy calls; never inflate the tier to create conversational theater.',
        },
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
        if (args.mission_complexity !== undefined) {
          const tierLimit = teammateBudgetForMission(args.mission_complexity)
          const occupied = ctx.agentTeams.listMembers(agent)
            .filter(member => member.role === 'teammate' && member.status !== 'inactive' && member.status !== 'failed')
          if (occupied.length >= tierLimit) {
            throw new TeamError(
              `Mission scale ${args.mission_complexity} permits ${tierLimit} concurrent teammate(s); reuse, finish, or interrupt an existing specialist before scaling.`,
              'TEAM_MEMBER_LIMIT',
            )
          }
        }
        const preference = latestModelSelectionPreference(agent.session)?.selection
        const eclipseEnabled = agent.session.header?.origin !== 'subagent'
          && isPhoenixCodexAutoSelection(preference)
        const settingsAuthority = ctx.get('agentDefaultModel') as {
          currentEclipseProfile?: () => EclipseRoutingSettings | undefined
        } | undefined
        const eclipse = eclipseEnabled ? settingsAuthority?.currentEclipseProfile?.() : undefined
        const occupiedNames = ctx.agentTeams.listMembers(agent)
          .filter(member => member.role === 'teammate')
          .map(member => member.name)
        const memberName = args.name ?? selectTeamPersonaName(args.description, occupiedNames)
        if (eclipse?.maxTeammates !== undefined && occupiedNames.length >= eclipse.maxTeammates) {
          throw new TeamError(
            'Eclipse reached the configured concurrent specialist limit.',
            'TEAM_MEMBER_LIMIT',
          )
        }
        const context = args.context ?? 'fresh'
        // Agent.options is the creation-time route and may be stale after the
        // user changes the live model selector. The latest request/header is
        // the authoritative route actually serving this turn/tool call.
        const requestConfig = foldRequestHeader(agent.session.events)?.config
        const activeProvider = requestConfig?.provider ?? agent.options.provider
        const activeModel = requestConfig?.model ?? agent.options.model
        const activeReasoningEffort = requestConfig?.reasoningEffort ?? agent.options.reasoningEffort
        const activeMaxTokens = requestConfig?.maxTokens ?? agent.options.maxTokens
        const taskSignal = `${args.mission_complexity ?? ''} ${args.description} ${args.prompt}`
        const adaptiveEffort = activeProvider === 'openai-codex'
          ? adaptiveCodexReasoningEffort(taskSignal) : undefined
        // Codex teammates use the configured Eclipse subagent route when the
        // coordinator selected Fénix Eclipse. Without an override they use
        // the current Luna worker at the task-sensitive tier.
        const codexDefault: TeamModelProfile | undefined = activeProvider === 'openai-codex'
          ? {
            provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_WORKER_MODEL,
            reasoningEffort: adaptiveEffort ?? 'high',
          }
          : undefined
        const namedProfile = args.model_profile === undefined
          ? undefined : config.modelProfiles[args.model_profile]
        // An Eclipse automatic/hybrid child uses the adaptive Codex default;
        // do not let a legacy deployment preset silently force Max. An
        // explicitly named profile remains an explicit caller choice.
        const fallbackProfile = namedProfile
          ?? (eclipseEnabled && activeProvider === 'openai-codex'
            ? codexDefault : config.modelProfiles[config.defaultModelProfile] ?? codexDefault)
        const profile = eclipseEnabled
          ? resolveEclipseTeammateProfile(
            eclipse,
            memberName,
            fallbackProfile,
            namedProfile === undefined ? adaptiveEffort : undefined,
          )
          : codexDefault
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
        return await ctx.agentTeams.spawnTeammate(agent, {
          name: memberName,
          description: args.description,
          prompt: [{ type: 'text', text: args.prompt }],
          context,
          provider: context === 'fork' ? config.forkProvider : config.freshProvider,
          ...args.mission_complexity === undefined ? {} : { missionComplexity: args.mission_complexity },
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
            description: 'Operational purpose. A natural conversational answer to Kira may use result without an external tool. Use blocker only for a genuine unresolved task obstacle, never a routine conversation or wait.',
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
            ? (() => {
              // The assigned task and the reported claim are separate
              // evidence obligations. A conversation-only assignment has none,
              // but cannot claim an unrelated external action succeeded.
              const assignment = teamExecutionProof(actor.session.events)
              const evidence = assignment.requirement === 'none'
                ? [] : requireExecutionProof(actor)
              const reportRequirement = teamExecutionRequirement(args.message)
              if (reportRequirement === 'none') return evidence
              const claimReceipts = requireExecutionProof(actor, reportRequirement, args.message)
              return [...new Set([...evidence, ...claimReceipts])]
            })()
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
      description: 'Wait once for new Team activity; never poll indefinitely. Actual waiting is capped at 12000ms. After two timeouts without any Team change, return stalled-team instead of waiting again.',
      parameters: {
        timeout_ms: {
          type: 'integer',
          description: 'Requested wait duration 5000 through 3600000ms, capped internally at 12000ms. Defaults to 12000ms; completes earlier on actual teammate activity.',
        },
      },
      output: jsonOutput(WAIT_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'wait_agent')
        const timeoutMs = args.timeout_ms ?? 12_000
        // Preserve TeamService's authoritative timeout validation before the
        // model-only no-progress shortcut.
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 3_600_000) {
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
        const result = await ctx.agentTeams.waitForChange(caller, Math.min(timeoutMs, 12_000), exec.signal)
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
