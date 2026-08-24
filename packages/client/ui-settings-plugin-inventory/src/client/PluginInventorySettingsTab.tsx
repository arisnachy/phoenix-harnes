import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { IconChevronDownOutline14, IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

export interface PluginInventorySettingsTabInjected {
  list: () => Promise<PluginInventorySnapshot>
}

type PluginInventoryEntry = PluginInventorySnapshot['entries'][number]
type CodexEntry = NonNullable<PluginInventorySnapshot['codex']>['plugins'][number]
type PluginFiberPhase = PluginInventoryEntry['fiberPhase']
type UpdatePhase = PluginInventorySnapshot['runtime']['update']['phase']

export type PluginInventorySettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginInventorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

const PHASE_KEYS = {
  pending: 'pending', loading: 'loadingPhase', active: 'active', failed: 'failed', unloading: 'unloading',
} satisfies Record<Exclude<PluginFiberPhase, null>, PluginInventoryLocaleKey>

const UPDATE_KEYS: Partial<Record<UpdatePhase, PluginInventoryLocaleKey>> = {
  available: 'updateAvailable', downloading: 'downloading', preparing: 'preparing',
  'ready-restart': 'readyRestart', installing: 'installing', restarting: 'restarting',
  'rolled-back': 'rolledBack', error: 'updateError', updated: 'upToDate', idle: 'upToDate',
}

function phaseLabel(phase: PluginFiberPhase, t: PluginInventorySettingsTabProps['t']): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped.replace(/^cordis:/, '').replace(/^cordis-plugin-/, '').replace(/^dsh-(?:host-|client-)?/, '')
}

function matchesLoader(entry: PluginInventoryEntry, query: string): boolean {
  return query.length === 0 || [entry.moduleName, entry.entryId].some(value => value.toLocaleLowerCase().includes(query))
}

function matchesCodex(entry: CodexEntry, query: string): boolean {
  return query.length === 0 || [entry.name, entry.description, entry.category, ...entry.surfaces]
    .some(value => value.toLocaleLowerCase().includes(query))
}

function shortSha(value: string): string {
  return value === 'unknown' ? value : value.slice(0, 12)
}

