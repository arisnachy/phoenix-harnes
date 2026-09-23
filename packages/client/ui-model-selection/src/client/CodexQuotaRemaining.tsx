/** Native Codex quota for the expanded Settings row and collapsed sidebar rail. */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { IApiClient, SessionId } from '@phoenix-ai/dsh-api-remotes/client'
import type { InjectFace } from '@phoenix-ai/dsh-client-ui-slots'
import css from './CodexQuotaRemaining.module.css'

type AuthorizationClient = IApiClient['authorization']

interface RateLimitWindow {
  usedPercent: number
  windowDurationMins?: number
  resetsAt?: number
}

interface AccountTelemetry {
  kind: 'account'
  provider: string
  primaryLimit?: RateLimitWindow
  secondaryLimit?: RateLimitWindow
}

interface AuthorizationEntry {
  key: string
  label?: string
  telemetry?: AccountTelemetry
}

type QuotaState = {
  primaryLimit?: RateLimitWindow
  secondaryLimit?: RateLimitWindow
}

type QuotaMeterStyle = CSSProperties & { '--quota-progress': string }

// Keep the last valid account telemetry across sidebar remounts. The host
// connection supplies the stable cache key; authorization faces can be
// recreated when the model selector opens and must not make the meter blink.
// A cache hit lets the selector render immediately while the fresh RPC runs in
// the background.
const quotaCache = new WeakMap<object, QuotaState>()

/** Registrant-owned faces needed by the OpenAI/Codex quota meter. */
export interface CodexQuotaRemainingInjected {
  /** Native authorization catalog carrying account rate-limit telemetry. */
  authorization: AuthorizationClient
  /** Stable page-connection identity used across slot remounts. */
  quotaCacheKey?: object
}

/** Minimal runtime seats actually consumed from the session-maybe Settings outlet. */
export type CodexQuotaRemainingProps = {
  wide: boolean
  sessionId: SessionId | undefined
} & InjectFace<CodexQuotaRemainingInjected>

const QUOTA_REFRESH_MS = 60_000
const QUOTA_STARTUP_RETRY_MS = 2_000
const QUOTA_STORAGE_KEY = 'phoenix.codex-quota.v1'
const LOADING_WINDOW_LABELS = ['5h', '7d'] as const

function isOpenAI(value: string | undefined): boolean {
  if (value === undefined) return false
  const normalized = value.toLowerCase()
  return normalized.includes('openai') || normalized.includes('codex') || normalized.includes('chatgpt')
}

function isOpenAIAccount(entry: AuthorizationEntry): boolean {
  return isOpenAI(entry.key) || isOpenAI(entry.label) || isOpenAI(entry.telemetry?.provider)
}

function isValidRateLimit(value: RateLimitWindow | undefined): value is RateLimitWindow {
  return value !== undefined
    && Number.isFinite(value.usedPercent)
    && value.usedPercent >= 0
    && value.usedPercent <= 100
}

function readPersistedQuota(): QuotaState | undefined {
  const raw = window.localStorage.getItem(QUOTA_STORAGE_KEY)
  if (raw === null) return undefined
  const parsed = JSON.parse(raw) as QuotaState
  const primaryLimit = isValidRateLimit(parsed.primaryLimit) ? parsed.primaryLimit : undefined
  const secondaryLimit = isValidRateLimit(parsed.secondaryLimit) ? parsed.secondaryLimit : undefined
  if (primaryLimit === undefined && secondaryLimit === undefined) {
    window.localStorage.removeItem(QUOTA_STORAGE_KEY)
    return undefined
  }
  return {
    ...primaryLimit === undefined ? {} : { primaryLimit },
    ...secondaryLimit === undefined ? {} : { secondaryLimit },
  }
}

function persistQuota(quota: QuotaState): void {
  window.localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(quota))
}

function clearPersistedQuota(): void {
  window.localStorage.removeItem(QUOTA_STORAGE_KEY)
}

function remaining(limit: RateLimitWindow): number {
  return Math.max(0, Math.min(100, Math.round(100 - limit.usedPercent)))
}

