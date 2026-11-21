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
  readonly backend?: 'ollama' | 'llama-server'
  readonly sizeBytes: number
  readonly estimatedRamBytes: number
  readonly contextWindow: number
  readonly nativeContextWindow?: number
  readonly maxTokens: number
  readonly recommended: boolean
}

export interface PhoenixLocalModelSnapshot {
  readonly thinking?: boolean | string | null
  readonly thinkingCapabilities?: { readonly values: readonly (boolean | string)[]; readonly default: boolean | string | null }
  readonly mode: PhoenixLocalModelMode
  readonly selectedModelId: string
  readonly installedModelIds: readonly string[]
  readonly ollamaInstalledModelIds?: readonly string[]
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
  /** Explicit permanent removal from the Ollama daemon, not a Phoenix unlink. */
  removeFromOllama?(modelId: string): Promise<PhoenixLocalModelSnapshot>
  setMode(mode: PhoenixLocalModelMode): Promise<PhoenixLocalModelSnapshot>
  setDefaultModel(modelId: string): Promise<PhoenixLocalModelSnapshot>
  setThinking(value: boolean | string | null): Promise<PhoenixLocalModelSnapshot>
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
  const [confirmOllamaDelete, setConfirmOllamaDelete] = useState(false)
  const [ollamaTag, setOllamaTag] = useState('')

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
  const inOllama = selected?.backend === 'ollama'
    && snapshot?.ollamaInstalledModelIds?.includes(selected.id) === true
  const outputBudget = selected === undefined ? 0
    : Math.min(selected.maxTokens, Math.max(1, Math.floor(selected.contextWindow / 4)))
  const inputBudget = selected === undefined ? 0
    : Math.max(0, selected.contextWindow - outputBudget
      - Math.min(2_048, Math.floor(selected.contextWindow / 4)))
  const modes = snapshot?.thinkingCapabilities?.values ?? []
  const activeThinking = snapshot?.thinking ?? null
  const thinkingKey = activeThinking === null ? 'default'
    : typeof activeThinking === 'boolean' ? `boolean:${String(activeThinking)}` : `level:${activeThinking}`
  const supportedKeys = new Set(modes.map(value => typeof value === 'boolean'
    ? `boolean:${String(value)}` : `level:${value}`))

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
            setConfirmUninstall(false)
            setConfirmOllamaDelete(false)
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

      <div className={styles['ollamaPicker']}>
        <label className={styles['field']}>
          <span className={styles['label']}>{t('ollamaTag')}</span>
          <input type="text" value={ollamaTag} autoComplete="off"
            placeholder="gemma4:e2b"
            disabled={busy || TRANSIENT_PHASES.has(snapshot.phase)}
            onChange={event => { setOllamaTag(event.currentTarget.value) }} />
        </label>
        <button type="button" className={styles['secondary']}
          disabled={busy || !/^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,159}$/u.test(ollamaTag.trim())}
          onClick={() => {
            const tag = ollamaTag.trim()
            void run(() => client.install(`ollama:${tag}`), 'installing')
          }}>{t('ollamaPull')}</button>
        <button type="button" className={styles['secondary']} disabled={busy}
          onClick={() => { void refresh() }}>{t('ollamaRefresh')}</button>
      </div>
      <p className={styles['muted']}>{t('ollamaTagHint')}</p>
      {selected === undefined ? null : (
        <div className={styles['facts']}>
          <span><b>{t('download')}:</b> {selected.backend === 'ollama' ? inOllama ? t('ollamaExisting') : t('ollamaNotDownloaded') : formatBytes(selected.sizeBytes)}</span>
          <span><b>{t('ram')}:</b> {formatBytes(selected.estimatedRamBytes)}</span>
          <span><b>{t('context')}:</b> {selected.contextWindow.toLocaleString()} tokens</span>
          <span><b>{t('inputBudget')}:</b> {inputBudget.toLocaleString()} tokens</span>
          <span><b>{t('outputBudget')}:</b> {outputBudget.toLocaleString()} tokens</span>
        </div>
      )}

      {selected?.backend === 'ollama' ? (
        <>
          <label className={styles['field']}>
            <span className={styles['label']}>{t('thinking')}</span>
            <select
              value={supportedKeys.has(thinkingKey) ? thinkingKey : 'default'}
              disabled={busy || modes.length === 0}
              onChange={event => {
                const key = event.currentTarget.value
                const value = key === 'default' ? null
                  : key === 'boolean:true' ? true
                    : key === 'boolean:false' ? false : key.slice('level:'.length)
                void run(() => client.setThinking(value))
              }}
            >
              <option value="default">{t('thinkingDefault')}</option>
              {modes.map(value => (
                <option key={String(value)} value={typeof value === 'boolean'
                  ? `boolean:${String(value)}` : `level:${value}`}>
                  {value === true ? t('thinkingOn') : value === false ? t('thinkingOff') : value}
                </option>
              ))}
            </select>
          </label>
          <p className={styles['muted']}>
            {modes.length === 0 ? t('thinkingUnavailable') : t('thinkingDetected')}
          </p>
          {selected.nativeContextWindow !== undefined ? (
            <p className={styles['muted']}>{t('nativeContext')}: {selected.nativeContextWindow.toLocaleString()} tokens</p>
          ) : null}
          <p className={styles['muted']}>{t('ollamaLiteMode')}</p>
        </>
      ) : null}

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
          >{snapshot.phase === 'installing' ? t('installing') : selected?.backend === 'ollama' ? inOllama ? t('connectOllama') : t('ollamaPull') : t('install')}</button>
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
          >{selected.backend === 'ollama' ? t('disconnectOllama') : t('uninstall')}</button>
        ) : null}
      </div>

      {selected?.backend === 'ollama' && inOllama && client.removeFromOllama !== undefined ? (
        <div className={styles['actions']}>
          <button type="button" className={styles['danger']}
            disabled={busy || TRANSIENT_PHASES.has(snapshot.phase)}
            onClick={() => { setConfirmOllamaDelete(true) }}>{t('ollamaDelete')}</button>
        </div>
      ) : null}
      {confirmOllamaDelete && selected?.backend === 'ollama' ? (
        <div role="alertdialog" className={styles['confirm']} aria-label={t('ollamaDelete')}>
          <p>{t('ollamaDeleteQuestion').replace('{model}', selected.displayName)}</p>
          <div className={styles['actions']}>
            <button type="button" className={styles['secondary']}
              onClick={() => { setConfirmOllamaDelete(false) }}>{t('cancel')}</button>
            <button type="button" className={styles['danger']} disabled={busy}
              onClick={() => {
                setConfirmOllamaDelete(false)
                if (client.removeFromOllama !== undefined) void run(() => client.removeFromOllama!(selected.id))
              }}>{t('ollamaDeleteConfirm')}</button>
          </div>
        </div>
      ) : null}
      {confirmUninstall && selected !== undefined ? (
        <div className={styles['confirm']} role="alertdialog" aria-label={t('uninstallQuestion')}>
          <p>{selected.backend === 'ollama' ? t('disconnectOllamaQuestion') : t('uninstallQuestion')}</p>
          <div className={styles['actions']}>
            <button type="button" className={styles['secondary']} onClick={() => { setConfirmUninstall(false) }}>{t('cancel')}</button>
            <button
              type="button"
              className={styles['danger']}
              onClick={() => {
                setConfirmUninstall(false)
                void run(() => client.uninstall(selected.id))
              }}
            >{selected.backend === 'ollama' ? t('disconnectOllama') : t('uninstallConfirm')}</button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
