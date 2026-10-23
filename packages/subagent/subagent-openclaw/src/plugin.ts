/** Cordis plugin composition for the public OpenClaw execution adapter. */

import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import {
  registerOpenClawExecutionAdapter,
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
export const inject = ['agentTeams', 'openclawManagedRuntime']
/** Optional host service key used for production managed-runtime composition. */
export const managedRuntimeService = 'openclawManagedRuntime'

/** Register one adapter per Cordis fiber; disposal unregisters that exact instance. */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const service = ctx.get(managedRuntimeService)
  const host = service instanceof OpenClawManagedHostAuthority ? service : undefined
  // Plugin YAML (including a pasted function or policy attestation) is never
  // execution authority. Only a live trusted Host can create the native route.
  // A missing Host fails closed even when a configured endpoint is reachable.
  const managed = host === undefined ? undefined : await createManagedOpenClawConfig(host)
  registerOpenClawExecutionAdapter(ctx, managed === undefined ? {} : {
    ...managed,
    // These bounded transport preferences do not change route or permissions.
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.maxFrameBytes === undefined ? {} : { maxFrameBytes: config.maxFrameBytes }),
  })
}
