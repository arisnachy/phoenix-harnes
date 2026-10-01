import { randomUUID } from 'node:crypto'
import type { Context } from '@phoenix-ai/cordis'
import type {
  McpConnectorChange,
  McpConnectorRegistry,
} from '@phoenix-ai/dsh-mcp-connector-registry'
import { wakeEvent, type WakeEvent } from './wake-engine.ts'

function lifecycleEvent(change: McpConnectorChange): WakeEvent {
  const entry = change.entry
  return wakeEvent({
    id: randomUUID(),
    source: 'mcp',
    eventType: change.kind === 'registered'
      ? 'connector.registered'
      : change.kind === 'status'
        ? 'connector.status.changed'
        : change.kind === 'tools'
          ? 'connector.tools.changed'
          : 'connector.removed',
    summary: `MCP connector ${change.serverName} is ${change.kind === 'disposed' ? 'removed' : entry.status}.`,
    attributes: {
      server_name: change.serverName,
      change: change.kind,
      transport: entry.transport,
      status: entry.status,
      tool_count: entry.toolNames.length,
      ...(entry.reasonCode === undefined ? {} : { reason_code: entry.reasonCode }),
    },
  })
}

/**
 * Bridge secret-free MCP lifecycle changes into Phoenix's existing Wake bus.
 * Provider-domain events continue to use the already-authenticated Wake ingress
 * or emit the existing `phoenix/wake-event` after provider-side normalization;
 * no second event authority or permission path is introduced here.
 * @param ctx - Cordis context that owns the existing Phoenix Wake event bus.
 * @param mcpConnectors - Optional live MCP connector registry to observe.
 * @returns Idempotent disposer for the MCP lifecycle subscription.
 */
export function installConnectorEventBridge(
  ctx: Context,
  mcpConnectors?: McpConnectorRegistry,
): () => void {
  if (mcpConnectors === undefined) return () => {}
  return mcpConnectors.subscribe((change) => {
    ctx.emit('phoenix/wake-event', lifecycleEvent(change))
  })
}
