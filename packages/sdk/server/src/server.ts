/**
 * JSON-RPC methods and notifications for out-of-process harness SDKs.
 * The surrounding context owns plugins, persistence, and configured adapters.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-server/server
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolve } from 'node:path'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { carrierKeyOf, type Scoped } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import type SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentRunEndInfo } from '@deepseek-ai/dsh-subagent'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import {
  HARNESS_SDK_PROTOCOL_VERSION,
  type InitializeParams,
  type InitializeResult,
  type JsonRpcTransportPeer,
  type SessionCloseResult,
  type SessionEventNotification,
  type SessionInterruptResult,
  type SessionLifecycleParams,
  type SessionPromptParams,
  type SessionPromptResult,
  type SubagentFinishedNotification,
  type SubagentStartedNotification,
} from '@deepseek-ai/dsh-sdk-protocol'

interface SessionRecord {
  handle: AgentHandle
}

/** Recover the delegating parent from the service-owned scoped carrier. */
function subagentParentOf(carrier: Scoped<SubagentRuntime>): Agent {
  return carrierKeyOf(carrier) as Agent
}

/** Deployment-specific status mapping for SDK turn and subagent outcomes. */
export interface HarnessSdkJsonRpcServerOptions {
  /** Report max-token termination as an accepted result instead of an infrastructure error. */
  maxTokensAsSuccess?: boolean
}

function successStatus(reason: string, options: HarnessSdkJsonRpcServerOptions): 'ok' | 'error' {
  if (reason === 'completed') return 'ok'
  return reason === 'max-tokens' && options.maxTokensAsSuccess === true ? 'ok' : 'error'
}

/**
 * SDK server over one booted harness context and transport peer. Construction
 * subscribes to session, agent, and subagent lifecycle events until shutdown;
 * reinitialization is unsupported.
 */
export class HarnessSdkJsonRpcServer {
  private cwd = process.cwd()
  private provider = 'deepseek-official'
  private model = 'deepseek-official'
  private maxTokens: number | undefined
  private llmFiber: { dispose(): Promise<void> } | undefined
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly sessionCreations = new Map<string, Promise<SessionRecord>>()
  private readonly sessionCloseTasks = new Map<string, Promise<SessionCloseResult>>()
  private readonly disposers: (() => void)[] = []
  private shutdownTask: Promise<Record<string, never>> | undefined
  private shuttingDown = false

  constructor(
    private readonly ctx: Context,
    private readonly transport: JsonRpcTransportPeer,
    private readonly options: HarnessSdkJsonRpcServerOptions = {},
  ) {
    const serverOptions = this.options
    this.disposers.push(ctx.on('session/event', (session, event) => {
      const payload: SessionEventNotification = { sessionId: String(session.id), event }
      this.transport.notify('session.event', payload)
    }))
    this.disposers.push(ctx.on('agent/status', ({ agent, status }) => {
      this.transport.notify('session.status', { sessionId: String(agent.session.id), status })
    }))
    this.disposers.push(ctx.on('session/created', (session) => {
      const parentSession = session.header.parentSession
      if (parentSession === undefined) return
      const payload: SubagentStartedNotification = {
        parentSessionId: String(parentSession),
        childSessionId: String(session.id),
      }
      this.transport.notify('subagent.started', payload)
    }))
    this.disposers.push(ctx.on('subagent/end', function (this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo) {
      const parent = subagentParentOf(this)
      if (!info.local) return
      const payload: SubagentFinishedNotification = {
        provider: info.provider,
        agentId: String(info.id),
        parentSessionId: String(parent.session.id),
        childSessionId: String(info.id),
        status: successStatus(info.stopReason, serverOptions),
        stopReason: info.stopReason,
        ...(info.lastAssistantMessage === undefined ? {} : { lastAssistantMessage: info.lastAssistantMessage }),
      }
      transport.notify('subagent.finished', payload)
    }))
  }

