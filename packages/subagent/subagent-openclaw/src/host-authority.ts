/** Native Host authority for the launcher-owned OpenClaw Gateway. */
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Service } from '@phoenix-ai/cordis'
import type { ExecutionNativePolicy, ExecutionNativePolicyRequest } from '@phoenix-ai/dsh-agent-team'
import { OpenClawGatewayClient } from './index.ts'
import { managedOpenClawConfigPath, type ManagedOpenClawPolicyRequest, type ManagedOpenClawRuntimeHost } from './managed-runtime.ts'
import type { OpenClawGatewayClientOptions, OpenClawNativePolicyAttestation } from './types.ts'

type Json = Record<string, unknown>
interface RuntimeReceipt { readonly status: 'verified'; readonly port: number; readonly configDigest: string }
interface VerifiedConfig { readonly receipt: RuntimeReceipt; readonly data: Json; readonly policy: ExecutionNativePolicy }
const DENIED_TOOLS = ['browser', 'cron', 'gateway', 'nodes', 'group:fs', 'group:runtime', 'group:web']
const ALLOWED_TOOLS = ['session_status']
function record(value: unknown): Json | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined
}
function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}
function samePolicy(a: ExecutionNativePolicy, b: ExecutionNativePolicy): boolean {
  return a.provider === b.provider && a.model === b.model && a.agentRuntime === b.agentRuntime
    && a.sandbox === b.sandbox && a.approval === b.approval && resolve(a.cwd) === resolve(b.cwd)
    && a.toolPolicy.profile === b.toolPolicy.profile && a.toolPolicy.profileHash === b.toolPolicy.profileHash
    && a.toolPolicy.allow.join('\u0000') === b.toolPolicy.allow.join('\u0000')
    && a.toolPolicy.deny.join('\u0000') === b.toolPolicy.deny.join('\u0000')
}
function rows(value: unknown, property: string): Json[] {
  const root = record(value)
  const records = Array.isArray(value) ? value : root?.[property]
  return Array.isArray(records) ? records.flatMap(item => record(item) === undefined ? [] : [item as Json]) : []
}
function routeFromConfig(data: Json, digest: string): ExecutionNativePolicy | undefined {
  const agents = record(data.agents)
  const entries = record(agents?.entries)
  const agent = record(entries?.phoenix)
  const modelRef = string(record(agent?.model)?.primary) ?? string(agent?.model)
  const defaults = record(agents?.defaults)
  const resolvedModel = modelRef ?? string(record(defaults?.model)?.primary) ?? string(defaults?.model)
  const workspace = string(agent?.workspace) ?? string(defaults?.workspace)
  const policies = record(defaults?.models)
  const agentPolicies = record(agent?.models)
  const agentModelPolicy = record(agentPolicies?.[resolvedModel ?? ''])
  const defaultModelPolicy = record(policies?.[resolvedModel ?? ''])
  const providerPolicy = record(record(record(data.models)?.providers)?.openai)
  const nativeRuntime = string(record(agentModelPolicy?.agentRuntime)?.id)
    ?? string(record(defaultModelPolicy?.agentRuntime)?.id)
    ?? string(record(providerPolicy?.agentRuntime)?.id)
  const plugins = record(data.plugins)
  const plugin = record(record(plugins?.entries)?.codex)
  const pluginConfig = record(plugin?.config)
  const codex = record(pluginConfig?.appServer)
  const sandbox = string(codex?.sandbox)
  const approval = string(codex?.approvalPolicy)
  const tools = record(agent?.tools) ?? record(defaults?.tools)
  if (resolvedModel === undefined || !resolvedModel.startsWith('openai/')
    || workspace === undefined || nativeRuntime !== 'codex'
    || plugin?.enabled !== true || (Array.isArray(plugins?.allow) && !plugins.allow.includes('codex'))
    || sandbox !== 'read-only' || approval !== 'never' || tools?.profile !== 'minimal') return undefined
  // The runtime is kept read-only until a separate native approval implementation is audited.
  // These exact tool restrictions must be configured; a reported tools.effective preview is not proof.
  const allow = Array.isArray(tools?.allow) ? tools.allow as string[] : undefined
  const deny = Array.isArray(tools?.deny) ? tools.deny as string[] : undefined
  if (allow === undefined || allow.length !== ALLOWED_TOOLS.length
    || !ALLOWED_TOOLS.every(t => allow.includes(t))
    || deny === undefined || !DENIED_TOOLS.every(t => deny.includes(t))) return undefined
  return {
    provider: 'openai', model: resolvedModel.slice('openai/'.length), agentRuntime: 'codex',
    sandbox, approval, cwd: workspace,
    toolPolicy: {
      profile: 'minimal', allow: [...allow], deny: [...deny],
      profileHash: digest,
    },
  }
}

