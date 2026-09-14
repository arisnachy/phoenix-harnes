import type { Context } from '@phoenix-ai/cordis'
import type { Agent, AgentRegistry } from '@phoenix-ai/dsh-agent'
import type { HostConnectionHandle } from '@phoenix-ai/dsh-client-connection'
import type { RpcResult } from '@phoenix-ai/dsh-host-apiproxy/api'
import { boundContextSummary, createUserMessage, type ContentBlock } from '@phoenix-ai/dsh-llm'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import {
  ProactivityDeferredError,
  type ProactivityEngine,
  type ProactivityExecution,
  type ProactivityExecutionResult,
  type ProactivityExecutor,
  type ProactivitySenderIdentity,
  type ProactivityTask,
} from './proactivity-engine.ts'

/** Host configuration for proactive execution and mail identity selection. */
export interface ProactivityRuntimeConfig {
  readonly pollMs: number
  readonly privateWorkProvider: string
  readonly privateWorkResultChars: number
  readonly userMailIdentity?: string
  readonly harnessMailIdentity?: string
}

/** Safe task projection exposed to local UI clients. Surprise contents never cross this boundary. */
export interface ProactivityTaskView {
  readonly id: string
  readonly title: string
  readonly status: ProactivityTask['status']
  readonly nextRunAt: string
  readonly recurrence: ProactivityTask['recurrence']
  readonly catchUp: ProactivityTask['catchUp']
  readonly visibility: ProactivityTask['visibility']
  readonly delivery: ProactivityTask['delivery']
  readonly senderIdentity: ProactivityTask['senderIdentity']
  readonly createdBy: ProactivityTask['createdBy']
  readonly history: readonly {
    readonly phase: 'prepare' | 'deliver'
    readonly scheduledFor: string
    readonly finishedAt: string
    readonly status: 'completed' | 'failed'
    readonly summary?: string
    readonly error?: string
  }[]
}

function requirePositive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`)
  return value
}

function chooseAgent(agents: Pick<AgentRegistry, 'get' | 'roots' | 'list'>, targetAgentId?: string): Agent {
  if (targetAgentId !== undefined) {
    const exact = agents.get(targetAgentId as never)
    if (exact === undefined) throw new ProactivityDeferredError(`target agent is not live: ${targetAgentId}`)
    return exact
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

function proactivePrompt(input: ProactivityExecution, config: ProactivityRuntimeConfig): string {
  const lines = [
    '<phoenix_proactive_task>',
    `Task: ${input.task.title}`,
    `Occurrence: ${input.scheduledFor}`,
    `Idempotency key: ${input.idempotencyKey}`,
    `Instruction: ${input.instruction}`,
  ]
  if (input.preparationResult !== undefined) lines.push(`Prepared result: ${input.preparationResult}`)
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

/**
 * Create the execution adapter that wakes a live agent for communication and
 * uses an isolated one-shot subagent for private preparation or office work.
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
      const privateWork = input.phase === 'prepare' || input.task.delivery === 'email' || input.task.delivery === 'work'
      if (!privateWork) {
        parent.followup(createUserMessage({
          content: [{ type: 'text', text: proactivePrompt(input, config) }],
          source: {
            kind: 'plugin',
            plugin: 'hardness-adapters',
            form: 'notice',
            summary: boundContextSummary(`Scheduled task: ${input.task.title}`),
          },
        }))
        return { summary: 'accepted by the live Phoenix agent inbox' }
      }

      if (subagents === undefined || subagents.getProvider(config.privateWorkProvider) === undefined) {
        throw new ProactivityDeferredError(`private-work provider is not available: ${config.privateWorkProvider}`)
      }
      const controller = new AbortController()
      const run = await subagents.start(config.privateWorkProvider, {
        label: input.phase === 'prepare' ? `Prepare: ${input.task.title}` : `Scheduled: ${input.task.title}`,
        prompt: [{ type: 'text', text: proactivePrompt(input, config) }],
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
    visibility: task.visibility,
    delivery: task.delivery,
    senderIdentity: task.senderIdentity,
    createdBy: task.createdBy,
    history: task.history.slice(-5).map(row => ({
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

function taskId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const id = (value as Record<string, unknown>).id
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : undefined
}

/**
 * Mount the local-only management channel used by Phoenix's visual Task Center.
 * The engine's ordinary list projection intentionally omits unrevealed surprises.
 */
export function installProactivityManagementRuntime(
  connection: HostConnectionHandle,
  engine: ProactivityEngine,
): () => Promise<void> {
  return connection.rpc.handle('/phoenix-tasks', async (endpoint, raw): Promise<RpcResult<readonly ProactivityTaskView[] | ProactivityTaskView>> => {
    try {
      if (endpoint === 'list') return { ok: true, value: (await engine.list()).map(taskView) }
      const id = taskId(raw)
      if (id === undefined) return rpcFailure('task operation requires a non-empty id')
      if (endpoint === 'pause') return { ok: true, value: taskView(await engine.pause(id)) }
      if (endpoint === 'resume') return { ok: true, value: taskView(await engine.resume(id)) }
      if (endpoint === 'cancel') return { ok: true, value: taskView(await engine.cancel(id)) }
      return rpcFailure(`unknown Phoenix task endpoint: ${endpoint}`)
    } catch (error) {
      return rpcFailure(error instanceof Error ? error.message : String(error))
    }
  }, { authority: 'loopback' })
}

/** Install startup recovery, live-agent wake recovery, and the periodic due-task pump. */
export function installProactivityRuntime(ctx: Context, engine: ProactivityEngine, pollMs: number): () => void {
  requirePositive(pollMs, 'pollMs')
  let disposed = false
  let pumping = false
  const pump = async (): Promise<void> => {
    if (disposed || pumping) return
    pumping = true
    try {
      await engine.runDue()
    } catch (error: unknown) {
      ctx.logger.warn(`proactivity task pump failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      pumping = false
    }
  }
  const timer = setInterval(() => { void pump() }, pollMs)
  const disposeCreated = ctx.on('agent/created', () => { void pump() })
  void pump()
  return () => {
    if (disposed) return
    disposed = true
    clearInterval(timer)
    disposeCreated()
  }
}
