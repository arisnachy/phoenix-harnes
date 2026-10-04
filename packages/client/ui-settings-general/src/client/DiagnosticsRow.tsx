/** General Settings row for local PHOENIX diagnostics without a visible console. */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@phoenix-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import css from './DiagnosticsRow.module.css'

type Diagnostics = {
  available: boolean
  logPath: string
  directory: string
  recentErrors: string[]
  updatedAt?: number
}

/** Registration-side Host diagnostics face. */
export interface DiagnosticsRowInjected {
  host: IApiClient['host']
}

/** Full Settings-row props. */
export type DiagnosticsRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings'>
  & InjectFace<DiagnosticsRowInjected>

/**
 * Show recent hidden-launch errors and open the full local log on demand.
 * @param props - Host diagnostics API and localized settings copy.
 * @returns the diagnostics row rendered in General Settings.
 */
export function DiagnosticsRow({ host, t }: DiagnosticsRowProps): ReactNode {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | undefined>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)
  const [canOpenPath, setCanOpenPath] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    const response = await host.describe({})
    if (!response.result.ok) {
      setLoadFailed(true)
      return
    }
    setLoadFailed(false)
    setCanOpenPath(response.result.value.canOpenPath)
    setDiagnostics(response.result.value.diagnostics)
  }, [host])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { void load() }, 15_000)
    return () => { window.clearInterval(timer) }
  }, [load])

  const open = async (path: string): Promise<void> => {
    setOpenFailed(false)
    const response = await host.openPath({ path })
    if (!response.result.ok) setOpenFailed(true)
  }

  const recent = diagnostics?.recentErrors ?? []
  return (
    <div className={css.row} data-phoenix-diagnostics="true">
      <div className={css.heading}>
        <div>
          <div className={css.title}>{t('diagnostics.title')}</div>
          <div className={css.desc}>{t('diagnostics.description')}</div>
        </div>
        <button className={css.refresh} type="button" onClick={() => { void load() }}>
          {t('diagnostics.refresh')}
        </button>
      </div>

      {loadFailed
        ? <div className={css.notice} role="alert">{t('diagnostics.loadError')}</div>
        : recent.length > 0
          ? (
              <div className={css.errors} role="status">
                {recent.map((line, index) => <code key={`${String(index)}-${line}`}>{line}</code>)}
              </div>
            )
          : <div className={css.notice}>{diagnostics?.available === true ? t('diagnostics.clean') : t('diagnostics.noLog')}</div>}

      {openFailed ? <div className={css.notice} role="alert">{t('diagnostics.openError')}</div> : null}
      {diagnostics !== undefined && canOpenPath ? (
        <div className={css.actions}>
          <button
            type="button"
            className={css.action}
            disabled={!diagnostics.available}
            onClick={() => { void open(diagnostics.logPath) }}
          >
            {t('diagnostics.openLog')}
          </button>
          <button type="button" className={css.action} onClick={() => { void open(diagnostics.directory) }}>
            {t('diagnostics.openFolder')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
