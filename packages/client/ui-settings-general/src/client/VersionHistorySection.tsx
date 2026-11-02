/** Settings > Versions: live installed state plus published, auditable release notes. */
import { useCallback, useEffect, useState } from 'react'
import type { PhoenixUpdateSnapshot } from '@phoenix-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import { fetchPhoenixReleaseNotes, fetchPhoenixVersionHistory } from './version-history.ts'
import type { PhoenixVersionEntry } from './version-history.ts'
import css from './VersionHistorySection.module.css'

/** Host-owned update state. The browser must not infer its installed version from GitHub. */
export interface VersionHistorySectionInjected {
  readUpdateState: () => Promise<PhoenixUpdateSnapshot>
}

/** Fully composed Settings version section props. */
export type VersionHistorySectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings'>
  & InjectFace<VersionHistorySectionInjected>

/** The commit is displayed as a short, recognizable identifier, not a semver claim. */
function shortSha(value: string | undefined): string | undefined {
  return value?.slice(0, 12)
}

/** Format a validated publication time in the user's browser locale. */
function readableDate(date: string): string {
  return new Date(date).toLocaleString()
}

/**
 * Show verified local activation, remote published history and per-PR change notes.
 * @param props - injected local Host state and Settings translations.
 * @returns read-only, responsive release information.
 */
export function VersionHistorySection({ t, readUpdateState }: VersionHistorySectionProps) {
  const [update, setUpdate] = useState<PhoenixUpdateSnapshot | undefined>()
  const [updateError, setUpdateError] = useState(false)
  const [releases, setReleases] = useState<readonly PhoenixVersionEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState(false)
  const [selected, setSelected] = useState<string | undefined>()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [notesLoading, setNotesLoading] = useState<string | undefined>()

  const readLocal = useCallback(async (): Promise<void> => {
    try {
      const next = await readUpdateState()
      setUpdate(next)
      setUpdateError(false)
    } catch {
      setUpdateError(true)
    }
  }, [readUpdateState])

  const readHistory = useCallback(async (): Promise<void> => {
    setHistoryLoading(true)
    try {
      setReleases(await fetchPhoenixVersionHistory())
      setHistoryError(false)
    } catch {
      setHistoryError(true)
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    void readLocal()
    void readHistory()
    const timer = window.setInterval(() => { void readLocal() }, 10_000)
    return () => { window.clearInterval(timer) }
  }, [readLocal, readHistory])

  const selectRelease = async (release: PhoenixVersionEntry): Promise<void> => {
    if (selected === release.sha) {
      setSelected(undefined)
      return
    }
    setSelected(release.sha)
    if (notes[release.sha] !== undefined || release.prNumber === undefined) return
    setNotesLoading(release.sha)
    try {
      const description = await fetchPhoenixReleaseNotes(release.prNumber)
      setNotes(previous => ({ ...previous, [release.sha]: description ?? t('version.noNotes') }))
    } catch {
      setNotes(previous => ({ ...previous, [release.sha]: t('version.notesUnavailable') }))
    } finally {
      setNotesLoading(undefined)
    }
  }

  const inProgress = update !== undefined && ['preparing', 'ready', 'restarting', 'applying', 'rolling-back'].includes(update.status)
  const active = update?.current
  const candidate = update?.target
  const previous = update?.previous
  const stable = releases[0]?.sha

  return (
    <div className={css.root} data-phoenix-version-history="true">
      <div className={css.heading}>
        <div>
          <div className={css.title}>{t('version.heading')}</div>
          <p className={css.subtitle}>{t('version.description')}</p>
        </div>
        <button className={css.refresh} type="button" onClick={() => { void readLocal(); void readHistory() }}>
          {t('version.refresh')}
        </button>
      </div>

      <section className={css.panel} aria-label={t('version.installed')}>
        <div className={css.key}>{t('version.installed')}</div>
        <div className={css.version} data-testid="installed-sha">
          {shortSha(active) ?? t('version.unknown')}
        </div>
        <div className={css.status}>
          <span className={css.pill}>
            {update === undefined ? t('version.checking') : inProgress
              ? t('version.inProgress')
              : update.status === 'current' || update.status === 'updated' ? t('version.current')
                : update.status === 'error' || update.status === 'rollback-failed' || update.status === 'rolled-back'
                  ? t('version.failed') : t('version.notUpdating')}
          </span>
          {update?.phase !== undefined ? <span className={css.pill}>{update.phase}</span> : null}
        </div>
        {updateError ? <p role="alert" className={css.alert}>{t('version.hostError')}</p> : null}
        {update?.detail !== undefined ? <p className={css.muted}>{update.detail}</p> : null}
        <div className={css.valueRow}>
          <div>
            <div className={css.key}>{t('version.target')}</div>
            <div className={css.version}>{shortSha(candidate) ?? t('version.unknown')}</div>
          </div>
          <div>
            <div className={css.key}>{t('version.previous')}</div>
            <div className={css.version}>{shortSha(previous) ?? t('version.unknown')}</div>
          </div>
        </div>
        <p className={css.muted}>{t('version.localAuthority')}</p>
      </section>

      <section aria-label={t('version.history')} className={css.panel}>
        <div className={css.title}>{t('version.history')}</div>
        <p className={css.subtitle}>{t('version.historyDescription')}</p>
        {stable !== undefined ? (
          <p className={css.meta}>
            {t('version.published')}: <strong>{shortSha(stable)}</strong>
            {active !== undefined && active !== stable ? ' · ' + t('version.different') : ''}
          </p>
        ) : null}
        {historyLoading ? <p role="status" className={css.muted}>{t('version.loading')}</p> : null}
        {historyError ? <p role="alert" className={css.alert}>{t('version.historyError')}</p> : null}
        {!historyLoading && !historyError && releases.length === 0
          ? <p className={css.muted}>{t('version.empty')}</p> : null}
        <div className={css.history}>
          {releases.map(release => (
            <article className={css.entry} key={release.sha}>
              <div className={css.entryTop}>
                <div className={css.entryTitle}>{release.summary}</div>
                <span className={css.meta}>{readableDate(release.publishedAt)}</span>
              </div>
              <div className={css.meta}>
                {shortSha(release.sha)}
                {active === release.sha ? ' · ' + t('version.installed') : ''}
                {candidate === release.sha && inProgress ? ' · ' + t('version.inProgress') : ''}
              </div>
              <div className={css.entryLinks}>
                <button type="button" onClick={() => { void selectRelease(release) }}>
                  {selected === release.sha ? t('version.hideNotes') : t('version.changes')}
                </button>
                <a
                  href={'https://github.com/arisnachy/phoenix-harnes/commit/' + release.sha}
                  target="_blank"
                  rel="noopener noreferrer"
                >{t('version.commit')}</a>
                {release.prNumber !== undefined
                  ? <a
                    href={'https://github.com/arisnachy/phoenix-harnes/pull/' + String(release.prNumber)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >PR #{release.prNumber}</a> : null}
              </div>
              {selected === release.sha ? (
                <div className={css.notes} role="region" aria-label={t('version.changes')}>
                  {notesLoading === release.sha ? t('version.loading')
                    : notes[release.sha] ?? release.summary}
                </div>
              ) : null}
            </article>
          ))}
        </div>
        <p className={css.muted}>{t('version.historyLimit')}</p>
      </section>
    </div>
  )
}
