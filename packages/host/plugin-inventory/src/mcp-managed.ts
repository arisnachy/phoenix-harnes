import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@phoenix-ai/dsh-atomic-write'
import { dshHomePath } from '@phoenix-ai/dsh-home-paths'
import { searchOfficialMcpRegistry } from './mcp-registry.ts'
import type {
  CuratedMcpConnectorId,
  ManagedMcpConnector,
  ManagedMcpSource,
  McpRegistryCandidate,
  McpRegistryInstallReceipt,
  McpRegistryInstallRequest,
  McpRegistrySearchSnapshot,
} from './types.ts'

const MCP_CLIENT_PACKAGE = '@phoenix-ai/dsh-mcp-client'
/**
 * Services every PHOENIX-managed MCP must wait for before activation.
 * Row order has no load semantics in Cordis; these explicit dependencies keep
 * persisted connectors from snapshotting missing auth/credential services on
 * a clean Host start.
 */
export const MANAGED_MCP_INJECT = ['tools', 'credentials', 'authorization', 'mcpConnectors'] as const
const SERVER_NAME_MAX = 32
const JEV_TOOL_TIMEOUT_MS = 30_000
const JEV_STARTUP_TIMEOUT_MS = 5_000
const JEV_LEGACY_TOOL_TIMEOUT_MS = 1_800
const JEV_LEGACY_STARTUP_TIMEOUT_MS = 1_200
const X_API_TOOL_TIMEOUT_MS = 60_000
const X_API_STARTUP_TIMEOUT_MS = 300_000
const CANVA_TOOL_TIMEOUT_MS = 60_000

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
  oauthClientIdRef?: string
  oauthClientSecretRef?: string
  oauthCallbackPort?: number
  oauthTokenEndpointAuthMethod?: 'none' | 'client_secret_post' | 'client_secret_basic'
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
/** Stable local MCP namespace for Canva's official remote MCP. */
export const CANVA_MCP_SERVER_NAME = 'canva'
/** Official Canva Streamable HTTP MCP endpoint. */
export const CANVA_MCP_URL = 'https://mcp.canva.com/mcp'
/** Official hosted Supabase MCP endpoint. */
export const SUPABASE_MCP_URL = 'https://mcp.supabase.com/mcp'
/** Official HeyGen remote MCP endpoint. */
export const HEYGEN_MCP_URL = 'https://mcp.heygen.com/mcp/v1/'
/** Official Figma remote MCP endpoint (available only to Figma-catalog clients). */
export const FIGMA_MCP_URL = 'https://mcp.figma.com/mcp'
/** Official Figma Desktop local MCP endpoint usable by a custom Phoenix client. */
export const FIGMA_DESKTOP_MCP_URL = 'http://127.0.0.1:3845/mcp'
/** GitHub's official remote MCP endpoint (not a Copilot model login). */
export const GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/'
/** Vault reference for a GitHub personal access token. Never persisted in MCP config. */
export const GITHUB_MCP_TOKEN_REF = 'GITHUB_MCP_TOKEN'
/** Official Vercel remote MCP endpoint. */
export const VERCEL_MCP_URL = 'https://mcp.vercel.com'
/** Official Notion remote MCP endpoint. */
export const NOTION_MCP_URL = 'https://mcp.notion.com/mcp'
/** Official Linear remote MCP endpoint. */
export const LINEAR_MCP_URL = 'https://mcp.linear.app/mcp'
/** Official Cloudflare API MCP endpoint. */
export const CLOUDFLARE_MCP_URL = 'https://mcp.cloudflare.com/mcp'
/** Official Slack MCP endpoint. Slack requires a registered client for custom harnesses. */
export const SLACK_MCP_URL = 'https://mcp.slack.com/mcp'
/** Phoenix vault reference for the Slack app OAuth client id. */
export const SLACK_MCP_CLIENT_ID_REF = 'SLACK_MCP_CLIENT_ID'
/** Phoenix vault reference for the Slack app OAuth client secret. */
export const SLACK_MCP_CLIENT_SECRET_REF = 'SLACK_MCP_CLIENT_SECRET'
/** Stable loopback callback registered in the Phoenix Slack app. */
export const SLACK_MCP_CALLBACK_PORT = 17844
/** Vault reference used by the official Brave Search MCP. */
export const BRAVE_SEARCH_API_KEY_REF = 'BRAVE_API_KEY'
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
  /** Loader-level dependencies. Legacy managed rows may omit this until migrated. */
  inject?: string[]
  config: ManagedMcpConfig
  source?: ManagedMcpSource
}

