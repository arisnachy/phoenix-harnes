import type { Agent } from '@phoenix-ai/dsh-agent'
import type { HostConnectionHandle } from '@phoenix-ai/dsh-client-connection'
import type { RpcResult } from '@phoenix-ai/dsh-host-apiproxy/api'
import type { HardnessService, CapabilityNeed } from '@phoenix-ai/dsh-hardness'
import type { SessionId } from '@phoenix-ai/dsh-session/types'
import type { ToolRuntime } from '@phoenix-ai/dsh-tools'
import type { CodeRunResult, CodeRuntime } from '@phoenix-ai/dsh-code-runtime'
import type { ApprovalService } from '@phoenix-ai/dsh-user-approval'
import { AcquisitionRegistry, type CapabilityBuilder } from './acquisition-registry.ts'
import { createUserApprovalBroker } from './user-approval-broker.ts'
import type { CapabilityApproval, CapabilityExecutor } from './execution-bridge.ts'
import { ArtifactRuntime } from './artifact-runtime.ts'
import { runHardnessMission, type HardnessMissionResult } from './mission-orchestrator.ts'
import { createHardnessMissionAudit } from './mission-audit.ts'
import type { OpenClawCapabilityBroker } from './openclaw/broker.ts'

/** Wire payload accepted by the loopback HARDNESS mission RPC. */
export interface HardnessMissionRpcPayload {
  readonly sessionId: string
  readonly callId: string
  readonly need: CapabilityNeed
  readonly args: unknown
}

/** Input accepted by a direct model-facing HARDNESS mission runner. */
export interface HardnessMissionRunnerInput {
  readonly need: CapabilityNeed
  readonly args: unknown
  readonly context: import('./execution-bridge.ts').CapabilityExecutionContext
}

/** Direct governed runner shared by model-facing tools and host RPC adapters. */
export interface HardnessMissionRunner {
  readonly run: (input: HardnessMissionRunnerInput) => Promise<HardnessMissionResult>
}

/** Live PHOENIX services required to mount the governed HARDNESS mission runtime. */
export interface HardnessMissionRuntimeDependencies {
  readonly connection: HostConnectionHandle
  readonly agents: { get: (id: SessionId) => Agent | undefined }
  readonly approval: ApprovalService
  readonly hardness: HardnessService
  readonly tools: Pick<ToolRuntime, 'execute'>
  readonly acquisition: AcquisitionRegistry
  readonly executor?: CapabilityExecutor
  /** Optional isolated code runtime used by the universal artifact surface. */
  readonly codeRuntime?: CodeRuntime
}

function failure(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function payload(value: unknown): HardnessMissionRpcPayload | undefined {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || typeof value.callId !== 'string' || !isRecord(value.need)) return undefined
  return { sessionId: value.sessionId, callId: value.callId, need: value.need as unknown as CapabilityNeed, args: value.args }
}

interface ArtifactExecutionRpcPayload {
  readonly sessionId: string
  readonly program: string
  readonly language: string
}

function artifactPayload(value: unknown): ArtifactExecutionRpcPayload | undefined {
  if (!isRecord(value)
    || typeof value.sessionId !== 'string'
    || typeof value.program !== 'string'
    || typeof value.language !== 'string'
    || value.sessionId.trim() === ''
    || value.program.trim() === ''
    || value.language.trim() === '') return undefined
  return { sessionId: value.sessionId, program: value.program, language: value.language }
}

