import type { Context } from '@phoenix-ai/cordis'
import type { Agent, AgentRegistry } from '@phoenix-ai/dsh-agent'
import { boundContextSummary, createUserMessage, type ContentBlock } from '@phoenix-ai/dsh-llm'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import type { HostConnectionHandle } from '@phoenix-ai/dsh-client-connection'
import type { RpcResult } from '@phoenix-ai/dsh-host-apiproxy/api'
import type { ObjectJsonSchema, ToolRestriction } from '@phoenix-ai/dsh-tools'
import {
  ProactivityDeferredError,
  type ProactivityEngine,
  type ProactivityExecution,
  type ProactivityExecutionResult,
  type ProactivityExecutor,
  type ProactivitySenderIdentity,
  type ProactivityTask,
} from './proactivity-engine.ts'
import {
  DEFAULT_PROACTIVITY_RETRY_POLICY,
  retryFailedProactivityTasks,
} from './proactivity-retry.ts'

export { retryFailedProactivityTasks } from './proactivity-retry.ts'
export type { ProactivityRetryPolicy } from './proactivity-retry.ts'

/** Host configuration for proactive execution and mail identity selection. */
export interface ProactivityRuntimeConfig {
  readonly pollMs: number
  readonly privateWorkProvider: string
  readonly privateWorkResultChars: number
  readonly userMailIdentity?: string
  readonly harnessMailIdentity?: string
  readonly resolveDefaultMailRecipient?: () => Promise<string | undefined>
  /**
   * Re-compose a persisted session before a scheduler-owned resume is published.
   * This restores the same preset/tool world the original conversation used.
   */
  readonly composeResumedAgent?: (agentCtx: Context) => Promise<void>
}

/** Browser-safe task projection; unrevealed surprises never reach this surface. */
/** Kinds of concise signals rendered by the blank-session Phoenix home feed. */
export type ProactivityAttentionKind = 'result' | 'failure' | 'upcoming'

/** Browser-safe attention row. Task instructions, credentials, and raw event payloads never cross this projection. */
export interface ProactivityAttentionItem {
  readonly id: string
  readonly taskId: string
  readonly kind: ProactivityAttentionKind
  readonly title: string
  readonly detail?: string
  readonly at: string
  readonly score: number
}

/** Browser-safe projection of one visible durable proactive task. */
export interface ProactivityTaskView {
  readonly id: string
  readonly title: string
  readonly status: ProactivityTask['status']
  readonly nextRunAt: string
  readonly recurrence: ProactivityTask['recurrence']
  readonly catchUp: ProactivityTask['catchUp']
  readonly delivery: ProactivityTask['delivery']
  readonly senderIdentity: ProactivityTask['senderIdentity']
  readonly createdBy: ProactivityTask['createdBy']
  readonly attentionMode?: ProactivityTask['attentionMode']
  readonly attentionPriority?: ProactivityTask['attentionPriority']
  readonly attentionText?: string
  readonly recentHistory: readonly Pick<ProactivityTask['history'][number], 'phase' | 'scheduledFor' | 'finishedAt' | 'status' | 'summary' | 'error'>[]
}

function requirePositive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`)
  return value
}

type ProactivityAgentRegistry =
  Pick<AgentRegistry, 'get' | 'roots' | 'list'>
  & Partial<Pick<AgentRegistry, 'resume'>>

interface ExecutionAgentLease {
  readonly agent: Agent
  readonly resumed: boolean
  release(): Promise<void>
}

async function acquireExecutionAgent(
  agents: ProactivityAgentRegistry,
  targetAgentId: string | undefined,
  config: ProactivityRuntimeConfig,
): Promise<ExecutionAgentLease> {
  if (targetAgentId !== undefined) {
    const exact = agents.get(targetAgentId as never)
    if (exact !== undefined) {
      return { agent: exact, resumed: false, release: async () => {} }
    }

    if (agents.resume === undefined) {
      throw new ProactivityDeferredError(
        `scheduled task target "${targetAgentId}" is not live and this runtime cannot resume persisted agents`,
      )
    }

    try {
      const handle = await agents.resume({
        resumeSessionId: targetAgentId as never,
        ...(config.composeResumedAgent === undefined ? {} : { setup: config.composeResumedAgent }),
      })
      let released = false
      return {
        agent: handle.agent,
        resumed: true,
        async release() {
          if (released) return
          released = true
          await handle.agent.whenIdle()
          await handle.dispose()
        },
      }
    } catch (error: unknown) {
      throw new ProactivityDeferredError(
        `scheduled task target "${targetAgentId}" is not live and could not be resumed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const agent = agents.roots()[0] ?? agents.list()[0]
  if (agent === undefined) {
    throw new ProactivityDeferredError('no live Phoenix agent is available for an untargeted scheduled task')
  }
  return { agent, resumed: false, release: async () => {} }
}

