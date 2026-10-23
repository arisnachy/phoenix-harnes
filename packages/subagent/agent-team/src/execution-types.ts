/** Persistent external execution values owned by the Phoenix Team mission. */
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { Branded } from '@phoenix-ai/dsh-brand'
import type { TeamId } from './types.ts'
import type { ExecutionEngine, ExecutionCapability, ExecutionEngineStatus } from './execution-engine-types.ts'
export type { ExecutionEngine, ExecutionCapability, ExecutionEngineStatus } from './execution-engine-types.ts'

/** Identifies one reserved operation, including across process recovery. */
export type ExecutionId = Branded<'ExecutionId'>
/** Phoenix-owned operation request; the model selection comes from the Lead. */
export interface ExecutionRequest {
  readonly idempotencyKey: string
  readonly task: string
  readonly capabilities: readonly ExecutionCapability[]
  readonly engine?: ExecutionEngine
  /** Concrete caller-resolved worker route; this is not a model-facing input. */
  readonly selection?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
  /** Explicit native restrictions captured before admission; never model supplied. */
  readonly nativePolicy?: ExecutionNativePolicy
}
/** Native identifiers are references, never authentication material. */
export interface ExecutionBinding {
  readonly sessionId: string
  readonly turnId?: string
  readonly cursor?: string
}
/** Native execution restrictions captured with one Phoenix reservation. */
export interface ExecutionNativePolicy {
  /** Native provider id; Phoenix provider aliases remain on the snapshot. */
  readonly provider: string
  readonly model: string
  readonly agentRuntime: string
  readonly sandbox: string
  readonly approval: string
  readonly cwd: string
  /** Effective OpenClaw tool policy, including its host-owned profile fingerprint. */
  readonly toolPolicy: ExecutionToolPolicy
}
/** Effective tool allow/deny policy resolved by the native host. */
export interface ExecutionToolPolicy {
  readonly profile: string
  readonly allow: readonly string[]
  readonly deny: readonly string[]
  readonly profileHash: string
}
/** Dispatch stages distinguish a safe resume from an uncertain submission. */
export type ExecutionPhase = 'reserved' | 'prepared' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain'
/** Authoritative snapshot written into the owning Lead session. */
export interface ExecutionSnapshot {
  readonly id: ExecutionId
  readonly teamId: TeamId
  readonly missionId: string
  readonly cancellationEpoch: number
  readonly idempotencyKey: string
  readonly engine: ExecutionEngine
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly task: string
  readonly capabilities: readonly ExecutionCapability[]
  /** Immutable native restrictions for this reserved operation. */
  readonly nativePolicy?: ExecutionNativePolicy
  readonly phase: ExecutionPhase
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly binding?: ExecutionBinding
  readonly output?: string
  readonly errorCode?: string
}
/** Final native result; successful execution does not complete a mission. */
export interface ExecutionOutcome {
  readonly status: 'completed' | 'failed' | 'cancelled' | 'uncertain'
  readonly output?: string
  readonly errorCode?: string
}
/** Durable input receipt; uncertain submissions must never be automatically resent. */
export interface ExecutionInputReceipt {
  readonly executionId: ExecutionId
  readonly idempotencyKey: string
  readonly text: string
  readonly phase: 'reserved' | 'submitted' | 'uncertain'
}
/** Only these metadata events may enter the durable progress journal. */
export interface ExecutionProgress {
  readonly kind: 'tool-started' | 'tool-completed' | 'reasoning' | 'output' | 'waiting-approval'
  readonly nativeEventId: string
  readonly toolName?: string
}
/** Capability passed to an adapter for exactly one execution epoch. */
export interface ExecutionContext {
  readonly root: Agent
  readonly snapshot: ExecutionSnapshot
  readonly signal: AbortSignal
  /** Bounded, provenance-backed recall already committed in the owning Session. */
  readonly sharedMemory: string
  /** Must commit before the adapter starts the corresponding native side effect. */
  checkpoint(phase: 'prepared' | 'dispatching' | 'running', binding?: ExecutionBinding): Promise<void>
  /** Publishes bounded metadata only, not command arguments or credentials. */
  progress(event: ExecutionProgress): Promise<void>
}
/** Trusted host-only input used to resolve native restrictions before reservation flush. */
export interface ExecutionNativePolicyRequest {
  /** Globally unique native task identity, shared by reservation and Gateway dispatch. */
  readonly executionId: ExecutionId
  readonly root: Agent
  readonly engine: ExecutionEngine
  readonly idempotencyKey: string
  readonly selection: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
  readonly capabilities: readonly ExecutionCapability[]
}
/** Runtime providers own native transport, approval restrictions, and teardown. */
export interface ExecutionAdapter {
  readonly engine: ExecutionEngine
  probe(): Promise<ExecutionEngineStatus>
  /** Resolve host-owned effective restrictions; never consume model task text or request.nativePolicy. */
  resolveNativePolicy?(request: ExecutionNativePolicyRequest): Promise<ExecutionNativePolicy | undefined>
  run(context: ExecutionContext): Promise<ExecutionOutcome>
  /** Inspect/rejoin the saved native operation; never blindly submit a new task. */
  recover(context: ExecutionContext): Promise<ExecutionOutcome>
  /** Direct the same live native turn, without starting a replacement task. */
  steer?(context: Pick<ExecutionContext, 'root' | 'snapshot' | 'signal'>, text: string): Promise<void>
}

declare module '@phoenix-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Persisted before native steering; transport uncertainty prevents blind retries. */
    'team/execution-input': { readonly version: 1 } & ExecutionInputReceipt
    /** Versioned whole execution value committed before native dispatch. */
    'team/execution': { readonly version: 1; readonly snapshot: ExecutionSnapshot }
    /** Metadata from one native event, deduplicated within the execution. */
    'team/execution-progress': { readonly version: 1; readonly executionId: ExecutionId; readonly event: ExecutionProgress }
    /** Selective memory supplied to an external execution; never re-indexed as a new memory. */
    'team/execution-context': { readonly version: 1; readonly executionId: ExecutionId; readonly content: string; readonly memoryIds: readonly string[] }
  }
}
