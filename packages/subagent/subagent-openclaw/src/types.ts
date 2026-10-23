/** Public, credential-free types for the OpenClaw Gateway transport. */
import type { ExecutionNativePolicy, ExecutionToolPolicy } from '@phoenix-ai/dsh-agent-team'

/** JSON values accepted by the public Gateway protocol. */
export type OpenClawJsonValue = null | boolean | number | string | OpenClawJsonValue[] | { readonly [key: string]: OpenClawJsonValue }

/** Minimal operator scopes that this adapter can declare. */
export type OpenClawOperatorScope = 'operator.read' | 'operator.write'

/** Client identity advertised during the Gateway handshake. */
export interface OpenClawClientIdentity {
  readonly id?: string
  readonly version?: string
  readonly platform?: string
  readonly mode?: string
}

/** Authentication values kept by the host and never returned by this package. */
export interface OpenClawGatewayCredentials {
  readonly token?: string
  readonly password?: string
}

/** Options for constructing one loopback-first Gateway client. */
export interface OpenClawGatewayClientOptions {
  /** WebSocket endpoint. Plain `ws:` endpoints must resolve to loopback. */
  readonly url: string
  /** Gateway bearer credentials; these values never appear in results or errors. */
  readonly credentials?: OpenClawGatewayCredentials
  /** Handshake identity sent to the Gateway. */
  readonly client?: OpenClawClientIdentity
  /** Requested operator scopes; defaults to read and write only. */
  readonly scopes?: readonly OpenClawOperatorScope[]
  /** Lowest protocol version accepted by the client. */
  readonly minProtocol?: number
  /** Highest protocol version accepted by the client. */
  readonly maxProtocol?: number
  /** Total connection/request timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Maximum UTF-8 bytes accepted or sent in one text frame. */
  readonly maxFrameBytes?: number
  /** Optional WebSocket factory for a host-specific transport implementation. */
  readonly socketFactory?: (url: string) => OpenClawSocket
}

/** Small WebSocket interface required by the portable client. */
export interface OpenClawSocket {
  readonly readyState: number
  readonly bufferedAmount: number
  on(event: string, listener: (...args: unknown[]) => void): this
  once(event: string, listener: (...args: unknown[]) => void): this
  off?(event: string, listener: (...args: unknown[]) => void): this
  removeAllListeners?(event?: string): this
  send(data: string, callback?: (error?: Error) => void): void
  close(code?: number, reason?: string): void
  terminate?(): void
}

/** Redacted authentication data reported by `hello-ok`. */
export interface OpenClawHelloAuth {
  readonly role: string
  readonly scopes: readonly string[]
}

/** Handshake result with all credential-bearing fields removed. */
export interface OpenClawHello {
  readonly type: 'hello-ok'
  readonly protocol: number
  readonly server: {
    readonly version: string
    readonly connId: string
  }
  readonly features: {
    readonly methods: readonly string[]
    readonly events: readonly string[]
  }
  readonly auth: OpenClawHelloAuth
  readonly policy: {
    readonly maxPayload: number
    readonly maxBufferedBytes: number
    readonly tickIntervalMs: number
  }
}

/** Gateway capability inventory discovered during the handshake. */
export interface OpenClawCapabilities {
  readonly protocol: number
  readonly serverVersion: string
  readonly methods: readonly string[]
  readonly events: readonly string[]
  readonly scopes: readonly string[]
}

/** Public Gateway event frame. Payloads are bounded JSON values. */
export interface OpenClawEvent {
  readonly type: 'event'
  readonly event: string
  readonly payload?: OpenClawJsonValue
  readonly seq?: number
  readonly stateVersion?: number
  readonly [key: string]: OpenClawJsonValue | undefined
}

/** Notification emitted when a monotonic event sequence has a gap. */
export interface OpenClawEventGap {
  readonly expected: number
  readonly received: number
}

/** Read-only reconciliation snapshot after a connection or event gap. */
export interface OpenClawReconcileSnapshot {
  readonly health: OpenClawJsonValue
  readonly sessions: OpenClawJsonValue
  readonly lastEventSeq?: number
  readonly gapDetected: boolean
}

/** One agent execution request with an application-owned native idempotency key. */
export interface OpenClawAgentExecuteRequest {
  readonly message: string
  readonly idempotencyKey: string
  readonly agentId?: string
  readonly sessionKey?: string
  readonly deliver?: boolean
  readonly signal?: AbortSignal
}

/** Bounded route selected by the Phoenix Lead and verified by the Gateway. */
export interface OpenClawModelRoute {
  readonly provider: string
  readonly model: string
}

/** One existing-session message request with a native idempotency key. */
export interface OpenClawSessionExecuteRequest {
  readonly sessionKey: string
  readonly message: string
  readonly idempotencyKey: string
  readonly signal?: AbortSignal
}

/** Request for one Phoenix-owned session created through Gateway session control. */
export interface OpenClawSessionCreateRequest {
  readonly sessionKey: string
  readonly agentId: string
  readonly model: string
  readonly cwd: string
  readonly idempotencyKey: string
  readonly signal?: AbortSignal
}

/** Host-owned evidence for policy fields not exposed by the public session roster. */
export interface OpenClawNativePolicyAttestation {
  readonly agentId: string
  readonly sessionKey?: string
  readonly provider: string
  readonly model: string
  readonly agentRuntime: string
  readonly sandbox: string
  readonly approval: string
  readonly cwd: string
  readonly toolPolicy: ExecutionToolPolicy
  readonly taskIdempotencyKey?: string
}

/**
 * Resolves effective Gateway policy without receiving model text or credentials.
 * Returning undefined is an authorization failure.
 */
export type OpenClawPolicyAttester = (request: {
  readonly agentId: string
  readonly sessionKey?: string
  readonly expected: ExecutionNativePolicy
  readonly taskIdempotencyKey?: string
}) => Promise<OpenClawNativePolicyAttestation | undefined>

/** Sanitized result returned by the Gateway `agent` RPC. */
export type OpenClawAgentExecuteResult = OpenClawJsonValue

/** Sanitized acknowledgement returned by `chat.send`. */
export type OpenClawSessionExecuteResult = OpenClawJsonValue

/** Options for one raw public Gateway RPC. */
export interface OpenClawRequestOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

/** Public error fields for transport and Gateway failures. */
export interface OpenClawErrorOptions {
  readonly code?: string
  readonly retryable?: boolean
  readonly retryAfterMs?: number
  readonly details?: OpenClawJsonValue
}
