import { useCallback, useEffect, useState } from 'react'
import type {
  PhoenixUpdateRestartReceipt,
  PhoenixUpdateSnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './UpdateFooterAction.module.css'

/** Poll cadence for the repository-local updater state while Web is open. */
const UPDATE_STATE_POLL_MS = 1250

/** Registration-side Remote face used by the sidebar updater action. */
export interface UpdateFooterActionInjected {
  /** Read the stable updater's current durable lifecycle state. */
  readUpdateState: () => Promise<PhoenixUpdateSnapshot>
  /** Ask the Host to close only when a prepared stable update can take over. */
  restartForUpdate: () => Promise<PhoenixUpdateRestartReceipt>
}

/** Full props assembled by the sidebar footer slot renderer. */
export type UpdateFooterActionProps =
  SidebarFooterActionOwnerProps
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<UpdateFooterActionInjected>

/** Statuses that should not consume any sidebar space. */
const HIDDEN_STATUSES: ReadonlySet<PhoenixUpdateSnapshot['status']> = new Set([
  'idle', 'checking', 'current', 'updated', 'off',
])

/**
 * Select the localized user-facing updater copy for one durable state.
 * @param snapshot - current sanitized updater state.
 * @returns locale key, or undefined when the updater should stay invisible.
 */
export function updateLabelKey(snapshot: PhoenixUpdateSnapshot): PluginInventoryLocaleKey | undefined {
  if (HIDDEN_STATUSES.has(snapshot.status)) return undefined
  switch (snapshot.status) {
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
    case 'paused': return 'updatePaused'
    case 'error':
    case 'rollback-failed': return 'updateError'
    /* v8 ignore next 4 -- the hidden set and closed status union exhaust every other value. */
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
      <svg viewBox="0 0 20 20" width="18" height="18">
        <path d="M15.6 5.3A7 7 0 1 0 16.8 12h-1.7a5.3 5.3 0 1 1-1-5.3L11.8 9H18V2.8l-2.4 2.5Z" fill="currentColor" />
      </svg>
    </span>
  )
}

/**
 * Render the Codex-style stable-update status immediately above Settings.
 * @param props - sidebar geometry, locale seat and updater Remote callbacks.
 * @returns nothing while current, otherwise a progress row or restart action.
 */
export function UpdateFooterAction({
  wide,
  t,
  readUpdateState,
  restartForUpdate,
}: UpdateFooterActionProps) {
  const [snapshot, setSnapshot] = useState<PhoenixUpdateSnapshot>({ status: 'idle' })
  const [requesting, setRequesting] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await readUpdateState())
    } catch (error) {
      setSnapshot({
        status: 'error',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }, [readUpdateState])

  useEffect(() => {
    let active = true
    const read = async (): Promise<void> => {
      if (!active) return
      await refresh()
    }
    void read()
    const timer = window.setInterval(() => { void read() }, UPDATE_STATE_POLL_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [refresh])

  const labelKey = updateLabelKey(snapshot)
  if (labelKey === undefined) return null

  const ready = snapshot.status === 'ready'
  const busy = requesting || isBusy(snapshot)
  const label = t(labelKey)
  const actionLabel = ready ? t('updateRestart') : label

  const onRestart = async (): Promise<void> => {
    if (!ready || requesting) return
    setRequesting(true)
    try {
      const receipt = await restartForUpdate()
      if (receipt.accepted) {
        setSnapshot({ ...snapshot, status: 'restarting', phase: 'restart' })
        return
      }
      await refresh()
    } catch (error) {
      setSnapshot({
        status: 'error',
        detail: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setRequesting(false)
    }
  }

  const content = (
    <>
      <UpdateGlyph spinning={busy} />
      {wide && (
        <span className={css.copy}>
          <span className={css.title}>{label}</span>
          {ready && <span className={css.detail}>{t('updateRestart')}</span>}
        </span>
      )}
    </>
  )

  if (ready) {
    return (
      <Tooltip label={actionLabel} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={css.action}
          aria-label={actionLabel}
          disabled={requesting}
          onClick={() => { void onRestart() }}
        >
          {content}
        </button>
      </Tooltip>
    )
  }

  return (
    <Tooltip label={label} delayMs={500} disabled={wide}>
      <div className={css.status} role="status" aria-live="polite" aria-label={label}>
        {content}
      </div>
    </Tooltip>
  )
}
