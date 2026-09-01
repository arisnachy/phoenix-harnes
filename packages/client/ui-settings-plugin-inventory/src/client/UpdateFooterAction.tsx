import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PhoenixUpdateRestartReceipt,
  PhoenixUpdateSnapshot,
} from '@phoenix-ai/dsh-api-remotes/client'
import { Tooltip } from '@phoenix-ai/dsh-client-ui-primitives'
import type { SidebarFooterActionOwnerProps } from '@phoenix-ai/dsh-client-ui-sidebar/client'
import type { InjectFace, PropsLocale } from '@phoenix-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './UpdateFooterAction.module.css'

/** Poll cadence for the repository-local updater state while Web is open. */
const UPDATE_STATE_POLL_MS = 1250
/** First automatic retry delay for a durable updater failure. */
const UPDATE_RETRY_BASE_MS = 15_000
/** Upper bound for repeated retries while the same failure remains durable. */
const UPDATE_RETRY_MAX_MS = 5 * 60 * 1000
/** Keep expected Host disconnects from being misreported as updater failures. */
const RESTART_RECONNECT_GRACE_MS = 2 * 60 * 1000
const RESTART_RECONNECT_GRACE_KEY = 'phoenix.update.restart-grace-until'

/** Registration-side Remote face used by the sidebar updater action. */
export interface UpdateFooterActionInjected {
  /** Read the stable updater's current durable lifecycle state. */
  readUpdateState: () => Promise<PhoenixUpdateSnapshot>
  /** Ask the Host to close only when a prepared stable update can take over. */
  restartForUpdate: () => Promise<PhoenixUpdateRestartReceipt>
  /** Wake the detached updater so a manual retry performs a real channel check. */
  refreshForUpdate: () => Promise<{ readonly accepted: boolean }>
}

/** Full props assembled by the sidebar footer slot renderer. */
export type UpdateFooterActionProps =
  SidebarFooterActionOwnerProps
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<UpdateFooterActionInjected>

/** Whether this browser tab is inside an explicitly requested restart transition. */
function restartReconnectGraceActive(): boolean {
  if (typeof window === 'undefined') return false
  const value = Number(window.sessionStorage.getItem(RESTART_RECONNECT_GRACE_KEY) ?? '')
  if (!Number.isFinite(value) || value <= Date.now()) {
    window.sessionStorage.removeItem(RESTART_RECONNECT_GRACE_KEY)
    return false
  }
  return true
}

/** Remember an accepted restart across a short Host disconnect or client remount. */
function armRestartReconnectGrace(): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(
    RESTART_RECONNECT_GRACE_KEY,
    String(Date.now() + RESTART_RECONNECT_GRACE_MS),
  )
}

/** Clear the expected-disconnect marker once durable state is readable again. */
function clearRestartReconnectGrace(): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(RESTART_RECONNECT_GRACE_KEY)
}

/**
 * Select the localized user-facing updater copy for one durable state.
 * @param snapshot - current sanitized updater state.
 * @returns locale key, or undefined when the updater should stay invisible.
 */
export function updateLabelKey(snapshot: PhoenixUpdateSnapshot): PluginInventoryLocaleKey | undefined {
  const developmentBranchPause = snapshot.phase === 'development-branch'
    || snapshot.detail?.startsWith('Automatic updates are disabled on branch ') === true
  switch (snapshot.status) {
    case 'idle':
    case 'current':
    case 'updated':
    case 'off':
      return undefined
    case 'paused': return developmentBranchPause ? undefined : 'updatePaused'
    case 'checking': return undefined
    case 'available': return 'updateAvailable'
    case 'preparing':
      switch (snapshot.phase) {
        case 'source': return 'updateSource'
        case 'dependencies': return 'updateDependencies'
        case 'build': return 'updateBuild'
        case 'smoke': return 'updateSmoke'
        default: return 'updateDependencies'
      }
    case 'ready': return 'updateReady'
    case 'restarting': return 'updateRestarting'
    case 'applying': return 'updateApplying'
    case 'rolling-back': return 'updateRollingBack'
    case 'rolled-back': return 'updateRolledBack'
    case 'error':
    case 'rollback-failed': return 'updateError'
    /* v8 ignore next 2 -- compile-time exhaustiveness guard for future statuses. */
    default: {
      const unreachable: never = snapshot.status
      return unreachable
    }
  }
}

