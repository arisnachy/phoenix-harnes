/** Durable Phoenix Agent Teams adapter over the public OpenClaw Gateway RPCs. */

import { resolve } from 'node:path'
import type { Context } from '@phoenix-ai/cordis'
import type { CredentialProvider } from '@phoenix-ai/dsh-credentials'
import { credentialRef } from '@phoenix-ai/dsh-credentials'
import type {
  ExecutionAdapter,
  ExecutionCapability,
  ExecutionContext,
  ExecutionEngineStatus,
  ExecutionOutcome,
  ExecutionProgress,
  ExecutionNativePolicy,
  ExecutionNativePolicyRequest,
  ExecutionToolPolicy,
} from '@phoenix-ai/dsh-agent-team'
import {
  OpenClawGatewayClient,
  type OpenClawGatewayClientOptions,
  type OpenClawModelRoute,
  type OpenClawNativePolicyAttestation,
  type OpenClawOperatorScope,
  type OpenClawPolicyAttester,
  type OpenClawSocket,
} from './index.ts'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_FRAME_BYTES = 1_048_576
const MAX_TIMEOUT_MS = 10 * 60_000
const MAX_FRAME_BYTES = 8 * 1024 * 1024
const WAIT_SLICE_MS = 1_000
const MAX_NATIVE_OUTPUT_BYTES = 64 * 1024
const PROBE_CAPABILITIES: readonly ExecutionCapability[] = ['conversation']
const DEFAULT_SCOPES: readonly OpenClawOperatorScope[] = ['operator.read', 'operator.write']

const NOT_CONFIGURED = 'OPENCLAW_NOT_CONFIGURED'
const ROUTE_UNVERIFIED = 'OPENCLAW_NATIVE_ROUTE_UNVERIFIED'
const MISSING_BINDING = 'OPENCLAW_MISSING_NATIVE_BINDING'
const NATIVE_UNCERTAIN = 'OPENCLAW_NATIVE_RUN_UNCERTAIN'
const NATIVE_FAILED = 'OPENCLAW_NATIVE_RUN_FAILED'
const NATIVE_CANCELLED = 'OPENCLAW_NATIVE_RUN_CANCELLED'
const NATIVE_TIMEOUT = 'OPENCLAW_NATIVE_RUN_TIMEOUT'
const POLICY_UNVERIFIED = 'OPENCLAW_EXECUTION_POLICY_UNVERIFIED'
const PHOENIX_CODEX_PROVIDER = 'openai-codex'
const NATIVE_CODEX_RUNTIME = 'codex'
const NATIVE_PROVIDER = 'openai'

type RecordValue = Record<string, unknown>

/** Deployment-owned OpenClaw Gateway execution settings. */
export interface OpenClawExecutionAdapterConfig {
  /** Explicit loopback-first Gateway endpoint. */
  readonly url?: string
  /** Host-owned credential reference; the value is resolved per operation. */
  readonly tokenRef?: string
  /** Explicit configured OpenClaw agent id. */
  readonly agentId?: string
  /** Optional exact existing native session key. */
  readonly sessionKey?: string
  /** Exact provider/model route configured on the native agent. */
  readonly provider?: string
  readonly model?: string
  /** Explicit native runtime and effective execution restrictions. */
  readonly agentRuntime?: string
  readonly sandbox?: string
  readonly approval?: string
  readonly cwd?: string
  /** Effective host-resolved tool policy, including its profile fingerprint. */
  readonly toolPolicy?: ExecutionToolPolicy
  /** Host-owned effective-policy proof; no model input or credentials are supplied. */
  readonly policyResolver?: (request: ExecutionNativePolicyRequest) => Promise<ExecutionNativePolicy | undefined>
  readonly policyAttester?: OpenClawPolicyAttester
  /** Requested public operator scopes; admin scopes are rejected. */
  readonly scopes?: readonly OpenClawOperatorScope[]
  readonly timeoutMs?: number
  readonly maxFrameBytes?: number
  /** Host-specific WebSocket seam, useful for a local real Gateway test. */
  readonly socketFactory?: (url: string) => OpenClawSocket
  /** Factory seam preserving the public client contract. */
  readonly clientFactory?: (options: OpenClawGatewayClientOptions) => OpenClawGatewayClient
}

