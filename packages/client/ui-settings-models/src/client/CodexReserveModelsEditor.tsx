/**
 * OpenAI Codex live-catalog status and user-enabled reserve model controls.
 *
 * The normal selector catalog is never persisted here: Codex app-server owns
 * it. Settings stores only an ordered reserve id list, and this editor only
 * offers ids returned by the current live discovery response.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@phoenix-ai/dsh-api-remotes/client'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

interface Probe {
  settingsNs: string
  provider: string
  baseURL?: string
  api?: string
  apiKey?: string
}

export interface CodexReserveModelsEditorProps {
  reserveModels: readonly string[]
  onChange: (models: string[]) => void
  probe: Probe
  api: Pick<IApiClient, 'llm'>
  t: (key: keyof typeof en) => string
  disabled: boolean
}

/** Render live Codex models and let the user opt specific live ids into reserve failover. */
export function CodexReserveModelsEditor(props: CodexReserveModelsEditorProps): ReactNode {
  const { reserveModels, onChange, probe, api, t, disabled } = props
  const [models, setModels] = useState<readonly { id: string; name?: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const refresh = async (): Promise<void> => {
    setLoading(true)
    setFailure(undefined)
    try {
      const response = await api.llm.discoverModels({
        settingsNs: probe.settingsNs,
        provider: probe.provider,
        ...(probe.baseURL === undefined ? {} : { baseURL: probe.baseURL }),
        ...(probe.api === undefined ? {} : { api: probe.api }),
        ...(probe.apiKey === undefined ? {} : { apiKey: probe.apiKey }),
      })
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      const live = response.result.value.models.map(model => ({
        id: model.id,
        ...(model.name === undefined ? {} : { name: model.name }),
      }))
      setModels(live)

      // A reserve retired upstream stops being operational immediately. Prune
      // it from the draft too so the next Apply cleans legacy settings.
      const liveIds = new Set(live.map(model => model.id))
      const pruned = reserveModels.filter(id => liveIds.has(id))
      if (pruned.length !== reserveModels.length) onChange(pruned)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // The probe identifies the account-scoped Codex route; refresh on a route
    // change, while explicit button presses cover same-route rechecks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe.settingsNs, probe.provider])

  const toggle = (id: string): void => {
    onChange(reserveModels.includes(id)
      ? reserveModels.filter(model => model !== id)
      : [...reserveModels, id])
  }

  return (
    <section className={styles['modelCatalog']} aria-label={t('codexReserveModels')}>
      <div className={styles['modelListHead']}>
        <div className={styles['modelCatalogHeading']}>
          <span className={styles['modelCatalogTitle']}>{t('codexCatalogLive')}</span>
          <span className={styles['modelCatalogMeta']}>{t('codexCatalogAutomatic')}</span>
        </div>
        <button
          type="button"
          className={styles['linkButton']}
          disabled={disabled || loading}
          onClick={() => { void refresh() }}
        >
          {loading ? t('codexRefreshingModels') : t('codexRefreshModels')}
        </button>
      </div>
      <p className={styles['advancedHint']}>{t('codexCatalogLiveHint')}</p>
      <span className={styles['fieldLabel']}>{t('codexReserveModels')}</span>
      <p className={styles['advancedHint']}>{t('codexReserveHint')}</p>
      {failure === undefined ? null : <p className={styles['error']}>{failure}</p>}
      {!loading && models.length === 0 && failure === undefined
        ? <p className={styles['advancedHint']}>{t('codexNoLiveModels')}</p>
        : null}
      {models.length === 0 ? null : (
        <ul className={styles['candidateList']}>
          {models.map(model => (
            <li key={model.id} className={styles['candidate']}>
              <label className={styles['candidateLabel']}>
                <input
                  type="checkbox"
                  checked={reserveModels.includes(model.id)}
                  disabled={disabled}
                  onChange={() => { toggle(model.id) }}
                />
                <span>
                  {model.name === undefined || model.name === model.id ? model.id : model.name}
                  {model.name === undefined || model.name === model.id
                    ? null
                    : <span className={styles['candidateId']}>{model.id}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
