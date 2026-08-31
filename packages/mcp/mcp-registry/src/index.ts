/** Secret-free live MCP connector state registry (`ctx.mcpConnectors`). */

import { Context, Service } from '@phoenix-ai/cordis'

declare module '@phoenix-ai/cordis' {
  interface Context {
    mcpConnectors: McpConnectorRegistry
  }
}

/** Transport families exposed by the MCP connector inventory. */
export type McpConnectorTransport = 'stdio' | 'streamable-http'

/** Lifecycle states that a model can act on without seeing provider details. */
export type McpConnectorStatus = 'starting' | 'ready' | 'disconnected' | 'failed' | 'auth-required'

/** Stable reason codes for an MCP lifecycle state. */
export type McpConnectorReasonCode =
  | 'connection-failed'
  | 'connection-lost'
  | 'authorization-required'
  | 'retry-exhausted'

/** Secret-free state for one registered MCP server. */
export interface McpConnectorEntry {
  readonly serverName: string
  readonly transport: McpConnectorTransport
  readonly status: McpConnectorStatus
  readonly toolNames: readonly string[]
  readonly reasonCode?: McpConnectorReasonCode
}

/** Registration handle owned by one MCP client instance. */
export interface McpConnectorRegistration {
  /** Publish a lifecycle state and optional stable reason code. */
  setStatus(status: McpConnectorStatus, reasonCode?: McpConnectorReasonCode): void
  /** Replace the public tool names for the current server generation. */
  setTools(toolNames: readonly string[]): void
  /** Remove this server from the registry; safe to call more than once. */
  dispose(): void
}

/** Input needed to register one MCP server identity. */
export interface McpConnectorRegistrationInput {
  readonly serverName: string
  readonly transport: McpConnectorTransport
}

interface MutableEntry {
  readonly serverName: string
  readonly transport: McpConnectorTransport
  status: McpConnectorStatus
  toolNames: string[]
  reasonCode?: McpConnectorReasonCode
}

/**
 * Process-local MCP lifecycle registry. It stores no connection settings,
 * credentials, URLs, headers, environment variables, or provider errors.
 */
export class McpConnectorRegistry extends Service {
  private readonly entries = new Map<string, MutableEntry>()

  constructor(ctx: Context) {
    super(ctx, 'mcpConnectors')
  }

  /**
   * Register one server identity in stable insertion order.
   * @param input - secret-free server identity and transport.
   * @returns a handle that publishes state and removes the entry.
   */
  register(input: McpConnectorRegistrationInput): McpConnectorRegistration {
    if (this.entries.has(input.serverName)) {
      throw new Error(`mcp connector "${input.serverName}" is already registered`)
    }
    const entry: MutableEntry = {
      serverName: input.serverName,
      transport: input.transport,
      status: 'starting',
      toolNames: [],
    }
    this.entries.set(input.serverName, entry)
    let disposed = false
    const dispose = (): void => {
      if (disposed) return
      disposed = true
      if (this.entries.get(input.serverName) === entry) this.entries.delete(input.serverName)
    }
    this.ctx.effect(() => dispose, `mcpConnectors.${input.serverName}`)
    return {
      setStatus: (status, reasonCode): void => {
        if (disposed) return
        entry.status = status
        if (reasonCode === undefined) delete entry.reasonCode
        else entry.reasonCode = reasonCode
      },
      setTools: (toolNames): void => {
        if (disposed) return
        entry.toolNames = [...new Set(toolNames)]
      },
      dispose,
    }
  }

  /**
   * Return detached entries in registration order.
   * @returns snapshots safe to pass to model-facing projection code.
   */
  list(): readonly McpConnectorEntry[] {
    return [...this.entries.values()].map(entry => ({
      serverName: entry.serverName,
      transport: entry.transport,
      status: entry.status,
      toolNames: [...entry.toolNames],
      ...(entry.reasonCode === undefined ? {} : { reasonCode: entry.reasonCode }),
    }))
  }
}

export default McpConnectorRegistry