interface ResolvedConfig {
  readonly url?: string
  readonly tokenRef?: string
  readonly agentId?: string
  readonly sessionKey?: string
  readonly route?: OpenClawModelRoute
  readonly policy?: ExecutionNativePolicy
  readonly policyResolver?: (request: ExecutionNativePolicyRequest) => Promise<ExecutionNativePolicy | undefined>
  readonly policyAttester?: OpenClawPolicyAttester
  readonly scopes: readonly OpenClawOperatorScope[]
  readonly timeoutMs: number
  readonly maxFrameBytes: number
  readonly socketFactory?: (url: string) => OpenClawSocket
  readonly clientFactory?: (options: OpenClawGatewayClientOptions) => OpenClawGatewayClient
}

interface NativeRoute {
  readonly provider: string
  readonly model: string
}

interface NativeBinding {
  readonly sessionKey: string
  readonly runId: string
}

interface NativeWait {
  readonly status: 'ok' | 'pending' | 'timeout' | 'error'
  readonly stopReason?: string
  readonly error?: string
}

interface NativeInspection {
  readonly binding: NativeBinding
  readonly route: NativeRoute
  readonly policy: ExecutionNativePolicy
}

interface NativeInspectionFailure {
  readonly errorCode: string
}

type NativeInspectionResult = NativeInspection | NativeInspectionFailure

interface NativeOutputCollector {
  readonly dispose: () => void
  readonly output: () => string | undefined
  readonly overflowed: () => boolean
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function textChunk(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function normalizeToolPolicy(value: ExecutionToolPolicy | undefined): ExecutionToolPolicy | undefined {
  if (value === undefined) return undefined
  const profile = stringValue(value.profile)
  const profileHash = stringValue(value.profileHash)
  const allow = value.allow.map(item => item.trim())
  const deny = value.deny.map(item => item.trim())
  if (profile === undefined
    || profileHash === undefined
    || allow.some(item => item.length === 0)
    || deny.some(item => item.length === 0)) return undefined
  return {
    profile,
    allow: [...new Set(allow)].sort((left, right) => left.localeCompare(right)),
    deny: [...new Set(deny)].sort((left, right) => left.localeCompare(right)),
    profileHash,
  }
}

function parseRoute(value: unknown, providerHint?: string): NativeRoute | undefined {
  if (typeof value === 'string') {
    const ref = value.trim()
    const slash = ref.indexOf('/')
    if (slash > 0 && slash < ref.length - 1) {
      return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) }
    }
    const model = stringValue(ref)
    const provider = stringValue(providerHint)
    return provider === undefined || model === undefined ? undefined : { provider, model }
  }
  if (!isRecord(value)) return undefined
  const nested = value.primary ?? value.effectiveModel ?? value.model
  const provider = stringValue(value.provider) ?? stringValue(value.modelProvider) ?? stringValue(value.providerOverride) ?? providerHint
  const direct = parseRoute(nested, provider)
  if (direct !== undefined) return direct
  const model = stringValue(value.model)
  return provider === undefined || model === undefined ? undefined : { provider, model }
}

function exactRoute(value: unknown, expected: NativeRoute): boolean {
  const actual = parseRoute(value)
  return actual?.provider === expected.provider && actual.model === expected.model
}

function runtimeId(value: unknown): string | undefined {
  if (isRecord(value)) {
    const nested = value.agentRuntime
    return isRecord(nested) ? stringValue(nested.id) : stringValue(nested)
  }
  return undefined
}

function exactRuntime(value: unknown, expected: string): boolean {
  return runtimeId(value) === expected
}

function policyEquals(left: ExecutionNativePolicy | undefined, right: ExecutionNativePolicy | undefined): boolean {
  return left !== undefined && right !== undefined
    && left.provider === right.provider
    && left.model === right.model
    && left.agentRuntime === right.agentRuntime
    && left.sandbox === right.sandbox
    && left.approval === right.approval
    && left.cwd === right.cwd
    && left.toolPolicy.profile === right.toolPolicy.profile
    && left.toolPolicy.profileHash === right.toolPolicy.profileHash
    && left.toolPolicy.allow.join('\u0000') === right.toolPolicy.allow.join('\u0000')
    && left.toolPolicy.deny.join('\u0000') === right.toolPolicy.deny.join('\u0000')
}

