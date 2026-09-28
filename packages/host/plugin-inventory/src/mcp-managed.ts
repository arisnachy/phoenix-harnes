import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@phoenix-ai/dsh-atomic-write'
import { dshHomePath } from '@phoenix-ai/dsh-home-paths'
import { searchOfficialMcpRegistry } from './mcp-registry.ts'
import type {
  ManagedMcpConnector,
  McpRegistryCandidate,
  McpRegistryInstallReceipt,
  McpRegistryInstallRequest,
  McpRegistrySearchSnapshot,
} from './types.ts'

const MCP_CLIENT_PACKAGE = '@phoenix-ai/dsh-mcp-client'
const SERVER_NAME_MAX = 32
const JEV_TOOL_TIMEOUT_MS = 30_000
const JEV_STARTUP_TIMEOUT_MS = 5_000
const JEV_LEGACY_TOOL_TIMEOUT_MS = 1_800
const JEV_LEGACY_STARTUP_TIMEOUT_MS = 1_200
const X_API_TOOL_TIMEOUT_MS = 60_000
const X_API_STARTUP_TIMEOUT_MS = 300_000

interface ManagedMcpReconnect {
  enabled: boolean
  initialDelayMs: number
  maxDelayMs: number
  maxAttempts: number
}

interface ManagedStreamableHttpMcpConfig {
  transport: 'streamable-http'
  serverName: string
  url: string
  headers: Record<string, string>
  oauth: boolean
  bearerTokenRef?: string
  toolCallTimeoutMs?: number
  startupTimeoutMs?: number
  failOnStartupError?: boolean
  reconnect?: ManagedMcpReconnect
}

interface ManagedStdioMcpConfig {
  transport: 'stdio'
  serverName: string
  command: string
  args: string[]
  env: Record<string, string>
  envCredentialRefs: Record<string, string>
  cwd: string
  toolCallTimeoutMs: number
  startupTimeoutMs: number
  failOnStartupError: boolean
  reconnect: ManagedMcpReconnect
}

type ManagedMcpConfig = ManagedStreamableHttpMcpConfig | ManagedStdioMcpConfig

/** Stable local MCP namespace for the pinned Jev connector. */
export const JEV_MCP_SERVER_NAME = 'jev'
/** Official pinned Jev Streamable HTTP MCP endpoint. */
export const JEV_MCP_URL = 'https://www.jevai.org/api/mcp'
/** Phoenix credential reference that holds the Jev API key outside loader config. */
export const JEV_API_KEY_REF = 'JEV_API_KEY'
/** Stable local MCP namespace for the official Binance Agent OS connector. */
export const BINANCE_AGENT_OS_SERVER_NAME = 'binance-agent-os'
/** Official Binance Agent OS Streamable HTTP MCP endpoint. */
export const BINANCE_AGENT_OS_URL = 'https://agent.binance.com/mcp/agentic'
/** Stable local MCP namespace for the official X API bridge. */
export const X_API_MCP_SERVER_NAME = 'x-api'
/** Official X API hosted MCP endpoint reached through xurl. */
export const X_API_MCP_URL = 'https://api.x.com/mcp'
/** Stable local MCP namespace for the official X documentation server. */
export const X_DOCS_MCP_SERVER_NAME = 'x-docs'
/** Official keyless X documentation MCP endpoint. */
export const X_DOCS_MCP_URL = 'https://docs.x.com/mcp'
/** Phoenix credential reference for the X developer OAuth client id. */
export const X_CLIENT_ID_REF = 'X_CLIENT_ID'
/** Phoenix credential reference for the X developer OAuth client secret. */
export const X_CLIENT_SECRET_REF = 'X_CLIENT_SECRET'

interface ManagedMcpRow {
  id: string
  name: typeof MCP_CLIENT_PACKAGE
  config: ManagedMcpConfig
}

interface ManagedMcpPatch {
  insert: ManagedMcpRow[]
}

/** Minimal Loader mutation seam needed for immediate MCP activation and rollback. */
export interface ManagedMcpLoader {
  create(options: { name: string; config: ManagedMcpConfig }): Promise<string>
  remove(id: string): Promise<void>
}

/** Injectable registry lookup used to re-verify a browser/model install request Host-side. */
export type ManagedMcpRegistrySearch = (
  request: { query: string; limit?: number },
) => Promise<McpRegistrySearchSnapshot>

/** Optional construction seams used by tests and alternate host embeddings. */
export interface ManagedMcpControllerOptions {
  readonly patchPath?: string
  readonly registrySearch?: ManagedMcpRegistrySearch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return isRecord(value) && Object.keys(value).length === 0
}

