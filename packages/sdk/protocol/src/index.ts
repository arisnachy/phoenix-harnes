/**
 * Shared wire protocol for the PHOENIX SDK runtime: the
 * newline-delimited JSON-RPC stdio transport plus the named request, result,
 * and notification types both wire ends speak. The runtime server plugin
 * (`@phoenix-ai/dsh-sdk-jsonrpc-server`) serves this protocol; SDK clients
 * (`@phoenix-ai/dsh-sdk-client`, the Python SDK) drive it.
 *
 * @module @phoenix-ai/dsh-sdk-protocol
 */

export { JsonRpcLineTransport, JsonRpcResponseError } from './transport.ts'
export { HARNESS_SDK_PROTOCOL_VERSION } from './types.ts'
export type { JsonRpcTransportPeer } from './transport.ts'
export type {
  HarnessSdkCapabilities,
  HarnessSdkNotificationMap,
  HarnessSdkRequestMap,
  InitializeParams,
  InitializeResult,
  SdkRunStatus,
  SessionCloseResult,
  SessionEventNotification,
  SessionInterruptResult,
  SessionLifecycleParams,
  SessionStatusNotification,
  SessionPromptParams,
  SessionPromptResult,
  SubagentFinishedNotification,
  SubagentStartedNotification,
} from './types.ts'