/** Return a deterministic visual progress value for the updater lifecycle. */
function updateProgress(snapshot: PhoenixUpdateSnapshot): number {
  switch (snapshot.status) {
    case 'checking': return 12
    case 'available': return 20
    case 'preparing':
      switch (snapshot.phase) {
        case 'source': return 34
        case 'dependencies': return 48
        case 'build': return 68
        case 'smoke': return 86
        default: return 42
      }
    case 'ready': return 100
    case 'restarting': return 100
    case 'applying': return 92
    case 'rolling-back': return 60
    case 'rolled-back': return 100
    case 'error':
    case 'rollback-failed': return 0
    case 'idle':
    case 'current':
    case 'updated':
    case 'paused':
    case 'off': return 0
    /* v8 ignore next 2 -- compile-time exhaustiveness guard for future statuses. */
    default: {
      const unreachable: never = snapshot.status
      return unreachable
    }
  }
}

/** Whether this lifecycle phase represents active background work. */
function isBusy(snapshot: PhoenixUpdateSnapshot): boolean {
  return snapshot.status === 'preparing'
    || snapshot.status === 'restarting'
    || snapshot.status === 'applying'
    || snapshot.status === 'rolling-back'
}

/** Small update glyph that doubles as a CSS spinner while work is active. */
function UpdateGlyph({ spinning }: { spinning: boolean }) {
  return (
    <span className={spinning ? css.spinner : css.glyph} aria-hidden="true">
      <svg viewBox="0 0 20 20" width="16" height="16">
        <path d="M15.6 5.3A7 7 0 1 0 16.8 12h-1.7a5.3 5.3 0 1 1-1-5.3L11.8 9H18V2.8l-2.4 2.5Z" fill="currentColor" />
      </svg>
    </span>
  )
}

/**
 * Render the compact stable-update status immediately above Settings.
 * @param props - sidebar geometry, locale seat and updater Remote callbacks.
 * @returns nothing while current, otherwise a compact progress card or restart action.
 */
