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
}

/** Browser-safe task projection; unrevealed surprises never reach this surface. */
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
  readonly recentHistory: readonly Pick<ProactivityTask['history'][number], 'phase' | 'scheduledFor' | 'finishedAt' | 'status' | 'summary' | 'error'>[]
}

function requirePositive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`)
  return value
}

function chooseAgent(agents: Pick<AgentRegistry, 'get' | 'roots' | 'list'>, targetAgentId?: string): Agent {
  if (targetAgentId !== undefined) {
    const exact = agents.get(targetAgentId as never)
    if (exact !== undefined) return exact
    // Session/agent ids can be ephemeral across process restarts. A durable
    // global task must not become permanently undeliverable just because the
    // conversation that created it no longer exists.
  }
  const agent = agents.roots()[0] ?? agents.list()[0]
  if (agent === undefined) throw new ProactivityDeferredError('no live Phoenix agent is available')
  return agent
}

function plainOutput(content: readonly ContentBlock[], limit: number): string {
  const text = content.map((block) => block.type === 'text' ? block.text : JSON.stringify(block)).join('\n').trim()
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 1))}…`
}

function mailIdentity(sender: ProactivitySenderIdentity, config: ProactivityRuntimeConfig): string {
  if (sender === 'user') {
    if (config.userMailIdentity === undefined) throw new Error('user mail identity is not configured')
    return config.userMailIdentity
  }
  if (sender === 'harness') {
    if (config.harnessMailIdentity === undefined) throw new Error('Phoenix mail identity is not configured')
    return config.harnessMailIdentity
  }
  if (config.harnessMailIdentity !== undefined) return config.harnessMailIdentity
  if (config.userMailIdentity !== undefined) return config.userMailIdentity
  throw new Error('no mail identity is configured')
}

function proactivePrompt(input: ProactivityExecution, config: ProactivityRuntimeConfig, conditionEvidence?: string): string {
  const lines = [
    '<phoenix_proactive_task>',
    `Task: ${input.task.title}`,
    `Occurrence: ${input.scheduledFor}`,
    `Idempotency key: ${input.idempotencyKey}`,
    `Instruction: ${input.instruction}`,
  ]
  if (input.preparationResult !== undefined) lines.push(`Prepared result: ${input.preparationResult}`)
  if (conditionEvidence !== undefined) lines.push(`Condition verified true: ${conditionEvidence}`)
  if (input.task.delivery === 'email') {
    lines.push(`Delivery: send email using configured identity reference ${JSON.stringify(mailIdentity(input.task.senderIdentity, config))}.`)
    if (input.task.recipient !== undefined) lines.push(`Recipient: ${input.task.recipient}`)
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
  allow: ['read', 'read_image', 'glob', 'grep', 'session_search', 'session_event_search', 'web_search', 'web_fetch'],
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
      + 'Evaluate the condition against current evidence. Use only the available read-only tools. '
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
  if (input.task.condition === undefined) throw new Error('condition watch requires a condition')
  const provider = subagents?.getProvider(providerName)
  if (subagents === undefined || provider === undefined) {
    throw new ProactivityDeferredError(`condition-watch provider is not available: ${providerName}`)
  }
  if (!provider.capabilities.outputSchema || !provider.capabilities.toolFilter) {
    throw new ProactivityDeferredError(`condition-watch provider lacks structured read-only evaluation: ${providerName}`)
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
  agents: Pick<AgentRegistry, 'get' | 'roots' | 'list'>,
  subagents: Pick<SubagentRuntime, 'getProvider' | 'start'> | undefined,
  config: ProactivityRuntimeConfig,
): ProactivityExecutor {
  requirePositive(config.privateWorkResultChars, 'privateWorkResultChars')
  return {
    async execute(input): Promise<ProactivityExecutionResult> {
      const parent = chooseAgent(agents, input.task.targetAgentId)
      let conditionEvidence: string | undefined
      if (input.phase === 'deliver' && input.task.condition !== undefined) {
        const decision = await evaluateConditionWatch(input, parent, subagents, config.privateWorkProvider)
        if (!decision.met) return { summary: `condition not met: ${decision.evidence}` }
        conditionEvidence = decision.evidence
      }
      const terminalAfterDelivery = input.phase === 'deliver' && input.task.condition !== undefined
      const privateWork = input.phase === 'prepare' || input.task.delivery === 'email' || input.task.delivery === 'work'
      if (!privateWork) {
        parent.followup(createUserMessage({
          content: [{ type: 'text', text: proactivePrompt(input, config, conditionEvidence) }],
          source: {
            kind: 'plugin',
            plugin: 'hardness-adapters',
            form: 'notice',
            summary: boundContextSummary(`Scheduled task: ${input.task.title}`),
          },
        }))
        return {
          summary: conditionEvidence === undefined
            ? 'accepted by the live Phoenix agent inbox'
            : `condition met and notification accepted: ${conditionEvidence}`,
          ...(terminalAfterDelivery ? { terminal: true } : {}),
        }
      }

      if (subagents === undefined || subagents.getProvider(config.privateWorkProvider) === undefined) {
        throw new ProactivityDeferredError(`private-work provider is not available: ${config.privateWorkProvider}`)
      }
      const controller = new AbortController()
      const run = await subagents.start(config.privateWorkProvider, {
        label: input.phase === 'prepare' ? `Prepare: ${input.task.title}` : `Scheduled: ${input.task.title}`,
        prompt: [{ type: 'text', text: proactivePrompt(input, config, conditionEvidence) }],
        parent,
        signal: controller.signal,
      })
      try {
        const result = await run.result
        if (result.stopReason !== 'completed') {
          throw new Error(result.diagnostic ?? `private proactive work ended with ${result.stopReason}`)
        }
        return {
          summary: plainOutput(result.output, config.privateWorkResultChars),
          ...(terminalAfterDelivery ? { terminal: true } : {}),
        }
      } finally {
        await run.dispose()
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

function rpcFailure(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

/** Mount a read-only loopback endpoint used by the browser Task Center. */
function installProactivityRpc(connection: HostConnectionHandle, engine: ProactivityEngine): () => Promise<void> {
  return connection.rpc.handle('/phoenix-tasks', async (endpoint): Promise<RpcResult<readonly ProactivityTaskView[]>> => {
    if (endpoint !== 'list') return rpcFailure(`unknown Phoenix tasks endpoint: ${endpoint}`)
    try {
      // `list()` intentionally omits surprises until reveal time. Hidden task
      // content therefore never crosses the browser transport ahead of time.
      return { ok: true, value: (await engine.list()).map(taskView) }
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
    const connection = ctx.get('connection') as HostConnectionHandle | undefined
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