function createArtifacts(): ArtifactRuntime {
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

function createApproval(deps: Pick<HardnessMissionRuntimeDependencies, 'approval'>): CapabilityApproval {
  const userApproval = createUserApprovalBroker(deps.approval)
  return {
    request: async (surface, context) => {
      if (context.agent === undefined) return { kind: 'denied' as const, reason: 'HARDNESS requires a live agent session' }
      return userApproval.request(surface, {
        agent: context.agent,
        signal: context.signal,
      })
    },
  }
}

/** Create the governed mission runner without exposing connection or RPC authority.
 * @param deps - live HARDNESS, tool, approval, acquisition, and optional executor services.
 * @returns runner that applies the shared mission protocol for each input.
 */
export function createHardnessMissionRunner(deps: Omit<HardnessMissionRuntimeDependencies, 'connection' | 'agents'>): HardnessMissionRunner {
  const artifacts = createArtifacts()
  const approval = createApproval(deps)
  return {
    run: input => runHardnessMission({
      hardness: deps.hardness,
      acquisition: deps.acquisition,
      tools: deps.tools,
      approval,
      artifacts,
      ...typeof input.context.agent?.session?.append === 'function'
        ? { audit: createHardnessMissionAudit(input.context.agent.session) }
        : {},
      ...(deps.executor === undefined ? {} : { executor: deps.executor }),
      need: input.need,
      args: input.args,
      context: input.context,
    }),
  }
}

/**
 * Install the production HARDNESS RPC against live PHOENIX services.
 * @param deps - Live connection, agent, approval, HARDNESS, tool, acquisition, and optional executor services.
 * @returns Async disposer for the mounted loopback RPC handler.
 */
export function installHardnessMissionRuntime(deps: HardnessMissionRuntimeDependencies): () => Promise<void> {
  const runner = createHardnessMissionRunner(deps)
  return deps.connection.rpc.handle('/hardness', async (endpoint, raw, signal): Promise<RpcResult<HardnessMissionResult>> => {
    if (endpoint === 'artifact/run') {
      const input = artifactPayload(raw)
      if (input === undefined) return failure('HARDNESS artifact execution requires sessionId, language and program')
      if (deps.codeRuntime === undefined) return failure('HARDNESS artifact execution has no isolated code runtime')
      const agent = deps.agents.get(input.sessionId as SessionId)
      if (agent === undefined) return failure(`HARDNESS session is not active: ${input.sessionId}`)
      if (input.language !== deps.codeRuntime.language && !(input.language === 'javascript' && deps.codeRuntime.language === 'typescript')) {
        return failure(`HARDNESS code runtime does not support language: ${input.language}`)
      }
      try {
        const result: CodeRunResult = await deps.codeRuntime.run({ program: input.program, bindings: [], signal })
        return { ok: true, value: { kind: 'execution', result } as never }
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error))
      }
    }
    if (endpoint !== 'mission/run') return failure(`unknown HARDNESS endpoint: ${endpoint}`)
    const input = payload(raw)
    if (input === undefined) return failure('HARDNESS mission requires sessionId, callId and need')
    const agent = deps.agents.get(input.sessionId as SessionId)
    if (agent === undefined) return failure(`HARDNESS session is not active: ${input.sessionId}`)
    try {
      const result = await runner.run({
        need: input.need,
        args: input.args,
        context: { callId: input.callId as never, signal, agent },
      })
      return { ok: true, value: result }
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error))
    }
  }, { authority: 'loopback' })
}

/**
 * Build an acquisition registry from explicit providers; nothing is discovered implicitly.
 * @param hardness - HARDNESS registry that owns prepared capability descriptors.
 * @param builders - Explicit native acquisition providers to register in order.
 * @param openclaw - Optional OpenClaw broker used as a lazy acquisition provider.
 * @returns Configured acquisition registry.
 */
export function createHardnessAcquisition(
  hardness: HardnessService,
  builders: readonly CapabilityBuilder[] = [],
  openclaw?: Pick<OpenClawCapabilityBroker, 'acquire'>,
): AcquisitionRegistry {
  const acquisition = new AcquisitionRegistry(hardness)
  for (const builder of builders) acquisition.register(builder)
  if (openclaw !== undefined) {
    acquisition.register((need, signal) => openclaw.acquire(need, signal))
  }
  return acquisition
}
