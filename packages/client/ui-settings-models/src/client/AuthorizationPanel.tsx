import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { en } from './locales.ts'
import { AuthorizationAttemptProgress, useAuthorizationAttempt } from './authorization-attempt.tsx'
import styles from './ModelsSection.module.css'

type AuthorizationClient = IApiClient['authorization']

interface RateLimitWindow {
  usedPercent: number
  windowDurationMins?: number
  resetsAt?: number
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
}

interface Entry {
  key: string
  label: string
  methods: Array<{ id: string; label: string }>
  inFlight: boolean
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

/** Account-based provider login. OAuth grants never pass through API-key inputs. */
export function AuthorizationPanel({ api, t, onAuthorized }: AuthorizationPanelProps): ReactNode {
  const [entries, setEntries] = useState<Entry[]>([])
  const [catalogFailure, setCatalogFailure] = useState<string | undefined>()
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

  return (
    <section className={styles['authorizationPanel']} aria-label={t('accountConnections')}>
      <h3 className={styles['authorizationTitle']}>{t('accountConnections')}</h3>
      <p className={styles['advancedHint']}>{t('accountConnectionsHint')}</p>
      {entries.map(entry => {
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
              </div>
            </div>
            {lines.length === 0 ? null : (
              <div aria-label={`${entry.label} account usage`}>
                {lines.map(line => <p key={line} className={styles['advancedHint']}>{line}</p>)}
              </div>
            )}
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