function attestationMatches(
  attestation: OpenClawNativePolicyAttestation | undefined,
  expected: ExecutionNativePolicy,
  agentId: string,
  sessionKey?: string,
  taskIdempotencyKey?: string,
): boolean {
  if (attestation === undefined
    || attestation.agentId !== agentId
    || sessionKey !== undefined && attestation.sessionKey !== sessionKey
    || attestation.provider !== expected.provider
    || attestation.model !== expected.model
    || attestation.agentRuntime !== expected.agentRuntime
    || attestation.sandbox !== expected.sandbox
    || attestation.approval !== expected.approval
    || attestation.cwd !== expected.cwd
    || !policyEquals({ ...expected, toolPolicy: attestation.toolPolicy }, expected)) return false
  return taskIdempotencyKey === undefined || attestation.taskIdempotencyKey === taskIdempotencyKey
}

function listRecords(value: unknown, keys: readonly string[]): readonly RecordValue[] {
  if (Array.isArray(value)) return value.filter(isRecord)
  if (!isRecord(value)) return []
  for (const key of keys) {
    const candidate = value[key]
    if (Array.isArray(candidate)) return candidate.filter(isRecord)
  }
  return []
}

function outputForProgress(payload: unknown): ExecutionProgress | undefined {
  if (!isRecord(payload)) return undefined
  const runId = stringValue(payload.runId) ?? stringValue(payload.id)
  if (runId === undefined) return undefined
  const toolName = stringValue(payload.toolName) ?? stringValue(payload.tool)
  const phase = stringValue(payload.phase) ?? stringValue(payload.status)
  if (toolName !== undefined && (phase === 'started' || phase === 'running' || phase === 'start')) {
    return { kind: 'tool-started', nativeEventId: `openclaw:${runId}:tool:${toolName}:started`, toolName }
  }
  if (toolName !== undefined && (phase === 'completed' || phase === 'done' || phase === 'end')) {
    return { kind: 'tool-completed', nativeEventId: `openclaw:${runId}:tool:${toolName}:completed`, toolName }
  }
  if (phase === 'output' || payload.deltaText !== undefined || payload.message !== undefined) {
    return { kind: 'output', nativeEventId: `openclaw:${runId}:output:${String(payload.seq ?? phase ?? 'event')}` }
  }
  if (phase === 'reasoning' || phase === 'thinking') {
    return { kind: 'reasoning', nativeEventId: `openclaw:${runId}:reasoning:${String(payload.seq ?? phase)}` }
  }
  return undefined
}

function createNativeOutputCollector(client: OpenClawGatewayClient, binding: () => NativeBinding | undefined): NativeOutputCollector {
  let current = ''
  let overflowed = false
  const dispose = client.onEvent((event) => {
    if (overflowed || event.event !== 'agent' || !isRecord(event.payload)) return
    const active = binding()
    const runId = stringValue(event.payload.runId)
    if (active === undefined || active.runId.length === 0 || runId !== active.runId) return
    const data = isRecord(event.payload.data) ? event.payload.data : undefined
    const eventSessionKey = stringValue(event.payload.sessionKey) ?? stringValue(data?.sessionKey)
    if (eventSessionKey !== undefined && eventSessionKey !== active.sessionKey) return
    if (event.payload.stream !== 'assistant' || data === undefined) return
    const full = textChunk(data.text)
    const delta = textChunk(data.delta)
    if (full === undefined && delta === undefined) return
    const replace = data.replace === true
    const next = full ?? (replace ? (delta ?? '') : `${current}${delta ?? ''}`)
    if (Buffer.byteLength(next, 'utf8') > MAX_NATIVE_OUTPUT_BYTES) {
      overflowed = true
      return
    }
    current = next
  })
  return {
    dispose,
    output: () => current.trim().length === 0 ? undefined : current,
    overflowed: () => overflowed,
  }
}

function asWait(value: unknown): NativeWait | undefined {
  if (!isRecord(value)) return undefined
  const status = value.status
  if (status !== 'ok' && status !== 'pending' && status !== 'timeout' && status !== 'error') return undefined
  const stopReason = stringValue(value.stopReason)
  const error = stringValue(value.error)
  return { status, ...(stopReason === undefined ? {} : { stopReason }), ...(error === undefined ? {} : { error }) }
}

function boundedPositive(value: number | undefined, fallback: number, maximum: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback
}

