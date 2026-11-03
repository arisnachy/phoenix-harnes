import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { PluginBulkActivationReceipt, PluginEnableRequest, PluginInventorySnapshot } from '@phoenix-ai/dsh-api-remotes/client'
import {
  IconChevronDownOutline14,
  IconSearchOutline16,
} from '@phoenix-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

/** Registration-side Remote face used by the section. */
export interface PluginInventorySettingsTabInjected {
  /** Read a current Host inventory snapshot. */
  list: () => Promise<PluginInventorySnapshot>
  /** Update a configured plugin through the real Host Loader. */
  setPluginEnabled?: (request: PluginEnableRequest) => Promise<PluginInventoryEntry>
  /** Activate configured plugins and install the trusted curated MCP pack. */
  activateAvailablePlugins?: () => Promise<PluginBulkActivationReceipt>
}

type PluginInventoryEntry = PluginInventorySnapshot['entries'][number]
type PluginFiberPhase = PluginInventoryEntry['fiberPhase']

/** Full component props assembled by the Settings slot renderer. */
export type PluginInventorySettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginInventorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

const PHASE_KEYS = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
} satisfies Record<Exclude<PluginFiberPhase, null>, PluginInventoryLocaleKey>

/** Localized accessible label for one root Fiber phase. */
function phaseLabel(
  phase: PluginFiberPhase,
  t: PluginInventorySettingsTabProps['t'],
): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/** Whether an inventory row matches the local catalog query. */
function matches(entry: PluginInventoryEntry, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [entry.moduleName, entry.entryId]
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/** Render actionable Loader state without confusing installed plugins with catalog entries. */
export function PluginInventorySettingsTab({ list, setPluginEnabled, activateAvailablePlugins, t }: PluginInventorySettingsTabProps): ReactNode {
  const catalogId = useId()
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  // The select is controlled: keep the user's choice visible while its Host
  // update is pending instead of instantly snapping back to the old snapshot.
  const [pendingSelection, setPendingSelection] = useState<Record<string, boolean>>({})
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = useMemo(
    () => state.status === 'ready'
      ? state.snapshot.entries.filter(entry => matches(entry, normalizedQuery))
      : [],
    [normalizedQuery, state],
  )

  useEffect(() => {
    if (expanded !== null && !filteredEntries.some(entry => entry.entryId === expanded)) {
      setExpanded(null)
    }
  }, [expanded, filteredEntries])

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  const refreshSnapshot = (): void => {
    void list().then(
      snapshot => { setState({ status: 'ready', snapshot }) },
      () => { setNotice(t('error')) },
    )
  }

  const changePlugin = (entry: PluginInventoryEntry, enabled: boolean): void => {
    if (setPluginEnabled === undefined || busy !== null) return
    setBusy(entry.entryId)
    setPendingSelection(previous => ({ ...previous, [entry.entryId]: enabled }))
    setNotice('')
    void setPluginEnabled({ entryId: entry.entryId, enabled }).then(
      updated => {
        setState(current => current.status !== 'ready' ? current : {
          status: 'ready',
          snapshot: {
            entries: current.snapshot.entries.map(item => item.entryId === updated.entryId ? updated : item),
          },
        })
        setNotice(updated.enabled === enabled ? t('pluginChanged') : t('pluginChangeFailed'))
        refreshSnapshot()
      },
      error => {
        const detail = error instanceof Error ? error.message.slice(0, 180) : ''
        setNotice(`${t('pluginChangeFailed')} (${entry.entryId})${detail ? ': ' + detail : ''}`)
      },
    ).finally(() => {
      setPendingSelection(previous => {
        const next = { ...previous }
        delete next[entry.entryId]
        return next
      })
      setBusy(null)
    })
  }

  const activateAll = (): void => {
    if (activateAvailablePlugins === undefined || busy !== null) return
    setBusy('all')
    setNotice('')
    void activateAvailablePlugins().then(
      result => {
        const needsAttention = result.skipped.length + result.failed.length + result.curatedFailed.length
        const examples = [...result.failed, ...result.skipped, ...result.curatedFailed].slice(0, 4).join(', ')
        setNotice(`${t('bulkComplete')}: ${result.activated.length} ${t('bulkActivated')}, ${result.curatedInstalled} ${t('bulkInstalled')}, ${needsAttention} ${t('bulkNeedsAttention')}${examples ? ' (' + examples + ')' : ''}.`)
        refreshSnapshot()
      },
      error => {
        const detail = error instanceof Error ? error.message.slice(0, 180) : ''
        setNotice(`${t('bulkFailed')}${detail ? ' ' + detail : ''}`)
      },
    ).finally(() => { setBusy(null) })
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className={css.catalog}>
          <label className={css.search}>
            <IconSearchOutline16 aria-hidden="true" />
            <span className={css.visuallyHidden}>{t('search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('search')}
              aria-label={t('search')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
          </label>
          <div className={css.catalogHeading}>
            <h3>{t('catalog')}</h3>
            <span data-plugin-count={filteredEntries.length}>{filteredEntries.length}</span>
            {activateAvailablePlugins === undefined ? null : (
              <button type="button" className={css.bulkButton}
                disabled={busy !== null} onClick={activateAll}>
                {busy === 'all' ? t('bulkBusy') : t('bulkAction')}
              </button>
            )}
          </div>
          {activateAvailablePlugins === undefined ? null : <p className={css.status}>{t('bulkExplanation')}</p>}
          {notice ? <p role="status" className={css.status}>{notice}</p> : null}
          {state.snapshot.entries.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
          {state.snapshot.entries.length > 0 && filteredEntries.length === 0
            ? <p className={css.status}>{t('emptySearch')}</p>
            : null}
          {filteredEntries.length > 0 ? (
            <ul className={css.cards}>
              {filteredEntries.map((entry) => {
                const status = phaseLabel(entry.fiberPhase, t)
                const title = moduleShortName(entry.moduleName)
                const configuration = t(entry.enabled ? 'enabledTag' : 'disabledTag')
                const open = expanded === entry.entryId
                const detailId = `${catalogId}-details-${encodeURIComponent(entry.entryId)}`
                return (
                  <li
                    className={css.card}
                    key={entry.entryId}
                    data-plugin-entry={entry.entryId}
                    data-open={open ? 'true' : undefined}
                  >
                    <div className={css.cardHeader}>
                    <button
                      className={css.cardContent}
                      type="button"
                      aria-expanded={open}
                      aria-controls={detailId}
                      aria-label={entry.enabled ? `${title}, ${status}, ${configuration}` : `${title}, ${configuration}`}
                      onClick={() => {
                        setExpanded(current => current === entry.entryId ? null : entry.entryId)
                      }}
                    >
                      <strong className={css.cardTitle} title={entry.moduleName}>{title}</strong>
                      <span className={css.cardTrailing}>
                        {entry.enabled ? (
                          <span
                            className={css.statusDot}
                            data-phase={entry.fiberPhase ?? 'unobserved'}
                            role="img"
                            aria-label={status}
                            title={status}
                          />
                        ) : null}
                        {setPluginEnabled === undefined ? (
                          <span className={css.configTag} data-enabled={entry.enabled ? 'true' : 'false'}>
                            {configuration}
                          </span>
                        ) : null}
                        <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
                      </span>
                    </button>
                    {setPluginEnabled === undefined ? null : (
                      <select className={css.pluginSelector}
                        aria-label={`${t('pluginControl')}: ${title} (${entry.entryId})`}
                        value={(pendingSelection[entry.entryId] ?? entry.enabled) ? 'on' : 'off'}
                        disabled={busy !== null || (entry.enabled && entry.moduleName.includes('plugin-inventory'))}
                        onChange={event => { changePlugin(entry, event.currentTarget.value === 'on') }}>
                        <option value="on">{t('enabledTag')}</option>
                        <option value="off">{t('disabledTag')}</option>
                      </select>
                    )}
                    </div>
                    {open ? (
                      <div className={css.cardDetails} id={detailId}>
                        <code className={css.entryValue} data-loader-entry>{entry.entryId}</code>
                        <dl className={css.details}>
                          <div>
                            <dt>{t('configuration')}</dt>
                            <dd>{configuration}</dd>
                          </div>
                          {entry.enabled ? (
                            <div>
                              <dt>{t('cordis')}</dt>
                              <dd>{status}</dd>
                            </div>
                          ) : null}
                        </dl>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
