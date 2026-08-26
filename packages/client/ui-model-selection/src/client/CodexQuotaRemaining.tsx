/** Compact native Codex quota for the Settings trigger trailing seat. */
import { useEffect, useState } from 'react'
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

function remaining(limit: RateLimitWindow): number {
  return Math.max(0, Math.min(100, Math.round(100 - limit.usedPercent)))
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
  const [quota, setQuota] = useState<number | undefined>()

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

  const provider = selection?.sessionId === sessionId ? selection.provider : undefined

  useEffect(() => {
    setQuota(undefined)
    if (!wide || sessionId === undefined || !isOpenAI(provider)) return
    let stale = false

    const load = async (): Promise<void> => {
      try {
        const response = await authorization.list({})
        if (stale || !response.result.ok) return
        const entry = (response.result.value.entries as AuthorizationEntry[]).find(isOpenAIAccount)
        const telemetry = entry?.telemetry
        const limit = telemetry?.primaryLimit ?? telemetry?.secondaryLimit
        if (!stale) setQuota(limit === undefined ? undefined : remaining(limit))
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
  }, [authorization, provider, sessionId, wide])

  if (!wide || sessionId === undefined || !isOpenAI(provider) || quota === undefined) return null

  return (
    <span className={css.root} title={`OpenAI Codex · ${quota}% remaining`} aria-hidden="true">
      <strong className={css.value}>{quota}%</strong>
      <span className={css.track}>
        <span className={css.fill} style={{ width: `${quota}%` }} />
      </span>
    </span>
  )
}
