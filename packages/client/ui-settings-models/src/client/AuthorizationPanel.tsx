import { AssistantMailPanel, type AssistantMailClient } from './AssistantMailPanel.tsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ChatGptWebSnapshot, IApiClient } from '@phoenix-ai/dsh-api-remotes/client'
import type { en } from './locales.ts'
import type { ConnectorKey } from './connectors-locales.ts'
import { CONNECTOR_CATALOG } from './connector-catalog.ts'
import type { ConnectorDefinition } from './connector-catalog.ts'
import { AuthorizationAttemptProgress, useAuthorizationAttempt } from './authorization-attempt.tsx'
import connectorStyles from './CodexConnectors.module.css'
import hubStyles from './ConnectorsSection.module.css'
import styles from './ModelsSection.module.css'
import { setChatGptWebEnabled } from './chatgpt-web-toggle.ts'
import type { ChatGptWebBridgeClient, ChatGptWebSettingsClient } from './chatgpt-web-toggle.ts'

type AuthorizationClient = IApiClient['authorization']

type ConnectorFilter = 'all' | 'connected' | 'available'

/** Sanitized Official MCP Registry candidate rendered by the Connectors page. */
export interface McpRegistryCandidateView {
  name: string
  title: string
  description: string
  version: string
  status: 'active' | 'deprecated' | 'deleted' | 'unknown'
  trust: 'registry-listed'
  icons: Array<{
    src: string
    mimeType?: 'image/png' | 'image/jpeg' | 'image/jpg' | 'image/svg+xml' | 'image/webp'
    sizes?: string[]
  }>
  transports: Array<'stdio' | 'streamable-http' | 'sse'>
  packages: Array<{
    registryType: string
    identifier: string
    transport: 'stdio' | 'streamable-http' | 'sse'
    version?: string
    runtimeHint?: string
  }>
  repositoryUrl?: string
  websiteUrl?: string
  remoteUrl?: string
  remoteSetupRequired?: 'headers' | 'variables'
}

/** One Host-proxied Official MCP Registry search result safe for the browser. */
export interface McpRegistrySearchSnapshot {
  source: 'official-mcp-registry'
  query: string
  fetchedAt: string
  stale: boolean
  candidates: McpRegistryCandidateView[]
}

/** Secret-free runtime state for one MCP server. */
export interface McpConnectorRuntimeView {
  serverName: string
  transport: 'stdio' | 'streamable-http'
  status: 'starting' | 'ready' | 'disconnected' | 'failed' | 'auth-required'
  toolNames: string[]
  reasonCode?: 'connection-failed' | 'connection-lost' | 'authorization-required' | 'retry-exhausted'
}

/** Secret-free PHOENIX-managed MCP identity and trusted reconstruction source. */
export interface ManagedMcpConnectorView {
  entryId: string
  serverName: string
  url: string
  source?:
    | { kind: 'registry'; name: string; version?: string }
    | { kind: 'curated'; connectorId: string }
}

/** Secret-free readiness for an existing OpenClaw connector route. */
export interface OpenClawConnectorView {
  id: 'google-workspace' | 'github'
  skillAlias: 'openclaw-gog' | 'openclaw-github'
  skillInstalled: boolean
  runtimeAvailable: boolean
  connected: boolean
  account?: string
  phase: 'ready' | 'auth-required' | 'missing-runtime' | 'missing-skill' | 'api-unavailable'
}

/** OpenClaw connector routes currently reusable by Phoenix. */
export interface OpenClawConnectorSnapshot {
  connectors: OpenClawConnectorView[]
}

/** Combined runtime + managed MCP state returned by the Host. */
export interface McpConnectorHubSnapshot {
  runtime: McpConnectorRuntimeView[]
  managed: ManagedMcpConnectorView[]
}

/** Secret-free Jev setup/runtime projection. */
export interface JevMcpSnapshot {
  configured: boolean
  credentialConfigured: boolean
  status?: McpConnectorRuntimeView['status']
  reasonCode?: McpConnectorRuntimeView['reasonCode']
}

type CuratedMcpConnectorId = 'github' | 'meta-devtools' | 'meta-whatsapp-business' | 'microsoft-learn' | 'microsoft-workiq' | 'microsoft-azure' | 'devpost' | 'canva' | 'supabase' | 'heygen' | 'figma' | 'vercel' | 'notion' | 'linear' | 'cloudflare' | 'slack' | 'brave-search' | 'filesystem' | 'memory' | 'fetch'

const CURATED_MCP_CONNECTOR_IDS = new Set<string>([
  'github', 'meta-devtools', 'meta-whatsapp-business', 'microsoft-learn', 'microsoft-workiq', 'microsoft-azure', 'devpost', 'canva', 'supabase', 'heygen', 'figma', 'vercel', 'notion', 'linear', 'cloudflare',
  'slack', 'brave-search', 'filesystem', 'memory', 'fetch',
])

function isCuratedMcpConnectorId(value: string): value is CuratedMcpConnectorId {
  return CURATED_MCP_CONNECTOR_IDS.has(value)
}

/** Browser-safe client for the Host-owned Official MCP Registry proxy and installer. */
export interface McpRegistryClient {
  /**
   * Search the Official MCP Registry through the Phoenix Host.
   * @param request - User-entered query and optional result limit.
   * @returns Sanitized registry metadata for display only.
   */
  search(request: { query: string; limit?: number }): Promise<McpRegistrySearchSnapshot>
  /**
   * Read secret-free MCP lifecycle and managed-install state.
   * @returns Runtime and persistent managed connector state.
   */
  state(): Promise<McpConnectorHubSnapshot>
  /** Retry one already-installed live MCP without clearing its stored authorization. */
  reconnect?(request: { serverName: string }): Promise<{ accepted: boolean }>
  /**
   * Install an exact registry identity after Host-side endpoint revalidation.
   * @param request - Registry name and optional version selected by the user.
   * @returns Idempotent managed-install receipt.
   */
  install(request: { name: string; version?: string }): Promise<{
    status: 'installed' | 'already-installed'
    connector: ManagedMcpConnectorView
  }>
  /** Install a Host-pinned curated MCP by connector id; no endpoint crosses the browser boundary. */
  installCurated?(request: { connectorId: CuratedMcpConnectorId }): Promise<{
    status: 'installed' | 'already-installed'
    connector: ManagedMcpConnectorView
  }>
  /** Remove one exact PHOENIX-managed MCP. */
  remove?(request: { entryId: string }): Promise<{ removed: boolean; liveUnloaded: boolean }>
  /** Repair one managed MCP strictly from its persisted trusted source. */
  repair?(request: { entryId: string }): Promise<{
    status: 'installed' | 'already-installed'
    connector: ManagedMcpConnectorView
  }>
  /** Reuse already-authenticated OpenClaw connector routes when present. */
  openClawState?(): Promise<OpenClawConnectorSnapshot>
  /** Read Jev setup/runtime state without exposing its secret. Optional for older hosts. */
  jevState?(): Promise<JevMcpSnapshot>
  /** Store a Jev key in Phoenix credentials and activate the pinned MCP endpoint. Optional for older hosts. */
  configureJev?(request: { apiKey: string }): Promise<{
    status: 'installed' | 'already-installed'
    connector: { entryId: string; serverName: string; url: string }
  }>
}

interface RateLimitWindow {
  usedPercent: number
  windowDurationMins?: number
  resetsAt?: number
}

interface ConnectorTelemetry {
  id: string
  name: string
  description?: string
  iconUrl?: string
  iconUrlDark?: string
  category?: string
  installUrl?: string
  accessible: boolean
  enabled: boolean
  installed?: boolean
  callable?: boolean
}

interface AccountTelemetry {
  kind: 'account'
  provider: string
  accountType?: string
  email?: string
  plan?: string
  primaryLimit?: RateLimitWindow
  secondaryLimit?: RateLimitWindow
  credits?: { hasCredits: boolean; unlimited: boolean; balance?: string }
  usage?: {
    lifetimeTokens?: number
    peakDailyTokens?: number
    longestRunningTurnSec?: number
    currentStreakDays?: number
    longestStreakDays?: number
  }
  connectors?: ConnectorTelemetry[]
}

const NATIVE_CODEX_ACCOUNT_KEY = 'subagent-codex/account'

interface Entry {
  key: string
  label: string
  methods: Array<{ id: string; label: string }>
  inFlight: boolean
  disconnectable?: true
  stored?: { kind: 'api-key' | 'grant' }
  telemetry?: AccountTelemetry
}

export interface AuthorizationPanelProps {
  api?: AuthorizationClient
  t: (key: keyof typeof en) => string
  onAuthorized: () => void
}

export interface ConnectorsSettingsSectionProps extends AuthorizationPanelProps {
  /** Direct-launch mode from the main Phoenix navigation. */
  launchContext?: 'discover' | 'connectors' | 'team'
  assistantMail?: AssistantMailClient
  connectorT: (key: ConnectorKey) => string
  chatGptWeb?: ChatGptWebBridgeClient
  settings?: ChatGptWebSettingsClient
  mcpRegistry?: McpRegistryClient
}

function integer(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

function resetLabel(resetsAt: number | undefined): string | undefined {
  if (resetsAt === undefined) return undefined
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(resetsAt * 1000))
}

function limitText(label: string, limit: RateLimitWindow | undefined): string | undefined {
  if (limit === undefined) return undefined
  const remaining = Math.max(0, 100 - limit.usedPercent)
  const reset = resetLabel(limit.resetsAt)
  return `${label}: ${integer(limit.usedPercent)}% used · ${integer(remaining)}% remaining${reset === undefined ? '' : ` · resets ${reset}`}`
}

