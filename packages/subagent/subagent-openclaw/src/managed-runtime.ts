/** Host-only composition for the Phoenix-managed OpenClaw runtime. */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { ExecutionNativePolicy, ExecutionNativePolicyRequest } from '@phoenix-ai/dsh-agent-team'
import type {
  OpenClawExecutionAdapterConfig,
} from './execution-adapter.ts'
import type {
  OpenClawGatewayClient,
  OpenClawGatewayClientOptions,
} from './index.ts'
import type { OpenClawPolicyAttester } from './types.ts'

/** The only config path this host factory is permitted to inspect.
 * @returns The fixed user-owned managed runtime configuration path.
 */
export function managedOpenClawConfigPath(): string {
  return resolve(homedir(), '.dsh', 'openclaw-runtime', 'openclaw.json')
}

/** Host-owned client and policy authority; credentials never enter this package's config. */
export interface ManagedOpenClawRuntimeHost {
  /** Construct a client while keeping any Gateway credential in the host process. */
  readonly clientFactory: (options: OpenClawGatewayClientOptions) => OpenClawGatewayClient
  /** Resolve effective restrictions from the managed Gateway and its child runtime. */
  readonly resolvePolicy: (request: ManagedOpenClawPolicyRequest) => Promise<ExecutionNativePolicy | undefined>
  /** Revalidate effective authority using the owning Phoenix session before every reservation. */
  readonly resolveExecutionPolicy: (
    request: ExecutionNativePolicyRequest & ManagedOpenClawPolicyRequest,
  ) => Promise<ExecutionNativePolicy | undefined>
  /** Return corroborated policy evidence for the exact agent/session/task identity. */
  readonly attestPolicy: OpenClawPolicyAttester
}

/** Sanitized projection passed to the manager; it contains no credential or model text. */
export interface ManagedOpenClawPolicyRequest {
  readonly configPath: string
  readonly agentId: string
  readonly provider: string
  readonly model: string
  readonly agentRuntime: string
  readonly sandbox: string
  readonly approval: string
  readonly cwd: string
  readonly toolsProfile: string
}

interface JsonObject { readonly [key: string]: unknown }

function object(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function nestedText(value: unknown): string | undefined {
  const record = object(value)
  return text(value) ?? (record === undefined ? undefined : text(record.primary))
}

interface ManagedConfigProjection {
  readonly agentId: string
  readonly provider: string
  readonly model: string
  readonly agentRuntime: string
  readonly sandbox: string
  readonly approval: string
  readonly cwd: string
  readonly toolsProfile: string
  readonly url: string
}

function projection(raw: unknown): ManagedConfigProjection | undefined {
  const root = object(raw)
  const agents = object(root?.agents)
  const entries = object(agents?.entries)
  const agent = object(entries?.phoenix)
  const defaults = object(agents?.defaults)
  const modelRef = nestedText(agent?.model) ?? nestedText(defaults?.model)
  if (agent === undefined || modelRef === undefined) return undefined
  const slash = modelRef.indexOf('/')
  if (slash <= 0 || slash === modelRef.length - 1) return undefined
  const provider = modelRef.slice(0, slash)
  const model = modelRef.slice(slash + 1)
  if (provider !== 'openai') return undefined
  const modelPolicies = object(defaults?.models)
  const modelPolicy = object(modelPolicies?.[modelRef])
  const runtime = text(object(modelPolicy?.agentRuntime)?.id)
  const tools = object(agent.tools) ?? object(defaults?.tools)
  const toolsProfile = text(tools?.profile)
  const pluginEntries = object(object(root?.plugins)?.entries)
  const codex = object(pluginEntries?.codex)
  const codexConfig = object(codex?.config)
  const appServer = object(codexConfig?.appServer)
  const sandbox = text(appServer?.sandbox)
  const approval = text(appServer?.approvalPolicy)
  const cwd = text(agent.workspace) ?? text(defaults?.workspace)
  const gateway = object(root?.gateway)
  const port = gateway?.port
  const bind = text(gateway?.bind)
  if (codex?.enabled !== true || runtime !== 'codex' || toolsProfile === undefined || sandbox === undefined || approval === undefined || cwd === undefined
    || typeof port !== 'number' || !Number.isSafeInteger(port) || port <= 0 || port > 65535 || (bind !== undefined && !['loopback', 'localhost', '127.0.0.1'].includes(bind))) return undefined
  return {
    agentId: 'phoenix', provider, model, agentRuntime: runtime, sandbox, approval, cwd, toolsProfile,
    url: `ws://127.0.0.1:${port}`,
  }
}

function sameStaticPolicy(left: ExecutionNativePolicy, right: ManagedConfigProjection): boolean {
  return left.provider === right.provider && left.model === right.model && left.agentRuntime === right.agentRuntime
    && left.sandbox === right.sandbox && left.approval === right.approval && left.cwd === right.cwd
    && left.toolPolicy.profile === right.toolsProfile
}

/**
 * Build the production adapter config from the managed runtime and host authority.
 * @param host - Trusted host manager that owns credentials and effective-policy reads.
 * @returns Adapter config, or undefined when the managed descriptor is incomplete or untrusted.
 */
export async function createManagedOpenClawConfig(host: ManagedOpenClawRuntimeHost): Promise<OpenClawExecutionAdapterConfig | undefined> {
  const configPath = managedOpenClawConfigPath()
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8')) as unknown
  } catch {
    return undefined
  }
  const selected = projection(raw)
  if (selected === undefined) return undefined
  let policy: ExecutionNativePolicy | undefined
  try { policy = await host.resolvePolicy({ configPath, ...selected }) }
  catch { return undefined }
  if (policy === undefined || !sameStaticPolicy(policy, selected)) return undefined
  return {
    url: selected.url,
    agentId: selected.agentId,
    provider: selected.provider,
    model: selected.model,
    agentRuntime: selected.agentRuntime,
    sandbox: selected.sandbox,
    approval: selected.approval,
    cwd: selected.cwd,
    toolPolicy: policy.toolPolicy,
    clientFactory: host.clientFactory,
    policyResolver: async (request) => {
      try { return await host.resolveExecutionPolicy({ ...request, configPath, ...selected }) }
      catch { return undefined }
    },
    policyAttester: host.attestPolicy,
  }
}
