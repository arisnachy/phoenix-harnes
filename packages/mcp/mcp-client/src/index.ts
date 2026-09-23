/**
 * MCP client bridge plugin: connects to an external MCP server and registers
 * its tools on `ctx.tools` under server-qualified public names
 * (`mcp__<serverName>__<rawName>`). Each plugin instance connects to one MCP
 * server; load multiple instances in `cordis.yml` for multiple servers.
 *
 * Namespace plugin (named exports, no default export). Lifecycle is
 * effect-scoped: disposal disconnects from the server, unregisters all tools,
 * and releases the `serverName` namespace reservation. HMR hot-swaps by
 * disposing the old instance and creating a new one; identical `serverName`
 * reproduces identical public tool names.
 *
 * @module @phoenix-ai/dsh-mcp-client
 */

import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@phoenix-ai/dsh-timeout'
import type { AuthorizationService } from '@phoenix-ai/dsh-authorization'
import { credentialRef, type CredentialProvider } from '@phoenix-ai/dsh-credentials'
import { RECONNECT_DEFAULTS, resolveReconnectPolicy, startConnection } from './connection.ts'
import type { ReconnectConfig } from './connection.ts'
import { McpOAuthController } from './oauth.ts'
import { checkPlatformCompatibility } from './platform.ts'
import type { SupportedPlatform } from './platform.ts'
import type { TransportOptions } from './transport.ts'
// Side-effect type import: declaration-merges `ctx.tools` onto Context.
import type {} from '@phoenix-ai/dsh-tools'

export type { McpResult } from './tools.ts'
export type { ReconnectConfig, ResolvedReconnectPolicy } from './connection.ts'
export type { SupportedPlatform } from './platform.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-client'

/** Services required by this plugin. */
export const inject = ['tools']

/** Default timeout for individual MCP tool calls (ms). */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** Default startup budget; slow or unavailable optional MCP servers do not block the Web UI. */
const DEFAULT_STARTUP_TIMEOUT_MS = 5_000

// Jev's pinned remote performs real routing/review work over MCP. Its previous
// 1.8s tool budget was shorter than normal network/model latency and produced
// false "Request timed out" failures even with a valid API key.
const JEV_SERVER_NAME = 'jev'
const JEV_ENDPOINT = 'https://www.jevai.org/api/mcp'
const JEV_API_KEY_REF = 'JEV_API_KEY'
const JEV_TOOL_TIMEOUT_MS = 30_000

function effectiveConnectionConfig(config: Config): Config {
  if (config.transport !== 'streamable-http'
    || config.serverName !== JEV_SERVER_NAME
    || config.url !== JEV_ENDPOINT
    || config.bearerTokenRef !== JEV_API_KEY_REF) return config
  if (config.toolCallTimeoutMs >= JEV_TOOL_TIMEOUT_MS) return config
  return { ...config, toolCallTimeoutMs: JEV_TOOL_TIMEOUT_MS }
}

/** Valid `serverName`, kept below the public tool-name budget. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Live `serverName` reservations per app, keyed off `ctx.root` (multiple apps
 * in one process — tests — must not see each other's names). A duplicate
 * namespace is a configuration error surfaced at plugin load, never silent
 * shadowing.
 */
const activeServerNames = new WeakMap<Context, Set<string>>()

// ---- Config ----