/** Format the remaining time until a provider quota window resets. */
export function formatResetCountdown(resetsAt: number, nowMs = Date.now()): string {
  const remainingMs = Math.max(0, resetsAt * 1000 - nowMs)
  if (remainingMs === 0) return 'available'
  const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1_000))
  const days = Math.floor(totalSeconds / (24 * 60 * 60))
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60))
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function windowLabel(limit: RateLimitWindow, fallback: string): string {
  const minutes = limit.windowDurationMins
  if (minutes === undefined || !Number.isSafeInteger(minutes) || minutes <= 0) return fallback
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

/**
 * Show native Codex account quota whenever the current session has a visible
 * sidebar and the authorization catalog provides OpenAI/Codex telemetry.
 * The last valid quota survives page/host restarts while fresh native telemetry
 * warms, and a known account keeps explicit 5h/7d loading seats without
 * inventing percentages or reset times.
 * @param props - session identity/sidebar state plus account/model-directory faces.
 * @returns the compact quota chip or null.
 */
export function CodexQuotaRemaining({
  wide, authorization, quotaCacheKey,
}: CodexQuotaRemainingProps) {
  const cacheKey = quotaCacheKey ?? authorization
  const [quota, setQuota] = useState<QuotaState | undefined>(
    () => quotaCache.get(cacheKey) ?? readPersistedQuota(),
  )
  const [accountPresent, setAccountPresent] = useState<boolean | undefined>(
    () => quota === undefined ? undefined : true,
  )
  const [clockMs, setClockMs] = useState(() => Date.now())
  const authorizationRef = useRef(authorization)
  authorizationRef.current = authorization

  useEffect(() => {
    // Quota is account telemetry, not expanded-sidebar UI state. Keep it warm
    // while the rail is collapsed so the 5h/7d percentages never disappear
    // merely because navigation was minimized.
    let stale = false
    let timer: number | undefined

    const schedule = (delayMs: number): void => {
      if (stale) return
      timer = window.setTimeout(() => { void load() }, delayMs)
    }

    const load = async (): Promise<void> => {
      try {
        const response = await authorizationRef.current.list({})
        if (stale) return
        if (!response.result.ok) {
          schedule(QUOTA_STARTUP_RETRY_MS)
          return
        }
        const accountEntries = (response.result.value.entries as AuthorizationEntry[])
          .filter(isOpenAIAccount)
        const hasAccount = accountEntries.length > 0
        setAccountPresent(hasAccount)
        if (!hasAccount) {
          quotaCache.delete(cacheKey)
          clearPersistedQuota()
          setQuota(undefined)
        }
        const telemetry = accountEntries
          .map(entry => entry.telemetry)
          .find((candidate): candidate is AccountTelemetry => candidate !== undefined
            && (isValidRateLimit(candidate.primaryLimit) || isValidRateLimit(candidate.secondaryLimit)))
        const primaryLimit = telemetry !== undefined && isValidRateLimit(telemetry.primaryLimit)
          ? telemetry.primaryLimit
          : undefined
        const secondaryLimit = telemetry !== undefined && isValidRateLimit(telemetry.secondaryLimit)
          ? telemetry.secondaryLimit
          : undefined
        const nextQuota: QuotaState = {
          ...primaryLimit === undefined ? {} : { primaryLimit },
          ...secondaryLimit === undefined ? {} : { secondaryLimit },
        }
        const available = Object.keys(nextQuota).length !== 0
        if (available) {
          quotaCache.set(cacheKey, nextQuota)
          persistQuota(nextQuota)
          setQuota(nextQuota)
        }
        schedule(available ? QUOTA_REFRESH_MS : QUOTA_STARTUP_RETRY_MS)
      } catch {
        if (!stale) {
          schedule(QUOTA_STARTUP_RETRY_MS)
        }
      }
    }

    void load()
    return () => {
      stale = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [cacheKey])

  useEffect(() => {
    if (quota === undefined) return
    setClockMs(Date.now())
    const timer = window.setInterval(() => { setClockMs(Date.now()) }, 1_000)
    return () => { window.clearInterval(timer) }
  }, [quota])

  if (quota === undefined) {
    // A known Codex account whose native telemetry is still warming (for
    // example while Codex performs a state-db backfill) keeps a quiet visible
    // seat instead of disappearing. No percentage or window is invented.
    if (accountPresent !== true) return null
    if (!wide) {
      return (
        <span
          className={css.railRoot}
          role="status"
          aria-label="OpenAI Codex usage limits loading"
          data-codex-quota-loading="true"
        >
          {LOADING_WINDOW_LABELS.map(label => (
            <span className={css.railWindow} key={label} aria-label={`Codex ${label} usage loading`}>
              <span className={css.railLabel}>{label}</span>
              <strong className={css.railValue}>…</strong>
              <span className={css.railReset}>↻ …</span>
            </span>
          ))}
        </span>
      )
    }
    return (
      <span
        className={css.root}
        role="status"
        aria-label="OpenAI Codex usage limits loading"
        data-codex-quota-loading="true"
      >
        {LOADING_WINDOW_LABELS.map((label, index) => (
          <span
            className={`${css.window} ${index === 0 ? css.primary : css.secondary}`}
            key={label}
            aria-label={`Codex ${label} usage loading`}
          >
            <span className={css.meter} aria-hidden="true">
              <strong className={css.value}>…</strong>
            </span>
            <span className={css.copy}>
              <span className={css.label}>{label}</span>
              <span className={css.reset}>↻ …</span>
            </span>
          </span>
        ))}
      </span>
    )
  }

  const windows = [
    quota.primaryLimit === undefined ? undefined : {
      key: 'primary',
      label: windowLabel(quota.primaryLimit, '5h'),
      value: remaining(quota.primaryLimit),
      resetText: quota.primaryLimit.resetsAt !== undefined && Number.isFinite(quota.primaryLimit.resetsAt)
        ? formatResetCountdown(quota.primaryLimit.resetsAt, clockMs) : undefined,
    },
    quota.secondaryLimit === undefined ? undefined : {
      key: 'secondary',
      label: windowLabel(quota.secondaryLimit, '7d'),
      value: remaining(quota.secondaryLimit),
      resetText: quota.secondaryLimit.resetsAt !== undefined && Number.isFinite(quota.secondaryLimit.resetsAt)
        ? formatResetCountdown(quota.secondaryLimit.resetsAt, clockMs) : undefined,
    },
  ].filter((window): window is {
    key: string
    label: string
    value: number
    resetText: string | undefined
  } => window !== undefined)

  if (!wide) {
    return (
      <span
        className={css.railRoot}
        role="group"
        aria-label="OpenAI Codex usage limits"
        data-codex-quota-rail="true"
      >
        {windows.map(window => (
          <span
            className={css.railWindow}
            key={window.key}
            title={`OpenAI Codex · ${window.label} · ${window.value}% remaining${window.resetText === undefined ? '' : ` · resets in ${window.resetText}`}`}
            aria-label={`Codex ${window.label} · ${window.value}% remaining${window.resetText === undefined ? '' : ` · resets in ${window.resetText}`}`}
          >
            <span className={css.railLabel}>{window.label}</span>
            <strong className={css.railValue}>{window.value}%</strong>
            {window.resetText === undefined ? null : <span className={css.railReset}>↻ {window.resetText}</span>}
          </span>
        ))}
      </span>
    )
  }

  return (
    <span className={css.root} role="group" aria-label="OpenAI Codex usage limits">
      {windows.map(window => (
        <span
          className={`${css.window} ${window.key === 'primary' ? css.primary : css.secondary}`}
          key={window.key}
          title={`OpenAI Codex · ${window.label} · ${window.value}% remaining${window.resetText === undefined ? '' : ` · resets in ${window.resetText}`}`}
          aria-label={`Codex ${window.label} · ${window.value}% remaining${window.resetText === undefined ? '' : ` · resets in ${window.resetText}`}`}
        >
          <span
            className={css.meter}
            data-quota-meter={window.label}
            style={{ '--quota-progress': `${String(window.value)}%` } as QuotaMeterStyle}
            aria-hidden="true"
          >
            <strong className={css.value}>{window.value}%</strong>
          </span>
          <span className={css.copy}>
            <span className={css.label}>{window.label}</span>
            {window.resetText === undefined ? null : <span className={css.reset}>↻ {window.resetText}</span>}
          </span>
        </span>
      ))}
    </span>
  )
}
