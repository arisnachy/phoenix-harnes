import { useEffect, useState, type ReactNode } from 'react'
import type { OpenClawRuntimeSnapshot } from '@phoenix-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

export interface OpenClawRuntimeInjected {
  readOpenClawRuntime: () => Promise<OpenClawRuntimeSnapshot>
}

export type OpenClawRuntimeSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<OpenClawRuntimeInjected>

/** Compact, truthful readiness display. Never calls browser capture or plugin activation. */
export function OpenClawRuntimeSettingsTab({ readOpenClawRuntime, t }: OpenClawRuntimeSettingsTabProps): ReactNode {
  const [refresh, setRefresh] = useState(0)
  const [snapshot, setSnapshot] = useState<OpenClawRuntimeSnapshot | null>(null)
  const [failure, setFailure] = useState(false)
  useEffect(() => {
    let active = true
    void readOpenClawRuntime().then(
      value => { if (active) { setSnapshot(value); setFailure(false) } },
      () => { if (active) setFailure(true) },
    )
    return () => { active = false }
  }, [readOpenClawRuntime, refresh])

  const checks = snapshot === null ? [] : [
    { id: 'gateway', label: t('ocGateway'), value: snapshot.gateway },
    { id: 'browser', label: t('ocBrowser'), value: snapshot.browser },
    { id: 'plugins', label: t('ocPlugins'), value: snapshot.plugins },
    { id: 'channels', label: t('ocChannels'), value: snapshot.channels },
  ] as const

  const status = (value: OpenClawRuntimeSnapshot['gateway']): string => {
    if (value === 'not-installed') return t('ocMissing')
    return value === 'responded' ? t('ocResponded') : t('ocUnavailable')
  }
  return (
    <section className={css.section} aria-busy={snapshot === null && !failure}>
      <div className={css.catalogHeading}>
        <h3>{t('ocHeading')}</h3>
        <button type="button" onClick={() => { setSnapshot(null); setFailure(false); setRefresh(n => n + 1) }}>
          {t('retry')}
        </button>
      </div>
      <p className={css.status}>{t('ocDescription')}</p>
      {failure ? <p role="alert" className={css.failure}>{t('ocError')}</p> : null}
      {snapshot === null && !failure ? <p className={css.status}>{t('loading')}</p> : null}
      {snapshot !== null ? (
        <>
          <p className={css.status}>{snapshot.installed ? t('ocInstalled') : t('ocMissing')}</p>
          <ul className={css.cards}>
            {checks.map(check => (
              <li key={check.id} className={css.card}>
                <div className={css.cardContent}>
                  <strong className={css.cardTitle}>{check.label}</strong>
                  <span className={css.configTag} data-enabled={check.value === 'responded' ? 'true' : 'false'}>
                    {status(check.value)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <p className={css.status}>{t('ocDisclaimer')}</p>
        </>
      ) : null}
    </section>
  )
}