function plainOutput(content: readonly ContentBlock[], limit: number): string {
  const text = content.map(block => block.type === 'text' ? block.text : JSON.stringify(block)).join('\n').trim()
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 1))}…`
}

function mailIdentity(sender: ProactivitySenderIdentity, config: ProactivityRuntimeConfig): string | undefined {
  if (sender === 'user') return config.userMailIdentity
  if (sender === 'harness') return config.harnessMailIdentity ?? config.userMailIdentity
  return config.harnessMailIdentity ?? config.userMailIdentity
}

function normalizedEmail(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 320 || !trimmed.includes('@') || /\s/u.test(trimmed)) return undefined
  return trimmed
}

async function deliveryRecipient(input: ProactivityExecution, config: ProactivityRuntimeConfig): Promise<string | undefined> {
  if (input.task.delivery !== 'email') return undefined
  const explicit = normalizedEmail(input.task.recipient)
  if (explicit !== undefined) return explicit
  return normalizedEmail(await config.resolveDefaultMailRecipient?.())
}

function proactivePrompt(
  input: ProactivityExecution,
  config: ProactivityRuntimeConfig,
  conditionEvidence?: string,
  resolvedRecipient?: string,
): string {
  const lines = [
    '<phoenix_proactive_task>',
    `Task: ${input.task.title}`,
    `Occurrence: ${input.scheduledFor}`,
    `Idempotency key: ${input.idempotencyKey}`,
    `Instruction: ${input.instruction}`,
    'Execution-time reality: use the current Phoenix Reality Context. Re-check any stale or missing time, timezone, calendar, location, weather/daylight, network, device-resource, connector-auth, provider/quota, or update-state fact that materially affects this task before acting. When phoenix_reality_now is available, use it for synchronized refresh rather than guessing.',
    'Use relevant already-authorized MCP and connector tools when they provide fresher or more authoritative evidence. Do not install, connect, authenticate, or broaden permissions merely to complete background work.',
  ]
  if (input.task.delivery === 'work') {
    const recent = input.task.history
      .filter(row => row.phase === 'deliver' && row.status === 'completed' && row.summary !== undefined)
      .slice(-3)
      .map(row => ({ scheduledFor: row.scheduledFor, summary: row.summary }))
    if (recent.length > 0) lines.push(`Recent background summaries: ${JSON.stringify(recent)}`)
    lines.push('Treat a durable user interest as permission to analyze and monitor, not as standing permission for purchases, wagers, trades, transfers, messages, bookings, or other external writes. An external write still needs explicit task authorization and the normal approval policy.')
    if (input.task.recurrence.kind !== 'once') {
      lines.push('If this recurring background check finds no material change from the recent summaries, return exactly NO_MATERIAL_UPDATE. Otherwise return a concise, actionable result suitable for Phoenix home attention.')
    } else {
      lines.push('Return a concise, actionable result suitable for Phoenix home attention.')
    }
  }
  if (input.preparationResult !== undefined) lines.push(`Prepared result: ${input.preparationResult}`)
  if (conditionEvidence !== undefined) lines.push(`Condition verified true: ${conditionEvidence}`)
  if (input.task.delivery === 'email') {
    const identity = mailIdentity(input.task.senderIdentity, config)
    if (identity !== undefined) {
      lines.push(`Delivery sender: use configured identity reference ${JSON.stringify(identity)}.`)
    } else {
      lines.push('Delivery sender: no dedicated mail identity reference is configured; use the currently authorized connected mail account through the normal governed mail tool. Do not invent an account or identity.')
    }
    if (resolvedRecipient !== undefined) lines.push(`Recipient: ${resolvedRecipient}`)
    lines.push('Do not expose credentials. Revalidate authorization and use the normal governed mail tool.')
  } else if (input.task.delivery === 'work') {
    lines.push('Delivery: complete the requested work and return a concise result.')
  } else {
    lines.push('Delivery: communicate naturally and proactively with the user in this conversation.')
  }
  lines.push('Treat this as scheduled work, not as a new planning request. Do not create or escalate permissions to complete it.', '</phoenix_proactive_task>')
  return lines.join('\n')
}

const CONDITION_WATCH_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    met: { type: 'boolean' },
    evidence: { type: 'string' },
  },
  required: ['met', 'evidence'],
}

const CONDITION_WATCH_READ_ONLY_TOOLS: ToolRestriction = {
  allow: ['read', 'read_image', 'glob', 'grep', 'session_search', 'session_event_search', 'web_search', 'web_fetch', 'phoenix_reality_now'],
}

interface ConditionWatchDecision {
  readonly met: boolean
  readonly evidence: string
}

function conditionDecision(value: unknown): ConditionWatchDecision | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.met !== 'boolean' || typeof record.evidence !== 'string') return undefined
  const evidence = record.evidence.trim()
  if (evidence.length === 0 || evidence.length > 2_000) return undefined
  return { met: record.met, evidence }
}

function conditionWatchPrompt(input: ProactivityExecution): ContentBlock[] {
  const recent = input.task.history
    .filter(row => row.phase === 'deliver' && row.summary !== undefined)
    .slice(-4)
    .map(row => ({ scheduledFor: row.scheduledFor, summary: row.summary }))
  return [{
    type: 'text',
    text: '<phoenix_condition_watch>\n'
      + `Watch: ${input.task.title}\n`
      + `Scheduled check: ${input.scheduledFor}\n`
      + `Condition: ${input.task.condition}\n`
      + `Recent checks: ${JSON.stringify(recent)}\n\n`
      + 'Evaluate the condition against current evidence. Use the current Phoenix Reality Context and call phoenix_reality_now when available if a relevant signal is stale or missing. Use only the available read-only tools. '
      + 'Do not send messages, edit state, install connectors, schedule work, or perform side effects. '
      + 'Return met=true only when current evidence clearly satisfies the condition. '
      + 'If evidence is missing, stale, ambiguous, or the condition is not yet true, return met=false. '
      + 'Keep evidence concise and factual.\n</phoenix_condition_watch>',
  }]
}

async function evaluateConditionWatch(
  input: ProactivityExecution,
  parent: Agent,
  subagents: Pick<SubagentRuntime, 'getProvider' | 'start'> | undefined,
  providerName: string,
): Promise<ConditionWatchDecision> {
  if (subagents === undefined) {
    throw new ProactivityDeferredError(`condition-watch provider is not available: ${providerName}`)
  }
  const provider = subagents.getProvider(providerName)
  if (provider === undefined) {
    throw new ProactivityDeferredError(`condition-watch provider is not available: ${providerName}`)
  }
  if (!provider.capabilities.outputSchema) {
    throw new ProactivityDeferredError(`condition-watch provider lacks structured output: ${providerName}`)
  }
  if (!provider.capabilities.toolFilter) {
    throw new ProactivityDeferredError(`condition-watch provider lacks read-only tool filtering: ${providerName}`)
  }
  const controller = new AbortController()
  const run = await subagents.start(providerName, {
    label: `Watch: ${input.task.title}`,
    prompt: conditionWatchPrompt(input),
    parent,
    signal: controller.signal,
    outputSchema: CONDITION_WATCH_OUTPUT_SCHEMA,
    toolFilter: CONDITION_WATCH_READ_ONLY_TOOLS,
  })
  try {
    const result = await run.result
    if (result.stopReason !== 'completed') {
      throw new Error(result.diagnostic ?? `condition watch ended with ${result.stopReason}`)
    }
    const decision = conditionDecision(result.structured)
    if (decision === undefined) throw new Error('condition watch returned invalid structured output')
    return decision
  } finally {
    await run.dispose()
  }
}

/**
 * Create the execution adapter that wakes a live agent for communication and
 * uses an isolated one-shot subagent for private preparation or office work.
 *
 * @param agents Registry used to resolve the original or current live Phoenix agent.
 * @param subagents Optional isolated-work runtime used for private preparation and office work.
 * @param config Runtime limits, provider selection, and governed mail identity references.
 * @returns An executor suitable for the durable proactivity engine.
 */
export function createProactivityExecutor(
  agents: ProactivityAgentRegistry,
  subagents: Pick<SubagentRuntime, 'getProvider' | 'start'> | undefined,
  config: ProactivityRuntimeConfig,
): ProactivityExecutor {
  requirePositive(config.privateWorkResultChars, 'privateWorkResultChars')
  return {
    async execute(input): Promise<ProactivityExecutionResult> {
      const lease = await acquireExecutionAgent(agents, input.task.targetAgentId, config)
      const parent = lease.agent
      try {
        const resolvedRecipient = await deliveryRecipient(input, config)
        if (input.task.delivery === 'email' && resolvedRecipient === undefined) {
          throw new ProactivityDeferredError(
            'scheduled email has no recipient and the connected account email is unavailable',
          )
        }
        if (input.phase === 'deliver' && input.task.condition !== undefined) {
          const decision = await evaluateConditionWatch(input, parent, subagents, config.privateWorkProvider)
          if (!decision.met) return { summary: `condition not met: ${decision.evidence}` }
          parent.followup(createUserMessage({
            content: [{ type: 'text', text: proactivePrompt(input, config, decision.evidence, resolvedRecipient) }],
            source: {
              kind: 'plugin',
              plugin: 'hardness-adapters',
              form: 'notice',
              summary: boundContextSummary(`Condition met: ${input.task.title}`),
            },
          }))
          await parent.whenIdle()
          return {
            summary: `condition met and notification accepted: ${decision.evidence}`,
            terminal: true,
          }
        }

        const privateWork = input.phase === 'prepare' || input.task.delivery === 'email' || input.task.delivery === 'work'
        if (!privateWork) {
          parent.followup(createUserMessage({
            content: [{ type: 'text', text: proactivePrompt(input, config, undefined, resolvedRecipient) }],
            source: {
              kind: 'plugin',
              plugin: 'hardness-adapters',
              form: 'notice',
              summary: boundContextSummary(`Scheduled task: ${input.task.title}`),
            },
          }))
          await parent.whenIdle()
          return { summary: lease.resumed ? 'resumed persisted Phoenix agent and completed scheduled chat turn' : 'accepted by the live Phoenix agent inbox' }
        }

        if (subagents === undefined || subagents.getProvider(config.privateWorkProvider) === undefined) {
          throw new ProactivityDeferredError(`private-work provider is not available: ${config.privateWorkProvider}`)
        }
        const controller = new AbortController()
        const run = await subagents.start(config.privateWorkProvider, {
          label: input.phase === 'prepare' ? `Prepare: ${input.task.title}` : `Scheduled: ${input.task.title}`,
          prompt: [{ type: 'text', text: proactivePrompt(input, config, undefined, resolvedRecipient) }],
          parent,
          signal: controller.signal,
        })
        try {
          const result = await run.result
          if (result.stopReason !== 'completed') {
            throw new Error(result.diagnostic ?? `private proactive work ended with ${result.stopReason}`)
          }
          return { summary: plainOutput(result.output, config.privateWorkResultChars) }
        } finally {
          await run.dispose()
        }
      } finally {
        await lease.release()
      }
    },
  }
}

function taskView(task: ProactivityTask): ProactivityTaskView {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    nextRunAt: task.nextRunAt,
    recurrence: { ...task.recurrence },
    catchUp: task.catchUp,
    delivery: task.delivery,
    senderIdentity: task.senderIdentity,
    createdBy: task.createdBy,
    ...(task.attentionMode === undefined ? {} : { attentionMode: task.attentionMode }),
    ...(task.attentionPriority === undefined ? {} : { attentionPriority: task.attentionPriority }),
    ...(task.attentionText === undefined ? {} : { attentionText: task.attentionText }),
    recentHistory: task.history.slice(-10).map(row => ({
      phase: row.phase,
      scheduledFor: row.scheduledFor,
      finishedAt: row.finishedAt,
      status: row.status,
      ...(row.summary === undefined ? {} : { summary: row.summary }),
      ...(row.error === undefined ? {} : { error: row.error }),
    })),
  }
}

const ATTENTION_RESULT_MAX_AGE_MS = 48 * 60 * 60 * 1000
const ATTENTION_UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ATTENTION_ITEMS = 8

function compactAttentionText(value: string | undefined, limit = 280): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (normalized.length === 0) return undefined
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 1))}…`
}