function safeErrorCode(error: unknown): string {
  if (!isRecord(error)) return NATIVE_UNCERTAIN
  const code = stringValue(error.code) ?? (error instanceof Error ? stringValue(error.message) : undefined)
  return code === undefined || !/^OPENCLAW_[A-Z0-9_]+$/u.test(code) ? NATIVE_UNCERTAIN : code
}

function terminalOutcome(wait: NativeWait, output?: string): ExecutionOutcome | undefined {
  if (wait.status === 'pending' || wait.status === 'timeout') return undefined
  if (wait.status === 'error') return { status: 'failed', errorCode: NATIVE_FAILED }
  const stop = wait.stopReason?.toLowerCase()
  if (stop === 'aborted' || stop === 'cancelled' || stop === 'canceled') return { status: 'cancelled', errorCode: NATIVE_CANCELLED }
  if (stop === 'error' || stop === 'failed') return { status: 'failed', errorCode: NATIVE_FAILED }
  return output === undefined ? { status: 'completed' } : { status: 'completed', output }
}

/** Public Gateway adapter for the Phoenix durable execution registry. */
export class OpenClawExecutionAdapter implements ExecutionAdapter {
  readonly engine = 'openclaw' as const
  private readonly config: ResolvedConfig

  constructor(config: OpenClawExecutionAdapterConfig = {}, private readonly credentials?: CredentialProvider) {
    const provider = stringValue(config.provider)
    const model = stringValue(config.model)
    const url = stringValue(config.url)
    const tokenRef = stringValue(config.tokenRef)
    const agentId = stringValue(config.agentId)
    const sessionKey = stringValue(config.sessionKey)
    const agentRuntime = stringValue(config.agentRuntime)
    const sandbox = stringValue(config.sandbox)
    const approval = stringValue(config.approval)
    const cwd = stringValue(config.cwd)
    const toolPolicy = normalizeToolPolicy(config.toolPolicy)
    const scopes = [...(config.scopes ?? DEFAULT_SCOPES)]
    if (tokenRef !== undefined) credentialRef(tokenRef)
    if (scopes.some(scope => scope !== 'operator.read' && scope !== 'operator.write')) {
      throw new Error('OpenClaw adapter only permits operator.read and operator.write scopes')
    }
    this.config = {
      ...(url === undefined ? {} : { url }),
      ...(tokenRef === undefined ? {} : { tokenRef }),
      ...(agentId === undefined ? {} : { agentId }),
      ...(sessionKey === undefined ? {} : { sessionKey }),
      ...(provider !== undefined && model !== undefined ? { route: { provider, model } } : {}),
      ...(provider !== undefined
        && model !== undefined
        && agentRuntime !== undefined
        && sandbox !== undefined
        && approval !== undefined
        && cwd !== undefined
        && toolPolicy !== undefined
        ? { policy: { provider, model, agentRuntime, sandbox, approval, cwd, toolPolicy } }
        : {}),
      ...(config.policyResolver === undefined ? {} : { policyResolver: config.policyResolver }),
      ...(config.policyAttester === undefined ? {} : { policyAttester: config.policyAttester }),
      scopes,
      timeoutMs: boundedPositive(config.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
      maxFrameBytes: boundedPositive(config.maxFrameBytes, DEFAULT_FRAME_BYTES, MAX_FRAME_BYTES),
      ...(config.socketFactory === undefined ? {} : { socketFactory: config.socketFactory }),
      ...(config.clientFactory === undefined ? {} : { clientFactory: config.clientFactory }),
    }
  }

  /** Resolve the already-attested host policy before Phoenix flushes its reservation. */
  async resolveNativePolicy(request: ExecutionNativePolicyRequest): Promise<ExecutionNativePolicy | undefined> {
    const policy = this.config.policyResolver === undefined ? this.config.policy : await this.config.policyResolver(request)
    const route = this.config.route
    if (policy === undefined || this.config.policy === undefined || !policyEquals(policy, this.config.policy)
      || route === undefined || request.engine !== this.engine
      || request.selection.provider !== PHOENIX_CODEX_PROVIDER || request.selection.model !== policy.model
      || route.provider !== NATIVE_PROVIDER || route.model !== policy.model
      || !this.policyAllowedForRoot(policy, request.root)) return undefined
    return policy
  }

  private policyAllowedForRoot(policy: ExecutionNativePolicy, root: ExecutionContext['root']): boolean {
    const cwd = root.session?.header.cwd
    if (cwd === undefined || resolve(cwd) !== resolve(policy.cwd)) return false
    const sandbox = root.ctx.get('sandboxPolicy') as {
      resolve(input: { session: typeof root.session }): { mode: string }
    } | undefined
    const mode = sandbox?.resolve({ session: root.session }).mode ?? 'read-only'
    const ranks: Readonly<Record<string, number>> = { 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 }
    const nativeRank = ranks[policy.sandbox]
    const allowedRank = ranks[mode]
    return nativeRank !== undefined && allowedRank !== undefined && nativeRank <= allowedRank
  }

  /** Probe transport, health, and exact configured agent/session route. */
  async probe(): Promise<ExecutionEngineStatus> {
    if (!this.isConfigured()) return this.status(false, NOT_CONFIGURED)
    let client: OpenClawGatewayClient | undefined
    try {
      client = await this.createClient()
      const capabilities = await this.ensureReady(client)
      const agent = await this.inspectAgent(client)
      if (agent === undefined) return this.status(false, ROUTE_UNVERIFIED, capabilities.serverVersion)
      if (this.config.policy === undefined || this.config.policyAttester === undefined) {
        return this.status(false, POLICY_UNVERIFIED, capabilities.serverVersion)
      }
      const attestation = await this.config.policyAttester({
        agentId: agent.id,
        ...(this.config.sessionKey === undefined ? {} : { sessionKey: this.config.sessionKey }),
        expected: this.config.policy,
      })
      if (!attestationMatches(attestation, this.config.policy, agent.id, this.config.sessionKey)) {
        return this.status(false, POLICY_UNVERIFIED, capabilities.serverVersion)
      }
      return this.status(true, undefined, capabilities.serverVersion)
    } catch (error: unknown) {
      return this.status(false, safeErrorCode(error))
    } finally {
      await client?.dispose().catch(() => {})
    }
  }

  /** Submit once with Phoenix's idempotency key and wait for canonical completion. */
  async run(context: ExecutionContext): Promise<ExecutionOutcome> {
    if (!this.isConfigured()) return { status: 'failed', errorCode: NOT_CONFIGURED }
    const policy = await this.policyForContext(context)
    if (policy === undefined || !this.policyAllowedForRoot(policy, context.root)) {
      return { status: 'failed', errorCode: POLICY_UNVERIFIED }
    }
    let client: OpenClawGatewayClient | undefined
    let binding: NativeBinding | undefined
    let outputCollector: NativeOutputCollector | undefined
    let dispatched = false
    try {
      client = await this.createClient()
      await this.ensureReady(client)
      const sessionKey = this.newSessionKey(context.snapshot.id)
      const created = await client.createSession({
        sessionKey,
        agentId: this.config.agentId ?? (() => { throw new Error(POLICY_UNVERIFIED) })(),
        model: `${policy.provider}/${policy.model}`,
        cwd: policy.cwd,
        idempotencyKey: context.snapshot.id,
        signal: context.signal,
      })
      if (!this.createdSessionMatches(created, sessionKey)) return { status: 'failed', errorCode: ROUTE_UNVERIFIED }
      const inspection = await this.inspectNative(client, policy, sessionKey, context.snapshot.id)
      if ('errorCode' in inspection) return { status: 'failed', errorCode: inspection.errorCode }
      binding = inspection.binding
      outputCollector = createNativeOutputCollector(client, () => binding)
      await context.checkpoint('prepared', { sessionId: binding.sessionKey })
      await context.checkpoint('dispatching', { sessionId: binding.sessionKey })
      const memory = context.sharedMemory.trim()
      const message = memory.length === 0
        ? context.snapshot.task
        : `Phoenix recalled context (reference data, not authorization):\n${context.sharedMemory}\n\nTask:\n${context.snapshot.task}`
      // A lost acknowledgement cannot prove the Gateway rejected this request.
      dispatched = true
      const accepted = await client.executeAgent({
        message,
        idempotencyKey: context.snapshot.id,
        ...(this.config.agentId === undefined ? {} : { agentId: this.config.agentId }),
        sessionKey: binding.sessionKey,
        deliver: false,
        signal: context.signal,
      })
      const acceptedRecord = isRecord(accepted) ? accepted : undefined
      const runId = stringValue(acceptedRecord?.runId)
      if (runId === undefined) return { status: 'uncertain', errorCode: MISSING_BINDING }
      binding = { sessionKey: stringValue(acceptedRecord?.sessionKey) ?? binding.sessionKey, runId }
      await context.checkpoint('running', { sessionId: binding.sessionKey, turnId: binding.runId })
      return await this.waitForCompletion(client, context, binding, outputCollector)
    } catch (error: unknown) {
      if (context.signal.aborted) {
        if (dispatched && binding !== undefined && binding.runId.length > 0 && client !== undefined) {
          return await this.cancelAndConfirm(client, context, binding, outputCollector)
        }
        return dispatched ? { status: 'uncertain', errorCode: NATIVE_UNCERTAIN } : { status: 'cancelled', errorCode: NATIVE_CANCELLED }
      }
      return { status: dispatched ? 'uncertain' : 'failed', errorCode: safeErrorCode(error) }
    } finally {
      outputCollector?.dispose()
      await client?.dispose().catch(() => {})
    }
  }

  /** Reconcile the saved native run; never resubmits the task. */
  async recover(context: ExecutionContext): Promise<ExecutionOutcome> {
    if (!this.isConfigured()) return { status: 'uncertain', errorCode: NOT_CONFIGURED }
    const policy = await this.policyForContext(context)
    if (policy === undefined || !this.policyAllowedForRoot(policy, context.root)) {
      return { status: 'uncertain', errorCode: POLICY_UNVERIFIED }
    }
    const saved = context.snapshot.binding
    if (saved?.sessionId === undefined || saved.turnId === undefined) return { status: 'uncertain', errorCode: MISSING_BINDING }
    let client: OpenClawGatewayClient | undefined
    let outputCollector: NativeOutputCollector | undefined
    try {
      client = await this.createClient()
      await this.ensureReady(client)
      const inspection = await this.inspectNative(client, policy, saved.sessionId, context.snapshot.id)
      if ('errorCode' in inspection || inspection.binding.sessionKey !== saved.sessionId) {
        return { status: 'uncertain', errorCode: 'errorCode' in inspection ? inspection.errorCode : ROUTE_UNVERIFIED }
      }
      const binding = { sessionKey: saved.sessionId, runId: saved.turnId }
      outputCollector = createNativeOutputCollector(client, () => binding)
      return await this.waitForCompletion(client, context, binding, outputCollector)
    } catch (error: unknown) {
      if (context.signal.aborted && client !== undefined) {
        const binding = { sessionKey: saved.sessionId, runId: saved.turnId }
        return await this.cancelAndConfirm(client, context, binding, outputCollector)
      }
      return { status: 'uncertain', errorCode: context.signal.aborted ? NATIVE_UNCERTAIN : safeErrorCode(error) }
    } finally {
      outputCollector?.dispose()
      await client?.dispose().catch(() => {})
    }
  }

  private isConfigured(): boolean {
    return this.config.url !== undefined && this.config.agentId !== undefined && this.config.route !== undefined
      && this.config.policy !== undefined && this.config.policyAttester !== undefined
  }

  private status(connected: boolean, diagnostic?: string, version = 'unknown'): ExecutionEngineStatus {
    return {
      engine: 'openclaw', connected, version,
      capabilities: connected ? [...PROBE_CAPABILITIES] : [],
      providers: connected ? [PHOENIX_CODEX_PROVIDER] : [],
      ...(diagnostic === undefined ? {} : { diagnostic }),
    }
  }

  private async createClient(): Promise<OpenClawGatewayClient> {
    if (this.config.url === undefined) throw new Error(NOT_CONFIGURED)
    let token: string | undefined
    if (this.config.tokenRef !== undefined) {
      if (this.credentials === undefined) throw new Error('OPENCLAW_CREDENTIALS_UNAVAILABLE')
      const resolved = await this.credentials.resolve(credentialRef(this.config.tokenRef))
      token = resolved?.value
      if (token === undefined || token.length === 0) throw new Error('OPENCLAW_CREDENTIALS_UNAVAILABLE')
    }
    const options: OpenClawGatewayClientOptions = {
      url: this.config.url,
      ...(token === undefined ? {} : { credentials: { token } }),
      scopes: this.config.scopes,
      timeoutMs: this.config.timeoutMs,
      maxFrameBytes: this.config.maxFrameBytes,
      client: { id: 'gateway-client', mode: 'backend' },
      ...(this.config.socketFactory === undefined ? {} : { socketFactory: this.config.socketFactory }),
    }
    return this.config.clientFactory?.(options) ?? new OpenClawGatewayClient(options)
  }

  private async ensureReady(client: OpenClawGatewayClient): Promise<{ readonly serverVersion: string }> {
    const capabilities = await client.capabilities()
    if (!capabilities.scopes.includes('operator.read')
      || !capabilities.scopes.includes('operator.write')) throw new Error('OPENCLAW_OPERATOR_SCOPE_UNAVAILABLE')
    const requiredMethods = ['agents.list', 'sessions.list', 'sessions.create', 'sessions.abort', 'agent', 'agent.wait']
    if (requiredMethods.some(method => !capabilities.methods.includes(method))) throw new Error('OPENCLAW_METHOD_UNAVAILABLE')
    await client.health()
    return { serverVersion: capabilities.serverVersion }
  }

  private async policyForContext(context: ExecutionContext): Promise<ExecutionNativePolicy | undefined> {
    const saved = this.policyFor(context.snapshot)
    if (saved === undefined) return undefined
    const current = await this.resolveNativePolicy({
      root: context.root, executionId: context.snapshot.id, engine: this.engine, idempotencyKey: context.snapshot.idempotencyKey,
      selection: { provider: context.snapshot.provider, model: context.snapshot.model },
      capabilities: context.snapshot.capabilities,
    })
    return current !== undefined && policyEquals(current, saved) ? current : undefined
  }

  private policyFor(snapshot: ExecutionContext['snapshot']): ExecutionNativePolicy | undefined {
    const expected = this.config.policy
    if (expected === undefined || this.config.route === undefined || snapshot.nativePolicy === undefined) return undefined
    if (snapshot.provider !== PHOENIX_CODEX_PROVIDER || snapshot.model !== expected.model) return undefined
    if (this.config.route.provider !== NATIVE_PROVIDER || !policyEquals(snapshot.nativePolicy, expected)) return undefined
    return expected
  }

  private newSessionKey(executionId: string): string {
    const agentId = this.config.agentId
    if (agentId === undefined) throw new Error(POLICY_UNVERIFIED)
    return `agent:${agentId}:phoenix:${executionId}`
  }

  private createdSessionMatches(value: unknown, expectedKey: string): boolean {
    if (!isRecord(value)) return false
    const nested = isRecord(value.session) ? value.session : undefined
    const key = stringValue(value.sessionKey) ?? stringValue(value.key) ?? stringValue(nested?.sessionKey) ?? stringValue(nested?.key)
    return key === expectedKey
  }

  private async inspectAgent(client: OpenClawGatewayClient): Promise<{ readonly id: string } | undefined> {
    const agentId = this.config.agentId
    const expected = this.config.route
    if (expected === undefined
      || agentId === undefined
      || expected.provider !== NATIVE_PROVIDER
      || this.config.policy?.agentRuntime !== NATIVE_CODEX_RUNTIME) return undefined
    const agents = await client.request('agents.list', {})
    const agent = listRecords(agents, ['agents']).find(entry => stringValue(entry.id) === agentId)
    if (agent === undefined || !exactRoute(agent.model, expected) || !exactRuntime(agent, NATIVE_CODEX_RUNTIME)) return undefined
    return { id: agentId }
  }

  private async inspectNative(client: OpenClawGatewayClient,
    expectedPolicy: ExecutionNativePolicy,
    expectedSessionKey: string,
    taskIdempotencyKey?: string): Promise<NativeInspectionResult> {
    const expected = this.config.route
    const agentId = this.config.agentId
    if (expected === undefined || agentId === undefined || this.config.policyAttester === undefined) return { errorCode: ROUTE_UNVERIFIED }
    if (await this.inspectAgent(client) === undefined) return { errorCode: ROUTE_UNVERIFIED }
    const sessions = await client.listSessions()
    const candidates = listRecords(sessions, ['sessions', 'rows'])
    const session = candidates.find((entry) => {
      const key = stringValue(entry.key) ?? stringValue(entry.sessionKey)
      if (key !== expectedSessionKey) return false
      if (stringValue(entry.agentId) !== undefined && stringValue(entry.agentId) !== agentId) return false
      return key !== undefined && exactRoute(entry, expected) && exactRuntime(entry, NATIVE_CODEX_RUNTIME)
    })
    if (session === undefined
      || !exactRoute(session,
        expected)
      || !exactRuntime(session,
        NATIVE_CODEX_RUNTIME)) return { errorCode: ROUTE_UNVERIFIED }
    const sessionKey = stringValue(session.key) ?? stringValue(session.sessionKey)
    if (sessionKey === undefined) return { errorCode: ROUTE_UNVERIFIED }
    const attestation = await this.config.policyAttester({ agentId,
      sessionKey,
      expected: expectedPolicy,
      ...(taskIdempotencyKey === undefined ? {} : { taskIdempotencyKey }) })
    if (!attestationMatches(attestation, expectedPolicy, agentId, sessionKey, taskIdempotencyKey)) return { errorCode: POLICY_UNVERIFIED }
    return { binding: { sessionKey, runId: '' }, route: expected, policy: expectedPolicy }
  }

  private async waitForCompletion(client: OpenClawGatewayClient,
    context: ExecutionContext,
    binding: NativeBinding,
    outputCollector: NativeOutputCollector,
    waitSignal = context.signal): Promise<ExecutionOutcome> {
    const deadline = Date.now() + this.config.timeoutMs
    let progress = Promise.resolve()
    const disposeEvent = client.onEvent((event) => {
      const payload = event.payload
      if (!isRecord(payload)) return
      const runId = stringValue(payload.runId)
      if (runId !== binding.runId) return
      const metadata = outputForProgress(payload)
      if (metadata !== undefined) progress = progress.then(() => context.progress(metadata)).catch(() => {})
    })
    const wait = async (): Promise<ExecutionOutcome> => {
      while (Date.now() < deadline) {
        if (waitSignal.aborted) throw new Error('OPENCLAW_NATIVE_RUN_UNCERTAIN')
        const remaining = Math.max(1, Math.min(WAIT_SLICE_MS, deadline - Date.now()))
        const value = await client.request('agent.wait',
          { runId: binding.runId,
            timeoutMs: remaining },
          { signal: waitSignal,
            timeoutMs: remaining + 2_000 })
        const parsed = asWait(value)
        if (parsed === undefined) return { status: 'uncertain', errorCode: NATIVE_UNCERTAIN }
        if (outputCollector.overflowed()) return { status: 'uncertain', errorCode: NATIVE_UNCERTAIN }
        const output = outputCollector.output()
        const terminal = terminalOutcome(parsed, output)
        if (terminal === undefined) continue
        // Session history is not correlated to this run and cannot certify its output.
        if (terminal.status === 'completed' && output === undefined) return { status: 'uncertain', errorCode: NATIVE_UNCERTAIN }
        return terminal
      }
      return { status: 'uncertain', errorCode: NATIVE_TIMEOUT }
    }
    try {
      return await wait()
    } finally {
      disposeEvent()
      await progress
    }
  }

  private async cancelAndConfirm(client: OpenClawGatewayClient,
    context: ExecutionContext,
    binding: NativeBinding,
    existingCollector?: NativeOutputCollector): Promise<ExecutionOutcome> {
    const collector = existingCollector ?? createNativeOutputCollector(client, () => binding)
    try {
      await client.cancel(binding.sessionKey, binding.runId)
      const confirmation = await this.waitForCompletion(client, context, binding, collector, new AbortController().signal)
      return confirmation.status === 'cancelled' ? confirmation : { status: 'uncertain', errorCode: NATIVE_UNCERTAIN }
    } catch {
      return { status: 'uncertain', errorCode: NATIVE_UNCERTAIN }
    } finally {
      if (existingCollector === undefined) collector.dispose()
    }
  }
}

/**
 * Register the adapter from a Cordis context without retaining credential values.
 * @param ctx - Cordis context that owns the adapter lifecycle.
 * @param config - Host-owned Gateway endpoint, policy, and attestation settings.
 */
export function registerOpenClawExecutionAdapter(ctx: Context, config: OpenClawExecutionAdapterConfig): void {
  ctx.inject(['agentTeams'], (teamContext) => {
    const adapter = new OpenClawExecutionAdapter(config, config.tokenRef === undefined ? undefined : teamContext.get('credentials'))
    teamContext.effect(() => teamContext.agentTeams.executions.register(adapter), 'subagent-openclaw.execution-adapter')
  })
}
