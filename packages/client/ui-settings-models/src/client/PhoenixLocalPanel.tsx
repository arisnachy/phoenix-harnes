import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PhoenixLocalKey } from './phoenix-local-locales.ts'
import styles from './PhoenixLocalPanel.module.css'

export type PhoenixLocalModelMode = 'off' | 'on-demand' | 'always-on'
export type PhoenixLocalModelPhase =
  | 'not-installed'
  | 'installing'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

export interface PhoenixLocalModelCatalogEntry {
  readonly id: string
  readonly displayName: string
  readonly sizeBytes: number
  readonly estimatedRamBytes: number
  readonly contextWindow: number
  readonly maxTokens: number
  readonly recommended: boolean
}

export interface PhoenixLocalModelSnapshot {
  readonly mode: PhoenixLocalModelMode
  readonly selectedModelId: string
  readonly installedModelIds: readonly string[]
  readonly phase: PhoenixLocalModelPhase
  readonly progress?: { readonly receivedBytes: number; readonly totalBytes?: number }
  readonly error?: { readonly code: string; readonly message: string }
  readonly catalog: readonly PhoenixLocalModelCatalogEntry[]
}

/** Browser-safe façade over the Host-owned Phoenix Local remote. */
export interface PhoenixLocalModelClient {
  state(): Promise<PhoenixLocalModelSnapshot>
  install(modelId: string): Promise<PhoenixLocalModelSnapshot>
  start(): Promise<PhoenixLocalModelSnapshot>
  stop(): Promise<PhoenixLocalModelSnapshot>
  uninstall(modelId: string): Promise<PhoenixLocalModelSnapshot>
  setMode(mode: PhoenixLocalModelMode): Promise<PhoenixLocalModelSnapshot>
  setDefaultModel(modelId: string): Promise<PhoenixLocalModelSnapshot>
}

export interface PhoenixLocalPanelProps {
  client: PhoenixLocalModelClient
  t: (key: PhoenixLocalKey) => string
}

const TRANSIENT_PHASES = new Set<PhoenixLocalModelPhase>(['installing', 'starting', 'stopping'])

function formatBytes(value: number): string {
  const gib = value / (1024 ** 3)
  if (gib >= 1) return `${gib.toFixed(gib >= 10 ? 0 : 1)} GB`
  return `${Math.max(1, Math.round(value / (1024 ** 2)))} MB`
}

function statusCopy(phase: PhoenixLocalModelPhase, t: PhoenixLocalPanelProps['t']): string {
  switch (phase) {
    case 'not-installed': return t('noInstalled')
    case 'installing': return t('installing')
    case 'ready': return t('ready')
    case 'starting': return t('starting')
    case 'running': return t('running')
    case 'stopping': return t('stopping')
    case 'error': return t('error')
  }
}

function progressPercent(snapshot: PhoenixLocalModelSnapshot): number | undefined {
  const total = snapshot.progress?.totalBytes
  if (total === undefined || total <= 0) return undefined
  return Math.max(0, Math.min(100, Math.round((snapshot.progress!.receivedBytes / total) * 100)))
}

