import type { Agent } from '@deepseek-ai/dsh-agent'
import type { HardnessService } from '@deepseek-ai/dsh-hardness'
import type { ToolDefinition, ToolRuntime } from '@deepseek-ai/dsh-tools'
import type ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { AcquisitionRegistry } from './acquisition-registry.ts'
import { ArtifactRuntime } from './artifact-runtime.ts'
import { searchCapabilityAtlas } from './capability-search.ts'
import type { CapabilityApproval, CapabilityExecutor } from './execution-bridge.ts'
import { runHardnessMission, type HardnessMissionResult } from './mission-orchestrator.ts'
import { createUserApprovalBroker } from './user-approval-broker.ts'

/** Live services used by the two small model-facing HARDNESS gateway tools. */
export interface HardnessModelToolsDependencies {
  readonly hardness: HardnessService
  readonly tools: Pick<ToolRuntime, 'register' | 'execute'>
  readonly approval: Pick<ApprovalService, 'request'>
  readonly acquisition: Pick<AcquisitionRegistry, 'acquireOrBuild'>
  readonly executor?: CapabilityExecutor
}

type ToolExecutionContextLike = {
  readonly callId?: unknown
  readonly signal?: AbortSignal
  readonly agent?: Agent
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function artifactRuntime(): ArtifactRuntime {
  const artifacts = new ArtifactRuntime()
  for (const mime of [
    'text/plain',
    'text/html',
    'application/vnd.hardness.app+html',
    'application/json',
    'text/css',
    'text/javascript',
  ]) {
    artifacts.register(mime, artifact => ({ kind: 'hardness-artifact', artifactId: artifact.id }))
  }
  return artifacts
}

function capabilityApproval(approval: Pick<ApprovalService, 'request'>): CapabilityApproval {
  const broker = createUserApprovalBroker(approval)
  return {
    request: async (surface, context) => {
      if (context.agent === undefined) return { kind: 'denied' as const, reason: 'HARDNESS requires a live agent session' }
      return broker.request(surface, { agent: context.agent, signal: context.signal })
    },
  }
}

function searchTool(deps: HardnessModelToolsDependencies): ToolDefinition {
  return {
    name: 'capability_search',
    description: 'Search the PHOENIX HARDNESS/ATLAS capability inventory for a small ranked set relevant to the current mission. Use this instead of guessing whether an injected capability exists.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Capability intent, task, provider, tool, or skill to find.' },
        limit: { type: 'integer', minimum: 1, maximum: 12, description: 'Maximum compact matches to return.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async (raw: unknown) => {
      const input = isRecord(raw) ? raw : {}
      const query = typeof input.query === 'string' ? input.query.trim() : ''
      if (query.length === 0) return { query, matches: [], error: 'query is required' }
      const limit = typeof input.limit === 'number' ? input.limit : 6
      return { query, matches: searchCapabilityAtlas(deps.hardness.list(), query, limit) }
    },
  } as unknown as ToolDefinition
}

function runTool(deps: HardnessModelToolsDependencies): ToolDefinition {
  const artifacts = artifactRuntime()
  const approval = capabilityApproval(deps.approval)
  return {
    name: 'capability_run',
    description: 'Run one PHOENIX capability intent through HARDNESS acquisition, approval, execution, artifact normalization, evidence, promotion, and quarantine. Use capability_search first when the correct capability family is uncertain.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Exact capability kind selected from capability_search or known mission requirements.' },
        payload: { description: 'Arguments forwarded to the governed capability executor.' },
        inputs: { type: 'array', items: { type: 'string' } },
        outputs: { type: 'array', items: { type: 'string' } },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    execute: async (raw: unknown, rawContext: unknown): Promise<HardnessMissionResult> => {
      const input = isRecord(raw) ? raw : {}
      const kind = typeof input.kind === 'string' ? input.kind.trim() : ''
      if (kind.length === 0) return { kind: 'blocked', reason: 'capability kind is required' }
      const context = isRecord(rawContext) ? rawContext as ToolExecutionContextLike : {}
      const signal = context.signal instanceof AbortSignal ? context.signal : new AbortController().signal
      const callId = context.callId ?? `capability-run:${kind}`
      const need = {
        kind,
        ...(Array.isArray(input.inputs) ? { inputs: input.inputs.filter((value): value is string => typeof value === 'string') } : {}),
        ...(Array.isArray(input.outputs) ? { outputs: input.outputs.filter((value): value is string => typeof value === 'string') } : {}),
      }
      return runHardnessMission({
        hardness: deps.hardness,
        acquisition: deps.acquisition,
        tools: deps.tools,
        approval,
        artifacts,
        ...(deps.executor === undefined ? {} : { executor: deps.executor }),
        need,
        args: input.payload,
        context: {
          callId: callId as never,
          signal,
          ...(context.agent === undefined ? {} : { agent: context.agent }),
        },
      })
    },
    output: {
      presentationMeta: (_input: unknown, value: unknown) => isRecord(value)
        && value.kind === 'completed'
        && isRecord(value.artifact)
        ? { artifact: value.artifact }
        : undefined,
    },
  } as unknown as ToolDefinition
}

/**
 * Register the bounded discovery and governed execution gateways exposed to the model.
 * The model never receives the full ATLAS and never gets direct execution authority.
 * @returns disposer retracting both gateway tools.
 */
export function installHardnessModelTools(deps: HardnessModelToolsDependencies): () => void {
  const disposers = [
    deps.tools.register(searchTool(deps)),
    deps.tools.register(runTool(deps)),
  ]
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (let index = disposers.length - 1; index >= 0; index -= 1) disposers[index]?.()
  }
}