/**
 * One Host-owned service; neither loader configuration nor model input supplies its assertions.
 * An unowned/stale Gateway remains disconnected rather than being silently promoted.
 */
export default class OpenClawManagedHostAuthority extends Service implements ManagedOpenClawRuntimeHost {
  private proof: (RuntimeReceipt & { readonly provedAt: number }) | undefined
  private readonly grants = new Map<string, { policy: ExecutionNativePolicy; root: ExecutionNativePolicyRequest['root'] }>()
  private live = true
  constructor(ctx: Context) {
    super(ctx, 'openclawManagedRuntime')
    ctx.effect(() => () => { this.live = false; this.proof = undefined; this.grants.clear() }, 'openclawManagedRuntime.dispose')
  }

  private async verified(): Promise<VerifiedConfig | undefined> {
    // A failed revalidation immediately revokes the previous credential lease.
    this.proof = undefined
    if (!this.live) return undefined
    const home = resolve(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'))
    const root = resolve(process.env.PHOENIX_RUNTIME_ROOT?.trim() || process.cwd())
    const modulePath = pathToFileURL(join(root, 'scripts', 'phoenix-engine-runtime.mjs')).href
    try {
      const module = await import(modulePath) as {
        ENGINE_RUNTIME_SAFETY_VERSION?: number
        attestManagedOpenClawGateway?: (options: { home: string }) => Promise<unknown>
      }
      if (module.ENGINE_RUNTIME_SAFETY_VERSION !== 2 || typeof module.attestManagedOpenClawGateway !== 'function') return undefined
      const receipt = record(await module.attestManagedOpenClawGateway({ home }))
      if (receipt?.status !== 'verified' || !Number.isSafeInteger(receipt.port)
        || typeof receipt.port !== 'number' || receipt.port < 1 || receipt.port > 65535
        || !string(receipt.configDigest)) return undefined
      const path = managedOpenClawConfigPath()
      if (resolve(path) !== join(home, 'openclaw-runtime', 'openclaw.json')) return undefined
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 1_048_576) return undefined
      const raw = readFileSync(path)
      const digest = 'sha256:' + createHash('sha256').update(raw).digest('hex')
      if (receipt.configDigest !== digest) return undefined
      const data = record(JSON.parse(raw.toString('utf8')) as unknown)
      if (data === undefined) return undefined
      const gateway = record(data.gateway)
      if (gateway?.port !== receipt.port || !['loopback', 'localhost', '127.0.0.1'].includes(string(gateway.bind) ?? 'loopback')) return undefined
      const auth = record(gateway.auth)
      if (string(auth?.token) === undefined && string(auth?.password) === undefined) return undefined
      const policy = routeFromConfig(data, digest)
      if (policy === undefined) return undefined
      const result: RuntimeReceipt = { status: 'verified', port: receipt.port, configDigest: digest }
      this.proof = { ...result, provedAt: Date.now() }
      return { receipt: result, data, policy }
    } catch {
      return undefined
    }
  }