function xDocsMcpConfig(): ManagedStreamableHttpMcpConfig {
  return {
    transport: 'streamable-http',
    serverName: X_DOCS_MCP_SERVER_NAME,
    url: X_DOCS_MCP_URL,
    headers: {},
    oauth: false,
  }
}

function xApiMcpConfig(): ManagedStdioMcpConfig {
  return {
    transport: 'stdio',
    serverName: X_API_MCP_SERVER_NAME,
    command: 'npx',
    args: ['-y', '@xdevplatform/xurl', 'mcp', X_API_MCP_URL],
    env: {},
    envCredentialRefs: {
      CLIENT_ID: X_CLIENT_ID_REF,
      CLIENT_SECRET: X_CLIENT_SECRET_REF,
    },
    cwd: '',
    toolCallTimeoutMs: X_API_TOOL_TIMEOUT_MS,
    startupTimeoutMs: X_API_STARTUP_TIMEOUT_MS,
    failOnStartupError: false,
    reconnect: {
      enabled: true,
      initialDelayMs: 1000,
      maxDelayMs: 30_000,
      maxAttempts: 10,
    },
  }
}

function exactJson(value: unknown, expected: ManagedMcpConfig): boolean {
  return JSON.stringify(value) === JSON.stringify(expected)
}

function validXApiConfig(value: Record<string, unknown>): boolean {
  return exactJson(value, xApiMcpConfig())
}

function validHttpConfig(value: Record<string, unknown>): boolean {
  if (exactJson(value, xDocsMcpConfig())) return true
  if (typeof value.serverName !== 'string' || typeof value.url !== 'string'
    || typeof value.oauth !== 'boolean' || !isEmptyRecord(value.headers)) return false
  try {
    if (new URL(value.url).protocol !== 'https:') return false
  } catch {
    return false
  }

  // Registry-managed remotes and Binance remain OAuth-only and may not smuggle a secret ref.
  if (value.oauth) return value.bearerTokenRef === undefined

  // Keep accepting the exact retired Jev form only so older owner overlays can be parsed and removed.
  if (value.serverName !== JEV_MCP_SERVER_NAME
    || value.url !== JEV_MCP_URL
    || value.bearerTokenRef !== JEV_API_KEY_REF
    || (value.toolCallTimeoutMs !== JEV_TOOL_TIMEOUT_MS && value.toolCallTimeoutMs !== JEV_LEGACY_TOOL_TIMEOUT_MS)
    || (value.startupTimeoutMs !== JEV_STARTUP_TIMEOUT_MS && value.startupTimeoutMs !== JEV_LEGACY_STARTUP_TIMEOUT_MS)
    || value.failOnStartupError !== false) return false
  return exactReconnect(value.reconnect, 3)
}

function validConfig(value: unknown): value is ManagedMcpConfig {
  if (!isRecord(value)) return false
  if (value.transport === 'stdio') return validXApiConfig(value)
  return value.transport === 'streamable-http' && validHttpConfig(value)
}

function parseManagedRows(raw: string): ManagedMcpRow[] {
  const document: unknown = JSON.parse(raw)
  if (!Array.isArray(document) || document.length !== 1) {
    throw new Error('managed MCP patch must contain exactly one insert document')
  }
  const patch = document[0]
  if (!isRecord(patch) || !Array.isArray(patch.insert)) {
    throw new Error('managed MCP patch is missing its insert list')
  }
  return patch.insert.map((value, index) => {
    if (!isRecord(value) || typeof value.id !== 'string' || value.name !== MCP_CLIENT_PACKAGE || !validConfig(value.config)) {
      throw new Error(`managed MCP patch row ${index} is invalid`)
    }
    return {
      id: value.id,
      name: MCP_CLIENT_PACKAGE,
      config: value.config,
    }
  })
}

function renderManagedRows(rows: readonly ManagedMcpRow[]): string {
  const document: ManagedMcpPatch[] = [{ insert: [...rows] }]
  return `${JSON.stringify(document, null, 2)}\n`
}

