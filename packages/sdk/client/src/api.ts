/**
 * High-level run API over {@link HarnessClient}: `DeepSeekHarness` owns one
 * runtime subprocess across many sessions; `HarnessSession.run` sends a
 * prompt and settles when the whole agent next becomes idle.
 * Mirrors the Python SDK's `DeepSeekHarness`/`Session` pair.
 *
 * @module @deepseek-ai/dsh-sdk-client/api
 */

import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  HARNESS_SDK_PROTOCOL_VERSION,
  type HarnessSdkCapabilities,
  type SessionCloseResult,
  type SessionInterruptResult,
} from '@deepseek-ai/dsh-sdk-protocol'
import { HarnessClient, isRecord, SdkProtocolError } from './client.ts'
import type { ContentBlock, DeepSeekHarnessOptions, HarnessClientOptions, HarnessNotification, RunResult } from './types.ts'

/** Reusable SDK for running PHOENIX agent turns in one runtime subprocess. */
export class DeepSeekHarness implements AsyncDisposable {
  private clientInstance: HarnessClient
  private readonly launch: HarnessClientOptions
  private readonly cwd: string
  private readonly provider: string
  private readonly model: string
  private readonly maxTokens: number | undefined
  private initialized: Promise<void> | undefined
  private closed = false
  private negotiatedProtocolVersion = 1
  private negotiatedCapabilities: HarnessSdkCapabilities | undefined

  constructor(options: DeepSeekHarnessOptions) {
    this.launch = options.launch
    this.clientInstance = new HarnessClient(options.launch)
    this.cwd = resolve(options.cwd ?? options.launch.cwd ?? process.cwd())
    this.provider = options.provider ?? 'deepseek-official'
    this.model = options.model ?? 'deepseek-v4-flash'
    this.maxTokens = options.maxTokens
  }

  /** Current low-level transport client owned by this harness. */
  get client(): HarnessClient {
    return this.clientInstance
  }

  /** Negotiated feature level after {@link start}; 1 before the handshake. */
  get protocolVersion(): number {
    return this.negotiatedProtocolVersion
  }

  /**
   * Query a negotiated v2 lifecycle capability.
   * @param capability - lifecycle capability to query.
   * @returns true only when advertised.
   */
  supports(capability: keyof HarnessSdkCapabilities): boolean {
    return this.negotiatedCapabilities?.[capability] === true
  }

  /** Start the subprocess and negotiate the newest optional protocol this client understands. */
  start(): Promise<void> {
    this.initialized ??= (async () => {
      try {
        this.clientInstance.start()
        const raw = await this.clientInstance.request('initialize', {
          cwd: this.cwd,
          provider: this.provider,
          model: this.model,
          protocolVersion: HARNESS_SDK_PROTOCOL_VERSION,
          ...this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens },
        })
        const result = validatedInitialize(raw)
        this.negotiatedProtocolVersion = result.protocolVersion
        this.negotiatedCapabilities = result.capabilities
      } catch (error) {
        this.initialized = undefined
        this.negotiatedProtocolVersion = 1
        this.negotiatedCapabilities = undefined
        await this.clientInstance.close()
        if (!this.closed) this.clientInstance = new HarnessClient(this.launch)
        throw error
      }
    })()
    return this.initialized
  }

  /**
   * Create a stable session handle.
   * @param sessionId - optional stable id.
   * @returns a session handle sharing this runtime.
   */
  session(sessionId?: string): HarnessSession {
    return new HarnessSession(this, sessionId ?? `session-${randomUUID().replaceAll('-', '')}`)
  }

  /**
   * Run one turn.
   * @param input - prompt or content blocks.
   * @param options - optional run settings.
   * @returns settled turn result.
   */
  run(input: string | ContentBlock[], options?: RunOptions): Promise<RunResult> {
    return this.session(options?.sessionId).run(input, options)
  }

  /** Close the shared runtime subprocess.
   * @returns once the shared runtime subprocess is closed.
   */
  close(): Promise<void> {
    this.closed = true
    return this.clientInstance.close()
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }
}

/** Per-run options: target session and streaming observer. */
export interface RunOptions {
  sessionId?: string
  onNotification?: (notification: HarnessNotification) => void
}

/** One SDK session: a stable id plus owned activity intervals and v2 lifecycle controls. */
export class HarnessSession {
  private closed = false

  constructor(readonly harness: DeepSeekHarness, readonly id: string) {}