/** Dedicated local-device card mounted inside Settings → Models. */
export function PhoenixLocalPanel({ client, t }: PhoenixLocalPanelProps): ReactNode {
  const [snapshot, setSnapshot] = useState<PhoenixLocalModelSnapshot | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [confirmUninstall, setConfirmUninstall] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setSnapshot(await client.state())
      setFailure(undefined)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }, [client])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (snapshot === undefined || !TRANSIENT_PHASES.has(snapshot.phase)) return
    const timer = window.setInterval(() => { void refresh() }, 750)
    return () => { window.clearInterval(timer) }
  }, [refresh, snapshot])

  const selected = useMemo(() => {
    if (snapshot === undefined) return undefined
    return snapshot.catalog.find(model => model.id === snapshot.selectedModelId)
      ?? snapshot.catalog.find(model => model.recommended)
      ?? snapshot.catalog[0]
  }, [snapshot])

  const installed = snapshot !== undefined && selected !== undefined
    && snapshot.installedModelIds.includes(selected.id)
  const percent = snapshot === undefined ? undefined : progressPercent(snapshot)

  const run = useCallback(async (
    operation: () => Promise<PhoenixLocalModelSnapshot>,
    optimistic?: PhoenixLocalModelPhase,
  ): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFailure(undefined)
    if (optimistic !== undefined) {
      setSnapshot(current => current === undefined ? current : { ...current, phase: optimistic })
    }
    try {
      setSnapshot(await operation())
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [busy, refresh])

  if (snapshot === undefined) {
    return (
      <section className={styles['panel']} aria-label={t('title')}>
        <div className={styles['header']}>
          <div><h3 className={styles['title']}>{t('title')}</h3><p className={styles['intro']}>{t('intro')}</p></div>
          <span className={styles['badge']}>{t('offline')}</span>
        </div>
        {failure === undefined ? <p className={styles['muted']}>{t('status')}…</p> : (
          <div className={styles['error']} role="alert">
            <span>{failure || t('unavailable')}</span>
            <button type="button" className={styles['secondary']} onClick={() => { void refresh() }}>{t('retry')}</button>
          </div>
        )}
      </section>
    )
  }

  return (
    <section className={styles['panel']} aria-label={t('title')}>
      <div className={styles['header']}>
        <div>
          <h3 className={styles['title']}>{t('title')}</h3>
          <p className={styles['intro']}>{t('intro')}</p>
        </div>
        <span className={styles['badge']}>{t('offline')}</span>
      </div>

      <div className={styles['statusRow']}>
        <span className={styles['label']}>{t('status')}</span>
        <strong className={styles['status']}>{statusCopy(snapshot.phase, t)}</strong>
      </div>

      {failure !== undefined || snapshot.error !== undefined ? (
        <div className={styles['error']} role="alert">
          <span>{failure ?? snapshot.error?.message ?? t('unavailable')}</span>
          <button type="button" className={styles['secondary']} onClick={() => { void refresh() }}>{t('retry')}</button>
        </div>
      ) : null}

      <label className={styles['field']}>
        <span className={styles['label']}>{t('model')}</span>
        <select
          value={selected?.id ?? ''}
          disabled={busy || TRANSIENT_PHASES.has(snapshot.phase)}
          onChange={(event) => {
            const modelId = event.currentTarget.value
            void run(() => client.setDefaultModel(modelId))
          }}
        >
          {snapshot.catalog.map(model => (
            <option key={model.id} value={model.id}>
              {model.displayName}{model.recommended ? ` · ${t('recommended')}` : ''}
            </option>
          ))}
        </select>
      </label>

      <label className={styles['field']}>
        <span className={styles['label']}>{t('mode')}</span>
        <select
          value={snapshot.mode}
          disabled={busy}
          onChange={(event) => {
            void run(() => client.setMode(event.currentTarget.value as PhoenixLocalModelMode))
          }}
        >
          <option value="off">{t('modeOff')}</option>
          <option value="on-demand">{t('modeOnDemand')}</option>
          <option value="always-on">{t('modeAlwaysOn')}</option>
        </select>
      </label>

      {selected === undefined ? null : (
        <div className={styles['facts']}>
          <span><b>{t('download')}:</b> {formatBytes(selected.sizeBytes)}</span>
          <span><b>{t('ram')}:</b> {formatBytes(selected.estimatedRamBytes)}</span>
          <span><b>{t('context')}:</b> {selected.contextWindow.toLocaleString()} tokens</span>
        </div>
      )}

      {snapshot.phase === 'installing' && snapshot.progress !== undefined ? (
        <div className={styles['progressBlock']}>
          <div className={styles['progressLabel']}>
            <span>{t('progress')}</span>
            <span>{percent === undefined ? formatBytes(snapshot.progress.receivedBytes) : `${percent}%`}</span>
          </div>
          {percent === undefined ? null : <progress value={percent} max={100} className={styles['progress']} />}
        </div>
      ) : null}

      <div className={styles['actions']}>
        {!installed ? (
          <button
            type="button"
            className={styles['primary']}
            disabled={busy || selected === undefined || snapshot.phase === 'installing'}
            onClick={() => {
              if (selected !== undefined) void run(() => client.install(selected.id), 'installing')
            }}
          >{snapshot.phase === 'installing' ? t('installing') : t('install')}</button>
        ) : null}

        {installed && snapshot.phase !== 'running' ? (
          <button
            type="button"
            className={styles['primary']}
            disabled={busy || snapshot.mode === 'off' || TRANSIENT_PHASES.has(snapshot.phase)}
            onClick={() => { void run(() => client.start(), 'starting') }}
          >{snapshot.phase === 'starting' ? t('starting') : t('start')}</button>
        ) : null}

        {snapshot.phase === 'running' ? (
          <button
            type="button"
            className={styles['secondary']}
            disabled={busy}
            onClick={() => { void run(() => client.stop(), 'stopping') }}
          >{t('stop')}</button>
        ) : null}

        {installed ? (
          <button
            type="button"
            className={styles['danger']}
            disabled={busy || TRANSIENT_PHASES.has(snapshot.phase)}
            onClick={() => { setConfirmUninstall(true) }}
          >{t('uninstall')}</button>
        ) : null}
      </div>

      {confirmUninstall && selected !== undefined ? (
        <div className={styles['confirm']} role="alertdialog" aria-label={t('uninstallQuestion')}>
          <p>{t('uninstallQuestion')}</p>
          <div className={styles['actions']}>
            <button type="button" className={styles['secondary']} onClick={() => { setConfirmUninstall(false) }}>{t('cancel')}</button>
            <button
              type="button"
              className={styles['danger']}
              onClick={() => {
                setConfirmUninstall(false)
                void run(() => client.uninstall(selected.id))
              }}
            >{t('uninstallConfirm')}</button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