/** Config for connecting to an MCP server via a spawned child process over stdio. */
export interface StdioConfig {
  /** Selects child-process stdio transport. */
  transport: 'stdio'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live mcp-client instances.
   */
  serverName: string
  /** Executable used to start the server. */
  command: string
  /** Arguments passed directly, without shell interpolation. */
  args: string[]
  /** Extra env vars merged on top of scrubbed ambient env. */
  env: Record<string, string>
  /** Working directory for the child process. */
  cwd: string
  /** Host platforms on which this stdio server may run; omission is cross-platform unless Phoenix knows the server is platform-bound. */
  supportedPlatforms?: SupportedPlatform[]
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Maximum time to wait for initial connection and tool discovery before boot continues. */
  startupTimeoutMs?: number
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Config for connecting to an MCP server over Streamable HTTP (SSE). */
export interface StreamableHttpConfig {
  /** Selects Streamable HTTP transport. */
  transport: 'streamable-http'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live mcp-client instances.
   */
  serverName: string
  /** MCP endpoint URL. */
  url: string
  /** Additional headers attached to MCP requests. */
  headers: Record<string, string>
  /**
   * Optional PHOENIX credential reference used as a Bearer token.
   * The persisted MCP config stores only the reference name; the secret is
   * resolved by the credential service when a transport generation connects.
   */
  bearerTokenRef?: string
  /** Whether to attach the host-managed OAuth provider when available. */
  oauth?: boolean
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Maximum time to wait for initial connection and tool discovery before boot continues. */
  startupTimeoutMs?: number
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Configuration for one stdio or Streamable HTTP MCP server. */
export type Config = StdioConfig | StreamableHttpConfig

const Reconnect: z<ReconnectConfig> = z.object({
  enabled: z.boolean().default(RECONNECT_DEFAULTS.enabled),
  initialDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(RECONNECT_DEFAULTS.initialDelayMs),
  maxDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(RECONNECT_DEFAULTS.maxDelayMs),
  maxAttempts: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(RECONNECT_DEFAULTS.maxAttempts),
})

export const Config = z.union([
  z.object({
    transport: z.const('stdio'),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    command: z.string().required(),
    args: z.array(String).default([]),
    env: z.dict(String).default({}),
    cwd: z.string().default(''),
    supportedPlatforms: z.array(String).default([]),
    toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z.boolean().default(false),
    startupTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STARTUP_TIMEOUT_MS),
    reconnect: Reconnect,
  }),
  z.object({
    transport: z.const('streamable-http'),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    url: z.string().required(),
    headers: z.dict(String).default({}),
    bearerTokenRef: z.string(),
    oauth: z.boolean().default(true),
    toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z.boolean().default(false),
    startupTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STARTUP_TIMEOUT_MS),
    reconnect: Reconnect,
  }),
]) as unknown as z<Config>

// ---- Plugin apply ----