export function UpdateFooterAction({
  wide,
  t,
  readUpdateState,
  restartForUpdate,
  refreshForUpdate,
}: UpdateFooterActionProps) {
  const [snapshot, setSnapshot] = useState<PhoenixUpdateSnapshot>({ status: 'idle' })
  const [requesting, setRequesting] = useState(false)
  const requestInFlight = useRef(false)

  const acceptDurableSnapshot = useCallback((next: PhoenixUpdateSnapshot) => {
    // A successful RPC proves the Host is reachable again. From this point the
    // durable updater state, including a real error, is authoritative.
    clearRestartReconnectGrace()
    setSnapshot(next)
  }, [])

  const reportReadFailure = useCallback((_error: unknown) => {
    // The Host intentionally disappears during an accepted restart. Treat that
    // transport gap as part of the restart instead of inventing an updater error.
    if (restartReconnectGraceActive()) return
    // A transient RPC/network failure is not evidence that an update failed.
    // Keep the last durable snapshot rendered until a later poll can replace
    // it. This prevents the update card from disappearing and reappearing.
    void _error
  }, [])

  const reportRestartFailure = useCallback(() => {
    // A failed restart request is an actionable updater operation failure,
    // unlike a background read that may only be a transient transport gap.
    setSnapshot({ status: 'error' })
  }, [])

  const refresh = useCallback(async () => {
    try {
      acceptDurableSnapshot(await readUpdateState())
    } catch (error) {
      reportReadFailure(error)
    }
  }, [acceptDurableSnapshot, readUpdateState, reportReadFailure])

  useEffect(() => {
    let active = true
    const isActive = (): boolean => active
    const read = async (): Promise<void> => {
      if (!isActive()) return
      try {
        const next = await readUpdateState()
        if (!isActive()) return
        acceptDurableSnapshot(next)
      } catch (error) {
        if (!isActive()) return
        reportReadFailure(error)
      }
    }
    void read()
    const timer = window.setInterval(() => { void read() }, UPDATE_STATE_POLL_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [acceptDurableSnapshot, readUpdateState, reportReadFailure])

  const retryUpdate = useCallback(async (): Promise<void> => {
    if (requestInFlight.current) return
    requestInFlight.current = true
    setRequesting(true)
    try {
      await refreshForUpdate()
      await refresh()
    } catch (_error) {
      // A failed wake request does not replace the last durable updater state.
      // Polling and the next bounded retry remain active without exposing the
      // private transport detail in the sidebar.
    } finally {
      requestInFlight.current = false
      setRequesting(false)
    }
  }, [refresh, refreshForUpdate])

  useEffect(() => {
    if (snapshot.status !== 'error' && snapshot.status !== 'rollback-failed') return
    let active = true
    let attempt = 0
    let timer: number | undefined
    const schedule = (): void => {
      const delay = Math.min(UPDATE_RETRY_BASE_MS * (2 ** Math.min(attempt, 4)), UPDATE_RETRY_MAX_MS)
      timer = window.setTimeout(() => {
        void retryUpdate().finally(() => {
          if (!active) return
          attempt += 1
          schedule()
        })
      }, delay)
    }
    schedule()
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [retryUpdate, snapshot.status])

  const labelKey = updateLabelKey(snapshot)
  if (labelKey === undefined) return null

  const ready = snapshot.status === 'ready'
  const busy = requesting || isBusy(snapshot)
  const label = t(labelKey)
  const actionLabel = ready ? t('updateRestart') : label
  const errorState = snapshot.status === 'error' || snapshot.status === 'rollback-failed'
  const tone = ready
    ? css.ready
    : errorState
      ? css.error
      : busy
        ? css.busy
        : css.neutral
  const className = `${ready ? css.action : css.status} ${tone}${wide ? '' : ` ${css.rail}`}`

  const onRestart = async (): Promise<void> => {
    if (requesting) return
    setRequesting(true)
    try {
      const receipt = await restartForUpdate()
      if (receipt.accepted) {
        armRestartReconnectGrace()
        setSnapshot({ ...snapshot, status: 'restarting', phase: 'restart' })
        return
      }
      await refresh()
    } catch {
      reportRestartFailure()
    } finally {
      setRequesting(false)
    }
  }

  const onRetry = async (): Promise<void> => {
    await retryUpdate()
  }

  const progress = updateProgress(snapshot)
  const target = snapshot.target?.slice(0, 12)
  const retryable = errorState || snapshot.status === 'paused'
  const detail = retryable
    ? snapshot.detail ?? t(snapshot.status === 'paused' ? 'updatePausedHint' : 'updateErrorHint')
    : undefined
  const content = (
    <>
      <UpdateGlyph spinning={busy} />
      {wide && (
        <span className={css.copy} title={detail}>
          <span className={css.title}>{label}</span>
          {target !== undefined && <code className={css.target}>{target}</code>}
          {ready ? <span className={css.detail}>{t('updateRestart')}</span> : null}
          {retryable ? (
            <button
              type="button"
              className={css.retryButton}
              aria-label={t('updateRetry')}
              disabled={requesting}
              onClick={() => { void onRetry() }}
            >
              {t('retry')}
            </button>
          ) : null}
          {busy && progress > 0 ? (
            <span className={css.progressTrack} aria-hidden="true">
              <span className={css.progressValue} style={{ width: `${String(progress)}%` }} />
            </span>
          ) : null}
        </span>
      )}
    </>
  )

  if (ready) {
    return (
      <Tooltip label={actionLabel} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={className}
          aria-label={actionLabel}
          disabled={requesting}
          data-testid="phoenix-update-card"
          data-update-status={snapshot.status}
          onClick={() => { void onRestart() }}
        >
          <span
            className={css.visuallyHidden}
            data-update-progress
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-label={label}
          />
          {content}
        </button>
      </Tooltip>
    )
  }

  return (
    <Tooltip label={label} delayMs={500} disabled={wide}>
      <div
        className={className}
        role="status"
        aria-live="polite"
        aria-label={label}
        data-testid="phoenix-update-card"
        data-update-status={snapshot.status}
      >
        <span
          className={css.visuallyHidden}
          data-update-progress
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={label}
        />
        {content}
      </div>
    </Tooltip>
  )
}