/** Graphical PHOENIX runtime, update progress, Codex arsenal, and loader inventory. */
export function PluginInventorySettingsTab({ list, t }: PluginInventorySettingsTabProps): ReactNode {
  const catalogId = useId()
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    let inFlight = false
    const load = (): void => {
      if (inFlight) return
      inFlight = true
      void Promise.resolve().then(() => list()).then(
        (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
        () => { if (current) setState({ status: 'error' }) },
      ).finally(() => { inFlight = false })
    }
    load()
    // The updater is a separate process; lightweight polling lets the Settings
    // page behave like Codex and visibly move through download → ready → restart.
    const timer = window.setInterval(load, 1_500)
    return () => { current = false; window.clearInterval(timer) }
  }, [list, request])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = useMemo(() => state.status === 'ready'
    ? state.snapshot.entries.filter(entry => matchesLoader(entry, normalizedQuery)) : [], [normalizedQuery, state])
  const filteredCodex = useMemo(() => state.status === 'ready' && state.snapshot.codex !== null
    ? state.snapshot.codex.plugins.filter(entry => matchesCodex(entry, normalizedQuery)) : [], [normalizedQuery, state])

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}><p role="alert">{t('error')}</p><button type="button" onClick={retry}>{t('retry')}</button></div>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <RuntimeCard snapshot={state.snapshot} t={t} />
          <label className={css.search}>
            <IconSearchOutline16 aria-hidden="true" />
            <span className={css.visuallyHidden}>{t('search')}</span>
            <input type="search" value={query} placeholder={t('search')} aria-label={t('search')} onChange={(event) => { setQuery(event.currentTarget.value) }} />
          </label>

          <div className={css.catalog}>
            <div className={css.catalogHeading}><h3>{t('codex')}</h3><span>{filteredCodex.length}</span></div>
            {state.snapshot.codex === null ? <p className={css.status}>{t('codexEmpty')}</p> : null}
            {state.snapshot.codex !== null ? (
              <>
                <div className={css.metaLine}>
                  <span>{t('sourceCommit')}: <code>{shortSha(state.snapshot.codex.sourceCommit)}</code></span>
                  <span>{t('syncedAt')}: {state.snapshot.codex.syncedAt}</span>
                </div>
                {filteredCodex.length === 0 ? <p className={css.status}>{t('emptySearch')}</p> : (
                  <ul className={css.cards}>
                    {filteredCodex.map(entry => (
                      <CodexCard key={entry.name} entry={entry} open={expanded === `codex:${entry.name}`} detailId={`${catalogId}-codex-${encodeURIComponent(entry.name)}`} t={t} toggle={() => { setExpanded(current => current === `codex:${entry.name}` ? null : `codex:${entry.name}`) }} />
                    ))}
                  </ul>
                )}
              </>
            ) : null}
          </div>

          <div className={css.catalog}>
            <div className={css.catalogHeading}><h3>{t('catalog')}</h3><span data-plugin-count={filteredEntries.length}>{filteredEntries.length}</span></div>
            {state.snapshot.entries.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
            {state.snapshot.entries.length > 0 && filteredEntries.length === 0 ? <p className={css.status}>{t('emptySearch')}</p> : null}
            {filteredEntries.length > 0 ? (
              <ul className={css.cards}>
                {filteredEntries.map(entry => {
                  const status = phaseLabel(entry.fiberPhase, t)
                  const title = moduleShortName(entry.moduleName)
                  const configuration = t(entry.enabled ? 'enabledTag' : 'disabledTag')
                  const key = `loader:${entry.entryId}`
                  const open = expanded === key
                  const detailId = `${catalogId}-details-${encodeURIComponent(entry.entryId)}`
                  return (
                    <li className={css.card} key={entry.entryId} data-plugin-entry={entry.entryId} data-open={open ? 'true' : undefined}>
                      <button className={css.cardContent} type="button" aria-expanded={open} aria-controls={detailId} onClick={() => { setExpanded(current => current === key ? null : key) }}>
                        <strong className={css.cardTitle} title={entry.moduleName}>{title}</strong>
                        <span className={css.cardTrailing}>
                          {entry.enabled ? <span className={css.statusDot} data-phase={entry.fiberPhase ?? 'unobserved'} role="img" aria-label={status} title={status} /> : null}
                          <span className={css.configTag} data-enabled={entry.enabled ? 'true' : 'false'}>{configuration}</span>
                          <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
                        </span>
                      </button>
                      {open ? (
                        <div className={css.cardDetails} id={detailId}>
                          <code className={css.entryValue}>{entry.entryId}</code>
                          <dl className={css.details}>
                            <div><dt>{t('configuration')}</dt><dd>{configuration}</dd></div>
                            {entry.enabled ? <div><dt>{t('cordis')}</dt><dd>{status}</dd></div> : null}
                          </dl>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

function RuntimeCard({ snapshot, t }: { snapshot: PluginInventorySnapshot; t: PluginInventorySettingsTabProps['t'] }): ReactNode {
  const update = snapshot.runtime.update
  const key = UPDATE_KEYS[update.phase] ?? 'upToDate'
  const busy = ['available', 'downloading', 'preparing', 'ready-restart', 'installing', 'restarting'].includes(update.phase)
  return (
    <section className={css.systemCard} data-update-phase={update.phase}>
      <div className={css.systemHeader}>
        <div><strong>{t('system')}</strong><span>{snapshot.runtime.version}</span></div>
        <span className={css.systemStatus} data-busy={busy ? 'true' : undefined}>{t(key)}</span>
      </div>
      <dl className={css.systemGrid}>
        <div><dt>{t('version')}</dt><dd>{snapshot.runtime.version}</dd></div>
        <div><dt>{t('build')}</dt><dd><code>{shortSha(snapshot.runtime.buildSha)}</code></dd></div>
        <div><dt>{t('channel')}</dt><dd>{snapshot.runtime.channel}</dd></div>
      </dl>
      {busy || update.phase === 'rolled-back' || update.phase === 'error' ? (
        <div className={css.updatePanel} role="status" aria-live="polite">
          <div className={css.updateMessage}><span>{t(key)}</span>{update.progress !== undefined ? <strong>{Math.round(update.progress)}%</strong> : null}</div>
          {update.progress !== undefined ? <progress max={100} value={update.progress}>{update.progress}%</progress> : null}
          {update.message !== undefined ? <p>{update.message}</p> : null}
        </div>
      ) : null}
    </section>
  )
}

function CodexCard({ entry, open, detailId, t, toggle }: { entry: CodexEntry; open: boolean; detailId: string; t: PluginInventorySettingsTabProps['t']; toggle: () => void }): ReactNode {
  return (
    <li className={css.card} data-open={open ? 'true' : undefined}>
      <button className={css.cardContent} type="button" aria-expanded={open} aria-controls={detailId} onClick={toggle}>
        <span className={css.codexTitle}><strong className={css.cardTitle}>{entry.name}</strong><small>{entry.version}</small></span>
        <span className={css.cardTrailing}>
          {entry.mcpServers.length > 0 ? <span className={css.configTag} data-enabled={entry.mcpEnabled ? 'true' : 'false'}>{t(entry.mcpEnabled ? 'mcpOn' : 'mcpOff')}</span> : null}
          <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
        </span>
      </button>
      {open ? (
        <div className={css.cardDetails} id={detailId}>
          {entry.description.length > 0 ? <p className={css.description}>{entry.description}</p> : null}
          <dl className={css.details}>
            <div><dt>{t('skills')}</dt><dd>{entry.skillCount}</dd></div>
            <div><dt>{t('mcp')}</dt><dd>{entry.mcpServers.length > 0 ? entry.mcpServers.join(', ') : '—'}</dd></div>
            <div><dt>{t('surfaces')}</dt><dd>{entry.surfaces.join(', ') || '—'}</dd></div>
            <div><dt>{t('credentials')}</dt><dd>{entry.requiredEnv.join(', ') || '—'}</dd></div>
          </dl>
        </div>
      ) : null}
    </li>
  )
}
