/**
 * Minimal Codex app-server 0.147.0 protocol adapter. The shared JSON-RPC
 * transport owns framing and request correlation; this module owns only the
 * product methods, current thread/turn association, unattended approval
 * responses, and terminal-answer selection.
 *
 * @module @phoenix-ai/dsh-subagent-codex/wire
 */

import type { Readable, Writable } from 'node:stream'
import type { ContentBlock } from '@phoenix-ai/dsh-llm'
import type { SubagentResult } from '@phoenix-ai/dsh-subagent'
import { JsonRpcLineTransport } from '@phoenix-ai/dsh-sdk-protocol'
import type { CodexPermissionMode } from './run.ts'

type JsonObject = Record<string, unknown>

declare const CODEX_THREAD_ID: unique symbol
declare const CODEX_TURN_ID: unique symbol

/** Opaque native Codex thread identity retained by a durable execution. */
export type CodexThreadId = string & { readonly [CODEX_THREAD_ID]: 'CodexThreadId' }

/** Opaque native Codex turn identity retained by a durable execution. */
export type CodexTurnId = string & { readonly [CODEX_TURN_ID]: 'CodexTurnId' }

/** Alias used when a caller stores the native session binding generically. */
export type CodexNativeSessionId = CodexThreadId

/** Construct one validated native Codex thread identity.
 * @param value - Bounded nonempty native thread identifier.
 * @returns Validated branded thread identity.
 */
export function CodexThreadId(value: string): CodexThreadId {
  if (value.length === 0 || value.length > 256) {
    throw new Error('subagent-codex: invalid native thread id')
  }
  return value as CodexThreadId
}

/** Construct a validated native session binding (the durable thread id).
 * @param value - Native thread identifier used as a session binding.
 * @returns Validated branded native session identity.
 */
export function CodexNativeSessionId(value: string): CodexNativeSessionId {
  return CodexThreadId(value)
}

/** Construct one validated native Codex turn identity.
 * @param value - Bounded nonempty native turn identifier.
 * @returns Validated branded turn identity.
 */
export function CodexTurnId(value: string): CodexTurnId {
  if (value.length === 0 || value.length > 256) {
    throw new Error('subagent-codex: invalid native turn id')
  }
  return value as CodexTurnId
}

/** The only terminal statuses that Codex may acknowledge for a turn. */
export type CodexTurnStatus = 'completed' | 'interrupted' | 'failed'

/** Progress status used when reconciling a persisted native thread. */
export type CodexThreadStatus = 'running' | 'idle' | 'unknown'

/** A bounded native turn summary returned by `thread/read`. */
export interface CodexTurnSummary {
  readonly id: CodexTurnId
  readonly status: CodexTurnStatus | 'in-progress' | 'unknown'
  readonly output?: string
}

/** A safe, secret-free view of one native thread. */
export interface CodexThreadSnapshot {
  readonly id: CodexThreadId
  readonly status: CodexThreadStatus
  readonly turns: readonly CodexTurnSummary[]
  readonly cwd?: string
  readonly model?: string
}

/** The durable binding acknowledged by `thread/start` or `thread/resume`. */
export interface CodexDurableThread {
  readonly id: CodexThreadId
  readonly ephemeral: false
}

/** Canonical terminal fact for one durable turn. */
export interface CodexTurnCompletion {
  readonly id: CodexTurnId
  readonly status: CodexTurnStatus
  readonly output?: string
}

/** Handle returned after Codex acknowledges a durable turn id. */
export interface CodexDurableTurn {
  readonly id: CodexTurnId
  readonly completion: Promise<CodexTurnCompletion>
}

/** Durable thread read/recovery result. */
export type CodexThreadReconciliation = CodexThreadSnapshot

/** Exact approval request scope exposed to an optional Phoenix broker. */
export interface CodexApprovalRequest {
  readonly kind: 'command' | 'file-change'
  readonly threadId: CodexThreadId
  readonly turnId: CodexTurnId
  readonly availableDecisions: readonly string[]
  /** Bounded native command text after credential-like values are redacted. */
  readonly command?: string
  /** Bounded workspace path supplied by the native approval request. */
  readonly path?: string
}

/** Native approval decisions accepted by the app-server. */
export type CodexApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'

/** Secret-free progress metadata emitted by durable Codex operations. */
export type CodexWireEvent =
  | {
    readonly kind: 'thread'
    readonly phase: 'started' | 'resumed' | 'status'
    readonly threadId: CodexThreadId
    readonly status?: CodexThreadStatus
  }
  | {
    readonly kind: 'turn'
    readonly phase: 'started' | 'completed'
    readonly threadId: CodexThreadId
    readonly turnId: CodexTurnId
    readonly status?: CodexTurnStatus
  }
  | {
    readonly kind: 'item'
    readonly phase: 'started' | 'completed'
    readonly threadId: CodexThreadId
    readonly turnId: CodexTurnId
    readonly itemId?: string
    readonly itemType: string
  }
  | {
    readonly kind: 'approval'
    readonly phase: 'requested' | 'decided'
    readonly request: 'command' | 'file-change'
    readonly threadId: CodexThreadId
    readonly turnId: CodexTurnId
    readonly decision?: CodexApprovalDecision
  }
  | {
    readonly kind: 'rate-limit'
    readonly phase: 'updated'
  }

/** Durable checkpoint phases required before later native side effects. */
export interface CodexWireCheckpoint {
  readonly phase: 'thread-acknowledged' | 'before-turn-start' | 'turn-acknowledged' | 'before-steer'
  readonly threadId: CodexThreadId
  readonly turnId?: CodexTurnId
}

/** Optional durable observers and approval/checkpoint callbacks. */
export interface CodexWireOptions {
  readonly onEvent?: (event: CodexWireEvent) => void
  readonly onApproval?: (
    request: CodexApprovalRequest,
    signal: AbortSignal,
  ) => CodexApprovalDecision | Promise<CodexApprovalDecision>
  readonly onCheckpoint?: (checkpoint: CodexWireCheckpoint) => void | Promise<void>
}

