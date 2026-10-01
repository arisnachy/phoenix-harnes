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
  /** Optional same-process recovery hook; never exposed by {@link list}. */
  readonly reconnect?: () => void
}

/** Secret-free registry change kinds consumable by event bridges and UI. */
export type McpConnectorChangeKind = 'registered' | 'status' | 'tools' | 'disposed'

/** Detached lifecycle/tool change emitted by the registry. */
export interface McpConnectorChange {
  readonly kind: McpConnectorChangeKind
  readonly serverName: string
  readonly entry: McpConnectorEntry
}

/** Listener for secret-free connector lifecycle changes. */
export type McpConnectorListener = (change: McpConnectorChange) => void

interface MutableEntry {
  readonly serverName: string
  readonly transport: McpConnectorTransport
  readonly reconnect?: () => void
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
  private readonly listeners = new Set<McpConnectorListener>()

  constructor(ctx: Context) {
    super(ctx, 'mcpConnectors')
  }

  /** Create one detached secret-free snapshot of a live mutable entry. */
  private snapshot(entry: MutableEntry): McpConnectorEntry {
    return {
      serverName: entry.serverName,
      transport: entry.transport,
      status: entry.status,
      toolNames: [...entry.toolNames],
      ...(entry.reasonCode === undefined ? {} : { reasonCode: entry.reasonCode }),
    }
  }

  private publish(kind: McpConnectorChangeKind, entry: MutableEntry): void {
    const change: McpConnectorChange = {
      kind,
      serverName: entry.serverName,
      entry: this.snapshot(entry),
    }
    for (const listener of this.listeners) {
      try {
        listener(change)
      } catch (error: unknown) {
        this.ctx.logger.warn(`mcp connector change listener failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /**
   * Subscribe to secret-free lifecycle/tool changes without exposing transport
   * configuration, credentials, URLs, provider errors, or reconnect callbacks.
   * @param listener - Synchronous observer removed by the returned disposer.
   * @returns Idempotent disposer.
   */
  subscribe(listener: McpConnectorListener): () => void {
    this.listeners.add(listener)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.listeners.delete(listener)
    }
  }

  /**
   * Register one server identity in stable insertion order.
   * @param input - Secret-free server identity and transport.
   * @returns A handle that publishes state and removes the entry.
   */
  register(input: McpConnectorRegistrationInput): McpConnectorRegistration {
    if (this.entries.has(input.serverName)) {
      throw new Error(`mcp connector "${input.serverName}" is already registered`)
    }
    const entry: MutableEntry = {
      serverName: input.serverName,
      transport: input.transport,
      ...(input.reconnect === undefined ? {} : { reconnect: input.reconnect }),
      status: 'starting',
      toolNames: [],
    }
    this.entries.set(input.serverName, entry)
    this.publish('registered', entry)
    let disposed = false
    const dispose = (): void => {
      if (disposed) return
      disposed = true
      if (this.entries.get(input.serverName) === entry) {
        this.entries.delete(input.serverName)
        this.publish('disposed', entry)
      }
    }
    this.ctx.effect(() => dispose, `mcpConnectors.${input.serverName}`)
    return {
      setStatus: (status, reasonCode): void => {
        if (disposed) return
        const changed = entry.status !== status || entry.reasonCode !== reasonCode
        entry.status = status
        if (reasonCode === undefined) delete entry.reasonCode
        else entry.reasonCode = reasonCode
        if (changed) this.publish('status', entry)
      },
      setTools: (toolNames): void => {
        if (disposed) return
        const next = [...new Set(toolNames)]
        const changed = next.length !== entry.toolNames.length || next.some((name, index) => name !== entry.toolNames[index])
        entry.toolNames = next
        if (changed) this.publish('tools', entry)
      },
      dispose,
    }
  }

  /**
   * Request an immediate reconnect for one registered server.
   * This is a same-process control seam: the callback itself is never returned
   * by {@link list}, so model/browser projections remain secret-free.
   * @param serverName - Stable MCP namespace to reconnect.
   * @returns true when a live registration accepted the request.
   */
  reconnect(serverName: string): boolean {
    const entry = this.entries.get(serverName)
    if (entry?.reconnect === undefined) return false
    entry.reconnect()
    return true
  }

  /**
   * Return detached entries in registration order.
   * @returns snapshots safe to pass to model-facing projection code.
   */
  list(): readonly McpConnectorEntry[] {
    return [...this.entries.values()].map((entry) => this.snapshot(entry))
  }
}

export default McpConnectorRegistry