  readonly clientFactory = (options: OpenClawGatewayClientOptions): OpenClawGatewayClient => {
    const proof = this.proof
    if (!this.live || proof === undefined || Date.now() - proof.provedAt > 15_000
      || options.url !== `ws://127.0.0.1:${proof.port}`) {
      throw new Error('OPENCLAW_HOST_AUTHORITY_UNAVAILABLE')
    }
    const path = managedOpenClawConfigPath()
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 1_048_576) {
      throw new Error('OPENCLAW_HOST_CONFIG_UNSAFE')
    }
    const raw = readFileSync(path)
    if ('sha256:' + createHash('sha256').update(raw).digest('hex') !== proof.configDigest) {
      throw new Error('OPENCLAW_HOST_CONFIG_CHANGED')
    }
    const data = record(JSON.parse(raw.toString('utf8')) as unknown)
    const auth = record(record(data?.gateway)?.auth)
    const token = string(auth?.token)
    const password = string(auth?.password)
    if (token === undefined && password === undefined) throw new Error('OPENCLAW_HOST_AUTH_REQUIRED')
    return new OpenClawGatewayClient({
      url: options.url, client: { id: 'gateway-client', mode: 'backend' },
      scopes: ['operator.read', 'operator.write'], ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxFrameBytes === undefined ? {} : { maxFrameBytes: options.maxFrameBytes }),
      credentials: { ...(token === undefined ? {} : { token }), ...(password === undefined ? {} : { password }) },
    })
  }

  private async routeVerified(value: VerifiedConfig, sessionKey?: string): Promise<boolean> {
    const client = this.clientFactory({ url: `ws://127.0.0.1:${value.receipt.port}` })
    try {
      const capabilities = await client.capabilities()
      if (!capabilities.scopes.includes('operator.read') || !capabilities.scopes.includes('operator.write')
        || !capabilities.methods.includes('agents.list') || !capabilities.methods.includes('sessions.list')) return false
      await client.health()
      const agents = rows(await client.request('agents.list', {}), 'agents')
      const agent = agents.find(a => a.id === 'phoenix')
      if (agent === undefined || record(agent.model)?.primary !== `openai/${value.policy.model}`
        || record(agent.agentRuntime)?.id !== 'codex') return false
      if (sessionKey !== undefined) {
        const session = rows(await client.listSessions(), 'sessions').find(s => s.key === sessionKey || s.sessionKey === sessionKey)
        if (session === undefined || session.agentId !== 'phoenix'
          || session.modelProvider !== 'openai' || session.model !== value.policy.model
          || record(session.agentRuntime)?.id !== 'codex') return false
      }
      return true
    } catch {
      return false
    } finally {
      await client.dispose().catch(() => undefined)
    }
  }

  readonly resolvePolicy = async (request: ManagedOpenClawPolicyRequest): Promise<ExecutionNativePolicy | undefined> => {
    const value = await this.verified()
    if (value === undefined || request.configPath !== managedOpenClawConfigPath()
      || request.agentId !== 'phoenix' || request.provider !== value.policy.provider
      || request.model !== value.policy.model || request.agentRuntime !== value.policy.agentRuntime
      || request.sandbox !== value.policy.sandbox || request.approval !== value.policy.approval
      || resolve(request.cwd) !== resolve(value.policy.cwd) || request.toolsProfile !== 'minimal'
      || !await this.routeVerified(value)) return undefined
    return value.policy
  }

  readonly resolveExecutionPolicy = async (
    request: ExecutionNativePolicyRequest & ManagedOpenClawPolicyRequest,
  ): Promise<ExecutionNativePolicy | undefined> => {
    if (request.engine !== 'openclaw' || request.selection.provider !== 'openai-codex'
      || request.selection.model !== request.model || request.idempotencyKey.length === 0
      || request.root.session?.header.cwd === undefined
      || resolve(request.root.session.header.cwd) !== resolve(request.cwd)
      || request.root.ctx.get('agents')?.get(request.root.id) !== request.root) return undefined
    const policy = await this.resolvePolicy(request)
    if (policy === undefined) return undefined
    const permissions = request.root.ctx.get('sandboxPolicy') as {
      resolve(options: { session: typeof request.root.session }): { mode: string }
    } | undefined
    if (!['read-only', 'workspace-write', 'danger-full-access'].includes(
      permissions?.resolve({ session: request.root.session }).mode ?? '',
    )) return undefined
    this.grants.set(String(request.executionId), { policy, root: request.root })
    return policy
  }

  readonly attestPolicy = async (request: {
    readonly agentId: string
    readonly sessionKey?: string
    readonly expected: ExecutionNativePolicy
    readonly taskIdempotencyKey?: string
  }): Promise<OpenClawNativePolicyAttestation | undefined> => {
    const value = await this.verified()
    if (value === undefined || request.agentId !== 'phoenix' || !samePolicy(value.policy, request.expected)) return undefined
    const taskId = request.taskIdempotencyKey
    if (request.sessionKey !== undefined && (taskId === undefined
      || request.sessionKey !== `agent:phoenix:phoenix:${taskId}`)) return undefined
    if (taskId !== undefined) {
      const grant = this.grants.get(taskId)
      if (grant === undefined || !samePolicy(grant.policy, value.policy)
        || grant.root.ctx.get('agents')?.get(grant.root.id) !== grant.root) return undefined
    }
    if (!await this.routeVerified(value, request.sessionKey)) return undefined
    return {
      agentId: 'phoenix',
      ...(request.sessionKey === undefined ? {} : { sessionKey: request.sessionKey }),
      provider: value.policy.provider, model: value.policy.model,
      agentRuntime: value.policy.agentRuntime, sandbox: value.policy.sandbox,
      approval: value.policy.approval, cwd: value.policy.cwd,
      toolPolicy: value.policy.toolPolicy,
      ...(taskId === undefined ? {} : { taskIdempotencyKey: taskId }),
    }
  }
}