function materialAttentionSummary(value: string | undefined): string | undefined {
  const summary = compactAttentionText(value)
  if (summary === undefined || /^NO_MATERIAL_UPDATE[.!]?$/iu.test(summary)) return undefined
  return summary
}

function attentionSummaryFingerprint(value: string | undefined): string | undefined {
  const summary = materialAttentionSummary(value)
  return summary?.toLocaleLowerCase().replace(/[.!?]+$/u, '')
}

function attentionPriority(task: ProactivityTask): number {
  if (task.attentionPriority === 'high') return 24
  if (task.attentionPriority === 'low') return 0
  return 12
}

/**
 * Rank task state into the quiet, non-intrusive Phoenix home feed.
 * @param tasks - Visible durable tasks; unrevealed surprises must already be filtered by the engine.
 * @param now - Ranking clock.
 * @returns At most eight browser-safe attention rows, highest-value first.
 */
export function buildProactivityAttentionItems(
  tasks: readonly ProactivityTask[],
  now = new Date(),
): ProactivityAttentionItem[] {
  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs)) throw new Error('now must be a valid date')
  const oldestResult = nowMs - ATTENTION_RESULT_MAX_AGE_MS
  const latestUpcoming = nowMs + ATTENTION_UPCOMING_WINDOW_MS
  const items: ProactivityAttentionItem[] = []

  for (const task of tasks) {
    const mode = task.attentionMode ?? 'auto'
    if (mode === 'off') continue
    const priority = attentionPriority(task)
    const failed = [...task.history].reverse().find(row => row.status === 'failed')
    const failureDetail = compactAttentionText(task.attentionText)
    if (failed !== undefined && failureDetail !== undefined && Date.parse(failed.finishedAt) >= oldestResult) {
      items.push({
        id: `${task.id}:failure:${failed.finishedAt}`,
        taskId: task.id,
        kind: 'failure',
        title: task.title,
        detail: failureDetail,
        at: failed.finishedAt,
        score: 130 + priority,
      })
      continue
    }

    const deliveries = [...task.history].reverse().filter(row =>
      row.phase === 'deliver' && row.status === 'completed' && row.summary !== undefined)
    const latestDelivery = deliveries[0]
    const summary = materialAttentionSummary(latestDelivery?.summary)
    const fingerprint = attentionSummaryFingerprint(latestDelivery?.summary)
    const previousFingerprint = deliveries
      .slice(1)
      .map(row => attentionSummaryFingerprint(row.summary))
      .find(value => value !== undefined)
    const repeatedResult = fingerprint !== undefined && fingerprint === previousFingerprint
    // The Hero is for background intelligence, not receipts for chat/email work the
    // user already received. Even explicit result mode stays scoped to delivery=work.
    const canSurfaceResult = task.delivery === 'work' && (mode === 'result' || mode === 'auto')
    if (canSurfaceResult && latestDelivery !== undefined && summary !== undefined && !repeatedResult
      && Date.parse(latestDelivery.finishedAt) >= oldestResult) {
      const ageHours = Math.max(0, (nowMs - Date.parse(latestDelivery.finishedAt)) / 3_600_000)
      items.push({
        id: `${task.id}:result:${latestDelivery.finishedAt}`,
        taskId: task.id,
        kind: 'result',
        title: task.title,
        detail: summary,
        at: latestDelivery.finishedAt,
        score: 100 + priority - Math.min(20, ageHours / 8),
      })
      continue
    }

    const nextMs = Date.parse(task.nextRunAt)
    const canSurfaceUpcoming = mode === 'upcoming'
      || (mode === 'auto' && (task.recurrence.kind === 'once' || task.attentionText !== undefined))
    if (canSurfaceUpcoming && task.status === 'scheduled' && nextMs >= nowMs && nextMs <= latestUpcoming) {
      const hoursAway = Math.max(0, (nextMs - nowMs) / 3_600_000)
      const detail = compactAttentionText(task.attentionText)
      items.push({
        id: `${task.id}:upcoming:${task.nextRunAt}`,
        taskId: task.id,
        kind: 'upcoming',
        title: task.title,
        ...(detail === undefined ? {} : { detail }),
        at: task.nextRunAt,
        score: 70 + priority + Math.max(0, 14 - Math.min(14, hoursAway / 12)),
      })
    }
  }

  return items
    .sort((left, right) => right.score - left.score || Date.parse(right.at) - Date.parse(left.at) || left.id.localeCompare(right.id))
    .slice(0, MAX_ATTENTION_ITEMS)
}

