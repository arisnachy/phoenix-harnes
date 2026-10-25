/** Host-free execution-engine facts shared by the settings client and Host RPC. */
export type ExecutionEngine = 'internal' | 'codex' | 'openclaw'
/** Capabilities must be verified by the adapter before routing. */
export type ExecutionCapability = 'conversation' | 'code' | 'artifact' | 'browser' | 'connector' | 'automation'
/** Public readiness, with no credentials or native account contents. */
export interface ExecutionEngineStatus {
  readonly engine: ExecutionEngine
  readonly connected: boolean
  readonly version: string
  readonly capabilities: readonly ExecutionCapability[]
  readonly providers: readonly string[]
  readonly diagnostic?: string
}
