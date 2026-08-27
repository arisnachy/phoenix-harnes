import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { en } from './locales.ts'
import { AuthorizationAttemptProgress, useAuthorizationAttempt } from './authorization-attempt.tsx'
import connectorStyles from './CodexConnectors.module.css'
import styles from './ModelsSection.module.css'

type AuthorizationClient = IApiClient['authorization']

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

function connectorStatus(connector: ConnectorTelemetry): { text: string; className: string } {
  if (!connector.enabled) {
    return { text: 'Disabled', className: connectorStyles['connectorStatusDisabled'] ?? '' }
  }
  if (!connector.accessible) {
    return { text: 'Unavailable', className: connectorStyles['connectorStatusDisabled'] ?? '' }
  }
  if (connector.installed === true && connector.callable === true) {
    return { text: 'Connected · callable', className: connectorStyles['connectorStatusReady'] ?? '' }
  }
  if (connector.installed === true) {
    return { text: 'Connected', className: connectorStyles['connectorStatusReady'] ?? '' }
  }
  if (connector.installed === false && connector.callable === false && connector.installUrl === undefined) {
    return { text: 'Permission needed', className: connectorStyles['connectorStatusDisabled'] ?? '' }
  }
  return { text: 'Available', className: '' }
}

function ConnectorCard({ connector }: { connector: ConnectorTelemetry }): ReactNode {
  const status = connectorStatus(connector)
  return (
    <article className={connectorStyles['connectorCard']}>
      <div className={connectorStyles['connectorTop']}>
        {connector.iconUrl === undefined ? (
          <div className={connectorStyles['connectorFallback']} aria-hidden="true">
            {connector.name.slice(0, 1).toUpperCase()}
          </div>
        ) : (
          <picture>
            {connector.iconUrlDark === undefined ? null : (
              <source media="(prefers-color-scheme: dark)" srcSet={connector.iconUrlDark} />
            )}
            <img className={connectorStyles['connectorIcon']} src={connector.iconUrl} alt={connector.name} />
          </picture>
        )}
        <div className={connectorStyles['connectorIdentity']}>
          <span className={connectorStyles['connectorName']}>{connector.name}</span>
          {connector.category === undefined ? null : (
            <span className={connectorStyles['connectorCategory']}>{connector.category}</span>
          )}
        </div>
      </div>
      {connector.description === undefined ? null : (
        <p className={connectorStyles['connectorDescription']}>{connector.description}</p>
      )}
      <div className={connectorStyles['connectorFooter']}>
        <span className={`${connectorStyles['connectorStatus'] ?? ''} ${status.className}`.trim()}>{status.text}</span>
        {connector.installUrl === undefined ? null : (
          <a
            className={connectorStyles['connectorLink']}
            href={connector.installUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Manage ${connector.name}`}
          >
            {connector.installed === true ? 'Manage' : 'Connect'}
          </a>
        )}
      </div>
    </article>
  )
}

function ConnectorGrid({ telemetry }: { telemetry: AccountTelemetry | undefined }): ReactNode {
  const connectors = telemetry?.connectors
  if (connectors === undefined || connectors.length === 0) return null
  const isGoogle = telemetry?.provider.toLowerCase().includes('google') === true
  const title = isGoogle ? 'Google Workspace services' : 'Codex connectors'
  const ready = connectors.filter(connector => connector.callable === true).length
  const hint = isGoogle
    ? `${integer(ready)} of ${integer(connectors.length)} services authorized by this Google account`
    : 'Live catalog from the native Codex app-server'
  return (
    <div className={connectorStyles['connectorSection']} aria-label={title}>
      <div className={connectorStyles['connectorHeading']}>
        <h4 className={connectorStyles['connectorTitle']}>{title}</h4>
        <p className={connectorStyles['connectorHint']}>{hint}</p>
      </div>
      <div className={connectorStyles['connectorGrid']}>
        {connectors.map(connector => <ConnectorCard key={connector.id} connector={connector} />)}
      </div>
    </div>
  )
}

/** Account-based provider login. OAuth grants never pass through API-key inputs. */
export function AuthorizationPanel({ api, t, onAuthorized }: AuthorizationPanelProps): ReactNode {
  const [entries, setEntries] = useState<Entry[]>([])
  const [catalogFailure, setCatalogFailure] = useState<string | undefined>()
  const [disconnectingKey, setDisconnectingKey] = useState<string | undefined>()
  const [refresh, setRefresh] = useState(0)
  const { attempt, answer, setAnswer, failure, begin, submitAnswer, cancel } = useAuthorizationAttempt(api, () => {
    setRefresh(current => current + 1)
    onAuthorized()
  })

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

  if (api === undefined || entries.length === 0) return null

  const disconnect = (key: string): void => {
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
    <section className={styles['authorizationPanel']} aria-label={t('accountConnections')}>
      <h3 className={styles['authorizationTitle']}>{t('accountConnections')}</h3>
      <p className={styles['advancedHint']}>{t('accountConnectionsHint')}</p>
      {entries.map((entry) => {
        const lines = telemetryLines(entry.telemetry)
        return (
          <div key={entry.key} className={styles['rowCard']}>
            <div className={styles['rowHead']}>
              <div className={styles['rowIdentity']}>
                <strong className={styles['rowName']}>{entry.label}</strong>
                {entry.stored === undefined ? null : <span className={styles['connectedChip']}>{t('accountConnected')}</span>}
              </div>
              <div className={styles['rowActions']}>
                <button
                  type="button"
                  className={styles['secondaryButton']}
                  disabled={attempt?.status === 'pending' || entry.inFlight}
                  onClick={() => { begin(entry.key, 'oauth') }}
                >
                  {attempt?.status === 'pending'
                    ? t('signingIn')
                    : `${entry.stored === undefined ? t('signInWith') : t('accountSignIn')} ${entry.label}`}
                </button>
                {entry.stored === undefined || entry.disconnectable !== true ? null : (
                  <button
                    type="button"
                    className={styles['secondaryButton']}
                    disabled={attempt?.status === 'pending' || entry.inFlight || disconnectingKey === entry.key}
                    onClick={() => { disconnect(entry.key) }}
                  >
                    {disconnectingKey === entry.key ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                )}
              </div>
            </div>
            {lines.length === 0 ? null : (
              <div aria-label={`${entry.label} account usage`}>
                {lines.map(line => <p key={line} className={styles['advancedHint']}>{line}</p>)}
              </div>
            )}
            <ConnectorGrid telemetry={entry.telemetry} />
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
      {failure === undefined ? null : <p className={styles['error']}>{failure}</p>}
      {catalogFailure === undefined ? null : <p className={styles['error']}>{catalogFailure}</p>}
    </section>
  )
}
