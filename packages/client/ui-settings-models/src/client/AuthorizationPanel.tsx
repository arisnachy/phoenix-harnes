import { useEffect, useMemo, useState } from 'react'
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
}

/** One Host-proxied Official MCP Registry search result safe for the browser. */
export interface McpRegistrySearchSnapshot {
  source: 'official-mcp-registry'
  query: string
  fetchedAt: string
  stale: boolean
  candidates: McpRegistryCandidateView[]
}

/** Browser-safe client for the Host-owned Official MCP Registry proxy. */
export interface McpRegistryClient {
  /**
   * Search the Official MCP Registry through the Phoenix Host.
   * @param request - User-entered query and optional result limit.
   * @returns Sanitized registry metadata for display only.
   */
  search(request: { query: string; limit?: number }): Promise<McpRegistrySearchSnapshot>
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

function LiveConnectorCard({ connector, t }: {
  connector: ConnectorTelemetry
  t: ConnectorsSettingsSectionProps['connectorT']
}): ReactNode {
  const status = connectorStatus(connector, t)
  const installUrl = safeExternalHref(connector.installUrl)
  return (
    <article className={connectorStyles['connectorCard']}>
      <div className={connectorStyles['connectorTop']}>
        {connector.iconUrl === undefined ? (
          <div className={connectorStyles['connectorFallback']} aria-hidden="true">{connector.name.slice(0, 1).toUpperCase()}</div>
        ) : (
          <picture>
            {connector.iconUrlDark === undefined ? null : <source media="(prefers-color-scheme: dark)" srcSet={connector.iconUrlDark} />}
            <img className={connectorStyles['connectorIcon']} src={connector.iconUrl} alt={connector.name} />
          </picture>
        )}
        <div className={connectorStyles['connectorIdentity']}>
          <span className={connectorStyles['connectorName']}>{connector.name}</span>
          {connector.category === undefined ? null : <span className={connectorStyles['connectorCategory']}>{connector.category}</span>}
        </div>
      </div>
      {connector.description === undefined ? null : <p className={connectorStyles['connectorDescription']}>{connector.description}</p>}
      <div className={connectorStyles['connectorFooter']}>
        <span className={`${connectorStyles['connectorStatus'] ?? ''} ${status.className}`.trim()}>{status.text}</span>
        {installUrl === undefined ? null : (
          <a className={connectorStyles['connectorLink']} href={installUrl} target="_blank" rel="noreferrer" aria-label={`${connector.installed === true ? 'Manage' : 'Connect'} ${connector.name}`}>
            {connector.installed === true ? t('configure') : t('authorize')}
          </a>
        )}
      </div>
    </article>
  )
}

function entryMatchesFamily(entry: Entry, family: string | undefined): boolean {
  if (family === undefined) return false
  const needle = normalize(family)
  return [entry.key, entry.label, entry.telemetry?.provider ?? ''].some(value => normalize(value).includes(needle))
}

function liveMatchesDefinition(live: ConnectorTelemetry, definition: ConnectorDefinition): boolean {
  const ids = [definition.id, ...(definition.aliases ?? [])].map(normalize)
  const liveId = normalize(live.id)
  const liveName = normalize(live.name)
  return ids.includes(liveId) || ids.includes(liveName) || normalize(definition.name) === liveName
}

function accountGrantConnectsCatalogEntry(account: Entry | undefined): boolean {
  if (account?.stored === undefined) return false
  const scopedConnectors = account.telemetry?.connectors
  return scopedConnectors === undefined || scopedConnectors.length === 0
}

function CatalogCard({ definition, live, account, t, onAuthorize, pending }: {
  definition: ConnectorDefinition
  live?: ConnectorTelemetry | undefined
  account?: Entry | undefined
  t: ConnectorsSettingsSectionProps['connectorT']
  onAuthorize: (entry: Entry) => void
  pending: boolean
}): ReactNode {
  const connectedByAccount = accountGrantConnectsCatalogEntry(account)
  const installUrl = safeExternalHref(live?.installUrl)
  const liveStatus = live === undefined ? undefined : connectorStatus(live, t)
  const status = liveStatus ?? (connectedByAccount
    ? { text: t('connectedStatus'), className: connectorStyles['connectorStatusReady'] ?? '' }
    : definition.mode === 'mcp'
      ? { text: t('mcpReadyStatus'), className: '' }
      : definition.mode === 'api-key'
        ? { text: t('apiKeyStatus'), className: '' }
        : account !== undefined
          ? { text: t('availableStatus'), className: '' }
          : { text: t('adapterNeededStatus'), className: connectorStyles['connectorStatusDisabled'] ?? '' })
  const oauthAccount = account !== undefined && account.methods.some(candidate => candidate.id === 'oauth')
    ? account
    : undefined
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
      <div className={connectorStyles['connectorFooter']}>
        <span className={`${connectorStyles['connectorStatus'] ?? ''} ${status.className}`.trim()}>{status.text}</span>
        {installUrl !== undefined ? (
          <a className={connectorStyles['connectorLink']} href={installUrl} target="_blank" rel="noreferrer">{t('configure')}</a>
        ) : oauthAccount === undefined || connectedByAccount ? null : (
          <button className={hubStyles['compactButton']} type="button" disabled={pending || oauthAccount.inFlight} onClick={() => { onAuthorize(oauthAccount) }}>
            {t('authorize')}
          </button>
        )}
      </div>
    </article>
  )
}