/**
 * Connect one MCP server and publish its initial tool generation before activation.
 * This entry remains explicitly `async`: Cordis treats a prototype-bearing
 * ordinary function as a constructor, whose returned Promise is not startup work.
 * @param ctx - plugin context carrying the tool registry.
 * @param config - resolved transport and server namespace configuration.
 * @returns startup readiness after connection and initial tool discovery settle.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  // Platform-bound stdio servers must be rejected before startConnection() can
  // construct an SDK transport and spawn a child process. This keeps persisted
  // XcodeBuildMCP configs harmless on Windows/Linux and prevents pointless
  // reconnect loops around an executable that can never work on this host.
  if (config.transport === 'stdio') {
    const compatibility = checkPlatformCompatibility(config)
    if (!compatibility.compatible) {
      const supported = compatibility.supportedPlatforms?.join(', ') ?? 'none'
      const message = `mcp-client(${config.serverName}): incompatible host platform ${compatibility.platform}; supported platform(s): ${supported}`
      ctx.logger.warn(`${message} — skipping MCP server before process spawn`)
      if (config.failOnStartupError) throw new Error(message)
      return
    }
  }

  // Fail loud at load: reconnect misconfiguration (including programmatic
  // construction that bypassed Schemastery) rejects THIS instance before any
  // effect registers.
  const reconnect = resolveReconnectPolicy(config.reconnect, `mcp-client(${config.serverName}): reconnect`)
  const startupTimeoutMs = config.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS

  // Reserve the namespace next: a duplicate `serverName` fails THIS instance
  // at load with an actionable error and leaves the earlier instance intact.
  ctx.effect(() => {
    let names = activeServerNames.get(ctx.root)
    if (!names) {
      names = new Set()
      activeServerNames.set(ctx.root, names)
    }
    if (names.has(config.serverName)) {
      throw new Error(
        `mcp-client: serverName "${config.serverName}" is already in use by another mcp-client instance — pick a unique serverName in cordis.yml`,
      )
    }
    names.add(config.serverName)
    return () => void names.delete(config.serverName)
  }, 'mcp-client.serverName')

  // The registry is a model-facing status projection, not a required part of
  // the transport seam. Keeping the lookup optional preserves minimal test and
  // embedded compositions while the base profile mounts the shared service.
  const mcpConnectors = ctx.get('mcpConnectors')
  let requestReconnect: (() => void) | undefined
  const registration = mcpConnectors?.register({
    serverName: config.serverName,
    transport: config.transport,
    reconnect: () => { requestReconnect?.() },
  })

  // The supervisor owns the client/transport generations, the reconnect
  // loop, and the live tool registrations; disposal stops reconnection,
  // quiesces in-flight work, and unregisters the current generation.
  const authorization = ctx.get('authorization') as AuthorizationService | undefined
  const credentials = ctx.get('credentials') as CredentialProvider | undefined
  let oauthController: McpOAuthController | undefined
  let transportOptions: TransportOptions | undefined
  if (config.transport === 'streamable-http' && config.oauth !== false
    && authorization !== undefined && credentials !== undefined) {
    oauthController = new McpOAuthController(credentials, config.serverName, config.url)
    await oauthController.ready
    transportOptions = {
      authProvider: oauthController.provider(() => {
        ctx.logger.info(`mcp-client(${config.serverName}): authorization is required`)
      }),
    }
  }
  if (config.transport === 'streamable-http' && config.bearerTokenRef !== undefined) {
    const ref = credentialRef(config.bearerTokenRef)
    if (credentials !== undefined) {
      transportOptions = {
        ...transportOptions,
        resolveBearerToken: async () => (await credentials.resolve(ref))?.value,
      }
    }
  }

  const connection = startConnection(ctx, effectiveConnectionConfig(config), reconnect, registration, transportOptions)
  requestReconnect = connection.reconnect

  if (oauthController !== undefined && authorization !== undefined && credentials !== undefined) {
    const controller = oauthController
    ctx.effect(() => authorization.registerFlow({
      key: controller.key,
      label: `MCP ${config.serverName}`,
      methods: [{ id: 'oauth', label: `Authorize ${config.serverName}` }],
      inspect: async () => {
        // Credential presence is not connector health. A server can reject an
        // expired/revoked token while the record still exists; surface that as
        // reconnect-required so Settings and connector_list do not claim the
        // MCP is connected merely because stale credentials are stored.
        const lifecycle = mcpConnectors?.list().find(entry => entry.serverName === config.serverName)
        if (lifecycle?.status === 'auth-required') return undefined
        return (await controller.isAuthorized())
          ? { kind: 'account', provider: `MCP ${config.serverName}`, accountType: 'oauth' }
          : undefined
      },
      disconnect: async () => {
        await controller.disconnect()
        connection.reconnect()
      },
      run: async (session) => {
        await controller.authorize(session)
        connection.reconnect()
      },
    }), 'mcp-client.oauth-flow')
    ctx.effect(() => () => {
      // Cancel the authorization attempt before closing its callback server.
      // Otherwise the pending callback rejection escapes as a load failure
      // while the Host is restarting or disposing this plugin.
      authorization.cancel(controller.key)
      void controller.close()
    }, 'mcp-client.oauth-callback')
  }

  ctx.effect(() => {
    return async () => {
      // Host replacement must not overlap stdio MCP children from the old
      // generation with children spawned by the replacement Host. The
      // connection supervisor already owns a bounded process-close barrier;
      // await it here instead of fire-and-forget disposal.
      await connection.dispose()
      registration?.dispose()
    }
  }, 'mcp-client.connection')

  // Wait only for the configured startup budget. Optional external servers
  // must not hold the Web UI behind package installation, authentication, or
  // an unavailable network; the supervisor continues its bounded reconnect
  // loop in the background. Strict startup still treats the timeout as fatal.
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<{ error: Error }>((resolve) => {
    timer = setTimeout(() => {
      const error = new Error(`mcp-client(${config.serverName}): startup timeout after ${startupTimeoutMs}ms`)
      ctx.logger.warn(`${error.message}; continuing boot while the connector retries in the background`)
      resolve({ error })
    }, startupTimeoutMs)
    timer.unref()
  })
  const outcome = await Promise.race([connection.ready, timeout])
  if (timer !== undefined) clearTimeout(timer)
  if (outcome.error !== undefined && config.failOnStartupError) {
    throw new Error(`mcp-client(${config.serverName}): initial connection or tool synchronization failed`, { cause: outcome.error })
  }
}
