import { useEffect, useState, type ReactNode } from 'react'
import type {
  ClawHubCatalogItem, ClawHubCatalogRequest, ClawHubCatalogSnapshot, ClawHubFamily,
  ClawHubInstallReceipt, ClawHubInstallRequest, ClawHubState,
} from '@phoenix-ai/dsh-api-remotes/client'
import type { PluginInventoryLocaleKey } from './locales.ts'
import type { PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
import css from './PluginInventorySettingsTab.module.css'

export interface ClawHubMarketplaceInjected {
  browseClawHub: (request: ClawHubCatalogRequest) => Promise<ClawHubCatalogSnapshot>
  readClawHubState: () => Promise<ClawHubState>
  installClawHubSkill: (request: ClawHubInstallRequest) => Promise<ClawHubInstallReceipt>
}

export type ClawHubMarketplaceProps = ClawHubMarketplaceInjected & {
  t: PluginInventorySettingsTabProps['t']
}

const FAMILIES: readonly ClawHubFamily[] = ['skill', 'code-plugin', 'bundle-plugin']

/** Browses public metadata, without starting a Gateway or executing native packages. */
export function ClawHubMarketplace({ browseClawHub, readClawHubState, installClawHubSkill, t }: ClawHubMarketplaceProps): ReactNode {
  const [family, setFamily] = useState<ClawHubFamily>('skill')
  const [onlyOfficial, setOnlyOfficial] = useState(false)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [reload, setReload] = useState(0)
  const [state, setState] = useState<ClawHubState | undefined>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [entries, setEntries] = useState<readonly ClawHubCatalogItem[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    void readClawHubState().then(value => { if (active) setState(value) }, () => { if (active) setState(undefined) })
    return () => { active = false }
  }, [readClawHubState, reload])

  useEffect(() => {
    let active = true
    setStatus('loading')
    const request: ClawHubCatalogRequest = {
      family, query,
      ...(onlyOfficial ? { officialOnly: true } : {}),
      limit: 12,
    }
    void browseClawHub(request).then(
      result => {
        if (active) {
          setEntries(result.items)
          setStatus('ready')
        }
      },
      () => {
        if (active) {
          setEntries([])
          setStatus('error')
        }
      },
    )
    return () => { active = false }
  }, [browseClawHub, family, onlyOfficial, query, reload])

  const install = (item: ClawHubCatalogItem): void => {
    if (item.family !== 'skill' || state?.cli === 'missing' || busy !== null) return
    setBusy(item.name)
    setNotice('')
    void installClawHubSkill({ name: item.name, family: 'skill' }).then(
      () => {
        setNotice(t('clawInstalled'))
        setReload(value => value + 1)
      },
      () => { setNotice(t('clawInstallError')) },
    ).finally(() => { setBusy(null) })
  }

  const familyLabel = (value: ClawHubFamily): string => value === 'skill' ? t('clawSkills')
    : value === 'code-plugin' ? t('clawCodePlugins') : t('clawBundlePlugins')
  return (
    <section className={css.catalog} aria-label={t('clawCatalogTitle')}>
      <div className={css.catalogHeading}>
        <h3>{t('clawCatalogTitle')}</h3>
        <span>{t('clawLiveCatalog')}</span>
      </div>
      <p className={css.status}>{t('clawCatalogDescription')}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FAMILIES.map(value => (
          <button key={value} type="button" aria-pressed={family === value}
            onClick={() => { setFamily(value); setQuery(''); setInput(''); setOnlyOfficial(value !== 'skill') }}
            style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid var(--dsw-alias-border-l2)',
              background: family === value ? 'var(--dsw-alias-bg-layer-3)' : 'transparent', color: 'inherit' }}>
            {familyLabel(value)}
          </button>
        ))}
        {family === 'skill' ? null : (
          <label className={css.status}>
            <input type="checkbox" checked={onlyOfficial}
              onChange={event => { setOnlyOfficial(event.currentTarget.checked) }} /> {t('clawOfficialOnly')}
          </label>
        )}
      </div>
      <form onSubmit={event => { event.preventDefault(); setQuery(input.trim()) }}
        style={{ display: 'flex', gap: 8 }}>
        <input type="search" aria-label={t('clawSearch')} placeholder={t('clawSearch')}
          value={input} maxLength={80} onChange={event => { setInput(event.currentTarget.value) }}
          style={{ flex: 1, minWidth: 0, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-bg-layer-1)', color: 'inherit', padding: '8px 10px' }} />
        <button type="submit">{t('clawSearchButton')}</button>
        <button type="button" onClick={() => { setReload(value => value + 1) }}>{t('retry')}</button>
      </form>
      {state?.cli === 'missing' ? <p className={css.status}>{t('clawCliMissing')}</p> : null}
      {status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {status === 'error' ? <p role="alert" className={css.status}>{t('clawCatalogUnavailable')}</p> : null}
      {status === 'ready' && entries.length === 0 ? <p className={css.status}>{t('clawNoResults')}</p> : null}
      {notice ? <p role="status" className={css.status}>{notice}</p> : null}
      {status === 'ready' ? (
        <ul className={css.cards}>
          {entries.map(item => (
            <li className={css.card} key={item.family + '/' + item.name}>
              <div className={css.cardContent} style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 5 }}>
                <strong className={css.cardTitle} title={item.name}>{item.displayName}</strong>
                <span className={css.status}>{item.name}{item.version === '—' ? '' : ' · ' + item.version}</span>
                {item.official ? <span className={css.configTag}>{t('clawOfficial')}</span> : null}
                <p className={css.status}>{item.description}</p>
                {item.family === 'skill' ? (
                  <button type="button" disabled={item.installed || busy !== null || state?.cli === 'missing'}
                    onClick={() => { install(item) }}>
                    {item.installed ? t('clawInstalledLabel') : busy === item.name ? t('loading') : t('clawInstall')}
                  </button>
                ) : <span className={css.status}>{t('clawPluginUnavailable')}</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <p className={css.status}>{t('clawCatalogWarning')}</p>
    </section>
  )
}
