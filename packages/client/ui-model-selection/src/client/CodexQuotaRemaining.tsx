/** Compact native Codex quota for the Settings trigger trailing seat. */
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

/** Registrant-owned faces needed by the OpenAI/Codex quota meter. */
export interface CodexQuotaRemainingInjected {
  /** Native authorization catalog carrying account rate-limit telemetry. */
  authorization: AuthorizationClient
}

/** Minimal runtime seats actually consumed from the session-maybe Settings outlet. */
export type CodexQuotaRemainingProps = {
  wide: boolean
  sessionId: SessionId | undefined
} & InjectFace<CodexQuotaRemainingInjected>

const QUOTA_REFRESH_MS = 60_000
const QUOTA_STARTUP_RETRY_MS = 2_000

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
 * Missing telemetry reserves no sidebar space and never invents limits.
 * @param props - session identity/sidebar state plus account/model-directory faces.
 * @returns the compact quota chip or null.
 */
export function CodexQuotaRemaining({
  wide, authorization,
}: CodexQuotaRemainingProps) {
  const [quota, setQuota] = useState<QuotaState | undefined>()
  const [clockMs, setClockMs] = useState(() => Date.now())
  const authorizationRef = useRef(authorization)
  authorizationRef.current = authorization

  useEffect(() => {
    if (!wide) {
      setQuota(undefined)
      return
    }
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
        const telemetry = (response.result.value.entries as AuthorizationEntry[])
          .filter(isOpenAIAccount)
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
        setQuota(available ? nextQuota : undefined)
        schedule(available ? QUOTA_REFRESH_MS : QUOTA_STARTUP_RETRY_MS)
      } catch {
        if (!stale) {
          setQuota(undefined)
          schedule(QUOTA_STARTUP_RETRY_MS)
        }
      }
    }

    void load()
    return () => {
      stale = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [wide])

  useEffect(() => {
    if (!wide || quota === undefined) return
    setClockMs(Date.now())
    const timer = window.setInterval(() => { setClockMs(Date.now()) }, 1_000)
    return () => { window.clearInterval(timer) }
  }, [quota, wide])

  if (!wide || quota === undefined) return null

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
