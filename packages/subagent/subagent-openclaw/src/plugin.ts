/** Cordis plugin composition for the public OpenClaw execution adapter. */

import type { Context } from '@phoenix-ai/cordis'
import type { ExecutionAdapter } from '@phoenix-ai/dsh-agent-team'
import z from '@phoenix-ai/schemastery'
import {
  OpenClawExecutionAdapter,
} from './execution-adapter.ts'
import { createManagedOpenClawConfig } from './managed-runtime.ts'
import OpenClawManagedHostAuthority from './host-authority.ts'
import type { OpenClawOperatorScope, OpenClawPolicyAttester } from './types.ts'

type ConfigToolPolicy = { readonly profile: string; readonly allow: string[]; readonly deny: string[]; readonly profileHash: string }

/** Profile-owned OpenClaw Gateway route and host credential reference. */
export interface Config {
  readonly url?: string
  readonly tokenRef?: string
  readonly agentId?: string
  readonly sessionKey?: string
  readonly provider?: string
  readonly model?: string
  readonly agentRuntime?: string
  readonly sandbox?: string
  readonly approval?: string
  readonly cwd?: string
  readonly toolPolicy?: ConfigToolPolicy
  readonly policyAttester?: OpenClawPolicyAttester
  readonly scopes?: OpenClawOperatorScope[]
  readonly timeoutMs?: number
  readonly maxFrameBytes?: number
}

export const Config: z<Config> = z.object({
  url: z.string().min(1).default(undefined as unknown as string),
  tokenRef: z.string().min(1).default(undefined as unknown as string),
  agentId: z.string().min(1).default(undefined as unknown as string),
  sessionKey: z.string().min(1).default(undefined as unknown as string),
  provider: z.string().min(1).default(undefined as unknown as string),
  model: z.string().min(1).default(undefined as unknown as string),
  agentRuntime: z.string().min(1).default(undefined as unknown as string),
  sandbox: z.string().min(1).default(undefined as unknown as string),
  approval: z.string().min(1).default(undefined as unknown as string),
  cwd: z.string().min(1).default(undefined as unknown as string),
  toolPolicy: z.object({
    profile: z.string().min(1), allow: z.array(z.string().min(1)), deny: z.array(z.string().min(1)), profileHash: z.string().min(1),
  }).default(undefined as unknown as ConfigToolPolicy),
  policyAttester: z.any().default(undefined as unknown as OpenClawPolicyAttester),
  scopes: z.array(z.union(['operator.read', 'operator.write'] as const)).default(['operator.read', 'operator.write']),
  timeoutMs: z.number().step(1).min(1).default(30_000),
  maxFrameBytes: z.number().step(1).min(1).default(1_048_576),
})

export const name = 'subagent-openclaw'
export const inject = ['agentTeams']
/** Optional host service key used for production managed-runtime composition. */
export const managedRuntimeService = 'openclawManagedRuntime'

/** Register one adapter per Cordis fiber; disposal unregisters that exact instance. */
export function apply(ctx: Context, config: Config = {}): void {
  const service: unknown = ctx.get(managedRuntimeService)
  // The adapter's own trusted Host fiber provides this native authority. A
  // foreign plugin cannot mint permission by occupying the same service key.
  const host = service === undefined
    ? new OpenClawManagedHostAuthority(ctx)
    : service instanceof OpenClawManagedHostAuthority ? service : undefined
  // Re-resolve Host authority on every probe and operation. Freezing one
  // unconfigured adapter at boot would leave a Gateway started later
  // permanently disconnected, and would also retain stale permissions.
  const adapterNow = async (): Promise<OpenClawExecutionAdapter> => {
    const managed = host === undefined ? undefined : await createManagedOpenClawConfig(host)
    return new OpenClawExecutionAdapter(managed === undefined ? {} : {
      ...managed,
      ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
      ...(config.maxFrameBytes === undefined ? {} : { maxFrameBytes: config.maxFrameBytes }),
    })
  }
  ctx.inject(['agentTeams'], (teamContext) => {
    const adapter: ExecutionAdapter = {
      engine: 'openclaw',
      probe: async () => (await adapterNow()).probe(),
      resolveNativePolicy: async request => (await adapterNow()).resolveNativePolicy(request),
      run: async request => (await adapterNow()).run(request),
      recover: async request => (await adapterNow()).recover(request),
    }
    teamContext.effect(
      () => teamContext.agentTeams.executions.register(adapter),
      'subagent-openclaw.execution-adapter',
    )
  })
}
