import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@phoenix-ai/dsh-atomic-write'
import { dshHomePath } from '@phoenix-ai/dsh-home-paths'
import { searchOfficialMcpRegistry } from './mcp-registry.ts'
import type {
  ManagedMcpConnector,
  ManagedMcpSource,
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
/** Stable local MCP namespace for the official Devpost Hackathons connector. */
export const DEVPOST_HACKATHONS_SERVER_NAME = 'devpost'
/** Official Devpost Hackathons Streamable HTTP MCP endpoint. */
export const DEVPOST_HACKATHONS_URL = 'https://devpost.com/mcp'
/** Stable local MCP namespace for the official X API bridge. */
export const X_API_MCP_SERVER_NAME = 'x-api'
/** Official X API hosted MCP endpoint reached through xurl. */
export const X_API_MCP_URL = 'https://api.x.com/mcp'
/** Dedicated MCP namespace for Phoenix's own X account. */
export const X_PHOENIX_API_MCP_SERVER_NAME = 'x-api-phoenix'
/** Public identity kinds supported by the managed X bridge. */
export type XMcpIdentity = 'user' | 'phoenix'
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
  source?: ManagedMcpSource
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

function devpostHackathonsMcpConfig(): ManagedStreamableHttpMcpConfig {
  return {
    transport: 'streamable-http',
    serverName: DEVPOST_HACKATHONS_SERVER_NAME,
    url: DEVPOST_HACKATHONS_URL,
    headers: {},
    oauth: true,
  }
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

function normalizeXUsername(username: string): string {
  const normalized = username.trim().replace(/^@/, '')
  if (!/^[A-Za-z0-9_]{1,15}$/.test(normalized)) {
    throw new Error('X username must be 1-15 characters and contain only letters, numbers, or underscores')
  }
  return normalized
}

function xApiMcpConfig(identity: XMcpIdentity = 'user', username?: string): ManagedStdioMcpConfig {
  const normalizedUsername = username === undefined ? undefined : normalizeXUsername(username)
  if (identity === 'phoenix' && normalizedUsername === undefined) {
    throw new Error('Phoenix-owned X identity requires its X username')
  }
  return {
    transport: 'stdio',
    serverName: identity === 'phoenix' ? X_PHOENIX_API_MCP_SERVER_NAME : X_API_MCP_SERVER_NAME,
    command: 'npx',
    args: normalizedUsername === undefined
      ? ['-y', '@xdevplatform/xurl', 'mcp', X_API_MCP_URL]
      : ['-y', '@xdevplatform/xurl', 'mcp', '-u', normalizedUsername, X_API_MCP_URL],
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
  if (exactJson(value, xApiMcpConfig())) return true
  if (!Array.isArray(value.args) || value.args.length !== 6
    || value.args[0] !== '-y'
    || value.args[1] !== '@xdevplatform/xurl'
    || value.args[2] !== 'mcp'
    || value.args[3] !== '-u'
    || typeof value.args[4] !== 'string'
    || value.args[5] !== X_API_MCP_URL) return false
  const identity: XMcpIdentity | undefined = value.serverName === X_API_MCP_SERVER_NAME
    ? 'user'
    : value.serverName === X_PHOENIX_API_MCP_SERVER_NAME ? 'phoenix' : undefined
  if (identity === undefined) return false
  try {
    return exactJson(value, xApiMcpConfig(identity, value.args[4]))
  } catch {
    return false
  }
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
  const reconnect = value.reconnect
  return isRecord(reconnect)
    && reconnect.enabled === true
    && reconnect.initialDelayMs === 1000
    && reconnect.maxDelayMs === 30_000
    && reconnect.maxAttempts === 3
}

function validConfig(value: unknown): value is ManagedMcpConfig {
  if (!isRecord(value)) return false
  if (value.transport === 'stdio') return validXApiConfig(value)
  return value.transport === 'streamable-http' && validHttpConfig(value)
}

function validManagedSource(value: unknown): value is ManagedMcpSource {
  if (!isRecord(value)) return false
  if (value.kind === 'registry') {
    return typeof value.name === 'string'
      && value.name.trim().length >= 2
      && (value.version === undefined || (typeof value.version === 'string' && value.version.trim().length > 0))
  }
  return value.kind === 'curated'
    && typeof value.connectorId === 'string'
    && value.connectorId.trim().length > 0
}

function parseManagedRows(raw: string): ManagedMcpRow[] {
  const document: unknown = JSON.parse(raw)
  if (!Array.isArray(document) || document.length !== 1) {
    throw new Error('managed MCP patch must contain exactly one insert document')
  }
  const patch: unknown = document[0]
  if (!isRecord(patch) || !Array.isArray(patch.insert)) {
    throw new Error('managed MCP patch is missing its insert list')
  }
  return patch.insert.map((value, index) => {
    if (!isRecord(value) || typeof value.id !== 'string' || value.name !== MCP_CLIENT_PACKAGE || !validConfig(value.config)) {
      throw new Error(`managed MCP patch row ${index} is invalid`)
    }
    if (value.source !== undefined && !validManagedSource(value.source)) {
      throw new Error(`managed MCP patch row ${index} has an invalid source`)
    }
    return {
      id: value.id,
      name: MCP_CLIENT_PACKAGE,
      config: value.config,
      ...(value.source === undefined ? {} : { source: value.source }),
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
    ...(row.source === undefined ? {} : { source: row.source }),
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

function isDevpostHackathonsManagedRow(row: ManagedMcpRow): boolean {
  return row.config.serverName === DEVPOST_HACKATHONS_SERVER_NAME
    || (row.config.transport === 'streamable-http' && row.config.url === DEVPOST_HACKATHONS_URL)
}

function isBinanceAgentOsManagedRow(row: ManagedMcpRow): boolean {
  return row.config.serverName === BINANCE_AGENT_OS_SERVER_NAME
    || (row.config.transport === 'streamable-http' && row.config.url === BINANCE_AGENT_OS_URL)
}

const X_MCP_SERVER_NAMES = new Set([
  X_API_MCP_SERVER_NAME,
  X_PHOENIX_API_MCP_SERVER_NAME,
  X_DOCS_MCP_SERVER_NAME,
])

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
    source?: ManagedMcpSource,
  ): Promise<McpRegistryInstallReceipt> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    return withFileLock(this.path, async () => {
      const rows = await readManagedRows(this.path)
      const existing = rows.find(row => managedIdentity(row.config) === managedIdentity(config))
      if (existing !== undefined) {
        return { status: 'already-installed', connector: connectorOf(existing) }
      }
      const entryId = await this.loader.create({ name: MCP_CLIENT_PACKAGE, config })
      const row: ManagedMcpRow = {
        id: entryId,
        name: MCP_CLIENT_PACKAGE,
        config,
        ...(source === undefined ? {} : { source }),
      }
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

  private async removeManagedRowsReceipt(
    matches: (row: ManagedMcpRow) => boolean,
  ): Promise<{ removed: boolean; liveUnloaded: boolean }> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    return withFileLock(this.path, async () => {
      const rows = await readManagedRows(this.path)
      const removed = rows.filter(matches)
      if (removed.length === 0) return { removed: false, liveUnloaded: true }

      // Persist removal first so a failed live unload cannot resurrect access
      // on the next Phoenix start.
      await writeManagedRows(this.path, rows.filter(row => !matches(row)))
      let liveUnloaded = true
      for (const row of removed) {
        try {
          await this.loader.remove(row.id)
        } catch {
          liveUnloaded = false
        }
      }
      return { removed: true, liveUnloaded }
    }, { waitMs: 15_000 })
  }

  private async removeManagedRows(
    matches: (row: ManagedMcpRow) => boolean,
    label: string,
  ): Promise<boolean> {
    const result = await this.removeManagedRowsReceipt(matches)
    if (result.removed && !result.liveUnloaded) {
      throw new Error(
        `${label} was removed from persistent MCP config but one or more live entries could not be unloaded`,
      )
    }
    return result.removed
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
   * Remove exactly one PHOENIX-managed connector. Persistence is authoritative:
   * a failed live unload never restores the entry to the managed overlay.
   * @param request - Exact managed entry id to remove.
   * @returns Whether persistence was removed and whether live unload also completed.
   */
  async remove(request: { entryId: string }): Promise<{ removed: boolean; liveUnloaded: boolean }> {
    const entryId = request.entryId.trim()
    if (entryId.length === 0) throw new Error('managed MCP removal requires a valid entry id')
    return this.removeManagedRowsReceipt(row => row.id === entryId)
  }

  /**
   * Repair a managed registry connector from its persisted trusted source.
   * Legacy rows without source metadata stay removable but are not guessed.
   * @param request - Exact managed entry id to repair.
   * @returns Installation receipt for the freshly re-resolved connector.
   */
  async repair(request: { entryId: string }): Promise<McpRegistryInstallReceipt> {
    const entryId = request.entryId.trim()
    if (entryId.length === 0) throw new Error('managed MCP repair requires a valid entry id')
    const row = (await readManagedRows(this.path)).find(candidate => candidate.id === entryId)
    if (row === undefined) throw new Error(`managed MCP entry "${entryId}" is not installed`)
    if (row.source === undefined) {
      throw new Error(`managed MCP entry "${entryId}" has no trusted repair source`)
    }
    if (row.source.kind === 'curated') {
      if (row.source.connectorId !== 'devpost') {
        throw new Error(`managed MCP entry "${entryId}" uses an unsupported curated repair source`)
      }
      const removed = await this.removeManagedRowsReceipt(candidateRow => candidateRow.id === entryId)
      if (!removed.removed) throw new Error(`managed MCP entry "${entryId}" disappeared during repair`)
      if (!removed.liveUnloaded) {
        throw new Error(
          `managed MCP entry "${entryId}" was removed from persistence but its live runtime could not be unloaded; restart Phoenix before retrying repair`,
        )
      }
      return this.installDevpostHackathons()
    }

    const snapshot = await this.registrySearch({ query: row.source.name, limit: 20 })
    const candidate = selectInstallableCandidate(snapshot, {
      name: row.source.name,
      ...(row.source.version === undefined ? {} : { version: row.source.version }),
    })
    if (isRetiredJevCandidate(candidate)) {
      throw new Error('Jev integration is retired and cannot be repaired through the Official MCP Registry')
    }
    const remoteUrl = candidate.remoteUrl
    if (remoteUrl === undefined) throw new Error('Registry candidate no longer exposes a Streamable HTTP endpoint')

    const removed = await this.removeManagedRowsReceipt(candidateRow => candidateRow.id === entryId)
    if (!removed.removed) throw new Error(`managed MCP entry "${entryId}" disappeared during repair`)
    if (!removed.liveUnloaded) {
      throw new Error(
        `managed MCP entry "${entryId}" was removed from persistence but its live runtime could not be unloaded; restart Phoenix before retrying repair`,
      )
    }

    return this.installManagedConfig({
      transport: 'streamable-http',
      serverName: serverNameFor(candidate),
      url: remoteUrl,
      headers: {},
      oauth: true,
    }, candidate.name, {
      kind: 'registry',
      name: candidate.name,
      version: candidate.version,
    })
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
   * Install the pinned official Devpost Hackathons MCP.
   * The endpoint is Host-owned so browser/model input cannot substitute another URL.
   * @returns Idempotent managed connector installation receipt.
   */
  async installDevpostHackathons(): Promise<McpRegistryInstallReceipt> {
    return this.installManagedConfig(
      devpostHackathonsMcpConfig(),
      'Devpost Hackathons',
      { kind: 'curated', connectorId: 'devpost' },
    )
  }

  /**
   * Remove only the PHOENIX-managed Devpost Hackathons MCP.
   * @returns true when one or more Devpost rows were removed.
   */
  async removeDevpostHackathons(): Promise<boolean> {
    return this.removeManagedRows(isDevpostHackathonsManagedRow, 'Devpost Hackathons')
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
   * @param options - X identity selection and optional xurl username.
   * @returns Independent idempotent receipts for the API and Docs connectors.
   */
  async installXMcp(options: { identity?: XMcpIdentity; username?: string } = {}): Promise<{
    api: McpRegistryInstallReceipt
    docs: McpRegistryInstallReceipt
  }> {
    const identity = options.identity ?? 'user'
    const docs = await this.installManagedConfig(xDocsMcpConfig(), 'X Docs')
    const api = await this.installManagedConfig(
      xApiMcpConfig(identity, options.username),
      identity === 'phoenix' ? 'Phoenix X API' : 'X API',
    )
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
    }, candidate.name, {
      kind: 'registry',
      name: candidate.name,
      version: candidate.version,
    })
  }
}

/**
 * Path to the generated MCP overlay consumed by the PHOENIX launcher.
 * @returns Absolute managed overlay path under DSH_HOME.
 */
export function managedMcpPatchPath(): string {
  return dshHomePath('mcp', 'managed.patch.yml')
}