/** Native model scope fixed for a durable thread. */
export interface CodexDurableThreadOptions {
  readonly cwd?: string
  readonly model?: string
  /** Explicit Phoenix policy; never inherit the native user's global sandbox. */
  readonly sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
}

/** Native model and reasoning scope fixed for one durable turn. */
export interface CodexDurableTurnOptions {
  readonly model?: string
  readonly reasoningEffort?: string
}

/** Product facts owned by the Codex wire after publication. */
export interface CodexWireFailureFacts {
  readonly stage: 'turn-start' | 'turn'
  readonly category: string
  readonly httpStatus?: number | undefined
}

const THREAD_PERMISSION_PARAMS: Readonly<Record<CodexPermissionMode, JsonObject>> = {
  never: { approvalPolicy: 'never' },
  'approve-for-me': {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandbox: 'workspace-write',
  },
  'dangerously-bypass-approvals-and-sandbox': {
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  },
}

const STDERR_PERMISSION_SIGNATURES = [
  {
    text: 'approval policy is Never; reject command',
    request: 'command execution',
    decision: 'denied',
    reason: 'Codex rejected an escalation because the selected policy never asks for approval',
  },
  {
    text: 'recorded sandbox violation:',
    request: 'sandbox execution',
    decision: 'failed',
    reason: 'Codex reported a sandbox violation',
  },
] as const

const STDERR_SIGNATURE_TAIL_CHARS = Math.max(
  ...STDERR_PERMISSION_SIGNATURES.map(signature => signature.text.length),
) - 1

function stderrSignatureTail(value: string): string {
  for (
    let length = Math.min(STDERR_SIGNATURE_TAIL_CHARS, value.length)
    ; length > 0
    ; length -= 1
  ) {
    const tail = value.slice(-length)
    if (STDERR_PERMISSION_SIGNATURES.some(signature =>
      tail.length < signature.text.length && signature.text.startsWith(tail))) {
      return tail
    }
  }
  return ''
}

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`subagent-codex: app-server returned invalid ${label}`)
  }
  return value as JsonObject
}

function notificationThreadId(params: JsonObject, label: string): CodexThreadId {
  const direct = params.threadId
  if (direct !== undefined) return CodexThreadId(string(direct, `${label} thread id`))
  const thread = object(params.thread, `${label} thread`)
  return CodexThreadId(string(thread.id, `${label} thread id`))
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`subagent-codex: app-server returned invalid ${label}`)
  }
  return value
}

function boundedTag(value: unknown, label: string, limit = 128): string {
  const result = string(value, label)
  if (result.length > limit) throw new Error(`subagent-codex: app-server returned an oversized ${label}`)
  return result
}

function terminalTurnStatus(value: unknown): CodexTurnStatus {
  if (value === 'completed' || value === 'interrupted' || value === 'failed') return value
  throw new Error(`subagent-codex: app-server returned invalid terminal turn status ${String(value)}`)
}

function summaryTurnStatus(value: unknown): CodexTurnSummary['status'] {
  if (value === 'completed' || value === 'interrupted' || value === 'failed') return value
  if (value === 'inProgress' || value === 'in-progress' || value === 'running') return 'in-progress'
  return 'unknown'
}

function turnInput(texts: readonly string[]): readonly JsonObject[] {
  if (texts.length === 0) throw new Error('subagent-codex: durable turn requires text input')
  return texts.map(text => ({ type: 'text', text, text_elements: [] }))
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  return boundedTag(value, label)
}

function approvalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const compact = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim()
  return compact.length > 0 && compact.length <= 256 ? compact : undefined
}

function approvalCommand(value: unknown): string | undefined {
  const command = approvalText(value)
  if (command === undefined) return undefined
  return command
    .replace(/(--?(?:api[-_]?key|token|secret|password|authorization)(?:=|\s+))(?:"[^"]*"|'[^']*'|\S+)/giu, '$1[REDACTED]')
    .replace(/(\b(?:bearer|basic)\s+)(\S+)/giu, '$1[REDACTED]')
    .replace(/(\b[A-Z][A-Z0-9_-]*(?:KEY|TOKEN|SECRET|PASSWORD|AUTH)[A-Z0-9_-]*\s*=\s*)([^\s]+)/gu, '$1[REDACTED]')
}

function approvalPath(value: unknown): string | undefined {
  return approvalText(value)
}

function outputFromItems(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  let final: string | undefined
  let unphased: string | undefined
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const item = raw as JsonObject
    if (item.type !== 'agentMessage' && item.type !== 'agent_message') continue
    if (typeof item.text !== 'string') continue
    if (item.phase === 'final_answer') final = item.text
    else if (item.phase === null || item.phase === undefined) unphased = item.text
  }
  return final ?? unphased
}

function threadStatus(turns: readonly CodexTurnSummary[]): CodexThreadStatus {
  if (turns.some(turn => turn.status === 'in-progress')) return 'running'
  if (turns.length > 0) return 'idle'
  return 'unknown'
}

function unattendedDecision(params: JsonObject): 'cancel' | 'decline' {
  const available = params.availableDecisions
  if (available === undefined || available === null) return 'decline'
  if (Array.isArray(available)) {
    if (available.includes('cancel')) return 'cancel'
    if (available.includes('decline')) return 'decline'
  }
  throw new Error('subagent-codex: app-server offered no unattended approval decision')
}

function numericHttpStatus(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= 65_535
    ? value
    : undefined
}

function objectFailureInfo(value: JsonObject): {
  readonly category: string
  readonly httpStatus?: number | undefined
} {
  const keys = Object.keys(value)
  const category = keys[0]
  if (keys.length !== 1 || category === undefined) {
    return { category: 'unknown' }
  }
  const detail = value[category]
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) {
    return { category: 'unknown' }
  }
  const fields = detail as JsonObject
  switch (category) {
    case 'httpConnectionFailed':
    case 'responseStreamConnectionFailed':
    case 'responseStreamDisconnected':
    case 'responseTooManyFailedAttempts':
    {
      const httpStatus = numericHttpStatus(fields.httpStatusCode)
      return httpStatus === undefined
        ? { category }
        : { category, httpStatus }
    }
    case 'activeTurnNotSteerable':
      return { category }
    default:
      return { category: 'unknown' }
  }
}