function OfficialMcpCard({ candidate, stale, t }: {
  candidate: McpRegistryCandidateView
  stale: boolean
  t: ConnectorsSettingsSectionProps['connectorT']
}): ReactNode {
  const source = safeExternalHref(candidate.repositoryUrl) ?? safeExternalHref(candidate.websiteUrl)
  const transport = candidate.transports.length === 0 ? 'MCP' : candidate.transports.join(' · ')
  const status = candidate.status === 'deprecated' || candidate.status === 'deleted'
    ? t('registryDeprecatedStatus')
    : t('registryListedStatus')
  return (
    <article className={connectorStyles['connectorCard']} data-registry-server={candidate.name}>
      <div className={connectorStyles['connectorTop']}>
        <div className={connectorStyles['connectorFallback']} aria-hidden="true">{candidate.title.slice(0, 1).toUpperCase()}</div>
        <div className={connectorStyles['connectorIdentity']}>
          <span className={connectorStyles['connectorName']}>{candidate.title}</span>
          <span className={connectorStyles['connectorCategory']}>{`MCP · ${transport} · v${candidate.version}`}</span>
        </div>
      </div>
      <p className={connectorStyles['connectorDescription']}>{candidate.description}</p>
      <div className={connectorStyles['connectorFooter']}>
        <span className={connectorStyles['connectorStatus'] ?? ''}>
          {status}{stale ? ` · ${t('registryCachedStatus')}` : ''}
        </span>
        {source === undefined ? null : (
          <a className={connectorStyles['connectorLink']} href={source} target="_blank" rel="noreferrer">{t('viewSource')}</a>
        )}
      </div>
    </article>
  )
}

/**
 * Legacy embedded model-account surface. Account and connector inventory now
 * belongs to Settings → Connectors; provider-specific OAuth remains in each
 * model provider editor.
 */
export function AuthorizationPanel(_props: AuthorizationPanelProps): ReactNode {
  return null
}

