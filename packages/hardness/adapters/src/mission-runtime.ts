import type { Agent } from '@deepseek-ai/dsh-agent'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { HardnessService, CapabilityNeed } from '@deepseek-ai/dsh-hardness'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import { AcquisitionRegistry, type CapabilityBuilder } from './acquisition-registry.ts'
import { createUserApprovalBroker } from './user-approval-broker.ts'
import type { CapabilityApproval, CapabilityExecutor } from './execution-bridge.ts'
import { ArtifactRuntime } from './artifact-runtime.ts'
import { runHardnessMission, type HardnessMissionResult } from './mission-orchestrator.ts'
import type { OpenClawCapabilityBroker } from './openclaw/broker.ts'

export interface HardnessMissionRpcPayload {
  readonly sessionId: string
  readonly callId: string
  readonly need: CapabilityNeed
  readonly args: unknown
}

export interface HardnessMissionRuntimeDependencies {
  readonly connection: HostConnectionHandle
  readonly agents: { get: (id: SessionId) => Agent | undefined }
  readonly approval: ApprovalService
  readonly hardness: HardnessService
  readonly tools: Pick<ToolRuntime, 'execute'>
  readonly acquisition: AcquisitionRegistry
  readonly executor?: CapabilityExecutor
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

/** Install the production HARDNESS RPC against live PHOENIX services. */
export function installHardnessMissionRuntime(deps: HardnessMissionRuntimeDependencies): () => Promise<void> {
  const artifacts = new ArtifactRuntime()
  artifacts.register('text/plain', artifact => ({ kind: 'hardness-artifact', artifactId: artifact.id }))
  const userApproval = createUserApprovalBroker(deps.approval)
  const approval: CapabilityApproval = {
    request: async (surface, context) => {
      if (context.agent === undefined) return { kind: 'denied' as const, reason: 'HARDNESS requires a live agent session' }
      return userApproval.request(surface, {
        agent: context.agent,
        signal: context.signal,
      })
    },
  }
  return deps.connection.rpc.handle('/hardness', async (endpoint, raw, signal): Promise<RpcResult<HardnessMissionResult>> => {
    if (endpoint !== 'mission/run') return failure(`unknown HARDNESS endpoint: ${endpoint}`)
    const input = payload(raw)
    if (input === undefined) return failure('HARDNESS mission requires sessionId, callId and need')
    const agent = deps.agents.get(input.sessionId as SessionId)
    if (agent === undefined) return failure(`HARDNESS session is not active: ${input.sessionId}`)
    try {
      const result = await runHardnessMission({
        hardness: deps.hardness,
        acquisition: deps.acquisition,
        tools: deps.tools,
        approval,
        artifacts,
        ...(deps.executor !== undefined ? { executor: deps.executor } : {}),
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

/** Build a runtime with explicit providers; no provider is ever discovered implicitly. */
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