function failureInfo(turn: JsonObject): {
  readonly category: string
  readonly httpStatus?: number | undefined
} {
  if (turn.status !== 'failed') return { category: 'unknown' }
  const error = turn.error
  if (error === null || typeof error !== 'object' || Array.isArray(error)) {
    return { category: 'unknown' }
  }
  const info = (error as JsonObject).codexErrorInfo
  if (typeof info === 'string') {
    switch (info) {
      case 'contextWindowExceeded':
      case 'sessionBudgetExceeded':
      case 'usageLimitExceeded':
      case 'serverOverloaded':
      case 'cyberPolicy':
      case 'internalServerError':
      case 'unauthorized':
      case 'badRequest':
      case 'threadRollbackFailed':
      case 'sandboxError':
      case 'other':
        return { category: info }
      default:
        return { category: 'unknown' }
    }
  }
  return info !== null && typeof info === 'object' && !Array.isArray(info)
    ? objectFailureInfo(info as JsonObject)
    : { category: 'unknown' }
}

function unattendedDiagnostic(
  mode: CodexPermissionMode,
  request: 'command approval' | 'file approval' | 'permission grant' | 'user input' | 'MCP elicitation' | 'command execution' | 'file change' | 'sandbox execution',
  decision: 'cancelled' | 'declined' | 'denied' | 'empty response' | 'failed',
  reason: string,
): string {
  return `Codex unattended decision (mode: ${mode}; request: ${request}; decision: ${decision}): ${reason}`
}