  /**
   * Configure the SDK route and negotiate optional protocol features.
   * @param params - runtime route, model, limits, and optional protocol version.
   * @returns server identity and negotiated protocol capabilities.
   */
  async initialize(params: InitializeParams): Promise<InitializeResult> {
    if (params.maxTokens !== undefined
      && (!Number.isSafeInteger(params.maxTokens) || params.maxTokens <= 0)) {
      throw new TypeError('initialize maxTokens must be a positive safe integer')
    }
    if (params.protocolVersion !== undefined
      && (!Number.isSafeInteger(params.protocolVersion) || params.protocolVersion <= 0)) {
      throw new TypeError('initialize protocolVersion must be a positive safe integer')
    }
    this.cwd = resolve(params.cwd)
    this.provider = params.provider
    this.model = params.model
    this.maxTokens = params.maxTokens
    if (!this.hasAdapterFor(this.provider)) {
      if (this.provider !== 'deepseek-official') throw new Error(`no adapter registered for provider "${this.provider}"`)
      this.llmFiber = await this.ctx.plugin(LlmDeepSeek, {})
    }

    const serverInfo = { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' }
    if (params.protocolVersion === undefined) return { serverInfo }
    const protocolVersion = Math.min(params.protocolVersion, HARNESS_SDK_PROTOCOL_VERSION)
    return {
      serverInfo,
      protocolVersion,
      ...(protocolVersion < 2 ? {} : {
        capabilities: { sessionInterrupt: true, sessionClose: true },
      }),
    }
  }

  /**
   * Queue one identified prompt without assigning later activity to it.
   * @param params - target session and prompt content blocks.
   * @returns the queued user-message identifier.
   */
  async prompt(params: SessionPromptParams): Promise<SessionPromptResult> {
    const rec = await this.getOrCreateSession(params.sessionId)
    if (this.ctx.agents.get(rec.handle.agent.id) !== rec.handle.agent) {
      throw new Error(`session agent was disposed outside the server: ${params.sessionId}`)
    }
    const message = createUserMessage({ content: params.contentBlocks, source: { kind: 'user' } })
    rec.handle.agent.followup(message)
    return { messageId: message.id }
  }

  /**
   * Cancel only the current activity of one SDK-owned session.
   * @param params - target SDK session.
   * @returns existence and prior running state.
   */
  async interrupt(params: SessionLifecycleParams): Promise<SessionInterruptResult> {
    const rec = await this.loadedSession(params.sessionId)
    if (rec === undefined || this.ctx.agents.get(rec.handle.agent.id) !== rec.handle.agent) {
      if (rec !== undefined) this.sessions.delete(params.sessionId)
      return { found: false, wasRunning: false }
    }
    const wasRunning = rec.handle.agent.status === 'running'
    if (wasRunning) rec.handle.agent.cancel({ kind: 'user' }, { keepInbox: true })
    return { found: true, wasRunning }
  }

  /**
   * Dispose one SDK-owned session while leaving the runtime and other sessions alive.
   * @param params - target SDK session.
   * @returns whether that session was found.
   */
  closeSession(params: SessionLifecycleParams): Promise<SessionCloseResult> {
    const existing = this.sessionCloseTasks.get(params.sessionId)
    if (existing !== undefined) return existing
    const task = this.performCloseSession(params.sessionId).finally(() => {
      if (this.sessionCloseTasks.get(params.sessionId) === task) this.sessionCloseTasks.delete(params.sessionId)
    })
    this.sessionCloseTasks.set(params.sessionId, task)
    return task
  }

  private async performCloseSession(sessionId: string): Promise<SessionCloseResult> {
    const rec = await this.loadedSession(sessionId)
    if (rec === undefined) return { found: false }
    if (this.sessions.get(sessionId) === rec) this.sessions.delete(sessionId)
    await rec.handle.dispose()
    return { found: true }
  }

  /**
   * Dispose server-owned agents, adapter, and subscriptions to quiescence.
   * @returns an empty success record after teardown.
   */
  shutdown(): Promise<Record<string, never>> {
    this.shutdownTask ??= this.performShutdown()
    return this.shutdownTask
  }

  private async performShutdown(): Promise<Record<string, never>> {
    this.shuttingDown = true
    const pendingCreations = [...this.sessionCreations.values()]
    await Promise.allSettled(pendingCreations)
    this.sessionCreations.clear()
    await Promise.allSettled([...this.sessionCloseTasks.values()])
    this.sessionCloseTasks.clear()
    const records = [...this.sessions.values()]
    this.sessions.clear()
    const failures: unknown[] = []
    while (this.disposers.length > 0) {
      try {
        this.disposers.pop()?.()
      } catch (error) {
        failures.push(error)
      }
    }
    const teardownResults = await Promise.allSettled([
      ...records.map(rec => Promise.resolve().then(() => rec.handle.dispose())),
      ...(this.llmFiber === undefined ? [] : [Promise.resolve().then(() => this.llmFiber?.dispose())]),
    ])
    this.llmFiber = undefined
    failures.push(...teardownResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason as unknown))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'SDK server teardown failed')
    return {}
  }

  /**
   * Dispatch one incoming JSON-RPC request to its typed handler.
   * @param method - protocol method name.
   * @param params - decoded request parameters.
   * @returns typed handler result.
   */
  async handleRequest(method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.initialize(params as unknown as InitializeParams)
      case 'session/prompt':
        return this.prompt(params as unknown as SessionPromptParams)
      case 'session/interrupt':
        return this.interrupt(params as unknown as SessionLifecycleParams)
      case 'session/close':
        return this.closeSession(params as unknown as SessionLifecycleParams)
      case 'shutdown':
        return this.shutdown()
      default:
        throw new Error(`unknown PHOENIX SDK runtime method: ${method}`)
    }
  }

  private async loadedSession(sessionId: string): Promise<SessionRecord | undefined> {
    const live = this.sessions.get(sessionId)
    if (live !== undefined) return live
    return this.sessionCreations.get(sessionId)
  }

  private async getOrCreateSession(sessionId: string): Promise<SessionRecord> {
    if (this.shuttingDown) throw new Error('SDK server is shutting down')
    if (this.sessionCloseTasks.has(sessionId)) throw new Error(`SDK session is closing: ${sessionId}`)
    const existing = this.sessions.get(sessionId)
    if (existing) return existing
    const pending = this.sessionCreations.get(sessionId)
    if (pending) return pending
    const creation = this.createSession(sessionId)
    this.sessionCreations.set(sessionId, creation)
    void creation.then(
      () => { this.sessionCreations.delete(sessionId) },
      () => { this.sessionCreations.delete(sessionId) },
    )
    return creation
  }

  private async createSession(sessionId: string): Promise<SessionRecord> {
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(sessionId),
      meta: { cwd: this.cwd },
      agentOptions: {
        provider: this.provider,
        model: this.model,
        ...this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens },
      },
    })
    const rec: SessionRecord = { handle }
    // A close task that already claimed this creation owns disposal. Let the
    // admitted creation publish its record so performCloseSession can observe
    // and dispose it exactly once; only shutdown tears it down here.
    if (this.shuttingDown) {
      await handle.dispose()
      throw new Error(`SDK session closed during creation: ${sessionId}`)
    }
    this.sessions.set(sessionId, rec)
    return rec
  }

  private hasAdapterFor(provider: string): boolean {
    return this.ctx.get('llm')?.listProviders().some(entry => entry.id === provider) ?? false
  }
}