async function readManagedRows(path: string): Promise<ManagedMcpRow[]> {
  try {
    return parseManagedRows(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function writeManagedRows(path: string, rows: readonly ManagedMcpRow[]): Promise<void> {
  await writeFileAtomic(path, renderManagedRows(rows), { mode: 0o600, dirMode: 0o700 })
}

function connectorOf(row: ManagedMcpRow): ManagedMcpConnector {
  return {
    entryId: row.id,
    serverName: row.config.serverName,
    url: row.config.transport === 'streamable-http' ? row.config.url : X_API_MCP_URL,
  }
}

function managedIdentity(config: ManagedMcpConfig): string {
  return config.transport === 'streamable-http'
    ? `http:${config.url}`
    : `stdio:${config.serverName}`
}

function isRetiredJevManagedRow(row: ManagedMcpRow): boolean {
  return row.config.serverName === JEV_MCP_SERVER_NAME
    || (row.config.transport === 'streamable-http' && row.config.url === JEV_MCP_URL)
}

function isRetiredJevCandidate(candidate: McpRegistryCandidate): boolean {
  if (candidate.remoteUrl === JEV_MCP_URL) return true
  const name = candidate.name.toLowerCase()
  const title = candidate.title.toLowerCase()
  return name === 'jev' || name.endsWith('/jev') || title === 'jev'
}

function isBinanceAgentOsManagedRow(row: ManagedMcpRow): boolean {
  return row.config.serverName === BINANCE_AGENT_OS_SERVER_NAME
    || (row.config.transport === 'streamable-http' && row.config.url === BINANCE_AGENT_OS_URL)
}

const X_MCP_SERVER_NAMES = new Set([X_API_MCP_SERVER_NAME, X_DOCS_MCP_SERVER_NAME])

function isXMcpManagedRow(row: ManagedMcpRow): boolean {
  return X_MCP_SERVER_NAMES.has(row.config.serverName)
}

function serverNameFor(candidate: McpRegistryCandidate): string {
  const tail = candidate.name.slice(candidate.name.lastIndexOf('/') + 1)
  const base = tail.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp'
  const digest = createHash('sha256').update(candidate.name).digest('hex').slice(0, 7)
  const maxBase = SERVER_NAME_MAX - digest.length - 1
  return `${base.slice(0, maxBase)}-${digest}`
}

function selectInstallableCandidate(
  snapshot: McpRegistrySearchSnapshot,
  request: McpRegistryInstallRequest,
): McpRegistryCandidate {
  const candidate = snapshot.candidates.find(value =>
    value.name === request.name && (request.version === undefined || value.version === request.version))
  if (candidate === undefined) {
    throw new Error('MCP registry candidate changed or is no longer available; search again before installing')
  }
  if (candidate.status !== 'active') {
    throw new Error(`MCP registry candidate ${candidate.name} is not active`)
  }
  if (candidate.remoteUrl === undefined) {
    throw new Error('Only registry-listed Streamable HTTP MCP servers can be installed automatically; review package-based servers manually')
  }
  return candidate
}

/**
 * Host-owned installer for safe remote MCPs. Registry installs are re-resolved
 * from the Official MCP Registry; pinned vendor integrations are admitted only
 * by exact configuration validators before this durable overlay is reloaded.
 */
export class ManagedMcpController {
  private readonly path: string
  private readonly registrySearch: ManagedMcpRegistrySearch

  /**
   * @param loader - Live Loader used for immediate activation and rollback.
   * @param options - Optional patch path and registry lookup overrides.
   */
  constructor(
    private readonly loader: ManagedMcpLoader,
    options: ManagedMcpControllerOptions = {},
  ) {
    this.path = options.patchPath ?? managedMcpPatchPath()
    this.registrySearch = options.registrySearch ?? searchOfficialMcpRegistry
  }

  private async installManagedConfig(
    config: ManagedMcpConfig,
    label: string,
  ): Promise<McpRegistryInstallReceipt> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    return withFileLock(this.path, async () => {
      const rows = await readManagedRows(this.path)
      const existing = rows.find(row => managedIdentity(row.config) === managedIdentity(config))
      if (existing !== undefined) {
        return { status: 'already-installed', connector: connectorOf(existing) }
      }
      const entryId = await this.loader.create({ name: MCP_CLIENT_PACKAGE, config })
      const row: ManagedMcpRow = { id: entryId, name: MCP_CLIENT_PACKAGE, config }
      try {
        await writeManagedRows(this.path, [...rows, row])
      } catch (error) {
        try {
          await this.loader.remove(entryId)
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            `failed to persist ${label} MCP and roll back live activation`,
          )
        }
        throw error
      }
      return { status: 'installed', connector: connectorOf(row) }
    }, { waitMs: 15_000 })
  }

  private async removeManagedRows(
    matches: (row: ManagedMcpRow) => boolean,
    label: string,
  ): Promise<boolean> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    return withFileLock(this.path, async () => {
      const rows = await readManagedRows(this.path)
      const removed = rows.filter(matches)
      if (removed.length === 0) return false

      // Persist removal first so a failed live unload cannot resurrect access
      // on the next Phoenix start.
      await writeManagedRows(this.path, rows.filter(row => !matches(row)))
      const failures: unknown[] = []
      for (const row of removed) {
        try {
          await this.loader.remove(row.id)
        } catch (error: unknown) {
          failures.push(error)
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `${label} was removed from persistent MCP config but one or more live entries could not be unloaded`,
        )
      }
      return true
    }, { waitMs: 15_000 })
  }

  /**
   * List PHOENIX-managed MCPs without exposing headers or credentials.
   * @returns Persisted managed connector identities and endpoints.
   */
  async snapshot(): Promise<readonly ManagedMcpConnector[]> {
    return (await readManagedRows(this.path))
      .filter(row => !isRetiredJevManagedRow(row))
      .map(connectorOf)
  }

  /**
   * Remove a legacy PHOENIX-managed Jev connector from persistence and the live Loader.
   * Generic registry-managed MCPs are left untouched.
   * @returns true when a legacy Jev row was retired.
   */
  async retireJev(): Promise<boolean> {
    return this.removeManagedRows(isRetiredJevManagedRow, 'Jev')
  }

  /**
   * Compatibility endpoint retained for old clients; Jev can no longer be installed by Phoenix.
   * @returns Rejected promise because Phoenix no longer installs Jev.
   */
  async configureJev(): Promise<McpRegistryInstallReceipt> {
    throw new Error('Jev integration is retired because new Jev accounts are unavailable; PHOENIX uses native routing instead')
  }

  /**
   * Install the pinned official Binance Agent OS MCP.
   * @returns Idempotent managed connector installation receipt.
   */
  async installBinanceAgentOs(): Promise<McpRegistryInstallReceipt> {
    return this.installManagedConfig({
      transport: 'streamable-http',
      serverName: BINANCE_AGENT_OS_SERVER_NAME,
      url: BINANCE_AGENT_OS_URL,
      headers: {},
      oauth: true,
    }, 'Binance Agent OS')
  }

  /**
   * Remove only the PHOENIX-managed Binance Agent OS MCP.
   * @returns true when one or more Binance Agent OS rows were removed.
   */
  async removeBinanceAgentOs(): Promise<boolean> {
    return this.removeManagedRows(isBinanceAgentOsManagedRow, 'Binance Agent OS')
  }

  /**
   * Install X's official keyless Docs MCP plus the official xurl OAuth bridge
   * for the hosted X API MCP. The bridge receives only credential references.
   * @returns Independent idempotent receipts for the API and Docs connectors.
   */
  async installXMcp(): Promise<{
    api: McpRegistryInstallReceipt
    docs: McpRegistryInstallReceipt
  }> {
    const docs = await this.installManagedConfig(xDocsMcpConfig(), 'X Docs')
    const api = await this.installManagedConfig(xApiMcpConfig(), 'X API')
    return { api, docs }
  }

  /**
   * Remove only the PHOENIX-managed X API and X Docs MCP entries.
   * @returns true when at least one X MCP entry was removed.
   */
  async removeXMcp(): Promise<boolean> {
    return this.removeManagedRows(isXMcpManagedRow, 'X')
  }

  /**
   * Install one exact active registry candidate with a concrete HTTPS remote.
   * The request never supplies an executable command or URL; the Host rechecks
   * both against registry metadata before mutating the Loader.
   * @param request - Registry name and optional exact version selected by the user/model.
   * @returns Idempotent installation receipt.
   */
  async install(request: McpRegistryInstallRequest): Promise<McpRegistryInstallReceipt> {
    const name = request.name.trim()
    if (name.length < 2) throw new Error('MCP registry install requires a valid server name')
    const snapshot = await this.registrySearch({ query: name, limit: 20 })
    const candidate = selectInstallableCandidate(snapshot, { ...request, name })
    if (isRetiredJevCandidate(candidate)) {
      throw new Error('Jev integration is retired and cannot be installed through the Official MCP Registry')
    }
    const remoteUrl = candidate.remoteUrl
    if (remoteUrl === undefined) {
      throw new Error('Registry candidate no longer exposes a Streamable HTTP endpoint')
    }
    return this.installManagedConfig({
      transport: 'streamable-http',
      serverName: serverNameFor(candidate),
      url: remoteUrl,
      headers: {},
      oauth: true,
    }, candidate.name)
  }
}

/**
 * Path to the generated MCP overlay consumed by the PHOENIX launcher.
 * @returns Absolute managed overlay path under DSH_HOME.
 */
export function managedMcpPatchPath(): string {
  return dshHomePath('mcp', 'managed.patch.yml')
}