function thrown(value: unknown): Error {
  /* v8 ignore next -- typed protocol and stream failures reject with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(`subagent-codex: app-server request aborted: ${String(signal.reason)}`)
}

async function raceAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void pending.catch(() => {})
    throw abortError(signal)
  }
  let rejectAbort!: (error: Error) => void
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const onAbort = (): void => { rejectAbort(abortError(signal)) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([pending, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * One app-server connection and its single ephemeral thread/turn.
 *
 * The class deliberately exposes no generic request surface. Supporting
 * another product method must first become part of the provider contract.
 */
export class CodexAppServerWire {
  private readonly transport: JsonRpcLineTransport
  private readonly fatal = Promise.withResolvers<never>()
  private readonly durableTurns = new Map<string, PromiseWithResolvers<CodexTurnCompletion>>()
  private durablePendingCompletion: PromiseWithResolvers<CodexTurnCompletion> | undefined
  private durablePendingTurnId: CodexTurnId | undefined
  private durableEarlyCompletion: CodexTurnCompletion | undefined
  private readonly durableOutputs = new Map<string, string | undefined>()
  private readonly durableCompleted = new Map<string, CodexTurnCompletion>()
  private durableThread = false
  private activeSignal: AbortSignal | undefined
  private threadId: string | undefined
  private turnId: string | undefined
  private pendingTurnId: string | undefined
  private turnCompleted: PromiseWithResolvers<{
    readonly params: JsonObject
    readonly order: number
  }> | undefined
  private readonly earlyTurnNotifications: Array<{
    readonly method: string
    readonly params: JsonObject
    readonly order: number
  }> = []
  private lastFinalAnswer: string | undefined
  private lastUnphasedAnswer: string | undefined
  private diagnostic: string | undefined
  private failure: CodexWireFailureFacts | undefined
  private diagnosticOrder = 0
  private observationOrder = 0
  private pendingDiagnostic: {
    readonly order: number
    readonly request: Parameters<typeof unattendedDiagnostic>[1]
    readonly decision: Parameters<typeof unattendedDiagnostic>[2]
    readonly reason: string
  } | undefined
  private stderrTail = ''
  private inputEnded = false
  private terminalObserved = false
  private closed = false

  constructor(
    private readonly input: Readable,
    output: Writable,
    private readonly permissionMode: CodexPermissionMode,
    private readonly onRateLimitsUpdated?: (rateLimits: unknown) => void,
    private readonly durableOptions: CodexWireOptions = {},
  ) {
    this.transport = new JsonRpcLineTransport(input, output)
    // Fatal protocol state can arrive after the current guarded operation has
    // already settled. Keep the shared rejection observed without inserting
    // another promise-adoption hop into active races.
    void this.fatal.promise.catch(() => {})
    this.transport.onRequest((method, params) => this.handleServerRequest(method, params))
    this.transport.onNotification((method, params) => {
      try {
        this.handleNotification(method, params)
      } catch (error: unknown) {
        this.fail(thrown(error))
      }
    })
    this.input.on('error', this.onInputError)
    this.input.on('end', this.onInputEnd)
    // Pipe errors can race protocol closure and process teardown. Retain both
    // error listeners for the lifetime of their per-run streams so no late
    // EPIPE or read failure becomes an unhandled EventEmitter error.
    output.on('error', this.onOutputError)
  }

  /** Start reading app-server frames. */
  start(): void {
    this.transport.start()
  }

  /**
   * Whether protocol output ended before a terminal turn notification.
   * @returns `true` only for an early protocol close without a terminal turn.
   */
  endedBeforeTerminal(): boolean {
    return this.inputEnded && !this.terminalObserved
  }

  /**
   * Perform the required app-server initialize/initialized handshake.
   * @param signal - unpublished-start cancellation.
   */
  async initialize(signal: AbortSignal): Promise<void> {
    object(await this.guarded(this.transport.request('initialize', {
      clientInfo: {
        name: 'deepseek-harness',
        title: 'PHOENIX',
        version: '0.0.1',
      },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
      },
    }, signal), signal), 'initialize response')
    this.transport.notify('initialized')
    await this.guarded(this.transport.flush(), signal)
  }

  /**
   * Create the run's private ephemeral thread and retain its identity.
   * @param cwd - parent Session workspace.
   * @param signal - unpublished-start cancellation.
   */
  async startThread(cwd: string, signal: AbortSignal): Promise<void> {
    const response = object(await this.guarded(this.transport.request('thread/start', {
      cwd,
      ephemeral: true,
      ...THREAD_PERMISSION_PARAMS[this.permissionMode],
    }, signal), signal), 'thread/start response')
    const thread = object(response.thread, 'thread/start thread')
    const id = string(thread.id, 'thread/start thread id')
    if (thread.ephemeral !== true) {
      throw new Error('subagent-codex: app-server did not create an ephemeral thread')
    }
    this.threadId = id
  }

  /**
   * Start a persistent native thread. This is deliberately separate from
   * {@link startThread}, whose ephemeral behavior is part of the one-shot
   * provider contract.
   * @param cwd - workspace supplied by the owning Phoenix execution.
   * @param signal - operation cancellation during native startup.
   * @param options - Frozen native model, workspace, sandbox and approval restrictions.
   * @returns The acknowledged persistent native thread binding.
   */
  async startDurableThread(
    cwd: string,
    signal: AbortSignal,
    options: CodexDurableThreadOptions = {},
  ): Promise<CodexDurableThread> {
    const response = object(await this.guarded(this.transport.request('thread/start', {
      cwd,
      ephemeral: false,
      ...options.model === undefined ? {} : { model: options.model },
      ...THREAD_PERMISSION_PARAMS[this.permissionMode],
      sandbox: options.sandbox ?? 'read-only',
    }, signal), signal), 'thread/start response')
    const thread = object(response.thread, 'thread/start thread')
    const id = CodexThreadId(string(thread.id, 'thread/start thread id'))
    if (thread.ephemeral !== false) {
      throw new Error('subagent-codex: app-server did not acknowledge a durable thread')
    }
    this.durableThread = true
    this.threadId = id
    this.turnId = undefined
    this.emitDurableEvent({ kind: 'thread', phase: 'started', threadId: id })
    await this.checkpoint({ phase: 'thread-acknowledged', threadId: id })
    return { id, ephemeral: false }
  }

  /**
   * Reattach this wire to an existing persistent native thread.
   * @param threadId - persisted native thread identity.
   * @param signal - operation cancellation during native recovery.
   * @param options - Original native model, workspace, sandbox and approval restrictions.
   * @returns The acknowledged persistent native thread binding.
   */
  async resumeThread(
    threadId: CodexThreadId | string,
    signal: AbortSignal,
    options: CodexDurableThreadOptions = {},
  ): Promise<CodexDurableThread> {
    const id = CodexThreadId(String(threadId))
    const response = object(await this.guarded(this.transport.request('thread/resume', {
      threadId: id,
      ...options.cwd === undefined ? {} : { cwd: options.cwd },
      ...options.model === undefined ? {} : { model: options.model },
      ...THREAD_PERMISSION_PARAMS[this.permissionMode],
      sandbox: options.sandbox ?? 'read-only',
    }, signal), signal), 'thread/resume response')
    const thread = object(response.thread, 'thread/resume thread')
    const resumed = CodexThreadId(string(thread.id, 'thread/resume thread id'))
    if (resumed !== id || thread.ephemeral !== false) {
      throw new Error('subagent-codex: app-server did not acknowledge the requested durable thread')
    }
    if (options.cwd !== undefined && response.cwd !== undefined && response.cwd !== options.cwd) {
      throw new Error('subagent-codex: resumed thread workspace does not match the execution scope')
    }
    if (options.model !== undefined && response.model !== undefined && response.model !== options.model) {
      throw new Error('subagent-codex: resumed thread model does not match the execution scope')
    }
    this.durableThread = true
    this.threadId = resumed
    this.turnId = undefined
    this.emitDurableEvent({ kind: 'thread', phase: 'resumed', threadId: resumed })
    await this.checkpoint({ phase: 'thread-acknowledged', threadId: resumed })
    return { id: resumed, ephemeral: false }
  }

  /**
   * Read one persistent native thread without exposing raw protocol payloads.
   * @param threadId - native thread identity to inspect.
   * @param signal - operation cancellation.
   * @returns Bounded thread and turn status metadata.
   */
  async readThread(threadId: CodexThreadId | string, signal: AbortSignal): Promise<CodexThreadSnapshot> {
    const expected = CodexThreadId(String(threadId))
    const response = object(await this.guarded(this.transport.request('thread/read', {
      threadId: expected,
      includeTurns: true,
    }, signal), signal), 'thread/read response')
    const thread = object(response.thread, 'thread/read thread')
    const id = CodexThreadId(string(thread.id, 'thread/read thread id'))
    if (id !== expected) throw new Error('subagent-codex: thread/read returned another thread')
    const rawTurns = thread.turns
    if (rawTurns !== undefined && !Array.isArray(rawTurns)) {
      throw new Error('subagent-codex: thread/read returned invalid turns')
    }
    const turns: CodexTurnSummary[] = []
    for (const raw of (Array.isArray(rawTurns) ? rawTurns.slice(-128) : [])) {
      const turn = object(raw, 'thread/read turn')
      const output = outputFromItems(turn.items)
      turns.push({
        id: CodexTurnId(string(turn.id, 'thread/read turn id')),
        status: summaryTurnStatus(turn.status),
        ...(output === undefined ? {} : { output }),
      })
    }
    const cwd = optionalString(thread.cwd ?? response.cwd, 'thread/read cwd')
    const model = optionalString(thread.model ?? response.model, 'thread/read model')
    const snapshot: CodexThreadSnapshot = {
      id,
      status: threadStatus(turns),
      turns,
      ...(cwd === undefined ? {} : { cwd }),
      ...(model === undefined ? {} : { model }),
    }
    if (this.durableThread && this.threadId === id) {
      this.emitDurableEvent({ kind: 'thread', phase: 'status', threadId: id, status: snapshot.status })
    }
    return snapshot
  }

  /**
   * Reconcile a persisted binding by reading the same native thread.
   * @param threadId - native thread identity to reconcile.
   * @param signal - operation cancellation.
   * @returns The authoritative bounded native status view.
   */
  async reconcileThread(threadId: CodexThreadId | string, signal: AbortSignal): Promise<CodexThreadReconciliation> {
    return this.readThread(threadId, signal)
  }

  /**
   * Start one turn on a persistent thread and retain its acknowledged id.
   * @param texts - text input already authorized by Phoenix.
   * @param signal - operation cancellation and approval scope.
   * @param options - Turn reasoning, sandbox restrictions and optional deadline.
   * @returns A handle whose completion is the canonical native terminal status.
   */
  async startDurableTurn(
    texts: readonly string[],
    signal: AbortSignal,
    options: CodexDurableTurnOptions = {},
  ): Promise<CodexDurableTurn> {
    const threadId = this.requireDurableThread()
    await this.checkpoint({ phase: 'before-turn-start', threadId })
    const completion = Promise.withResolvers<CodexTurnCompletion>()
    this.durablePendingCompletion = completion
    this.durablePendingTurnId = undefined
    this.durableEarlyCompletion = undefined
    this.activeSignal = signal
    let id: CodexTurnId
    try {
      const response = object(await this.guarded(this.transport.request('turn/start', {
        threadId,
        input: turnInput(texts),
        ...options.model === undefined ? {} : { model: options.model },
        ...options.reasoningEffort === undefined ? {} : { effort: options.reasoningEffort },
      }, signal), signal), 'turn/start response')
      const turn = object(response.turn, 'turn/start turn')
      id = CodexTurnId(string(turn.id, 'turn/start turn id'))
      if (this.durablePendingTurnId !== undefined && this.durablePendingTurnId !== id) {
        throw new Error('subagent-codex: turn/start response did not match the acknowledged turn')
      }
    } finally {
      this.durablePendingCompletion = undefined
    }
    this.durableTurns.set(id, completion)
    this.threadId = threadId
    this.turnId = id
    this.emitDurableEvent({ kind: 'turn', phase: 'started', threadId, turnId: id })
    await this.checkpoint({ phase: 'turn-acknowledged', threadId, turnId: id })
    if (this.durableEarlyCompletion !== undefined) {
      completion.resolve(this.durableEarlyCompletion)
      this.durableEarlyCompletion = undefined
    }
    return {
      id,
      completion: this.waitForDurableTurn(id, signal),
    }
  }

  /**
   * Await one already acknowledged durable turn without treating narration as
   * completion evidence.
   * @param turnId - acknowledged native turn identity.
   * @param signal - operation cancellation.
   * @returns The canonical native terminal status.
   */
  waitForDurableTurn(turnId: CodexTurnId | string, signal: AbortSignal): Promise<CodexTurnCompletion> {
    const id = CodexTurnId(String(turnId))
    this.activeSignal = signal
    const completed = this.durableCompleted.get(id)
    if (completed !== undefined) return this.guarded(Promise.resolve(completed), signal)
    let completion = this.durableTurns.get(id)
    if (completion === undefined) {
      completion = Promise.withResolvers<CodexTurnCompletion>()
      this.durableTurns.set(id, completion)
    }
    const waiting = this.guarded(completion.promise, signal)
    // The descriptor may be held for steering before its completion is awaited.
    // Observe lifecycle rejection without changing what an awaiting caller sees.
    void waiting.catch(() => {})
    return waiting
  }

  /**
   * Steer the active durable turn after checkpointing its exact native ids.
   * @param turnId - active native turn identity.
   * @param texts - text input already authorized by Phoenix.
   * @param signal - operation cancellation.
   * @returns The native turn identity acknowledged by the steer response.
   */
  async steerTurn(turnId: CodexTurnId | string, texts: readonly string[], signal: AbortSignal): Promise<CodexTurnId> {
    const threadId = this.requireDurableThread()
    const id = CodexTurnId(String(turnId))
    if (this.turnId !== id) throw new Error('subagent-codex: steer referenced another active turn')
    await this.checkpoint({ phase: 'before-steer', threadId, turnId: id })
    const response = object(await this.guarded(this.transport.request('turn/steer', {
      threadId,
      expectedTurnId: id,
      input: turnInput(texts),
    }, signal), signal), 'turn/steer response')
    const acknowledged = response.turnId === undefined
      ? id
      : CodexTurnId(string(response.turnId, 'turn/steer turn id'))
    if (acknowledged !== id) throw new Error('subagent-codex: turn/steer acknowledged another turn')
    return acknowledged
  }

  /**
   * Submit the one text-only task and wait for this thread/turn's authoritative
   * terminal notification.
   * @param texts - already validated task text blocks.
   * @param signal - local cancellation for the published run.
   * @returns the shared subagent result.
   */
  async runTurn(
    texts: readonly string[],
    signal: AbortSignal,
  ): Promise<SubagentResult> {
    const completion = Promise.withResolvers<{
      readonly params: JsonObject
      readonly order: number
    }>()
    this.turnCompleted = completion
    const threadId = this.threadId as string
    try {
      const response = object(await this.guarded(this.transport.request('turn/start', {
        threadId,
        input: texts.map(text => ({ type: 'text', text, text_elements: [] })),
      }, signal), signal), 'turn/start response')
      const turn = object(response.turn, 'turn/start turn')
      this.commitTurnId(string(turn.id, 'turn/start turn id'))
    } catch (error: unknown) {
      this.recordFailure({ stage: 'turn-start', category: 'unknown' })
      throw error
    }

    let completed: {
      readonly params: JsonObject
      readonly order: number
    }
    let terminal: JsonObject
    try {
      completed = await this.guarded(completion.promise, signal)
      terminal = object(completed.params.turn, 'turn/completed turn')
    } catch (error: unknown) {
      this.recordFailure({ stage: 'turn', category: 'unknown' })
      throw error
    }
    const status = terminal.status
    if (status !== 'completed') {
      const parsed = failureInfo(terminal)
      this.recordFailure(parsed.httpStatus === undefined
        ? { stage: 'turn', category: parsed.category }
        : {
          stage: 'turn',
          category: parsed.category,
          httpStatus: parsed.httpStatus,
        })
      if (parsed.category === 'sandboxError') {
        this.recordDiagnostic(
          'sandbox execution',
          'failed',
          'Codex reported a sandbox failure',
          completed.order,
        )
      }
      if (parsed.category === 'contextWindowExceeded') {
        return { output: this.collectOutput(), stopReason: 'max-tokens' }
      }
      const detail = status === 'failed' ? `: ${parsed.category}` : ''
      throw new Error(`subagent-codex: Codex turn ended with status ${String(status)}${detail}`)
    }
    const output = this.collectOutput()
    if (output.length === 0) {
      this.recordFailure({ stage: 'turn', category: 'unknown' })
      throw new Error('subagent-codex: Codex completed without a final answer')
    }
    return { output, stopReason: 'completed' }
  }

  /**
   * Best-effort remote cancellation. Local settlement and process teardown
   * remain authoritative when the child no longer accepts protocol requests.
   */
  interrupt(): void {
    if (this.threadId === undefined || this.turnId === undefined || this.closed) return
    void this.transport.request('turn/interrupt', {
      threadId: this.threadId,
      turnId: this.turnId,
    }).catch(() => {})
  }

  /**
   * The best non-commentary answer observed so far, preserving exact bytes.
   * @returns the selected final or nullable-phase text block, if any.
   */
  collectOutput(): ContentBlock[] {
    const selected = this.lastFinalAnswer ?? this.lastUnphasedAnswer
    return selected !== undefined && selected.trim().length > 0
      ? [{ type: 'text', text: selected }]
      : []
  }

  /**
   * The latest safe unattended permission fact observed for this run.
   * @returns provider-authored diagnostic text, when one was observed.
   */
  collectDiagnostic(): string | undefined {
    return this.diagnostic
  }

  /**
   * The structured failure fact observed for this published turn.
   * Call only after a non-completed return or rejection from {@link runTurn}.
   * @returns the fixed stage/category pair and optional HTTP status.
   */
  collectFailure(): CodexWireFailureFacts {
    return this.failure as CodexWireFailureFacts
  }

  /**
   * Observe product stderr while retaining only enough tail to recognize fixed
   * permission signatures. The raw text is never copied into the diagnostic.
   * @param chunk - one decoded stderr chunk already forwarded to the host.
   */
  observeStderr(chunk: string): void {
    const observed = `${this.stderrTail}${chunk}`
    let latestIndex = -1
    let latest: (typeof STDERR_PERMISSION_SIGNATURES)[number] | undefined
    for (const signature of STDERR_PERMISSION_SIGNATURES) {
      const index = observed.lastIndexOf(signature.text)
      if (index > latestIndex) {
        latestIndex = index
        latest = signature
      }
    }
    if (latest !== undefined) {
      this.recordDiagnostic(latest.request, latest.decision, latest.reason)
    }
    this.stderrTail = stderrSignatureTail(observed)
  }

  /** Detach JSON-RPC listeners and reject outstanding requests. Idempotent. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.fail(new Error('subagent-codex: app-server wire closed'))
    this.input.off('end', this.onInputEnd)
    this.transport.close()
    this.durableTurns.clear()
    this.durableCompleted.clear()
    this.durableOutputs.clear()
    this.durablePendingCompletion = undefined
    this.durablePendingTurnId = undefined
    this.durableEarlyCompletion = undefined
  }

  private requireDurableThread(): CodexThreadId {
    if (!this.durableThread || this.threadId === undefined) {
      throw new Error('subagent-codex: no durable native thread is attached')
    }
    return CodexThreadId(this.threadId)
  }

  private async checkpoint(checkpoint: CodexWireCheckpoint): Promise<void> {
    await this.durableOptions.onCheckpoint?.(checkpoint)
  }

  private emitDurableEvent(event: CodexWireEvent): void {
    try {
      this.durableOptions.onEvent?.(event)
    } catch (error: unknown) {
      this.fail(thrown(error))
      throw error
    }
  }

  private async guarded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    const withFatal = Promise.race([this.fatal.promise, pending])
    return raceAbort(withFatal, signal)
  }

  private fail(error: Error): void {
    this.fatal.reject(error)
  }

  private readonly onInputError = (error: Error): void => {
    this.fail(error)
  }

  private readonly onOutputError = (error: Error): void => {
    this.fail(error)
  }

  private readonly onInputEnd = (): void => {
    this.inputEnded = true
    this.fail(new Error('subagent-codex: app-server protocol stream closed'))
  }

  private observePendingTurnId(id: string): void {
    if (this.turnCompleted === undefined) {
      throw new Error('subagent-codex: app-server referenced a turn before turn/start')
    }
    if (this.pendingTurnId !== undefined && this.pendingTurnId !== id) {
      throw new Error('subagent-codex: app-server referenced conflicting turns')
    }
    this.pendingTurnId = id
  }

  private commitTurnId(id: string): void {
    if (this.pendingTurnId !== undefined && this.pendingTurnId !== id) {
      throw new Error('subagent-codex: turn/start response did not match the active turn')
    }
    this.turnId = id
    const pendingDiagnostic = this.pendingDiagnostic
    this.pendingDiagnostic = undefined
    if (pendingDiagnostic !== undefined) {
      this.recordDiagnostic(
        pendingDiagnostic.request,
        pendingDiagnostic.decision,
        pendingDiagnostic.reason,
        pendingDiagnostic.order,
      )
    }
    const notifications = this.earlyTurnNotifications.splice(0)
    for (const notification of notifications) {
      this.handleNotification(
        notification.method,
        notification.params,
        notification.order,
      )
    }
  }

  /**
   * Validate the request's thread and turn association.
   * @returns `true` when the matching turn is still provisional, so the caller
   * defers its diagnostic until `commitTurnId()`.
   */
  private validateRunIds(
    params: JsonObject,
    nullableTurn = false,
  ): boolean {
    if (params.threadId !== this.threadId) {
      throw new Error('subagent-codex: app-server request referenced another thread')
    }
    if (nullableTurn && params.turnId === null) return false
    const id = string(params.turnId, 'server request turn id')
    if (this.turnId === undefined) {
      this.observePendingTurnId(id)
      return true
    }
    if (id !== this.turnId) {
      throw new Error('subagent-codex: app-server request referenced another turn')
    }
    return false
  }

  private recordRequestDiagnostic(
    provisional: boolean,
    request: Parameters<typeof unattendedDiagnostic>[1],
    decision: Parameters<typeof unattendedDiagnostic>[2],
    reason: string,
  ): void {
    const order = this.nextObservationOrder()
    if (provisional) {
      this.pendingDiagnostic = {
        order,
        request,
        decision,
        reason,
      }
      return
    }
    this.recordDiagnostic(request, decision, reason, order)
  }

  private recordDiagnostic(
    request: Parameters<typeof unattendedDiagnostic>[1],
    decision: Parameters<typeof unattendedDiagnostic>[2],
    reason: string,
    order = this.nextObservationOrder(),
  ): void {
    if (order < this.diagnosticOrder) return
    this.diagnosticOrder = order
    this.diagnostic = unattendedDiagnostic(
      this.permissionMode,
      request,
      decision,
      reason,
    )
  }

  private recordFailure(facts: CodexWireFailureFacts): void {
    this.failure = facts
  }

  private nextObservationOrder(): number {
    this.observationOrder += 1
    return this.observationOrder
  }

  private recordDeclinedItem(item: JsonObject, order?: number): boolean {
    if (item.type === 'commandExecution' && item.status === 'declined') {
      this.recordDiagnostic(
        'command execution',
        'declined',
        'Codex declined the command under the selected permission mode',
        order,
      )
      return true
    }
    if (item.type === 'fileChange' && item.status === 'declined') {
      this.recordDiagnostic(
        'file change',
        'declined',
        'Codex declined the file change under the selected permission mode',
        order,
      )
      return true
    }
    return false
  }

  private async handleServerRequest(method: string, params: JsonObject): Promise<unknown> {
    try {
      switch (method) {
        case 'item/commandExecution/requestApproval':
          return await this.handleApprovalRequest('command', params)
        case 'item/fileChange/requestApproval':
          return await this.handleApprovalRequest('file-change', params)
        case 'item/permissions/requestApproval':
          this.recordRequestDiagnostic(
            this.validateRunIds(params),
            'permission grant',
            'denied',
            'the provider grants no additional turn permissions',
          )
          return { permissions: {}, scope: 'turn' }
        case 'item/tool/requestUserInput':
          this.recordRequestDiagnostic(
            this.validateRunIds(params),
            'user input',
            'empty response',
            'the provider does not collect interactive answers',
          )
          return { answers: {} }
        case 'mcpServer/elicitation/request':
          this.recordRequestDiagnostic(
            this.validateRunIds(params, true),
            'MCP elicitation',
            'declined',
            'the provider does not collect interactive MCP input',
          )
          return { action: 'decline', content: null, _meta: null }
        default:
          throw new Error(`subagent-codex: unsupported app-server request ${JSON.stringify(method)}`)
      }
    } catch (error: unknown) {
      const normalized = thrown(error)
      this.fail(normalized)
      throw normalized
    }
  }

  private async handleApprovalRequest(
    kind: CodexApprovalRequest['kind'],
    params: JsonObject,
  ): Promise<JsonObject> {
    const provisional = this.validateRunIds(params)
    const decision = await this.resolveApproval(kind, params)
    this.recordRequestDiagnostic(
      provisional,
      kind === 'command' ? 'command approval' : 'file approval',
      decision === 'cancel' ? 'cancelled' : decision === 'decline' ? 'declined' : 'denied',
      this.durableOptions.onApproval === undefined
        ? 'the provider does not grant interactive approval'
        : 'the approval broker returned a scoped decision',
    )
    return { decision }
  }

  private async resolveApproval(
    kind: CodexApprovalRequest['kind'],
    params: JsonObject,
  ): Promise<CodexApprovalDecision> {
    const threadId = CodexThreadId(string(params.threadId, 'approval thread id'))
    const turnId = CodexTurnId(string(params.turnId, 'approval turn id'))
    const available = Array.isArray(params.availableDecisions)
      ? params.availableDecisions.filter((value): value is string => typeof value === 'string')
      : []
    const command = approvalCommand(params.command)
    const path = approvalPath(params.path ?? params.grantRoot ?? params.cwd)
    const request: CodexApprovalRequest = {
      kind,
      threadId,
      turnId,
      availableDecisions: available,
      ...(command === undefined ? {} : { command }),
      ...(path === undefined ? {} : { path }),
    }
    if (this.durableThread) {
      this.emitDurableEvent({ kind: 'approval', phase: 'requested', request: kind, threadId, turnId })
    }
    const fallback = (): CodexApprovalDecision => {
      if (this.durableThread) {
        if (available.includes('decline')) return 'decline'
        if (available.includes('cancel')) return 'cancel'
      }
      return unattendedDecision(params)
    }
    const handler = this.durableThread ? this.durableOptions.onApproval : undefined
    if (handler === undefined) {
      const decision = fallback()
      if (this.durableThread) {
        this.emitDurableEvent({ kind: 'approval', phase: 'decided', request: kind, threadId, turnId, decision })
      }
      return decision
    }
    const signal = this.activeSignal ?? AbortSignal.abort(new Error('subagent-codex: no active durable turn'))
    let decision: CodexApprovalDecision
    try {
      decision = await handler(request, signal)
    } catch (error: unknown) {
      if (!signal.aborted) throw error
      decision = fallback()
    }
    if (signal.aborted) decision = fallback()
    if (!available.includes(decision)) {
      throw new Error('subagent-codex: approval callback returned a decision not offered for this request')
    }
    this.emitDurableEvent({ kind: 'approval', phase: 'decided', request: kind, threadId, turnId, decision })
    return decision
  }

  private handleNotification(
    method: string,
    params: JsonObject,
    order?: number,
  ): void {
    if (method === 'account/rateLimits/updated') {
      // Optional account telemetry must never make a successful turn fail.
      this.onRateLimitsUpdated?.(params.rateLimits)
      if (this.durableThread) this.emitDurableEvent({ kind: 'rate-limit', phase: 'updated' })
      return
    }
    if (this.durableThread) {
      this.handleDurableNotification(method, params)
      return
    }
    if (method === 'turn/started') {
      const threadId = string(params.threadId, 'turn/started thread id')
      if (threadId !== this.threadId) return
      const turn = object(params.turn, 'turn/started turn')
      if (this.turnCompleted !== undefined && this.turnId === undefined) {
        this.observePendingTurnId(string(turn.id, 'turn/started turn id'))
      }
      return
    }
    if (method === 'item/completed') {
      const threadId = string(params.threadId, 'item/completed thread id')
      if (threadId !== this.threadId) return
      const id = string(params.turnId, 'item/completed turn id')
      if (this.turnId === undefined) {
        if (this.turnCompleted !== undefined) {
          this.observePendingTurnId(id)
          this.earlyTurnNotifications.push({
            method,
            params,
            order: this.nextObservationOrder(),
          })
        }
        return
      }
      if (id !== this.turnId) return
      const item = object(params.item, 'item/completed item')
      if (this.recordDeclinedItem(item, order)) return
      if (item.type !== 'agentMessage') return
      const text = typeof item.text === 'string'
        ? item.text
        : (() => { throw new Error('subagent-codex: app-server returned an invalid agent message') })()
      if (item.phase === 'final_answer') {
        this.lastFinalAnswer = text
      } else if (item.phase === null) {
        this.lastUnphasedAnswer = text
      } else if (item.phase !== 'commentary') {
        throw new Error(`subagent-codex: app-server returned an unknown agent message phase ${JSON.stringify(item.phase)}`)
      }
      return
    }
    if (method !== 'turn/completed') return
    const threadId = string(params.threadId, 'turn/completed thread id')
    if (threadId !== this.threadId) return
    const turn = object(params.turn, 'turn/completed turn')
    const id = string(turn.id, 'turn/completed turn id')
    const turnCompleted = this.turnCompleted
    if (turnCompleted === undefined) return
    if (this.turnId === undefined) {
      this.observePendingTurnId(id)
      this.earlyTurnNotifications.push({
        method,
        params,
        order: this.nextObservationOrder(),
      })
      return
    }
    if (id !== this.turnId) return
    this.terminalObserved = true
    if (!['completed', 'interrupted', 'failed'].includes(String(turn.status))) {
      throw new Error(`subagent-codex: app-server returned invalid terminal turn status ${String(turn.status)}`)
    }
    turnCompleted.resolve({
      params,
      order: order ?? this.nextObservationOrder(),
    })
  }

  private handleDurableNotification(method: string, params: JsonObject): void {
    if (method === 'thread/started') {
      const threadId = notificationThreadId(params, 'thread/started')
      if (threadId !== this.threadId) return
      this.emitDurableEvent({ kind: 'thread', phase: 'started', threadId })
      return
    }
    if (method === 'turn/started') {
      const threadId = CodexThreadId(string(params.threadId, 'turn/started thread id'))
      if (threadId !== this.threadId) return
      const turn = object(params.turn, 'turn/started turn')
      const turnId = CodexTurnId(string(turn.id, 'turn/started turn id'))
      if (this.durablePendingTurnId !== undefined && this.durablePendingTurnId !== turnId) {
        throw new Error('subagent-codex: turn/started referenced another pending turn')
      }
      this.durablePendingTurnId = turnId
      this.emitDurableEvent({ kind: 'turn', phase: 'started', threadId, turnId })
      return
    }
    if (method === 'item/started' || method === 'item/completed') {
      const threadId = CodexThreadId(string(params.threadId, `${method} thread id`))
      if (threadId !== this.threadId) return
      const turnId = CodexTurnId(string(params.turnId, `${method} turn id`))
      const item = object(params.item, `${method} item`)
      const itemId = item.id === undefined ? undefined : boundedTag(item.id, `${method} item id`, 256)
      const itemType = boundedTag(item.type, `${method} item type`)
      if (method === 'item/completed' && (item.type === 'agentMessage' || item.type === 'agent_message')) {
        if (typeof item.text === 'string') {
          const current = this.durableOutputs.get(turnId)
          const phase = item.phase
          if (phase === 'final_answer' || (phase === null && current === undefined)) {
            this.durableOutputs.set(turnId, item.text)
          }
        }
      }
      this.emitDurableEvent({
        kind: 'item',
        phase: method === 'item/started' ? 'started' : 'completed',
        threadId,
        turnId,
        ...itemId === undefined ? {} : { itemId },
        itemType,
      })
      return
    }
    if (method !== 'turn/completed') return
    const threadId = CodexThreadId(string(params.threadId, 'turn/completed thread id'))
    if (threadId !== this.threadId) return
    const turn = object(params.turn, 'turn/completed turn')
    const turnId = CodexTurnId(string(turn.id, 'turn/completed turn id'))
    const output = this.durableOutputs.get(turnId)
    const completion: CodexTurnCompletion = {
      id: turnId,
      status: terminalTurnStatus(turn.status),
      ...(output === undefined ? {} : { output }),
    }
    this.emitDurableEvent({
      kind: 'turn',
      phase: 'completed',
      threadId,
      turnId,
      status: completion.status,
    })
    if (this.durablePendingCompletion !== undefined) {
      if (this.durablePendingTurnId !== undefined && this.durablePendingTurnId !== turnId) {
        throw new Error('subagent-codex: turn/completed referenced another pending turn')
      }
      this.durablePendingTurnId = turnId
      this.durableEarlyCompletion = completion
      return
    }
    const pending = this.durableTurns.get(turnId)
    if (pending !== undefined) pending.resolve(completion)
    else this.durableCompleted.set(turnId, completion)
  }
}