function rpcFailure(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

/** Mount the read-only loopback endpoints used by the browser task and attention surfaces. */
function installProactivityRpc(connection: HostConnectionHandle, engine: ProactivityEngine): () => Promise<void> {
  return connection.rpc.handle('/phoenix-tasks', async (endpoint): Promise<RpcResult<readonly ProactivityTaskView[] | readonly ProactivityAttentionItem[]>> => {
    try {
      // `list()` intentionally omits surprises until reveal time. Hidden task
      // content therefore never crosses the browser transport ahead of time.
      const tasks = await engine.list()
      if (endpoint === 'list') return { ok: true, value: tasks.map(taskView) }
      if (endpoint === 'attention') return { ok: true, value: buildProactivityAttentionItems(tasks) }
      return rpcFailure(`unknown Phoenix tasks endpoint: ${endpoint}`)
    } catch (error: unknown) {
      return rpcFailure(error instanceof Error ? error.message : String(error))
    }
  }, { authority: 'loopback' })
}

/**
 * Install startup recovery, live-agent wake recovery, periodic retries, task RPC,
 * and the due-task pump.
 *
 * @param ctx Cordis context that owns services, lifecycle events, and the host connection.
 * @param engine Durable proactivity engine whose scheduled work is pumped.
 * @param pollMs Interval between due-task and retry scans.
 * @returns A disposer that stops polling and unmounts lifecycle/RPC handlers.
 */
export function installProactivityRuntime(ctx: Context, engine: ProactivityEngine, pollMs: number): () => void {
  requirePositive(pollMs, 'pollMs')
  let disposed = false
  let pumping = false
  let activeConnection: HostConnectionHandle | undefined
  let rpcDispose: (() => Promise<void>) | undefined

  const syncRpc = (): void => {
    const connection = ctx.get('connection')
    if (connection === activeConnection) return
    const previous = rpcDispose
    activeConnection = undefined
    rpcDispose = undefined
    if (previous !== undefined) void previous()
    if (connection === undefined) return
    activeConnection = connection
    rpcDispose = installProactivityRpc(connection, engine)
  }

  const pump = async (): Promise<void> => {
    if (disposed || pumping) return
    pumping = true
    try {
      const now = new Date()
      await retryFailedProactivityTasks(engine, now, DEFAULT_PROACTIVITY_RETRY_POLICY)
      await engine.runDue(now)
    } catch (error: unknown) {
      ctx.logger.warn(`proactivity task pump failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      pumping = false
    }
  }

  syncRpc()
  const disposeService = ctx.on('internal/service', (serviceName) => {
    if (serviceName === 'connection') syncRpc()
  })
  const timer = setInterval(() => { void pump() }, pollMs)
  const disposeCreated = ctx.on('agent/created', () => { void pump() })
  void pump()

  return () => {
    if (disposed) return
    disposed = true
    clearInterval(timer)
    disposeCreated()
    disposeService()
    const disposeRpc = rpcDispose
    activeConnection = undefined
    rpcDispose = undefined
    if (disposeRpc !== undefined) void disposeRpc()
  }
}