  /**
   * Run one turn in this stable session.
   * @param input - prompt or content blocks.
   * @param options - optional notification observer.
   * @returns settled turn result.
   */
  async run(input: string | ContentBlock[], options?: Pick<RunOptions, 'onNotification'>): Promise<RunResult> {
    if (this.closed) throw new SdkProtocolError(`SDK session "${this.id}" is closed`)
    await this.harness.start()
    const client = this.harness.client
    const contentBlocks = normalizeInput(input)
    const events: SessionEvent[] = []
    const notifications: HarnessNotification[] = []

    const subscription = client.subscribeSessionTree(this.id)
    const collect = (notification: HarnessNotification): void => {
      if (notification.method === 'session.event' && notification.params.sessionId === this.id) {
        const event = validatedSessionEvent(notification.params.event)
        notifications.push(notification)
        options?.onNotification?.(notification)
        events.push(event)
        return
      }
      notifications.push(notification)
      options?.onNotification?.(notification)
    }
    try {
      const messageId = await client.prompt(this.id, contentBlocks)
      let received = false
      while (true) {
        const notification = await subscription.next()
        if (!received) {
          if (notification.method !== 'session.event'
            || notification.params.sessionId !== this.id
            || !isInboxReceipt(notification.params.event, messageId)) continue
          received = true
        }
        collect(notification)
        if (notification.method === 'session.status'
          && notification.params.sessionId === this.id
          && notification.params.status === 'idle') break
      }
    } finally {
      subscription.close()
    }

    return {
      sessionId: this.id,
      finalResponse: finalResponse(events),
      events,
      notifications,
    }
  }

  /**
   * Cancel this session's current activity without closing the runtime.
   * @returns whether the session existed and was running.
   */
  async interrupt(): Promise<SessionInterruptResult> {
    if (this.closed) return { found: false, wasRunning: false }
    await this.harness.start()
    if (!this.harness.supports('sessionInterrupt')) {
      throw new SdkProtocolError('PHOENIX runtime does not advertise session/interrupt')
    }
    const value = await this.harness.client.request('session/interrupt', { sessionId: this.id })
    if (!isRecord(value) || typeof value.found !== 'boolean' || typeof value.wasRunning !== 'boolean') {
      throw new SdkProtocolError(`session/interrupt returned malformed result: ${JSON.stringify(value)}`)
    }
    return { found: value.found, wasRunning: value.wasRunning }
  }

  /**
   * Dispose this SDK-owned session while preserving the shared runtime.
   * @returns whether a live SDK session was found and closed.
   */
  async close(): Promise<SessionCloseResult> {
    if (this.closed) return { found: false }
    await this.harness.start()
    if (!this.harness.supports('sessionClose')) {
      throw new SdkProtocolError('PHOENIX runtime does not advertise session/close')
    }
    const value = await this.harness.client.request('session/close', { sessionId: this.id })
    if (!isRecord(value) || typeof value.found !== 'boolean') {
      throw new SdkProtocolError(`session/close returned malformed result: ${JSON.stringify(value)}`)
    }
    this.closed = true
    return { found: value.found }
  }
}

interface ValidatedInitialize {
  protocolVersion: number
  capabilities?: HarnessSdkCapabilities
}

/** Accept legacy v1 runtimes while requiring an internally consistent v2 capability advertisement. */
function validatedInitialize(value: unknown): ValidatedInitialize {
  if (!isRecord(value) || !isRecord(value.serverInfo)
    || typeof value.serverInfo.name !== 'string' || typeof value.serverInfo.version !== 'string') {
    throw new SdkProtocolError(`initialize returned no server identity: ${JSON.stringify(value)}`)
  }
  if (value.protocolVersion === undefined) return { protocolVersion: 1 }
  if (!Number.isSafeInteger(value.protocolVersion) || (value.protocolVersion as number) <= 0) {
    throw new SdkProtocolError(`initialize returned invalid protocolVersion: ${JSON.stringify(value.protocolVersion)}`)
  }
  const protocolVersion = value.protocolVersion as number
  if (protocolVersion < 2) return { protocolVersion }
  const capabilities = value.capabilities
  if (!isRecord(capabilities)
    || typeof capabilities.sessionInterrupt !== 'boolean'
    || typeof capabilities.sessionClose !== 'boolean') {
    throw new SdkProtocolError(`initialize returned no v2 capabilities: ${JSON.stringify(value)}`)
  }
  return {
    protocolVersion,
    capabilities: {
      sessionInterrupt: capabilities.sessionInterrupt,
      sessionClose: capabilities.sessionClose,
    },
  }
}

export function normalizeInput(input: string | ContentBlock[]): ContentBlock[] {
  return typeof input === 'string' ? [{ type: 'text', text: input }] : input
}

function validatedSessionEvent(value: unknown): SessionEvent {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new SdkProtocolError(`session.event carried no event envelope: ${JSON.stringify(value)}`)
  }
  if (value.type === 'assistant/message') {
    const message = isRecord(value.data) ? value.data.message : undefined
    const content = isRecord(message) ? message.content : undefined
    if (!Array.isArray(content) || !content.every(block => isRecord(block) && typeof block.type === 'string')) {
      throw new SdkProtocolError(`assistant/message event carried malformed content: ${JSON.stringify(value)}`)
    }
  }
  return value as unknown as SessionEvent
}

function isInboxReceipt(value: unknown, messageId: string): boolean {
  if (!isRecord(value) || value.type !== 'agent/inbox/spliced' || !isRecord(value.data)) return false
  const inserted = value.data.inserted
  return Array.isArray(inserted) && inserted.some(message => isRecord(message) && message.id === messageId)
}

export function finalResponse(events: SessionEvent[]): string {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    return event.data.message.content
      .filter((block): block is ContentBlock & { type: 'text' } => block.type === 'text')
      .map(block => block.text)
      .join('')
  }
  return ''
}