/** Dedicated account and MCP/app connector settings page. */
export function ConnectorsSettingsSection({ api, t, connectorT, chatGptWeb, settings, mcpRegistry, onAuthorized }: ConnectorsSettingsSectionProps): ReactNode {
  const [entries, setEntries] = useState<Entry[]>([])
  const [catalogFailure, setCatalogFailure] = useState<string | undefined>()
  const [disconnectingKey, setDisconnectingKey] = useState<string | undefined>()
  const [refresh, setRefresh] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ConnectorFilter>('connected')
  const [registrySnapshot, setRegistrySnapshot] = useState<McpRegistrySearchSnapshot | undefined>()
  const [registryBusy, setRegistryBusy] = useState(false)
  const [registryFailure, setRegistryFailure] = useState(false)
  const [chatGptWebState, setChatGptWebState] = useState<ChatGptWebSnapshot | undefined>()
  const [chatGptWebBusy, setChatGptWebBusy] = useState(false)
  const [chatGptWebFailure, setChatGptWebFailure] = useState<string | undefined>()
  const { attempt, answer, setAnswer, failure, begin, submitAnswer, cancel } = useAuthorizationAttempt(api, () => {
    setRefresh(current => current + 1)
    onAuthorized()
  })

  useEffect(() => {
    if (chatGptWeb === undefined) return
    let stale = false
    void chatGptWeb.state().then(
      snapshot => { if (!stale) setChatGptWebState(snapshot) },
      error => { if (!stale) setChatGptWebFailure(String(error)) },
    )
    return () => { stale = true }
  }, [chatGptWeb])

  useEffect(() => {
    if (api === undefined) return
    let stale = false
    setCatalogFailure(undefined)
    void api.list({}).then((response) => {
      if (stale) return
      if (!response.result.ok) {
        setCatalogFailure(response.result.error.message)
        return
      }
      setEntries(response.result.value.entries.filter(entry => entry.methods.some(method => method.id === 'oauth')) as Entry[])
    }, (error: unknown) => { if (!stale) setCatalogFailure(String(error)) })
    return () => { stale = true }
  }, [api, refresh])

  useEffect(() => {
    const search = query.trim()
    if (mcpRegistry === undefined || filter === 'connected' || search.length < 2) {
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
        snapshot => {
          if (!stale) setRegistrySnapshot(snapshot)
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
  }, [filter, mcpRegistry, query])

  const liveConnectors = useMemo(
    () => entries.flatMap(entry => entry.telemetry?.connectors ?? []),
    [entries],
  )

  const catalogRows = useMemo(() => CONNECTOR_CATALOG.map((definition) => {
    const live = liveConnectors.find(candidate => liveMatchesDefinition(candidate, definition))
    const account = entries.find(entry => entryMatchesFamily(entry, definition.providerFamily))
    const connected = live?.installed === true || live?.callable === true || accountGrantConnectsCatalogEntry(account)
    return { definition, live, account, connected }
  }), [entries, liveConnectors])

  const visibleRows = catalogRows.filter(({ definition, connected }) => {
    if (filter === 'connected' && !connected) return false
    if (filter === 'available' && connected) return false
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return true
    return `${definition.name} ${definition.category} ${definition.description} ${definition.capabilities.join(' ')}`.toLowerCase().includes(needle)
  })

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
      <p className={hubStyles['safetyNote']}>{connectorT('setupHint')}</p>

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
                  onChange={event => { toggleChatGptWeb(event.target.checked) }}
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

      {entries.length === 0 ? null : (
        <section className={hubStyles['block']} aria-label={connectorT('accounts')}>
          <div className={hubStyles['heading']}>
            <h3>{connectorT('accounts')}</h3>
            <p>{connectorT('accountsHint')}</p>
          </div>
          <div className={hubStyles['accounts']}>
            {entries.map((entry) => {
              const lines = telemetryLines(entry.telemetry)
              return (
                <div key={entry.key} className={styles['rowCard']}>
                  <div className={styles['rowHead']}>
                    <div className={styles['rowIdentity']}>
                      <strong className={styles['rowName']}>{entry.label}</strong>
                      {entry.telemetry !== undefined
                        ? <span className={styles['connectedChip']}>{connectorT('connectedStatus')}</span>
                        : entry.stored === undefined
                          ? null
                          : <span className={styles['advancedHint']}>{connectorT('reconnectRequiredStatus')}</span>}
                    </div>
                    <div className={styles['rowActions']}>
                      <button type="button" className={styles['secondaryButton']} disabled={attempt?.status === 'pending' || entry.inFlight} onClick={() => { begin(entry.key, 'oauth') }}>
                        {attempt?.status === 'pending' ? t('signingIn') : entry.stored === undefined ? connectorT('authorize') : connectorT('reconnect')}
                      </button>
                      {entry.stored === undefined || entry.disconnectable !== true ? null : (
                        <button type="button" className={styles['secondaryButton']} disabled={entry.inFlight || disconnectingKey === entry.key} onClick={() => { disconnect(entry.key) }}>
                          {disconnectingKey === entry.key ? connectorT('disconnecting') : connectorT('disconnect')}
                        </button>
                      )}
                    </div>
                  </div>
                  {lines.map(line => <p key={line} className={styles['advancedHint']}>{line}</p>)}
                  {entry.telemetry?.connectors === undefined ? null : (
                    <div className={connectorStyles['connectorGrid']}>
                      {entry.telemetry.connectors.map(connector => <LiveConnectorCard key={connector.id} connector={connector} t={connectorT} />)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <AuthorizationAttemptProgress attempt={attempt} answer={answer} setAnswer={setAnswer} submitAnswer={submitAnswer} cancel={cancel} t={t} />
      {failure === undefined ? null : <p className={styles['error']}>{failure}</p>}
      {catalogFailure === undefined ? null : <p className={styles['error']}>{catalogFailure}</p>}

      <section className={hubStyles['block']} aria-label={connectorT('catalog')}>
        <div className={hubStyles['heading']}>
          <h3>{connectorT('catalog')}</h3>
          <p>{connectorT('catalogHint')}</p>
        </div>
        <div className={hubStyles['toolbar']}>
          <input className={hubStyles['search']} type="search" aria-label={connectorT('search')} placeholder={connectorT('search')} value={query} onChange={event => { setQuery(event.target.value) }} />
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
            {visibleRows.map(row => (
              <CatalogCard
                key={row.definition.id}
                definition={row.definition}
                live={row.live}
                account={row.account}
                t={connectorT}
                pending={attempt?.status === 'pending'}
                onAuthorize={(entry) => { begin(entry.key, 'oauth') }}
              />
            ))}
          </div>
        )}
      </section>

      {mcpRegistry === undefined || filter === 'connected' || query.trim().length < 2 ? null : (
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
              {registrySnapshot.candidates.map(candidate => (
                <OfficialMcpCard
                  key={`${candidate.name}@${candidate.version}`}
                  candidate={candidate}
                  stale={registrySnapshot.stale}
                  t={connectorT}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