interface ManagedMcpPatch {
  insert: ManagedMcpRow[]
}

/** Minimal Loader mutation seam needed for immediate MCP activation and rollback. */
export interface ManagedMcpLoader {
  create(options: { name: string; inject?: readonly string[]; config: ManagedMcpConfig }): Promise<string>
  /**
   * Live Loader update used to migrate legacy managed rows in-place. The
   * production Loader supports it; alternate embeddings may omit it and will
   * still persist the corrected dependency list for the next Host start.
   */
  update?(id: string, options: { inject: readonly string[] }): Promise<void>
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

function remoteOauthMcpConfig(
  serverName: string,
  url: string,
  toolCallTimeoutMs = 60_000,
): ManagedStreamableHttpMcpConfig {
  return {
    transport: 'streamable-http',
    serverName,
    url,
    headers: {},
    oauth: true,
    toolCallTimeoutMs,
    startupTimeoutMs: 5_000,
    failOnStartupError: false,
  }
}

function canvaMcpConfig(): ManagedStreamableHttpMcpConfig {
  return {
    ...remoteOauthMcpConfig(CANVA_MCP_SERVER_NAME, CANVA_MCP_URL, CANVA_TOOL_TIMEOUT_MS),
  }
}

/** Remote GitHub MCP does not support dynamic OAuth client registration.
 * GitHub Apps/OAuth Apps need separately registered client IDs; the default
 * supported path for custom hosts is a vault-backed, revocable GitHub PAT.
 */
function githubMcpConfig(): ManagedStreamableHttpMcpConfig {
  return {
    ...remoteOauthMcpConfig('github', GITHUB_MCP_URL),
    oauth: false,
    bearerTokenRef: GITHUB_MCP_TOKEN_REF,
  }
}

function slackMcpConfig(): ManagedStreamableHttpMcpConfig {
  return {
    ...remoteOauthMcpConfig('slack', SLACK_MCP_URL),
    oauthClientIdRef: SLACK_MCP_CLIENT_ID_REF,
    oauthClientSecretRef: SLACK_MCP_CLIENT_SECRET_REF,
    oauthCallbackPort: SLACK_MCP_CALLBACK_PORT,
    oauthTokenEndpointAuthMethod: 'client_secret_post',
  }
}

function figmaDesktopMcpConfig(): ManagedStreamableHttpMcpConfig {
  return {
    transport: 'streamable-http',
    serverName: 'figma',
    url: FIGMA_DESKTOP_MCP_URL,
    headers: {},
    oauth: false,
    toolCallTimeoutMs: 60_000,
    startupTimeoutMs: 2_000,
    failOnStartupError: false,
    reconnect: {
      enabled: true,
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      maxAttempts: 120,
    },
  }
}

function localNpxMcpConfig(
  serverName: string,
  pkg: string,
  extraArgs: readonly string[] = [],
  envCredentialRefs: Readonly<Record<string, string>> = {},
): ManagedStdioMcpConfig {
  return {
    transport: 'stdio',
    serverName,
    command: 'npx',
    args: ['-y', pkg, ...extraArgs],
    env: {},
    envCredentialRefs: { ...envCredentialRefs },
    cwd: '',
    toolCallTimeoutMs: 60_000,
    startupTimeoutMs: 20_000,
    failOnStartupError: false,
    reconnect: {
      enabled: true,
      initialDelayMs: 1000,
      maxDelayMs: 30_000,
      maxAttempts: 3,
    },
  }
}

function fetchMcpConfig(): ManagedStdioMcpConfig {
  return {
    transport: 'stdio',
    serverName: 'fetch',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    env: {},
    envCredentialRefs: {},
    cwd: '',
    toolCallTimeoutMs: 60_000,
    startupTimeoutMs: 20_000,
    failOnStartupError: false,
    reconnect: {
      enabled: true,
      initialDelayMs: 1000,
      maxDelayMs: 30_000,
      maxAttempts: 3,
    },
  }
}

interface CuratedMcpSpec {
  readonly label: string
  readonly config: () => ManagedMcpConfig
}

const CURATED_MCP_SPECS: Readonly<Record<CuratedMcpConnectorId, CuratedMcpSpec>> = {
  devpost: { label: 'Devpost Hackathons', config: devpostHackathonsMcpConfig },
  canva: { label: 'Canva', config: canvaMcpConfig },
  supabase: { label: 'Supabase', config: () => remoteOauthMcpConfig('supabase', SUPABASE_MCP_URL) },
  heygen: { label: 'HeyGen', config: () => remoteOauthMcpConfig('heygen', HEYGEN_MCP_URL, 120_000) },
  figma: { label: 'Figma', config: () => remoteOauthMcpConfig('figma', FIGMA_MCP_URL) },
  github: { label: 'GitHub repositories', config: githubMcpConfig },
  vercel: { label: 'Vercel', config: () => remoteOauthMcpConfig('vercel', VERCEL_MCP_URL) },
  notion: { label: 'Notion', config: () => remoteOauthMcpConfig('notion', NOTION_MCP_URL) },
  linear: { label: 'Linear', config: () => remoteOauthMcpConfig('linear', LINEAR_MCP_URL) },
  cloudflare: { label: 'Cloudflare', config: () => remoteOauthMcpConfig('cloudflare', CLOUDFLARE_MCP_URL) },
  slack: { label: 'Slack', config: slackMcpConfig },
  'brave-search': {
    label: 'Brave Search',
    config: () => localNpxMcpConfig(
      'brave-search',
      '@brave/brave-search-mcp-server',
      ['--transport', 'stdio'],
      { BRAVE_API_KEY: BRAVE_SEARCH_API_KEY_REF },
    ),
  },
  filesystem: {
    label: 'Filesystem MCP',
    config: () => localNpxMcpConfig('filesystem', '@modelcontextprotocol/server-filesystem', ['.']),
  },
  memory: {
    label: 'Memory MCP',
    config: () => localNpxMcpConfig('memory', '@modelcontextprotocol/server-memory'),
  },
  fetch: { label: 'Fetch MCP', config: fetchMcpConfig },
}

/**
 * Core MCPs restored automatically on Phoenix startup.
 * Binance is intentionally excluded: REAL Binance remains behind the existing
 * high-risk activation/approval boundary.
 */
export const CORE_MCP_PACK_IDS: readonly CuratedMcpConnectorId[] = [
  'canva',
  'supabase',
  'heygen',
  'figma',
  'notion',
  'linear',
  'cloudflare',
  'slack',
  'brave-search',
  'filesystem',
  'memory',
  'fetch',
]

function isCuratedMcpConnectorId(value: string): value is CuratedMcpConnectorId {
  return Object.prototype.hasOwnProperty.call(CURATED_MCP_SPECS, value)
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
  if (exactJson(value, figmaDesktopMcpConfig())) return true
  if (typeof value.serverName !== 'string' || typeof value.url !== 'string'
    || typeof value.oauth !== 'boolean' || !isEmptyRecord(value.headers)) return false
  try {
    if (new URL(value.url).protocol !== 'https:') return false
  } catch {
    return false
  }

  // Host-curated credentials are admitted by exact specification only.
  // GitHub's official MCP remote does NOT support OAuth DCR; the previous
  // PAT migration persisted oauth:false and bearerTokenRef:GITHUB_MCP_TOKEN.
  // Reject any other bearer ref, arbitrary URL, headers, or extra OAuth fields.
  if (exactJson(value, githubMcpConfig())) return true

  // Slack is the one curated confidential OAuth client. Its references and
  // fixed callback are admitted only as one exact Host-owned configuration.
  if (exactJson(value, slackMcpConfig())) return true

  // Registry-managed remotes, Binance, and dynamic OAuth curated remotes may
  // not smuggle credential refs or fixed-client settings through persisted JSON.
  if (value.oauth) {
    return value.bearerTokenRef === undefined
      && value.oauthClientIdRef === undefined
      && value.oauthClientSecretRef === undefined
      && value.oauthCallbackPort === undefined
      && value.oauthTokenEndpointAuthMethod === undefined
  }

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

function validCuratedStdioConfig(value: Record<string, unknown>): boolean {
  return Object.values(CURATED_MCP_SPECS)
    .map(spec => spec.config())
    .some(config => config.transport === 'stdio' && exactJson(value, config))
}

function validConfig(value: unknown): value is ManagedMcpConfig {
  if (!isRecord(value)) return false
  if (value.transport === 'stdio') return validXApiConfig(value) || validCuratedStdioConfig(value)
  return value.transport === 'streamable-http' && validHttpConfig(value)
}

function validManagedInject(value: unknown): value is string[] | undefined {
  if (value === undefined) return true
  return Array.isArray(value)
    && value.length === MANAGED_MCP_INJECT.length
    && value.every((entry, index) => entry === MANAGED_MCP_INJECT[index])
}

function hasManagedInject(row: ManagedMcpRow): boolean {
  return validManagedInject(row.inject) && row.inject !== undefined
}

function managedLoaderOptions(config: ManagedMcpConfig): {
  name: typeof MCP_CLIENT_PACKAGE
  inject: string[]
  config: ManagedMcpConfig
} {
  return {
    name: MCP_CLIENT_PACKAGE,
    inject: [...MANAGED_MCP_INJECT],
    config,
  }
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
    if (!validManagedInject(value.inject)) {
      throw new Error(`managed MCP patch row ${index} has an invalid inject dependency list`)
    }
    if (value.source !== undefined && !validManagedSource(value.source)) {
      throw new Error(`managed MCP patch row ${index} has an invalid source`)
    }
    return {
      id: value.id,
      name: MCP_CLIENT_PACKAGE,
      ...(value.inject === undefined ? {} : { inject: [...value.inject] }),
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
  const url = row.config.transport === 'streamable-http'
    ? row.config.url
    : row.config.serverName === X_API_MCP_SERVER_NAME || row.config.serverName === X_PHOENIX_API_MCP_SERVER_NAME
      ? X_API_MCP_URL
      : `stdio://${row.config.serverName}`
  return {
    entryId: row.id,
    serverName: row.config.serverName,
    url,
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

function isCanvaManagedRow(row: ManagedMcpRow): boolean {
  return row.config.serverName === CANVA_MCP_SERVER_NAME
    || (row.config.transport === 'streamable-http' && row.config.url === CANVA_MCP_URL)
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
    if (candidate.remoteSetupRequired === 'headers') {
      throw new Error('MCP requires provider-specific authorization headers; configure this server manually rather than installing a broken connection')
    }
    if (candidate.remoteSetupRequired === 'variables') {
      throw new Error('MCP requires a tenant-specific URL or variables; configure its endpoint manually before connecting')
    }
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

  /**
   * Upgrade legacy persisted MCP rows that predate explicit loader dependencies.
   * Updating `inject` causes the Loader to restart a live row and then hold it
   * pending until credentials, authorization, tools, and lifecycle registry are
   * all available. Successful upgrades are persisted atomically so later starts
   * never repeat the startup race.
   */
  private async ensureManagedDependencies(rows: readonly ManagedMcpRow[]): Promise<{
    rows: ManagedMcpRow[]
    failed: Array<{ row: ManagedMcpRow; message: string }>
  }> {
    let changed = false
    const failed: Array<{ row: ManagedMcpRow; message: string }> = []
    const upgraded: ManagedMcpRow[] = []

    for (const row of rows) {
      if (hasManagedInject(row)) {
        upgraded.push(row)
        continue
      }
      try {
        await this.loader.update?.(row.id, { inject: [...MANAGED_MCP_INJECT] })
        upgraded.push({ ...row, inject: [...MANAGED_MCP_INJECT] })
        changed = true
      } catch (error) {
        upgraded.push(row)
        failed.push({
          row,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (changed) await writeManagedRows(this.path, upgraded)
    return { rows: upgraded, failed }
  }

  private async installManagedConfig(
    config: ManagedMcpConfig,
    label: string,
    source?: ManagedMcpSource,
  ): Promise<McpRegistryInstallReceipt> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    return withFileLock(this.path, async () => {
      const migration = await this.ensureManagedDependencies(await readManagedRows(this.path))
      const rows = migration.rows
      // The registry can publish a new remote URL for an existing MCP. A
      // second row with the same serverName would conflict at tool registration
      // and appear 'broken' despite the old account still being configured.
      const existing = rows.find(row => managedIdentity(row.config) === managedIdentity(config)
        || row.config.serverName === config.serverName
        || (source?.kind === 'registry' && row.source?.kind === 'registry' && row.source.name === source.name))
      if (existing !== undefined) {
        const sameSource = source?.kind === 'registry' && existing.source?.kind === 'registry'
          && existing.source.name === source.name
        if (managedIdentity(existing.config) !== managedIdentity(config) && !sameSource) {
          throw new Error(`MCP namespace "${config.serverName}" is already used by another connector. Remove or repair the existing entry first.`)
        }
        const failure = migration.failed.find(item => item.row.id === existing.id)
        if (failure !== undefined) {
          throw new Error(`failed to repair managed MCP dependencies for "${existing.id}": ${failure.message}`)
        }
        return { status: 'already-installed', connector: connectorOf(existing) }
      }
      const entryId = await this.loader.create(managedLoaderOptions(config))
      const row: ManagedMcpRow = {
        id: entryId,
        name: MCP_CLIENT_PACKAGE,
        inject: [...MANAGED_MCP_INJECT],
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
   * Recreate the persisted row when a repair fails after unload. The existing
   * credentials are intentionally left untouched, and the original stable row
   * remains available to the next Host start even if live restoration fails.
   */
  private async restoreRemovedManagedRow(row: ManagedMcpRow): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    await withFileLock(this.path, async () => {
      const rows = await readManagedRows(this.path)
      if (rows.some(existing => existing.id === row.id
        || managedIdentity(existing.config) === managedIdentity(row.config))) return
      await writeManagedRows(this.path, [...rows, row])
    }, { waitMs: 15_000 })
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
      const connectorId = row.source.connectorId
      if (!isCuratedMcpConnectorId(connectorId)) {
        throw new Error(`managed MCP entry "${entryId}" uses an unsupported curated repair source`)
      }
      const removed = await this.removeManagedRowsReceipt(candidateRow => candidateRow.id === entryId)
      if (!removed.removed) throw new Error(`managed MCP entry "${entryId}" disappeared during repair`)
      if (!removed.liveUnloaded) {
        await this.restoreRemovedManagedRow(row)
        throw new Error(`managed MCP entry "${entryId}" could not be unloaded; its previous configuration was preserved`)
      }
      try {
        // The existing Figma Desktop MCP does not use browser OAuth. Repairing
        // it must preserve its loopback endpoint rather than silently switching
        // to Figma's separate remote OAuth integration.
        if (connectorId === 'figma'
          && row.config.transport === 'streamable-http'
          && row.config.url === FIGMA_DESKTOP_MCP_URL) {
          return await this.installManagedConfig(figmaDesktopMcpConfig(), 'Figma Desktop',
            { kind: 'curated', connectorId: 'figma' })
        }
        return await this.installCuratedMcp(connectorId)
      } catch (error) {
        await this.restoreRemovedManagedRow(row)
        throw new Error(`MCP repair failed; the previous configuration was preserved for the next Phoenix start: ${String(error)}`, { cause: error })
      }
    }

    const snapshot = await this.registrySearch({ query: row.source.name, limit: 20 })
    // Repair follows the latest active registry version. Keeping the originally
    // installed version pinned makes repair fail whenever the publisher updates.
    const candidate = selectInstallableCandidate(snapshot, { name: row.source.name })
    if (isRetiredJevCandidate(candidate)) {
      throw new Error('Jev integration is retired and cannot be repaired through the Official MCP Registry')
    }
    const remoteUrl = candidate.remoteUrl
    if (remoteUrl === undefined) throw new Error('Registry candidate no longer exposes a Streamable HTTP endpoint')

    const removed = await this.removeManagedRowsReceipt(candidateRow => candidateRow.id === entryId)
    if (!removed.removed) throw new Error(`managed MCP entry "${entryId}" disappeared during repair`)
    if (!removed.liveUnloaded) {
      await this.restoreRemovedManagedRow(row)
      throw new Error(`managed MCP entry "${entryId}" could not be unloaded; its previous configuration was preserved`)
    }

    try {
      return await this.installManagedConfig({
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
    } catch (error) {
      await this.restoreRemovedManagedRow(row)
      throw new Error(`MCP repair failed; the previous configuration was preserved for the next Phoenix start: ${String(error)}`, { cause: error })
    }
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
   * Install one Phoenix-curated MCP from its exact Host-owned specification.
   * No caller-supplied URL, executable, package, or environment value crosses
   * this boundary.
   * @param connectorId - Curated connector identity admitted by Phoenix.
   * @returns Idempotent managed installation receipt.
   */
  async installCuratedMcp(connectorId: CuratedMcpConnectorId): Promise<McpRegistryInstallReceipt> {
    const spec = CURATED_MCP_SPECS[connectorId]
    return this.installManagedConfig(
      spec.config(),
      spec.label,
      { kind: 'curated', connectorId },
    )
  }

  /**
   * Restore the default Phoenix MCP pack without blocking one provider on
   * another. Missing live entries are created in parallel and then committed
   * to the managed overlay in one atomic write. At Host boot use
   * installMissing: false to preserve configured connectors without silently
   * activating optional remote services that still need provider setup.
   * @param options - Whether to install missing curated MCPs or migrate existing rows only.
   * @returns Installed, already-present, and failed curated connector ids.
   */
  async ensureCoreMcpPack(options: { installMissing?: boolean } = {}): Promise<{
    installed: readonly CuratedMcpConnectorId[]
    alreadyInstalled: readonly CuratedMcpConnectorId[]
    failed: readonly { connectorId: CuratedMcpConnectorId; message: string }[]
  }> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    return withFileLock(this.path, async () => {
      const migration = await this.ensureManagedDependencies(await readManagedRows(this.path))
      const rows = migration.rows
      const alreadyInstalled = CORE_MCP_PACK_IDS.filter((connectorId) => {
        const config = CURATED_MCP_SPECS[connectorId].config()
        return rows.some(row => managedIdentity(row.config) === managedIdentity(config)
          || row.config.serverName === config.serverName)
      })
      // Boot restores only explicitly installed MCPs. Creating twelve optional
      // connectors on every cold start made fresh accounts look broken before
      // they had credentials, local dependencies, or an OAuth session.
      const missing = options.installMissing === false
        ? []
        : CORE_MCP_PACK_IDS.filter(connectorId => !alreadyInstalled.includes(connectorId))
      const attempted = await Promise.all(missing.map(async (connectorId) => {
        const spec = CURATED_MCP_SPECS[connectorId]
        const config = spec.config()
        try {
          const id = await this.loader.create(managedLoaderOptions(config))
          const row: ManagedMcpRow = {
            id,
            name: MCP_CLIENT_PACKAGE,
            inject: [...MANAGED_MCP_INJECT],
            config,
            source: { kind: 'curated', connectorId },
          }
          return { ok: true as const, connectorId, row }
        } catch (error) {
          return {
            ok: false as const,
            connectorId,
            message: error instanceof Error ? error.message : String(error),
          }
        }
      }))
      const created = attempted.filter((result): result is Extract<typeof result, { ok: true }> => result.ok)
      if (created.length > 0) {
        try {
          await writeManagedRows(this.path, [...rows, ...created.map(result => result.row)])
        } catch (error) {
          const rollbackErrors: unknown[] = []
          for (const result of created) {
            try {
              await this.loader.remove(result.row.id)
            } catch (rollbackError) {
              rollbackErrors.push(rollbackError)
            }
          }
          if (rollbackErrors.length > 0) {
            throw new AggregateError(
              [error, ...rollbackErrors],
              'failed to persist the Phoenix core MCP pack and fully roll back live activation',
            )
          }
          throw error
        }
      }
      const migrationFailures = migration.failed.flatMap(({ row, message }) => {
        const connectorId = row.source?.kind === 'curated' && isCuratedMcpConnectorId(row.source.connectorId)
          ? row.source.connectorId
          : undefined
        return connectorId !== undefined && CORE_MCP_PACK_IDS.includes(connectorId)
          ? [{ connectorId, message: `dependency migration failed: ${message}` }]
          : []
      })
      return {
        installed: created.map(result => result.connectorId),
        alreadyInstalled,
        failed: [
          ...migrationFailures,
          ...attempted
            .filter((result): result is Extract<typeof result, { ok: false }> => !result.ok)
            .map(result => ({ connectorId: result.connectorId, message: result.message })),
        ],
      }
    }, { waitMs: 30_000 })
  }

  /**
   * Install the pinned official Devpost Hackathons MCP.
   * The endpoint is Host-owned so browser/model input cannot substitute another URL.
   * @returns Idempotent managed connector installation receipt.
   */
  async installDevpostHackathons(): Promise<McpRegistryInstallReceipt> {
    return this.installCuratedMcp('devpost')
  }

  /**
   * Remove only the PHOENIX-managed Devpost Hackathons MCP.
   * @returns true when one or more Devpost rows were removed.
   */
  async removeDevpostHackathons(): Promise<boolean> {
    return this.removeManagedRows(isDevpostHackathonsManagedRow, 'Devpost Hackathons')
  }

  /**
   * Install Canva's pinned official remote MCP with user-scoped OAuth.
   * @returns Idempotent managed Canva installation receipt.
   */
  async installCanva(): Promise<McpRegistryInstallReceipt> {
    return this.installCuratedMcp('canva')
  }

  /**
   * Remove only the PHOENIX-managed Canva MCP.
   * @returns Whether one or more managed Canva entries were removed.
   */
  async removeCanva(): Promise<boolean> {
    return this.removeManagedRows(isCanvaManagedRow, 'Canva')
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
