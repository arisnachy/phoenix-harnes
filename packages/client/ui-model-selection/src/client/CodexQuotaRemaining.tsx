/** Compact native Codex quota for the Settings trigger trailing seat. */
import { useEffect, useRef, useState } from 'react'
import type { IApiClient, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelDirectory } from './directory.ts'
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

/** Registrant-owned faces needed by the OpenAI/Codex quota meter. */
export interface CodexQuotaRemainingInjected {
  /** Native authorization catalog carrying account rate-limit telemetry. */
  authorization: AuthorizationClient
  /** Resolve the same per-session model directory used by the composer selector. */
  directoryFor: (sessionId: SessionId) => ModelDirectory
}

/** Minimal runtime seats actually consumed from the session-maybe Settings outlet. */
export type CodexQuotaRemainingProps = {
  wide: boolean
  sessionId: SessionId | undefined
} & InjectFace<CodexQuotaRemainingInjected>

const QUOTA_REFRESH_MS = 60_000

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

function windowLabel(limit: RateLimitWindow, fallback: string): string {
  const minutes = limit.windowDurationMins
  if (minutes === undefined || !Number.isSafeInteger(minutes) || minutes <= 0) return fallback
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

/**
 * Show native Codex account quota only when the current session is routed to
 * an OpenAI/Codex provider. Non-OpenAI selections reserve no sidebar space.
 * @param props - session identity/sidebar state plus account/model-directory faces.
 * @returns the compact quota chip or null.
 */
export function CodexQuotaRemaining({
  wide, sessionId, authorization, directoryFor,
}: CodexQuotaRemainingProps) {
  const [selection, setSelection] = useState<{
    sessionId: SessionId
    provider: string | undefined
  } | undefined>()
  const [quota, setQuota] = useState<QuotaState | undefined>()
  const authorizationRef = useRef(authorization)
  authorizationRef.current = authorization

  useEffect(() => {
    if (!wide || sessionId === undefined) {
      setSelection(undefined)
      return
    }
    const id = sessionId
    const directory = directoryFor(id)
    const sync = (): void => {
      setSelection({ sessionId: id, provider: directory.store.getSnapshot().current?.provider })
    }
    sync()
    const stop = directory.store.subscribe(sync)
    void directory.load().catch(() => { /* no provider fact = no meter */ })
    return stop
  }, [directoryFor, sessionId, wide])

  const provider = selection?.sessionId === sessionId ? selection?.provider : undefined

  useEffect(() => {
    setQuota(undefined)
    if (!wide || sessionId === undefined || !isOpenAI(provider)) return
    let stale = false

    const load = async (): Promise<void> => {
      try {
        const response = await authorizationRef.current.list({})
        if (stale || !response.result.ok) return
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
        setQuota(Object.keys(nextQuota).length === 0 ? undefined : nextQuota)
      } catch {
        if (!stale) setQuota(undefined)
      }
    }

    void load()
    const timer = window.setInterval(() => { void load() }, QUOTA_REFRESH_MS)
    return () => {
      stale = true
      window.clearInterval(timer)
    }
  }, [provider, sessionId, wide])

  if (!wide || sessionId === undefined || !isOpenAI(provider) || quota === undefined) return null

  const windows = [
    quota.primaryLimit === undefined ? undefined : {
      key: 'primary',
      label: windowLabel(quota.primaryLimit, '5h'),
      value: remaining(quota.primaryLimit),
    },
    quota.secondaryLimit === undefined ? undefined : {
      key: 'secondary',
      label: windowLabel(quota.secondaryLimit, '7d'),
      value: remaining(quota.secondaryLimit),
    },
  ].filter((window): window is {
    key: string
    label: string
    value: number
  } => window !== undefined)

  return (
    <span className={css.root} aria-hidden="true">
      {windows.map(window => (
        <span
          className={css.window}
          key={window.key}
          title={`OpenAI Codex · ${window.label} · ${window.value}% remaining`}
        >
          <span className={css.label}>{window.label}</span>
          <strong className={css.value}>{window.value}%</strong>
          <span className={css.track}>
            <span className={css.fill} style={{ width: `${window.value}%` }} />
          </span>
        </span>
      ))}
    </span>
  )
}