function telemetryLines(telemetry: AccountTelemetry | undefined): string[] {
  if (telemetry === undefined) return []
  const lines: string[] = []
  const identity = [telemetry.provider, telemetry.plan, telemetry.email].filter(Boolean).join(' · ')
  if (identity.length > 0) lines.push(identity)
  const primary = limitText('Primary', telemetry.primaryLimit)
  const secondary = limitText('Secondary', telemetry.secondaryLimit)
  if (primary !== undefined) lines.push(primary)
  if (secondary !== undefined) lines.push(secondary)
  if (telemetry.credits !== undefined) {
    const value = telemetry.credits.unlimited
      ? 'unlimited'
      : telemetry.credits.balance ?? (telemetry.credits.hasCredits ? 'available' : 'none')
    lines.push(`Credits: ${value}`)
  }
  if (telemetry.usage?.lifetimeTokens !== undefined) {
    lines.push(`Token activity: ${integer(telemetry.usage.lifetimeTokens)} lifetime`)
  }
  if (telemetry.usage?.peakDailyTokens !== undefined) {
    lines.push(`Peak day: ${integer(telemetry.usage.peakDailyTokens)} tokens`)
  }
  return lines
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

const TRANSIENT_CONNECTOR_REMOTE_RETRY_MS = [0, 150, 500, 1_500] as const
// MCP plugins register their auth flow only after initialization. A plugin can
// exceed the previous 2.87 s window (its initial startup budget is 5 s), so
// do not declare an OAuth method absent before the registry has time to settle.
const MCP_AUTH_FLOW_RETRY_MS = [0, 250, 500, 750, 1_000, 1_500, 2_000, 2_500, 3_000] as const
const CURATED_OAUTH_MCP_IDS = new Set<string>([
  'meta-devtools', 'meta-whatsapp-business', 'devpost', 'canva', 'supabase', 'heygen', 'figma', 'vercel', 'notion', 'linear', 'cloudflare', 'slack',
])
const MCP_AUTH_FLOW_REFRESH_MS = 2_000

function isTransientConnectorRemoteFailure(error: unknown): boolean {
  const message = String(error).toLowerCase()
  return [
    'websocket disconnected',
    'failed to fetch',
    'fetch failed',
    'networkerror',
    'network request failed',
    'load failed',
    'econnrefused',
    'connection refused',
    'connection reset',
    'err_connection',
  ].some(fragment => message.includes(fragment))
}

async function readAuthorizationEntries(api: AuthorizationClient): Promise<Entry[]> {
  const response = await api.list({})
  if (!response.result.ok) throw new Error(response.result.error.message)
  return response.result.value.entries as Entry[]
}

async function readConnectorRemoteWithRetry<T>(
  read: () => Promise<T>,
  cancelled: () => boolean,
): Promise<T> {
  let lastError: unknown
  for (const delayMs of TRANSIENT_CONNECTOR_REMOTE_RETRY_MS) {
    if (cancelled()) throw new Error('Connector state read cancelled')
    if (delayMs > 0) {
      await new Promise<void>((resolve) => { globalThis.setTimeout(resolve, delayMs) })
    }
    if (cancelled()) throw new Error('Connector state read cancelled')
    try {
      return await read()
    } catch (error: unknown) {
      lastError = error
      if (!isTransientConnectorRemoteFailure(error)) throw error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? 'Connector remote unavailable'))
}

/**
 * Keep only HTTPS external links before exposing them to clickable connector UI.
 * @param value - Candidate external URL from connector or registry metadata.
 * @returns A normalized HTTPS URL, or undefined when the value is unsafe/invalid.
 */
export function safeExternalHref(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function connectorStatus(
  connector: ConnectorTelemetry,
  t: ConnectorsSettingsSectionProps['connectorT'],
): { text: string; className: string } {
  if (!connector.enabled) return { text: t('disabledStatus'), className: connectorStyles['connectorStatusDisabled'] ?? '' }
  if (!connector.accessible) return { text: t('unavailableStatus'), className: connectorStyles['connectorStatusDisabled'] ?? '' }
  if (connector.installed === true && connector.callable === true) {
    return { text: t('callableStatus'), className: connectorStyles['connectorStatusReady'] ?? '' }
  }
  if (connector.installed === true) return { text: t('connectedStatus'), className: connectorStyles['connectorStatusReady'] ?? '' }
  if (connector.installed === false && connector.callable === false && connector.installUrl === undefined) {
    return { text: t('permissionStatus'), className: connectorStyles['connectorStatusDisabled'] ?? '' }
  }
  return { text: t('availableStatus'), className: '' }
}

function entryMatchesFamily(entry: Entry, family: string | undefined): boolean {
  if (family === undefined) return false
  const needle = normalize(family).split(/[^a-z0-9]+/u).filter(Boolean).join('-')
  return [entry.key, entry.label, entry.telemetry?.provider ?? ''].some((value) => {
    const tokens = normalize(value).split(/[^a-z0-9]+/u).filter(Boolean).join('-')
    return `-${tokens}-`.includes(`-${needle}-`)
  })
}

function entryMatchesDefinitionAuthorization(entry: Entry, definition: ConnectorDefinition): boolean {
  if (definition.authorizationKey !== undefined) return entry.key === definition.authorizationKey
  return entryMatchesFamily(entry, definition.providerFamily)
}

function liveMatchesDefinition(live: ConnectorTelemetry, definition: ConnectorDefinition): boolean {
  const ids = [definition.id, ...(definition.aliases ?? [])].map(normalize)
  const liveId = normalize(live.id)
  const liveName = normalize(live.name)
  return ids.includes(liveId) || ids.includes(liveName) || normalize(definition.name) === liveName
}

function serverMatchesDefinition(serverName: string, definition: ConnectorDefinition): boolean {
  if (definition.authorizationKey?.startsWith('llm-pi-ai/') === true) return false
  const server = normalize(serverName)
  // GitHub Copilot is an independent model provider, not a GitHub repository
  // MCP runtime. Fuzzy "github" includes "github-copilot" and caused a false
  // connected status and incorrect authorization routing.
  if (definition.id === 'github') {
    return server === 'github' || server === 'github-mcp' || server === 'github-mcp-server'
  }
  const needles = [definition.id, definition.name, ...(definition.aliases ?? [])]
    .map(normalize)
    .filter(value => value.length >= 3)
  return needles.some(needle => server === needle || server.includes(needle) || needle.includes(server))
}

function runtimeMatchesDefinition(runtime: McpConnectorRuntimeView, definition: ConnectorDefinition): boolean {
  return serverMatchesDefinition(runtime.serverName, definition)
}

function managedMatchesDefinition(managed: ManagedMcpConnectorView, definition: ConnectorDefinition): boolean {
  if (managed.source?.kind === 'curated') return managed.source.connectorId === definition.id
  if (managed.source?.kind === 'registry' && definition.registryName !== undefined) {
    return managed.source.name === definition.registryName
  }
  return serverMatchesDefinition(managed.serverName, definition)
}


function catalogDefinitionForText(value: string): ConnectorDefinition | undefined {
  const haystack = normalize(value)
  return CONNECTOR_CATALOG.find((definition) => {
    const aliases = [definition.id, definition.name, ...(definition.aliases ?? [])]
    return aliases.some((alias) => {
      const needle = normalize(alias)
      return needle.length >= 3 && (haystack === needle || haystack.includes(needle))
    })
  })
}

function isRetiredJevSearchText(value: string): boolean {
  const needle = normalize(value)
  return needle === 'jev' || needle === 'jev-ai' || needle === 'jev ai' || needle === 'jevai'
}

function isRetiredJevCandidate(candidate: McpRegistryCandidateView): boolean {
  const name = normalize(candidate.name)
  const title = normalize(candidate.title)
  const endpoint = candidate.remoteUrl?.toLowerCase() ?? ''
  return name === 'jev'
    || name.endsWith('/jev')
    || title === 'jev'
    || endpoint === 'https://www.jevai.org/api/mcp'
    || endpoint.startsWith('https://www.jevai.org/')
}

function collapsedTechnicalName(value: string): string {
  const raw = value.replace(/^MCP\s+/i, '').trim()
  const parts = raw.split('-').filter(Boolean)
  if (parts.length > 1 && parts.length % 2 === 0) {
    const middle = parts.length / 2
    if (parts.slice(0, middle).join('-') === parts.slice(middle).join('-')) {
      return parts.slice(0, middle).join('-')
    }
  }
  return raw
}

function accountPresentation(entry: Entry): {
  name: string
  description?: string
  logoUrl?: string
  technical?: string
} {
  const definition = CONNECTOR_CATALOG.find(candidate =>
    entryMatchesDefinitionAuthorization(entry, candidate))
  const technical = collapsedTechnicalName(entry.telemetry?.provider ?? entry.label)
  if (definition !== undefined) {
    return {
      name: definition.name,
      description: definition.description,
      ...(definition.logoUrl === undefined ? {} : { logoUrl: definition.logoUrl }),
      ...(normalize(definition.name) === normalize(technical) ? {} : { technical }),
    }
  }
  const name = technical
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ') || entry.label
  return { name, technical }
}

function managedAuthorizationEntry(
  connector: ManagedMcpConnectorView,
  entries: readonly Entry[],
): Entry | undefined {
  const id = connector.serverName.toLowerCase().replaceAll('_', '-')
  return entries.find(entry => entry.key === `mcp-client/${id}`)
}

function runtimeForEntry(
  entry: Entry,
  runtime: readonly McpConnectorRuntimeView[],
): McpConnectorRuntimeView | undefined {
  const haystack = normalize(`${entry.label} ${entry.key} ${entry.telemetry?.provider ?? ''}`)
  return runtime.find(candidate => haystack.includes(normalize(candidate.serverName)))
}

function accountStatus(
  entry: Entry,
  runtime: McpConnectorRuntimeView | undefined,
  t: ConnectorsSettingsSectionProps['connectorT'],
): { text: string; className: string } {
  if (runtime?.status === 'starting') {
    return { text: t('connectingStatus'), className: connectorStyles['connectorStatusInfo'] ?? '' }
  }
  if (runtime?.status === 'auth-required') {
    return {
      text: entry.stored === undefined ? t('authorizationRequiredStatus') : t('tokenExpiredStatus'),
      className: connectorStyles['connectorStatusWarn'] ?? '',
    }
  }
  if (runtime?.status === 'failed') {
    return { text: t('brokenStatus'), className: connectorStyles['connectorStatusError'] ?? '' }
  }
  if (runtime?.status === 'disconnected') {
    return { text: t('disconnectedStatus'), className: connectorStyles['connectorStatusDisabled'] ?? '' }
  }
  if (runtime?.status === 'ready' || entry.telemetry !== undefined) {
    return { text: t('connectedStatus'), className: connectorStyles['connectorStatusReady'] ?? '' }
  }
  if (entry.stored !== undefined) {
    return { text: t('reconnectRequiredStatus'), className: connectorStyles['connectorStatusWarn'] ?? '' }
  }
  return { text: t('authorizationRequiredStatus'), className: connectorStyles['connectorStatusWarn'] ?? '' }
}

function accountGrantConnectsCatalogEntry(account: Entry | undefined): boolean {
  if (account === undefined || (account.stored === undefined && account.telemetry === undefined)) return false
  const scopedConnectors = account.telemetry?.connectors
  return scopedConnectors === undefined || scopedConnectors.length === 0
}

function CatalogCard({ definition, live, account, mcpRuntime, managed, openClaw, connected, t, authorizationProgress,
  onAuthorize, onDisconnect, onConfigure, onInstallCurated, onFindOfficial, onFindRegistry, onReconnect, onRepair, onRemove,
  pending, installingCurated, reconnecting,
  repairing, removing }: {
  definition: ConnectorDefinition
  live?: ConnectorTelemetry | undefined
  account?: Entry | undefined
  mcpRuntime?: McpConnectorRuntimeView | undefined
  managed?: ManagedMcpConnectorView | undefined
  openClaw?: OpenClawConnectorView | undefined
  connected: boolean
  t: ConnectorsSettingsSectionProps['connectorT']
  authorizationProgress?: ReactNode
  onAuthorize: (entry: Entry) => void
  onDisconnect?: ((entry: Entry) => void) | undefined
  onConfigure?: (() => void) | undefined
  onInstallCurated?: (() => void) | undefined
  onFindOfficial?: (() => void) | undefined
  onFindRegistry?: (() => void) | undefined
  onReconnect?: ((runtime: McpConnectorRuntimeView) => void) | undefined
  onRepair?: ((connector: ManagedMcpConnectorView) => void) | undefined
  onRemove?: ((connector: ManagedMcpConnectorView) => void) | undefined
  pending: boolean
  installingCurated: boolean
  reconnecting: boolean
  repairing: boolean
  removing: boolean
}): ReactNode {
  const [microsoftBillingAcknowledged, setMicrosoftBillingAcknowledged] = useState(false)
  const microsoftRequiresBillingAcknowledgement = definition.id === 'microsoft-workiq'
    || definition.id === 'microsoft-azure'
  const connectedByAccount = managed === undefined
    && mcpRuntime === undefined
    && accountGrantConnectsCatalogEntry(account)
  const installUrl = safeExternalHref(live?.installUrl)
  const liveStatus = live === undefined ? undefined : connectorStatus(live, t)
  const mcpStatus = mcpRuntime?.status === 'ready'
    ? mcpRuntime.toolNames.length > 0
      ? { text: t('callableStatus'), className: connectorStyles['connectorStatusReady'] ?? '' }
      : { text: t('registryNoToolsStatus'), className: connectorStyles['connectorStatusWarn'] ?? '' }
    : mcpRuntime?.status === 'starting'
      ? { text: t('connectingStatus'), className: connectorStyles['connectorStatusInfo'] ?? '' }
      : mcpRuntime?.status === 'auth-required'
        ? { text: t('authorizationRequiredStatus'), className: connectorStyles['connectorStatusWarn'] ?? '' }
        : mcpRuntime?.status === 'failed'
          ? { text: t('brokenStatus'), className: connectorStyles['connectorStatusError'] ?? '' }
          : mcpRuntime?.status === 'disconnected'
            ? { text: t('disconnectedStatus'), className: connectorStyles['connectorStatusDisabled'] ?? '' }
            : managed !== undefined
              ? { text: t('runtimeMissingStatus'), className: connectorStyles['connectorStatusInfo'] ?? '' }
              : undefined
  const openClawStatus = openClaw?.connected === true
    ? { text: t('openClawConnectedStatus'), className: connectorStyles['connectorStatusReady'] ?? '' }
    : undefined
  // MCP state is authoritative whenever installed: a gh CLI session cannot
  // hide a failed or unauthenticated GitHub MCP.
  const status = (managed !== undefined || mcpRuntime !== undefined ? mcpStatus : undefined)
    ?? openClawStatus ?? mcpStatus ?? liveStatus ?? (connectedByAccount
    ? { text: t('connectedStatus'), className: connectorStyles['connectorStatusReady'] ?? '' }
    : definition.id === 'binance'
      ? { text: t('binancePaperReadyStatus'), className: connectorStyles['connectorStatusReady'] ?? '' }
      : definition.provenance === 'private-owner'
        ? { text: t('privateOwnerStatus'), className: connectorStyles['connectorStatusInfo'] ?? '' }
        : definition.mode === 'native'
          ? { text: t('availableStatus'), className: '' }
          : definition.mode === 'mcp'
            ? { text: t('mcpReadyStatus'), className: '' }
            : definition.mode === 'api-key'
              ? { text: t('apiKeyStatus'), className: '' }
              : account !== undefined
                ? { text: t('availableStatus'), className: '' }
                : definition.curatedMcp === true || definition.registryName !== undefined
                  ? { text: t('officialInstallAvailableStatus'), className: connectorStyles['connectorStatusInfo'] ?? '' }
                  : { text: t('officialAdapterUnavailableStatus'), className: connectorStyles['connectorStatusDisabled'] ?? '' })
  const authorizationAccount = account !== undefined && account.methods.length > 0
    ? account
    : undefined
  const reauthorizationRequired = mcpRuntime?.status === 'auth-required'
    && authorizationAccount?.stored !== undefined
  const openClawRuntimeMissing = definition.id === 'github' && openClaw?.phase === 'missing-runtime'
  const shouldShowAuthorization = authorizationAccount !== undefined
    && !connectedByAccount
    && (openClaw?.connected !== true || managed !== undefined || mcpRuntime !== undefined)
    && (!openClawRuntimeMissing || managed !== undefined || mcpRuntime !== undefined)
    && (authorizationAccount.stored === undefined || mcpRuntime?.status === 'auth-required'
      || (authorizationAccount.methods.some(method => method.id === 'credentials')
        && mcpRuntime !== undefined && mcpRuntime.status !== 'ready'))
  const missingOAuthFlow = managed !== undefined && mcpRuntime?.status === 'auth-required'
    && authorizationAccount === undefined
  const canRepair = managed !== undefined && managed.source !== undefined && onRepair !== undefined
    && (mcpRuntime === undefined || mcpRuntime.status === 'failed'
      || mcpRuntime.status === 'disconnected'
      || (mcpRuntime.status === 'ready' && mcpRuntime.toolNames.length === 0)
      || missingOAuthFlow)
  // Reconnecting an auth-required MCP with no registered flow cannot produce
  // consent. Offer the source-aware Repair action instead of looping forever.
  const canReconnect = mcpRuntime !== undefined
    && (mcpRuntime.status === 'failed'
      || mcpRuntime.status === 'disconnected'
      || (missingOAuthFlow && !canRepair))
    && onReconnect !== undefined
  return (
    <article className={connectorStyles['connectorCard']} data-connector-id={definition.id}>
      <div className={connectorStyles['connectorTop']}>
        <div className={hubStyles['logoShell']}>
          <span className={connectorStyles['connectorFallback']} aria-hidden="true">{definition.name.slice(0, 1).toUpperCase()}</span>
          {definition.logoUrl === undefined ? null : (
            <img
              className={`${connectorStyles['connectorIcon']} ${hubStyles['logoImage'] ?? ''}`.trim()}
              src={definition.logoUrl}
              alt={definition.name}
              onError={(event) => { event.currentTarget.hidden = true }}
            />
          )}
        </div>
        <div className={connectorStyles['connectorIdentity']}>
          <span className={connectorStyles['connectorName']}>{definition.name}</span>
          <span className={connectorStyles['connectorCategory']}>{definition.category} · {definition.mode.toUpperCase()}</span>
        </div>
      </div>
      <p className={connectorStyles['connectorDescription']}>{definition.description}</p>
      {definition.id === 'github' ? (
        <div className={styles['advancedHint']}>
          <p>
            GitHub MCP remoto no admite registro OAuth dinámico. Utiliza un token
            personal (PAT); GitHub Copilot como proveedor de modelos es independiente.{' '}
            <a href="https://github.com/settings/personal-access-tokens/new"
              target="_blank" rel="noopener noreferrer">Crear token en GitHub</a>
            {' '}·{' '}
            <a href="https://github.com/arisnachy/phoenix-harnes/blob/stable/docs/connectors/github-mcp.md"
              target="_blank" rel="noopener noreferrer">Guía completa</a>
          </p>
          <details>
            <summary>Cómo crear el token y configurar los permisos</summary>
            <ol>
              <li>Inicia sesión en GitHub y abre «Crear token en GitHub».</li>
              <li>En Token name escribe «Phoenix GitHub MCP» y elige una caducidad (por ejemplo, 90 días).</li>
              <li>En Resource owner elige tu cuenta o la organización autorizada.</li>
              <li>En Repository access selecciona solo los repositorios que utilizará Phoenix.</li>
              <li>En Repository permissions concede Contents, Issues, Pull requests y Actions en Read-only según lo que necesites. Metadata es automático.</li>
              <li>Solo si Kira debe modificar repositorios, aumenta a Read and write los permisos concretos necesarios.</li>
              <li>Pulsa Generate token, cópialo una vez y pégalo únicamente en «Configurar token GitHub» dentro de Phoenix.</li>
            </ol>
            <p>No compartas el token en el chat, commits ni registros. Phoenix lo guardará en su vault local.</p>
          </details>
        </div>
      ) : null}
      {definition.id === 'meta-devtools' ? (
        <div className={styles['advancedHint']}>
          <p>
            MCP oficial de Meta para tus aplicaciones, permisos, App Review, uso de API y webhooks.
            No sirve para publicar directamente en páginas de Facebook o cuentas de Instagram.
            {' '}<a href="https://developers.facebook.com/documentation/mcp/devtools-mcp"
              target="_blank" rel="noopener noreferrer">Documentación oficial</a>
            {' '}·{' '}<a href="https://github.com/arisnachy/phoenix-harnes/blob/stable/docs/connectors/meta-mcp.md"
              target="_blank" rel="noopener noreferrer">Guía de Phoenix</a>.
          </p>
          <p>OAuth de Meta requiere autorización real y puede exigir un redirect HTTPS; si Meta rechaza
            el callback local de Phoenix, la conexión permanecerá pendiente, nunca conectada ficticiamente.</p>
        </div>
      ) : null}
      {definition.id === 'meta-whatsapp-business' ? (
        <div className={styles['advancedHint']}>
          <p>
            Para WhatsApp Business Cloud API, no para WhatsApp personal.
            Necesitas permisos de administrador en Meta Business y en la app de WhatsApp,
            además de aceptar los términos de Cloud API.
            {' '}<a href="https://mcp.facebook.com/whatsapp_business_tools"
              target="_blank" rel="noopener noreferrer">Servidor oficial</a>
            {' '}·{' '}<a href="https://github.com/arisnachy/phoenix-harnes/blob/stable/docs/connectors/meta-mcp.md"
              target="_blank" rel="noopener noreferrer">Guía de Phoenix</a>.
          </p>
          <p>Conectar y consultar no supone envíos gratuitos ilimitados. Algunos mensajes y
            operaciones pueden generar cargos de Meta: confirma el coste y pide aprobación
            antes de cualquier envío o cambio de facturación.</p>
        </div>
      ) : null}
      {definition.id === 'microsoft-learn' ? (
        <p className={styles['advancedHint']}>
          Gratuito: documentación pública oficial sin inicio de sesión ni acceso a correos privados.
          {' '}<a href="https://learn.microsoft.com/en-us/training/support/mcp-developer-reference"
            target="_blank" rel="noopener noreferrer">Documentación oficial</a>.
        </p>
      ) : null}
      {definition.id === 'microsoft-workiq' ? (
        <div className={styles['advancedHint']}>
          <p>Microsoft Work IQ es una puerta de entrada a Outlook, Calendar, Teams,
            OneDrive y SharePoint, pero su API <strong>se factura por uso</strong>. Necesitas
            plan de pago habilitado, consentimiento administrativo de Entra y aceptar
            el contrato de licencia (EULA) antes del primer uso.</p>
          <p>Tras instalarlo, acepta la licencia en una terminal propia:
            <code>npx -y @microsoft/workiq accept-eula</code>. No se aceptará automáticamente.</p>
          <p><a href="https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/cli"
            target="_blank" rel="noopener noreferrer">Requisitos oficiales</a>
            {' '}·{' '}<a href="https://github.com/arisnachy/phoenix-harnes/blob/stable/docs/connectors/microsoft-mcp.md"
              target="_blank" rel="noopener noreferrer">Guía Phoenix</a></p>
        </div>
      ) : null}
      {definition.id === 'microsoft-azure' ? (
        <div className={styles['advancedHint']}>
          <p>Azure MCP oficial utiliza <code>npx</code> y las credenciales de
            <code>az login</code>. El MCP no tiene coste de licencia independiente,
            pero ejecutar operaciones sobre recursos Azure puede generar cargos.
            El modo consolidado reduce el volumen de herramientas.</p>
          <p><a href="https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/concepts"
            target="_blank" rel="noopener noreferrer">Documentación oficial</a>
            {' '}·{' '}<a href="https://github.com/arisnachy/phoenix-harnes/blob/stable/docs/connectors/microsoft-mcp.md"
              target="_blank" rel="noopener noreferrer">Guía Phoenix</a></p>
        </div>
      ) : null}
      {['outlook-mail', 'outlook-calendar', 'onedrive', 'sharepoint', 'microsoft-teams'].includes(definition.id)
        && managed === undefined && authorizationAccount === undefined ? (
          <p className={styles['advancedHint']}>
            Para consultar datos de Microsoft 365, instala Microsoft 365 Work IQ
            (requiere plan de facturación y permisos Entra) o conecta un adaptador
            Graph con los permisos de tu cuenta. Esta tarjeta no es un OAuth operativo independiente.
          </p>
        ) : null}
      {microsoftRequiresBillingAcknowledgement && managed === undefined ? (
        <label className={styles['advancedHint']}>
          <input type="checkbox" checked={microsoftBillingAcknowledged}
            onChange={(event) => { setMicrosoftBillingAcknowledged(event.target.checked) }} />
          {' '}Comprendo que debo autorizar los costes y requisitos de Microsoft
          antes de activar este MCP. La instalación no garantiza uso gratuito.
        </label>
      ) : null}
      {definition.id === 'figma' && managed?.url === 'http://127.0.0.1:3845/mcp'
        && mcpRuntime?.status !== 'ready' ? (
          <p className={styles['advancedHint']}>
            Figma Desktop no abre OAuth: inicia Figma, abre un diseño en Dev Mode y habilita el servidor MCP local.
            Para OAuth utiliza el MCP remoto oficial de Figma.
          </p>
        ) : null}
      {definition.id === 'memory' && mcpRuntime?.status === 'failed' ? (
        <p className={styles['advancedHint']}>
          Memory MCP es local (stdio), no requiere OAuth. Pulsa Reparar y comprueba que Node.js y npx están disponibles
          para el proceso de PHOENIX; si continúa roto, revisa el error de arranque del Host.
        </p>
      ) : null}
      {missingOAuthFlow ? (
        <p role="alert" className={styles['advancedHint']}>
          El Host solicita autorización, pero el plugin MCP no registró su método OAuth.
          Usa Reparar para reconstruir el conector desde su origen oficial, sin eliminar las credenciales existentes.
        </p>
      ) : null}
      {openClaw?.connected !== true ? null : (
        <p className={styles['advancedHint']}>
          {openClaw.account === undefined ? openClaw.skillAlias : `${openClaw.skillAlias} · ${openClaw.account}`}
          {definition.id === 'github' ? ' · API CLI verificada (independiente del MCP)' : ''}
        </p>
      )}
      {definition.id === 'github' && managed === undefined && mcpRuntime === undefined ? (
        <p className={styles['advancedHint']}>
          El MCP oficial de GitHub proporciona herramientas de repositorios y PR.
          Se autoriza con GitHub, no con GitHub Copilot como modelo.
        </p>
      ) : null}
      {definition.id === 'github' && openClaw?.phase === 'api-unavailable'
        && managed === undefined ? (
          <p role="alert" className={styles['advancedHint']}>
            GitHub CLI está autenticado, pero gh api user no pudo verificar acceso a la API.
            Comprueba permisos/red o utiliza el MCP oficial.
          </p>
        ) : null}
      <div className={connectorStyles['connectorFooter']}>
        <span className={`${connectorStyles['connectorStatus'] ?? ''} ${status.className}`.trim()}>{status.text}</span>
        <div className={connectorStyles['connectorActions']}>
          {onConfigure !== undefined ? (
            <button className={connectorStyles['connectorPrimaryButton']} type="button" disabled={pending} onClick={onConfigure}>
              {t('configure')}
            </button>
          ) : installUrl !== undefined ? (
            <a className={connectorStyles['connectorLink']} href={installUrl} target="_blank" rel="noreferrer">{t('configure')}</a>
          ) : null}
          {shouldShowAuthorization ? (
            <button className={hubStyles['compactButton']} type="button" disabled={pending || authorizationAccount.inFlight} onClick={() => { onAuthorize(authorizationAccount) }}>
              {definition.id === 'github' && authorizationAccount.methods.some(method => method.id === 'credentials')
                ? 'Configurar token GitHub'
                : reauthorizationRequired || connected ? t('reauthorize') : t('authorize')}
            </button>
          ) : null}
          {account?.stored !== undefined && account.disconnectable === true && onDisconnect !== undefined ? (
            <button className={hubStyles['compactButton']} type="button" disabled={pending || account.inFlight}
              onClick={() => { onDisconnect(account) }}>
              {t('disconnect')}
            </button>
          ) : null}
          {canReconnect ? (
            <button
              className={hubStyles['compactButton']}
              type="button"
              disabled={pending || reconnecting || repairing || removing}
              onClick={() => {
                if (mcpRuntime !== undefined) onReconnect?.(mcpRuntime)
              }}
            >
              {reconnecting ? t('connectingStatus') : mcpRuntime.status === 'auth-required' ? t('authorize') : t('reconnect')}
            </button>
          ) : null}
          {canRepair ? (
            <button
              className={hubStyles['compactButton']}
              type="button"
              disabled={pending || repairing || removing}
              onClick={() => { onRepair(managed) }}
            >
              {repairing ? t('repairing') : t('repair')}
            </button>
          ) : null}
          {managed !== undefined && onRemove !== undefined ? (
            <button
              className={connectorStyles['connectorSecondaryButton']}
              type="button"
              disabled={pending || repairing || removing}
              onClick={() => { onRemove(managed) }}
            >
              {removing ? t('uninstalling') : t('uninstall')}
            </button>
          ) : null}
          {managed === undefined && mcpRuntime === undefined && authorizationAccount === undefined
            && (openClaw?.connected !== true || definition.id === 'github')
            && definition.curatedMcp === true && onInstallCurated !== undefined ? (
              <button
                className={connectorStyles['connectorPrimaryButton']}
                type="button"
                disabled={pending || installingCurated
                  || (microsoftRequiresBillingAcknowledgement && !microsoftBillingAcknowledged)}
                onClick={onInstallCurated}
              >
                {installingCurated ? t('installing') : definition.id === 'github' ? 'Instalar MCP GitHub' : t('install')}
              </button>
            ) : null}
          {managed === undefined && (authorizationAccount === undefined || openClawRuntimeMissing)
            && openClaw?.connected !== true && onFindOfficial !== undefined ? (
              <button className={hubStyles['compactButton']} type="button" disabled={pending} onClick={onFindOfficial}>
                {definition.registryName === undefined ? t('findConnector') : t('findOfficialConnector')}
              </button>
            ) : null}
          {managed === undefined && authorizationAccount === undefined && openClaw?.connected !== true && definition.provenance === 'registry-listed' && onFindRegistry !== undefined ? (
            <button className={hubStyles['compactButton']} type="button" disabled={pending} onClick={onFindRegistry}>
              {t('findConnector')}
            </button>
          ) : null}
        </div>
      </div>
      {authorizationProgress}
    </article>
  )
}

function registryCandidateLogo(candidate: McpRegistryCandidateView): string | undefined {
  return candidate.icons
    .map(icon => safeExternalHref(icon.src))
    .find((src): src is string => src !== undefined)
}

function OfficialMcpCard({ candidate, stale, managed, runtime, installing, reconnecting, repairing, removing, t,
  onInstall, onReconnect, onRepair, onRemove }: {
  candidate: McpRegistryCandidateView
  stale: boolean
  managed?: ManagedMcpConnectorView | undefined
  runtime?: McpConnectorRuntimeView | undefined
  installing: boolean
  reconnecting: boolean
  repairing: boolean
  removing: boolean
  t: ConnectorsSettingsSectionProps['connectorT']
  onInstall: (candidate: McpRegistryCandidateView) => void
  onReconnect?: ((runtime: McpConnectorRuntimeView) => void) | undefined
  onRepair?: ((connector: ManagedMcpConnectorView) => void) | undefined
  onRemove?: ((connector: ManagedMcpConnectorView) => void) | undefined
}): ReactNode {
  const source = safeExternalHref(candidate.repositoryUrl) ?? safeExternalHref(candidate.websiteUrl)
  const logoUrl = registryCandidateLogo(candidate)
  const displayName = candidate.title
  const technicalName = normalize(displayName) === normalize(candidate.name) ? undefined : candidate.name
  const installable = candidate.status === 'active' && candidate.remoteUrl !== undefined
    && candidate.remoteSetupRequired === undefined
  const needsRepair = managed !== undefined && (runtime === undefined || runtime.status === 'failed')
  const canReconnect = runtime !== undefined
    && (runtime.status === 'failed' || runtime.status === 'disconnected' || runtime.status === 'auth-required')
    && onReconnect !== undefined
  const setupStatus = candidate.remoteSetupRequired === 'headers'
    ? t('registryHeadersSetupStatus')
    : candidate.remoteSetupRequired === 'variables'
      ? t('registryVariablesSetupStatus')
      : candidate.packages.length > 0
        ? t('registryPackageSetupStatus')
        : t('registryNoCompatibleRemoteStatus')
  const status = managed !== undefined
    ? runtime === undefined
      ? t('runtimeMissingStatus')
      : runtime.status === 'ready'
        ? runtime.toolNames.length > 0 ? t('callableStatus') : t('registryNoToolsStatus')
        : runtime.status === 'starting'
          ? t('connectingStatus')
          : runtime.status === 'auth-required'
            ? t('authorizationRequiredStatus')
            : runtime.status === 'disconnected'
              ? t('disconnectedStatus')
              : t('brokenStatus')
    : candidate.status === 'deprecated' || candidate.status === 'deleted'
      ? t('registryDeprecatedStatus')
      : candidate.status === 'active' && !installable
        ? setupStatus
        : t('registryListedStatus')
  return (
    <article className={`${connectorStyles['connectorCard'] ?? ''} ${connectorStyles['registryCard'] ?? ''}`.trim()} data-registry-server={candidate.name}>
      <div className={connectorStyles['connectorTop']}>
        <div className={hubStyles['logoShell']}>
          <span className={connectorStyles['connectorFallback']} aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
          {logoUrl === undefined ? null : (
            <img
              className={`${connectorStyles['connectorIcon'] ?? ''} ${hubStyles['logoImage'] ?? ''}`.trim()}
              src={logoUrl}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={(event) => { event.currentTarget.hidden = true }}
            />
          )}
        </div>
        <div className={connectorStyles['connectorIdentity']}>
          <span className={connectorStyles['connectorName']}>{displayName}</span>
          {technicalName === undefined ? null : <span className={connectorStyles['connectorCategory']}>{technicalName}</span>}
        </div>
      </div>
      <div className={connectorStyles['connectorBadges']}>
        <span className={connectorStyles['connectorBadge']}>MCP</span>
        <span className={connectorStyles['connectorBadge']}>{`v${candidate.version}`}</span>
        {candidate.transports.slice(0, 2).map(transport => (
          <span key={transport} className={connectorStyles['connectorBadge']}>{transport}</span>
        ))}
      </div>
      <p className={connectorStyles['connectorDescription']}>{candidate.description}</p>
      <div className={connectorStyles['connectorFooter']}>
        <span title={status} className={`${connectorStyles['connectorStatus'] ?? ''} ${needsRepair ? connectorStyles['connectorStatusError'] ?? '' : runtime?.status === 'ready' && runtime.toolNames.length > 0 ? connectorStyles['connectorStatusReady'] ?? '' : candidate.status === 'active' ? connectorStyles['connectorStatusInfo'] ?? '' : connectorStyles['connectorStatusDisabled'] ?? ''}`.trim()}>
          {status}{stale ? ` · ${t('registryCachedStatus')}` : ''}
        </span>
        <div className={connectorStyles['connectorActions']}>
          {source === undefined ? null : (
            <a className={connectorStyles['connectorLink']} href={source} target="_blank" rel="noreferrer">{t('viewSource')}</a>
          )}
          {managed === undefined && installable ? (
            <button
              type="button"
              className={connectorStyles['connectorPrimaryButton']}
              disabled={installing}
              onClick={() => { onInstall(candidate) }}
            >
              {installing ? t('installing') : t('install')}
            </button>
          ) : null}
          {canReconnect ? (
            <button
              type="button"
              className={hubStyles['compactButton']}
              disabled={reconnecting || repairing || removing}
              onClick={() => {
                if (runtime !== undefined) onReconnect?.(runtime)
              }}
            >
              {reconnecting ? t('connectingStatus') : runtime?.status === 'auth-required' ? t('authorize') : t('reconnect')}
            </button>
          ) : null}
          {needsRepair && managed.source !== undefined && onRepair !== undefined ? (
            <button
              type="button"
              className={hubStyles['compactButton']}
              disabled={repairing || removing}
              onClick={() => { onRepair(managed) }}
            >
              {repairing ? t('repairing') : t('repair')}
            </button>
          ) : null}
          {managed !== undefined && onRemove !== undefined ? (
            <button
              type="button"
              className={connectorStyles['connectorSecondaryButton']}
              disabled={repairing || removing}
              onClick={() => { onRemove(managed) }}
            >
              {removing ? t('uninstalling') : t('uninstall')}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  )
}

/**
 * Legacy compact account surface retained for compatibility tests. Product
 * authentication is owned by Settings → Connectors; Models no longer renders
 * this component.
 */
export function AuthorizationPanel({ api, t, onAuthorized }: AuthorizationPanelProps): ReactNode {
  const [entries, setEntries] = useState<Entry[]>([])
  const [catalogFailure, setCatalogFailure] = useState<string | undefined>()
  const [refresh, setRefresh] = useState(0)
  const { attempt, answer, setAnswer, failure, preparingKey, begin, submitAnswer, cancel } =
    useAuthorizationAttempt(api, () => {
      setRefresh(current => current + 1)
      onAuthorized()
    })

  useEffect(() => {
    if (api === undefined) return
    let stale = false
    setCatalogFailure(undefined)
    void readConnectorRemoteWithRetry(() => readAuthorizationEntries(api), () => stale).then((allEntries) => {
      if (stale) return
      const oauthEntries = allEntries.filter(entry => entry.methods.some(method => method.id === 'oauth'))
      // Fresh installs put subscription-backed Codex first so the primary
      // model route presents its native Auth action before generic providers.
      oauthEntries.sort((left, right) =>
        Number(right.key === NATIVE_CODEX_ACCOUNT_KEY) - Number(left.key === NATIVE_CODEX_ACCOUNT_KEY))
      setEntries(oauthEntries)
    }, (error: unknown) => {
      if (!stale) setCatalogFailure(String(error))
    })
    return () => { stale = true }
  }, [api, refresh])

  if (api === undefined) return null
  if (entries.length === 0 && catalogFailure === undefined) return null

  return (
    <section className={styles.authorizationPanel} aria-label={t('accountConnections')}>
      <h3 className={styles.authorizationTitle}>{t('accountConnections')}</h3>
      <p className={styles.intro}>{t('accountConnectionsHint')}</p>
      {entries.map((entry) => {
        const connected = entry.stored !== undefined
        const busy = entry.inFlight || preparingKey === entry.key || (attempt?.status === 'pending' && attempt.key === entry.key)
        const methods = entry.methods.filter(method => method.id === 'oauth')
        return (
          <div key={entry.key} className={styles.authorizationActions}>
            <span className={styles.rowName}>{entry.label}</span>
            <span className={styles.rowTag}>Auth</span>
            <span className={connected ? styles.connectedChip : styles.notice}>
              {connected ? t('accountSignedIn') : t('credentialMissing')}
            </span>
            {connected
              ? null
              : methods.map(method => (
                <button
                  key={method.id}
                  type="button"
                  className={styles.secondaryButton}
                  disabled={busy}
                  onClick={() => { begin(entry.key, method.id) }}
                >
                  {busy && attempt?.key === entry.key ? t('signingIn') : method.label}
                </button>
              ))}
          </div>
        )
      })}
      <AuthorizationAttemptProgress
        attempt={attempt}
        answer={answer}
        setAnswer={setAnswer}
        submitAnswer={submitAnswer}
        cancel={cancel}
        t={t}
      />
      {catalogFailure === undefined ? null : <p className={styles.error}>{catalogFailure}</p>}
      {failure === undefined ? null : <p className={styles.error}>{failure}</p>}
    </section>
  )
}

/** Dedicated account and MCP/app connector settings page. */
export function ConnectorsSettingsSection({ api,
  t,
  connectorT,
  chatGptWeb,
  settings,
  mcpRegistry,
  assistantMail,
  launchContext,
  onAuthorized }: ConnectorsSettingsSectionProps): ReactNode {
  const [entries, setEntries] = useState<Entry[]>([])
  const [catalogFailure, setCatalogFailure] = useState<string | undefined>()
  const [disconnectingKey, setDisconnectingKey] = useState<string | undefined>()
  const [refresh, setRefresh] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ConnectorFilter>('all')
  const catalogSearch = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (launchContext === 'discover') {
      setFilter('available')
      catalogSearch.current?.focus({ preventScroll: true })
    } else if (launchContext === 'connectors') {
      setFilter('all')
    }
  }, [launchContext])
  const [registrySnapshot, setRegistrySnapshot] = useState<McpRegistrySearchSnapshot | undefined>()
  const [registryBusy, setRegistryBusy] = useState(false)
  const [registryFailure, setRegistryFailure] = useState(false)
  const [mcpHub, setMcpHub] = useState<McpConnectorHubSnapshot>({ runtime: [], managed: [] })
  const [openClaw, setOpenClaw] = useState<OpenClawConnectorSnapshot>({ connectors: [] })
  const [jevState, setJevState] = useState<JevMcpSnapshot | undefined>()
  const [jevSetupOpen, setJevSetupOpen] = useState(false)
  const [jevApiKey, setJevApiKey] = useState('')
  const [jevBusy, setJevBusy] = useState(false)
  const [jevFailure, setJevFailure] = useState<string | undefined>()
  const [installingRegistryName, setInstallingRegistryName] = useState<string | undefined>()
  const [installingCuratedId, setInstallingCuratedId] = useState<string | undefined>()
  const [repairingEntryId, setRepairingEntryId] = useState<string | undefined>()
  const [removingEntryId, setRemovingEntryId] = useState<string | undefined>()
  const [reconnectingServerName, setReconnectingServerName] = useState<string | undefined>()
  const [reconnectFailure, setReconnectFailure] = useState<{ serverName: string; message: string } | undefined>()
  const [chatGptWebState, setChatGptWebState] = useState<ChatGptWebSnapshot | undefined>()
  const [chatGptWebBusy, setChatGptWebBusy] = useState(false)
  const [chatGptWebFailure, setChatGptWebFailure] = useState<string | undefined>()
  const {
    attempt,
    answer,
    setAnswer,
    failure,
    preparingKey,
    lastAttemptKey,
    reserveOAuthPopup,
    closeOAuthPopup,
    begin,
    submitAnswer,
    cancel,
  } = useAuthorizationAttempt(api, () => {
    setRefresh(current => current + 1)
    onAuthorized()
  })

  useEffect(() => {
    if (chatGptWeb === undefined) return
    let stale = false
    setChatGptWebFailure(undefined)
    void readConnectorRemoteWithRetry(() => chatGptWeb.state(), () => stale).then(
      (snapshot) => { if (!stale) setChatGptWebState(snapshot) },
      (error: unknown) => {
        if (!stale && !isTransientConnectorRemoteFailure(error)) {
          setChatGptWebFailure(String(error))
        }
      },
    )
    return () => { stale = true }
  }, [chatGptWeb])

  useEffect(() => {
    if (api === undefined) return
    let stale = false
    setCatalogFailure(undefined)
    void readConnectorRemoteWithRetry(() => readAuthorizationEntries(api), () => stale).then(
      (allEntries) => { if (!stale) setEntries(allEntries) },
      (error: unknown) => { if (!stale) setCatalogFailure(String(error)) },
    )
    return () => { stale = true }
  }, [api, refresh])

  useEffect(() => {
    if (mcpRegistry === undefined) return
    let stale = false
    void readConnectorRemoteWithRetry(() => mcpRegistry.state(), () => stale).then(
      (snapshot) => { if (!stale) setMcpHub(snapshot) },
      (error: unknown) => {
        if (!stale && !isTransientConnectorRemoteFailure(error)) {
          setCatalogFailure(String(error))
        }
      },
    )
    return () => { stale = true }
  }, [mcpRegistry, refresh])

  useEffect(() => {
    if (mcpRegistry === undefined || !mcpHub.runtime.some(entry => entry.status === 'starting')) return
    const timer = window.setTimeout(() => {
      setRefresh(current => current + 1)
    }, 650)
    return () => { window.clearTimeout(timer) }
  }, [mcpRegistry, mcpHub.runtime])

  useEffect(() => {
    if (api === undefined && mcpRegistry === undefined) return
    const timer = window.setInterval(() => {
      setRefresh(current => current + 1)
    }, 5_000)
    return () => { window.clearInterval(timer) }
  }, [api, mcpRegistry])

  useEffect(() => {
    if (api === undefined) return
    const expectedKeys = mcpHub.managed.flatMap((connector) => {
      const runtime = mcpHub.runtime.find(entry => entry.serverName === connector.serverName)
      if (runtime?.status !== 'auth-required') return []
      return [`mcp-client/${connector.serverName.toLowerCase().replaceAll('_', '-')}`]
    })
    if (expectedKeys.length === 0) return

    const controller = new AbortController()
    let retryTimer: ReturnType<typeof globalThis.setTimeout> | undefined
    void (async () => {
      for (const delayMs of MCP_AUTH_FLOW_RETRY_MS) {
        if (delayMs > 0) {
          await new Promise<void>((resolve) => { globalThis.setTimeout(resolve, delayMs) })
        }
        if (controller.signal.aborted) return
        try {
          const allEntries = await readAuthorizationEntries(api)
          if (controller.signal.aborted) return
          setEntries(allEntries)
          if (expectedKeys.every(key => allEntries.some(entry => entry.key === key))) return
        } catch (error: unknown) {
          if (!isTransientConnectorRemoteFailure(error)) {
            if (!controller.signal.aborted) setCatalogFailure(String(error))
            return
          }
        }
      }
      if (!controller.signal.aborted) {
        retryTimer = globalThis.setTimeout(() => {
          setRefresh(current => current + 1)
        }, MCP_AUTH_FLOW_REFRESH_MS)
      }
    })()
    return () => {
      controller.abort()
      if (retryTimer !== undefined) globalThis.clearTimeout(retryTimer)
    }
  }, [api, mcpHub.managed, mcpHub.runtime])

  useEffect(() => {
    const readOpenClaw = mcpRegistry?.openClawState?.bind(mcpRegistry)
    if (readOpenClaw === undefined) return
    let stale = false
    void readConnectorRemoteWithRetry(() => readOpenClaw(), () => stale).then(
      (snapshot) => { if (!stale) setOpenClaw(snapshot) },
      (error: unknown) => {
        if (!stale && !isTransientConnectorRemoteFailure(error)) setCatalogFailure(String(error))
      },
    )
    return () => { stale = true }
  }, [mcpRegistry, refresh])

  useEffect(() => {
    const readJevState = mcpRegistry?.jevState?.bind(mcpRegistry)
    if (readJevState === undefined) return
    let stale = false
    void readConnectorRemoteWithRetry(() => readJevState(), () => stale).then(
      (snapshot) => { if (!stale) setJevState(snapshot) },
      (error: unknown) => {
        if (!stale && !isTransientConnectorRemoteFailure(error)) setJevFailure(String(error))
      },
    )
    return () => { stale = true }
  }, [mcpRegistry, refresh])

  useEffect(() => {
    const search = query.trim()
    const catalogMatch = catalogDefinitionForText(search)
    // Jev is a pinned Phoenix integration with its own credential flow.
    // Never send Jev through the generic Official MCP Registry installer:
    // that path performs an unnecessary second registry lookup and can time out.
    if (mcpRegistry === undefined || search.length < 2 || isRetiredJevSearchText(search) || catalogMatch !== undefined) {
      setRegistrySnapshot(undefined)
      setRegistryFailure(false)
      setRegistryBusy(false)
      return
    }
    let stale = false
    const timer = window.setTimeout(() => {
      setRegistryBusy(true)
      setRegistryFailure(false)
      void mcpRegistry.search({ query: search, limit: 12 }).then(
        (snapshot) => {
          if (!stale) {
            setRegistrySnapshot({
              ...snapshot,
              candidates: snapshot.candidates.filter(candidate => !isRetiredJevCandidate(candidate)),
            })
          }
        },
        () => {
          if (!stale) {
            setRegistrySnapshot(undefined)
            setRegistryFailure(true)
          }
        },
      ).finally(() => {
        if (!stale) setRegistryBusy(false)
      })
    }, 250)
    return () => {
      stale = true
      window.clearTimeout(timer)
    }
  }, [mcpRegistry, query])

  const liveConnectors = useMemo(
    () => entries.flatMap(entry => entry.telemetry?.connectors ?? []),
    [entries],
  )

  const catalogDefinitions = useMemo(() => {
    const providers: ConnectorDefinition[] = entries.filter(entry =>
      entry.key.startsWith('llm-pi-ai/')
      && entry.key !== 'llm-pi-ai/github-copilot'
      && !CONNECTOR_CATALOG.some(definition => entryMatchesDefinitionAuthorization(entry, definition)))
      .map(entry => ({
        id: entry.key, name: entry.label, category: connectorT('modelProviders'),
        description: connectorT('modelProviderHint'),
        mode: entry.methods.some(method => method.id === 'oauth') ? 'oauth' : 'api-key',
        provenance: 'native', authorizationKey: entry.key, capabilities: ['models'],
      }))
    return [...CONNECTOR_CATALOG, ...providers]
  }, [entries, connectorT])

  const catalogRows = useMemo(() => catalogDefinitions.map((definition) => {
    const live = liveConnectors.find(candidate => liveMatchesDefinition(candidate, definition))
    const managed = definition.id === 'binance'
      ? mcpHub.managed.find(candidate => candidate.serverName === 'binance-agent-os'
        || candidate.url === 'https://agent.binance.com/mcp/agentic')
      : definition.id === 'jev'
        ? mcpHub.managed.find(candidate => candidate.serverName === 'jev')
        : mcpHub.managed.find(candidate => managedMatchesDefinition(candidate, definition))
    // Registry MCPs often use generated namespaces (e.g. mcp-<digest>).
    // The persisted managed source binds them to a catalogue identity; matching
    // runtime status by the UI's friendly name misses that exact server entirely.
    const mcpRuntime = managed !== undefined
      ? mcpHub.runtime.find(candidate => candidate.serverName === managed.serverName)
      : definition.id === 'binance'
        ? mcpHub.runtime.find(candidate => candidate.serverName === 'binance-agent-os')
        : definition.id === 'jev'
          ? mcpHub.runtime.find(candidate => candidate.serverName === 'jev')
          : mcpHub.runtime.find(candidate => runtimeMatchesDefinition(candidate, definition))
    // A legacy provider API-key grant can share the same name as a curated
    // OAuth MCP (notably Cloudflare). Never substitute that unrelated flow:
    // it prompts for an API token even though the official MCP offers login.
    const catalogAccount = definition.curatedMcp === true
      ? entries.find(entry => entry.key === `mcp-client/${definition.id}`)
      : entries.find(entry => entryMatchesDefinitionAuthorization(entry, definition))
    const account = managed === undefined
      ? catalogAccount
      : managedAuthorizationEntry(managed, entries) ?? catalogAccount
    const openClawRoute = definition.openClawConnectorId === undefined
      ? undefined
      : openClaw.connectors.find(candidate => candidate.id === definition.openClawConnectorId)
    const accountConnected = managed === undefined
      && mcpRuntime === undefined
      && accountGrantConnectsCatalogEntry(account)
    const runtimeAuthoritative = managed !== undefined || mcpRuntime !== undefined
    const connected = (openClawRoute?.connected === true && !runtimeAuthoritative)
      || (runtimeAuthoritative
        ? mcpRuntime?.status === 'ready' && mcpRuntime.toolNames.length > 0
        : live?.callable === true || accountConnected)
      || definition.id === 'binance'
    return { definition, live, account, mcpRuntime, managed, openClaw: openClawRoute, connected }
  }), [catalogDefinitions, entries, liveConnectors, mcpHub, openClaw])

  const visibleRows = catalogRows.filter(({ definition, connected }) => {
    if (filter === 'connected' && !connected) return false
    if (filter === 'available' && connected) return false
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return true
    return `${definition.name} ${(definition.aliases ?? []).join(' ')} ${definition.category} ${definition.description} ${definition.capabilities.join(' ')}`.toLowerCase().includes(needle)
  })

  const visibleAccountEntries = useMemo(() => entries.filter(entry =>
    entry.key !== 'llm-pi-ai/github-copilot'
    && !catalogDefinitions.some(definition =>
      entryMatchesDefinitionAuthorization(entry, definition))),
  [catalogDefinitions, entries])
  // Localize each credential or OAuth dialog at the exact connector card.
  // Keep the header only as fallback while its card is hidden by filters.
  const activeAuthorizationKey = attempt?.key ?? preparingKey ?? lastAttemptKey
  const authorizationHasVisibleCard = activeAuthorizationKey !== undefined
    && (visibleAccountEntries.some(entry => entry.key === activeAuthorizationKey)
      || visibleRows.some(row => row.account?.key === activeAuthorizationKey
        || (row.managed !== undefined
          && `mcp-client/${row.managed.serverName.toLowerCase().replaceAll('_', '-')}` === activeAuthorizationKey)))

  const toggleChatGptWeb = (enabled: boolean): void => {
    if (chatGptWeb === undefined || settings === undefined || chatGptWebBusy) return
    setChatGptWebBusy(true)
    setChatGptWebFailure(undefined)
    void setChatGptWebEnabled({ bridge: chatGptWeb, settings }, enabled)
      .then((snapshot) => {
        setChatGptWebState(snapshot)
        onAuthorized()
      })
      .catch((error: unknown) => { setChatGptWebFailure(String(error)) })
      .finally(() => { setChatGptWebBusy(false) })
  }

  const configureJev = (): void => {
    const configure = mcpRegistry?.configureJev?.bind(mcpRegistry)
    if (configure === undefined || jevBusy) return
    const apiKey = jevApiKey.trim()
    if (apiKey.length === 0 && jevState?.credentialConfigured !== true) {
      setJevFailure(connectorT('jevApiKeyLabel'))
      return
    }
    if (apiKey.length > 0 && apiKey.length < 8) {
      setJevFailure(connectorT('jevApiKeyLabel'))
      return
    }
    setJevBusy(true)
    setJevFailure(undefined)
    void configure({ apiKey }).then(
      () => {
        setJevApiKey('')
        setJevSetupOpen(false)
        setRefresh(current => current + 1)
        onAuthorized()
      },
      (error: unknown) => { setJevFailure(String(error)) },
    ).finally(() => { setJevBusy(false) })
  }

  const findOfficialConnector = (definition: ConnectorDefinition): void => {
    const registryName = definition.registryName
    if (mcpRegistry === undefined || registryBusy || definition.mode === 'native') return
    setRegistryBusy(true)
    setRegistryFailure(false)
    setCatalogFailure(undefined)
    // For providers without a pinned registry ID, allow discovery by product
    // name. Installation is still limited to Host-verified registry entries.
    const lookup = registryName ?? definition.name
    setQuery(definition.name)
    void mcpRegistry.search({ query: lookup, limit: 12 }).then(
      (snapshot) => {
        const matches = snapshot.candidates.filter(candidate =>
          !isRetiredJevCandidate(candidate)
          && (registryName === undefined || candidate.name === registryName))
        setRegistrySnapshot({ ...snapshot, candidates: matches })
        if (matches.length === 0) setCatalogFailure(connectorT('officialConnectorMissing'))
      },
      () => {
        setRegistrySnapshot(undefined)
        setRegistryFailure(true)
        setCatalogFailure(connectorT('registryUnavailable'))
      },
    ).finally(() => { setRegistryBusy(false) })
  }

  const reconnectMcpConnector = (runtime: McpConnectorRuntimeView): void => {
    const registry = mcpRegistry
    const reconnect = registry?.reconnect?.bind(registry)
    if (registry === undefined || reconnect === undefined || reconnectingServerName !== undefined) return
    // An unreachable HTTP MCP can report "failed" rather than "auth-required"
    // before OAuth discovery completes. Treat both as candidates for an auth
    // handoff, but never force OAuth on stdio or on already-valid grants.
    const expectedKey = `mcp-client/${runtime.serverName.toLowerCase().replaceAll('_', '-')}`
    const knownFlow = entries.find(candidate => candidate.key === expectedKey)
    const knownMethod = knownFlow?.methods[0]
    const recoverAuthorization = runtime.transport === 'streamable-http'
      && (runtime.status === 'auth-required'
        || ((runtime.status === 'failed' || runtime.status === 'disconnected')
          && knownFlow?.stored === undefined))
    setCatalogFailure(undefined)
    setReconnectFailure(undefined)
    // If the runtime already asks for auth and the flow is registered, a
    // reconnect cannot produce consent; go directly to the Host authorization.
    if (runtime.status === 'auth-required' && knownFlow !== undefined && knownMethod !== undefined) {
      begin(knownFlow.key, knownMethod.id)
      return
    }
    if (recoverAuthorization) reserveOAuthPopup()
    setReconnectingServerName(runtime.serverName)
    // The registry can hold a pending transport generation indefinitely.
    // Never make the user wait for that RPC without a visible failure.
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined
    void Promise.race([
      reconnect({ serverName: runtime.serverName }),
      new Promise<never>((_resolve, reject) => {
        reconnectTimeout = setTimeout(() => reject(new Error(
          'El Host MCP no confirmó la reconexión en 12 segundos. Comprueba la disponibilidad del servicio y vuelve a intentar.',
        )), 12_000)
      }),
    ]).then(async (result) => {
      if (!result.accepted) {
        if (recoverAuthorization) closeOAuthPopup()
        const message = connectorT('reconnectRequiredStatus')
        setReconnectFailure({ serverName: runtime.serverName, message })
        setCatalogFailure(message)
        return
      }
      setRefresh(current => current + 1)
      onAuthorized()
      if (!recoverAuthorization) return
      if (api === undefined) {
        closeOAuthPopup()
        const message = 'El Host no expone la API de autorización. Comprueba la instalación activa de Phoenix.'
        setReconnectFailure({ serverName: runtime.serverName, message })
        setCatalogFailure(message)
        return
      }

      for (const delayMs of MCP_AUTH_FLOW_RETRY_MS) {
        if (delayMs > 0) await new Promise<void>((resolve) => { globalThis.setTimeout(resolve, delayMs) })
        const [snapshot, allEntries] = await Promise.all([
          registry.state(),
          readAuthorizationEntries(api),
        ])
        setMcpHub(snapshot)
        setEntries(allEntries)
        const currentRuntime = snapshot.runtime.find(entry => entry.serverName === runtime.serverName)
        if (currentRuntime?.status === 'ready' && currentRuntime.toolNames.length > 0) {
          closeOAuthPopup()
          return
        }
        const entry = allEntries.find(candidate => candidate.key === expectedKey)
        const method = entry?.methods[0]
        // Start consent only if the MCP explicitly requested auth or has no
        // stored grant. An ordinary network failure with a valid token must
        // remain a reconnect error, not trigger unsolicited reauthorization.
        if (entry !== undefined && method !== undefined
          && (currentRuntime?.status === 'auth-required'
            || ((currentRuntime?.status === 'failed' || currentRuntime?.status === 'disconnected')
              && entry.stored === undefined && method.id === 'oauth'))) {
          begin(entry.key, method.id)
          return
        }
      }
      closeOAuthPopup()
      const message = `No se inició la autorización de ${runtime.serverName}: el MCP sigue sin exponer un método OAuth operativo. `
        + 'Comprueba su URL, disponibilidad y si requiere API key, client ID o secret. El conector no está conectado.'
      setReconnectFailure({ serverName: runtime.serverName, message })
      setCatalogFailure(message)
    }).catch((error: unknown) => {
      if (recoverAuthorization) closeOAuthPopup()
      const message = String(error)
      setReconnectFailure({ serverName: runtime.serverName, message })
      setCatalogFailure(message)
    }).finally(() => {
      if (reconnectTimeout !== undefined) clearTimeout(reconnectTimeout)
      setReconnectingServerName(undefined)
    })
  }

  const repairManagedConnector = (connector: ManagedMcpConnectorView): void => {
    const repair = mcpRegistry?.repair?.bind(mcpRegistry)
    if (repair === undefined || repairingEntryId !== undefined || removingEntryId !== undefined) return
    setCatalogFailure(undefined)
    setRepairingEntryId(connector.entryId)
    void repair({ entryId: connector.entryId }).then(
      () => {
        setRefresh(current => current + 1)
        onAuthorized()
      },
      (error: unknown) => { setCatalogFailure(String(error)) },
    ).finally(() => { setRepairingEntryId(undefined) })
  }

  const removeManagedConnector = (connector: ManagedMcpConnectorView): void => {
    const remove = mcpRegistry?.remove?.bind(mcpRegistry)
    if (remove === undefined || repairingEntryId !== undefined || removingEntryId !== undefined) return
    const account = managedAuthorizationEntry(connector, entries)
    if (account?.stored !== undefined && account.disconnectable !== true) {
      setCatalogFailure(connectorT('uninstallAuthCleanupUnavailable'))
      return
    }
    setCatalogFailure(undefined)
    setRemovingEntryId(connector.entryId)

    const clearAccount = account?.stored === undefined || api === undefined
      ? Promise.resolve()
      : api.disconnect({ key: account.key }).then((response) => {
        if (!response.result.ok) throw new Error(response.result.error.message)
      })

    void clearAccount.then(
      () => remove({ entryId: connector.entryId }),
    ).then(
      (result) => {
        if (result.removed && !result.liveUnloaded) {
          setCatalogFailure(connectorT('uninstallRestartRequired'))
        }
        setRefresh(current => current + 1)
        onAuthorized()
      },
      (error: unknown) => { setCatalogFailure(String(error)) },
    ).finally(() => { setRemovingEntryId(undefined) })
  }

  /** Installation is not readiness: complete the explicit user's click by finding
   * its actual Host auth flow and performing the next necessary step. */
  const finishMcpInstall = async (serverName: string): Promise<void> => {
    if (mcpRegistry === undefined) return
    if (api === undefined) {
      closeOAuthPopup()
      setCatalogFailure('MCP instalado, pero el servicio de autorización de PHOENIX no está disponible. Reinicia PHOENIX e inténtalo de nuevo.')
      return
    }
    const key = `mcp-client/${serverName.toLowerCase().replaceAll('_', '-')}`
    for (const delayMs of MCP_AUTH_FLOW_RETRY_MS) {
      if (delayMs > 0) await new Promise<void>((resolve) => { globalThis.setTimeout(resolve, delayMs) })
      const [snapshot, allEntries] = await Promise.all([
        readConnectorRemoteWithRetry(() => mcpRegistry.state(), () => false),
        readConnectorRemoteWithRetry(() => readAuthorizationEntries(api), () => false),
      ])
      setMcpHub(snapshot)
      setEntries(allEntries)
      const runtime = snapshot.runtime.find(item => item.serverName === serverName)
      if (runtime?.status === 'ready' && runtime.toolNames.length > 0) {
        closeOAuthPopup()
        return
      }
      const entry = allEntries.find(item => item.key === key)
      const method = entry?.methods[0]
      if (entry !== undefined && method !== undefined
        && (runtime?.status === 'auth-required' || entry.stored === undefined)) {
        begin(entry.key, method.id)
        return
      }
      // A newly mounted MCP can fail its first connection before registering
      // its authorization flow. Keep the bounded discovery window open.
    }
    closeOAuthPopup()
    setCatalogFailure(
      `El MCP ${serverName} se instaló, pero todavía no expone herramientas operativas. `
        + 'Revisa su estado y utiliza Reparar o Autorizar; PHOENIX no lo marcará como conectado.',
    )
  }

  const installCuratedConnector = (definition: ConnectorDefinition): void => {
    const installCurated = mcpRegistry?.installCurated?.bind(mcpRegistry)
    if (installCurated === undefined || definition.curatedMcp !== true || !isCuratedMcpConnectorId(definition.id)
      || installingCuratedId !== undefined || repairingEntryId !== undefined || removingEntryId !== undefined) return
    setCatalogFailure(undefined)
    if (CURATED_OAUTH_MCP_IDS.has(definition.id)) reserveOAuthPopup()
    setInstallingCuratedId(definition.id)
    void installCurated({ connectorId: definition.id }).then(
      async (receipt) => {
        setRefresh(current => current + 1)
        onAuthorized()
        await finishMcpInstall(receipt.connector.serverName)
      },
      (error: unknown) => {
        closeOAuthPopup()
        setCatalogFailure(String(error))
      },
    ).catch((error: unknown) => {
      closeOAuthPopup()
      setCatalogFailure(String(error))
    }).finally(() => { setInstallingCuratedId(undefined) })
  }

  const installRegistryCandidate = (candidate: McpRegistryCandidateView): void => {
    if (mcpRegistry === undefined || installingRegistryName !== undefined || isRetiredJevCandidate(candidate)) return
    const definition = catalogDefinitionForText(`${candidate.name} ${candidate.title}`)
    if (definition?.id === 'jev' && mcpRegistry.configureJev !== undefined) {
      setCatalogFailure(undefined)
      setJevFailure(undefined)
      setJevSetupOpen(true)
      return
    }
    setCatalogFailure(undefined)
    reserveOAuthPopup()
    setInstallingRegistryName(candidate.name)
    void mcpRegistry.install({ name: candidate.name, version: candidate.version }).then(
      async (receipt) => {
        setRefresh(current => current + 1)
        onAuthorized()
        await finishMcpInstall(receipt.connector.serverName)
      },
      (error: unknown) => {
        closeOAuthPopup()
        setCatalogFailure(String(error))
      },
    ).catch((error: unknown) => {
      closeOAuthPopup()
      setCatalogFailure(String(error))
    }).finally(() => { setInstallingRegistryName(undefined) })
  }

  const disconnect = (key: string): void => {
    if (api === undefined) return
    setCatalogFailure(undefined)
    setDisconnectingKey(key)
    void api.disconnect({ key }).then((response) => {
      if (!response.result.ok) {
        setCatalogFailure(response.result.error.message)
        return
      }
      setRefresh(current => current + 1)
      onAuthorized()
    }, (error: unknown) => { setCatalogFailure(String(error)) })
      .finally(() => { setDisconnectingKey(undefined) })
  }

  return (
    <div className={styles['section']}>
      <h2 className={styles['title']}>{connectorT('title')}</h2>
      <p className={styles['intro']}>{connectorT('intro')}</p>
      {authorizationHasVisibleCard || preparingKey === undefined ? null
        : <p role="status" className={styles['advancedHint']}>Contactando al servicio de autorización de PHOENIX…</p>}
      {authorizationHasVisibleCard || failure === undefined ? null
        : <p role="alert" className={styles['error']}>{failure}</p>}
      {authorizationHasVisibleCard || attempt === undefined ? null : (
        <section className={hubStyles['block']} aria-label={t('signingIn')}>
          <AuthorizationAttemptProgress attempt={attempt} answer={answer} setAnswer={setAnswer}
            submitAnswer={submitAnswer} cancel={cancel} t={t} />
        </section>
      )}
      <div className={hubStyles['intelligenceBanner']}>
        <div className={hubStyles['intelligenceIcon']} aria-hidden="true">✦</div>
        <div className={hubStyles['intelligenceCopy']}>
          <strong>{connectorT('intelligenceTitle')}</strong>
          <span>{connectorT('intelligenceHint')}</span>
        </div>
        <div className={hubStyles['intelligenceChecks']}>
          <span>✓ {connectorT('intelligenceAuth')}</span>
          <span>✓ {connectorT('intelligenceOfficial')}</span>
        </div>
      </div>
      <p className={hubStyles['safetyNote']}>{connectorT('setupHint')}</p>
      {assistantMail === undefined ? null : <AssistantMailPanel client={assistantMail} />}

      {chatGptWeb === undefined || settings === undefined ? null : (
        <section className={hubStyles['block']} aria-label={connectorT('chatgptWebTitle')}>
          <div className={hubStyles['heading']}>
            <h3>{connectorT('chatgptWebTitle')}</h3>
            <p>{connectorT('chatgptWebDescription')}</p>
          </div>
          <div className={styles['rowCard']}>
            <div className={styles['rowHead']}>
              <div className={styles['rowIdentity']}>
                <strong className={styles['rowName']}>{connectorT('chatgptWebTitle')}</strong>
                <span className={chatGptWebState?.phase === 'ready' ? styles['connectedChip'] : styles['advancedHint']}>
                  {chatGptWebState?.phase === 'ready'
                    ? connectorT('chatgptWebReady')
                    : chatGptWebState?.phase === 'needs-setup'
                      ? connectorT('chatgptWebNeedsSetup')
                      : chatGptWebState?.phase === 'starting'
                        ? connectorT('chatgptWebStarting')
                        : chatGptWebState?.phase === 'unavailable'
                          ? connectorT('chatgptWebUnavailable')
                          : connectorT('chatgptWebOff')}
                </span>
              </div>
              <label className={styles['rowActions']}>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={connectorT('chatgptWebToggle')}
                  checked={chatGptWebState?.enabled === true}
                  disabled={chatGptWebBusy}
                  onChange={(event) => { toggleChatGptWeb(event.target.checked) }}
                />
                <span>{chatGptWebBusy
                  ? connectorT('chatgptWebBusy')
                  : chatGptWebState?.enabled === true ? connectorT('chatgptWebOn') : connectorT('chatgptWebOff')}</span>
              </label>
            </div>
            {chatGptWebState === undefined ? null : <p className={styles['advancedHint']}>{chatGptWebState.detail}</p>}
            {chatGptWebState?.phase === 'needs-setup'
              ? <p className={styles['advancedHint']}>{connectorT('chatgptWebSetupHint')}</p>
              : null}
            {chatGptWebFailure === undefined ? null : <p className={styles['error']}>{chatGptWebFailure}</p>}
          </div>
        </section>
      )}

      {visibleAccountEntries.length === 0 ? null : (
        <section className={hubStyles['block']} aria-label={connectorT('accounts')}>
          <div className={hubStyles['heading']}>
            <h3>{connectorT('accounts')}</h3>
            <p>{connectorT('accountsHint')}</p>
          </div>
          <div className={connectorStyles['connectorGrid']}>
            {visibleAccountEntries.map((entry) => {
              const lines = telemetryLines(entry.telemetry)
              const presentation = accountPresentation(entry)
              const runtime = runtimeForEntry(entry, mcpHub.runtime)
              const status = accountStatus(entry, runtime, connectorT)
              const actionLabel = runtime?.status === 'auth-required' && entry.stored !== undefined
                ? connectorT('reauthorize')
                : entry.stored === undefined ? connectorT('authorize') : connectorT('reconnect')
              const runtimeReconnect = entry.stored !== undefined
                && runtime !== undefined
                && (runtime.status === 'failed' || runtime.status === 'disconnected')
                && mcpRegistry?.reconnect !== undefined
              const thisAuthorizationPending = preparingKey === entry.key
                || (attempt?.status === 'pending' && attempt.key === entry.key)
              const preferredMethod = entry.methods[0]
              return (
                <article key={entry.key} className={connectorStyles['connectorCard']} data-authorization-key={entry.key}>
                  <div className={connectorStyles['connectorTop']}>
                    <div className={hubStyles['logoShell']}>
                      <span className={connectorStyles['connectorFallback']} aria-hidden="true">{presentation.name.slice(0, 1).toUpperCase()}</span>
                      {presentation.logoUrl === undefined ? null : (
                        <img
                          className={`${connectorStyles['connectorIcon'] ?? ''} ${hubStyles['logoImage'] ?? ''}`.trim()}
                          src={presentation.logoUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                          onError={(event) => { event.currentTarget.hidden = true }}
                        />
                      )}
                    </div>
                    <div className={connectorStyles['connectorIdentity']}>
                      <span className={connectorStyles['connectorName']}>{presentation.name}</span>
                      {presentation.technical === undefined ? null : <span className={connectorStyles['connectorCategory']}>{presentation.technical}</span>}
                    </div>
                  </div>
                  {presentation.description === undefined ? null : (
                    <p className={connectorStyles['connectorDescription']}>{presentation.description}</p>
                  )}
                  {lines.slice(0, 2).map(line => <p key={line} className={styles['advancedHint']}>{line}</p>)}
                  <div className={connectorStyles['connectorFooter']}>
                    <span className={`${connectorStyles['connectorStatus'] ?? ''} ${status.className}`.trim()}>{status.text}</span>
                    <div className={connectorStyles['connectorActions']}>
                      {preferredMethod === undefined || (entry.stored !== undefined
                        && runtime?.status !== 'auth-required' && !runtimeReconnect) ? null : (
                          <button
                            type="button"
                            className={connectorStyles['connectorPrimaryButton']}
                            disabled={thisAuthorizationPending || entry.inFlight
                            || (runtimeReconnect && reconnectingServerName !== undefined)}
                            onClick={() => {
                              if (runtimeReconnect && runtime !== undefined) {
                                reconnectMcpConnector(runtime)
                                return
                              }
                              begin(entry.key, preferredMethod.id)
                            }}
                          >
                            {runtimeReconnect && reconnectingServerName === runtime?.serverName
                              ? connectorT('connectingStatus')
                              : thisAuthorizationPending ? t('signingIn') : actionLabel}
                          </button>
                        )}
                      {entry.stored === undefined || entry.disconnectable !== true ? null : (
                        <button
                          type="button"
                          className={connectorStyles['connectorSecondaryButton']}
                          disabled={entry.inFlight || disconnectingKey === entry.key}
                          onClick={() => { disconnect(entry.key) }}
                        >
                          {disconnectingKey === entry.key ? connectorT('disconnecting') : connectorT('disconnect')}
                        </button>
                      )}
                    </div>
                  </div>
                  {preparingKey !== entry.key ? null : <p role="status">Iniciando autorización…</p>}
                  {attempt?.key !== entry.key ? null : (
                    <div className={styles['authorizationPrompt']}>
                      <AuthorizationAttemptProgress attempt={attempt} answer={answer} setAnswer={setAnswer}
                        submitAnswer={submitAnswer} cancel={cancel} t={t} />
                    </div>
                  )}
                  {failure !== undefined && lastAttemptKey === entry.key
                    ? <p role="alert" className={styles['error']}>{failure}</p> : null}
                </article>
              )
            })}
          </div>
        </section>
      )}


      {catalogFailure === undefined ? null : <p className={styles['error']}>{catalogFailure}</p>}

      <section className={hubStyles['block']} aria-label={connectorT('catalog')}>
        <div className={hubStyles['heading']}>
          <h3>{connectorT('catalog')}</h3>
          <p>{connectorT('catalogHint')}</p>
        </div>
        <div className={hubStyles['toolbar']}>
          <input ref={catalogSearch} className={hubStyles['search']} type="search" aria-label={connectorT('search')} placeholder={connectorT('searchRegistry')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
          <div className={hubStyles['filters']}>
            {(['all', 'connected', 'available'] as const).map(value => (
              <button key={value} type="button" aria-pressed={filter === value} className={filter === value ? hubStyles['filterActive'] : undefined} onClick={() => { setFilter(value) }}>
                {connectorT(value)}
              </button>
            ))}
          </div>
        </div>
        {visibleRows.length === 0 ? <p className={styles['advancedHint']}>{connectorT('noResults')}</p> : (
          <div className={connectorStyles['connectorGrid']}>
            {visibleRows.map((row) => {
              const authorizationKey = row.account?.key
                ?? (row.managed === undefined
                  ? undefined
                  : `mcp-client/${row.managed.serverName.toLowerCase().replaceAll('_', '-')}`)
              const rowAuthorizationPending = authorizationKey !== undefined
                && (preparingKey === authorizationKey
                  || (attempt?.status === 'pending' && attempt.key === authorizationKey))
              return (
                <CatalogCard
                  key={row.definition.id}
                  definition={row.definition}
                  live={row.live}
                  account={row.account}
                  mcpRuntime={row.mcpRuntime}
                  managed={row.managed}
                  openClaw={row.openClaw}
                  connected={row.connected}
                  t={connectorT}
                  authorizationProgress={preparingKey !== undefined && preparingKey === authorizationKey ? (
                    <p role="status" className={styles['advancedHint']}>Iniciando autorización…</p>
                  ) : attempt !== undefined && attempt.key === authorizationKey ? (
                    <div className={styles['authorizationPrompt']}>
                      <AuthorizationAttemptProgress attempt={attempt} answer={answer} setAnswer={setAnswer}
                        submitAnswer={submitAnswer} cancel={cancel} t={t} />
                      {failure !== undefined && lastAttemptKey === authorizationKey
                        && !(attempt.status === 'failed' && attempt.error === failure)
                        ? <p role="alert" className={styles['error']}>{failure}</p> : null}
                    </div>
                  ) : failure !== undefined && lastAttemptKey === authorizationKey ? (
                    <p role="alert" className={styles['error']}>{failure}</p>
                  ) : reconnectFailure !== undefined && row.mcpRuntime?.serverName === reconnectFailure.serverName ? (
                    <p role="alert" className={styles['error']}>{reconnectFailure.message}</p>
                  ) : undefined}
                  pending={rowAuthorizationPending || jevBusy
                    || (disconnectingKey !== undefined && disconnectingKey === row.account?.key)}
                  installingCurated={installingCuratedId === row.definition.id}
                  reconnecting={row.mcpRuntime !== undefined && reconnectingServerName === row.mcpRuntime.serverName}
                  repairing={row.managed !== undefined && repairingEntryId === row.managed.entryId}
                  removing={row.managed !== undefined && removingEntryId === row.managed.entryId}
                  onAuthorize={(entry) => {
                    const method = entry.methods[0]
                    if (method !== undefined) begin(entry.key, method.id)
                  }}
                  onDisconnect={(entry) => { disconnect(entry.key) }}
                  onInstallCurated={mcpRegistry?.installCurated === undefined || row.definition.curatedMcp !== true
                    ? undefined
                    : () => { installCuratedConnector(row.definition) }}
                  onFindOfficial={mcpRegistry?.search === undefined
                    || row.definition.mode === 'native'
                    || (row.definition.curatedMcp === true && mcpRegistry.installCurated !== undefined)
                    ? undefined
                    : () => { findOfficialConnector(row.definition) }}
                  onFindRegistry={mcpRegistry === undefined || row.definition.provenance !== 'registry-listed'
                    ? undefined
                    : () => {
                      setCatalogFailure(undefined)
                      setRegistryFailure(false)
                      setFilter('available')
                      setQuery(row.definition.name)
                    }}
                  onReconnect={mcpRegistry?.reconnect === undefined
                    ? undefined : (runtime) => { reconnectMcpConnector(runtime) }}
                  onRepair={mcpRegistry?.repair === undefined ? undefined : repairManagedConnector}
                  onRemove={mcpRegistry?.remove === undefined ? undefined : removeManagedConnector}
                  onConfigure={row.definition.id === 'jev' && mcpRegistry?.configureJev !== undefined ? () => {
                    setJevFailure(undefined)
                    setJevSetupOpen(true)
                  } : undefined}
                />
              )
            })}
          </div>
        )}
        {!jevSetupOpen ? null : (
          <div className={styles['setupCard']} data-connector-setup="jev">
            <div className={styles['editorHeader']}>
              <strong className={styles['editorTitle']}>{connectorT('jevSetupTitle')}</strong>
              <span className={styles['advancedHint']}>{connectorT('jevOptionalStatus')}</span>
            </div>
            <p className={styles['advancedHint']}>{connectorT('jevSetupDescription')}</p>
            <label className={styles['field']}>
              <span className={styles['fieldLabel']}>{connectorT('jevApiKeyLabel')}</span>
              <input
                className={styles['input']}
                type="password"
                autoComplete="new-password"
                value={jevApiKey}
                placeholder={connectorT('jevKeyPlaceholder')}
                disabled={jevBusy}
                onChange={(event) => { setJevApiKey(event.target.value) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') configureJev()
                }}
              />
            </label>
            {jevFailure === undefined ? null : <p className={styles['error']}>{jevFailure}</p>}
            <div className={styles['editorActions']}>
              <a className={connectorStyles['connectorLink']} href="https://www.jevai.org/agent/keys" target="_blank" rel="noreferrer">{connectorT('viewSource')}</a>
              <button type="button" className={styles['secondaryButton']} disabled={jevBusy} onClick={() => {
                setJevApiKey('')
                setJevFailure(undefined)
                setJevSetupOpen(false)
              }}>
                {t('cancel')}
              </button>
              <button
                type="button"
                className={styles['primaryButton']}
                disabled={jevBusy
                  || (jevApiKey.trim().length === 0 && jevState?.credentialConfigured !== true)
                  || (jevApiKey.trim().length > 0 && jevApiKey.trim().length < 8)}
                onClick={configureJev}
              >
                {jevBusy
                  ? connectorT('installing')
                  : jevApiKey.trim().length === 0 && jevState?.credentialConfigured === true
                    ? connectorT('reconnect')
                    : connectorT('jevSave')}
              </button>
            </div>
          </div>
        )}
      </section>

      {mcpRegistry === undefined || query.trim().length < 2 ? null : (
        <section className={hubStyles['block']} aria-label={connectorT('officialRegistry')}>
          <div className={hubStyles['heading']}>
            <h3>{connectorT('officialRegistry')}</h3>
            <p>{connectorT('officialRegistryHint')}</p>
          </div>
          {registryBusy ? <p className={styles['advancedHint']}>{connectorT('registrySearching')}</p> : null}
          {registryFailure ? <p className={styles['error']}>{connectorT('registryUnavailable')}</p> : null}
          {!registryBusy && !registryFailure && registrySnapshot !== undefined && registrySnapshot.candidates.length === 0
            ? <p className={styles['advancedHint']}>{connectorT('registryNoMatches')}</p>
            : null}
          {registrySnapshot === undefined || registrySnapshot.candidates.length === 0 ? null : (
            <div className={connectorStyles['connectorGrid']}>
              {registrySnapshot.candidates.map((candidate) => {
                const managed = mcpHub.managed.find(connector =>
                  (connector.source?.kind === 'registry' && connector.source.name === candidate.name)
                  || (candidate.remoteUrl !== undefined && connector.url === candidate.remoteUrl))
                const runtime = managed === undefined
                  ? undefined
                  : mcpHub.runtime.find(entry => entry.serverName === managed.serverName)
                return (
                  <OfficialMcpCard
                    key={`${candidate.name}@${candidate.version}`}
                    candidate={candidate}
                    stale={registrySnapshot.stale}
                    managed={managed}
                    runtime={runtime}
                    installing={installingRegistryName === candidate.name}
                    reconnecting={runtime !== undefined && reconnectingServerName === runtime.serverName}
                    repairing={managed !== undefined && repairingEntryId === managed.entryId}
                    removing={managed !== undefined && removingEntryId === managed.entryId}
                    t={connectorT}
                    onInstall={installRegistryCandidate}
                    onReconnect={mcpRegistry.reconnect === undefined ? undefined : reconnectMcpConnector}
                    onRepair={mcpRegistry.repair === undefined ? undefined : repairManagedConnector}
                    onRemove={mcpRegistry.remove === undefined ? undefined : removeManagedConnector}
                  />
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
