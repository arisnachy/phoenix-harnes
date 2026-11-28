import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PhoenixLocalKey } from './phoenix-local-locales.ts'
import styles from './PhoenixLocalPanel.module.css'

/** Browser-safe public directory query. */
export interface LocalLibraryRequest {
  readonly source: 'ollama' | 'huggingface'
  readonly query: string
  readonly family?: string
  readonly sort?: 'popular' | 'recent'
}
/** One published directory record; compatibility must be checked after installation. */
export interface LocalLibraryEntry {
  readonly name: string
  readonly url: string
  readonly family?: string
  readonly installId?: string
  readonly downloads?: number
  readonly updatedAt?: string
}
/** Timestamped directory result. */
export interface LocalLibrarySnapshot {
  readonly entries: readonly LocalLibraryEntry[]
  readonly fetchedAt: string
}
interface Props {
  search: (request: LocalLibraryRequest) => Promise<LocalLibrarySnapshot>
  install: (id: string) => void
  disabled: boolean
  installedIds: readonly string[]
  t: (key: PhoenixLocalKey) => string
}

/** Search public model sources on demand; never install on search or selection.
 * @param props - Host-backed directory and existing install action.
 * @returns Model library explorer.
 */
export function LocalLibraryExplorer({ search, install, disabled, installedIds, t }: Props): ReactNode {
  const [source, setSource] = useState<LocalLibraryRequest['source']>('ollama')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'popular' | 'recent'>('popular')
  const [family, setFamily] = useState<string>()
  const [result, setResult] = useState<LocalLibrarySnapshot>()
  const [error, setError] = useState(false)
  const [pending, setPending] = useState(false)
  const [choice, setChoice] = useState<LocalLibraryEntry>()
  const [quant, setQuant] = useState('')
  const generation = useRef(0)
  useEffect(() => () => { generation.current += 1 }, [])
  const reset = (): void => { generation.current += 1; setPending(false); setResult(undefined); setError(false); setChoice(undefined); setQuant(''); setFamily(undefined) }
  const lookup = async (nextFamily?: string): Promise<void> => {
    const requestId = ++generation.current
    setFamily(nextFamily); setPending(true); setError(false); setChoice(undefined); setResult(undefined)
    try {
      const response = await search({ source, query, sort, ...(nextFamily === undefined ? {} : { family: nextFamily }) })
      if (generation.current === requestId) setResult(response)
    } catch { if (generation.current === requestId) setError(true) }
    finally { if (generation.current === requestId) setPending(false) }
  }
  const installChoice = (): void => {
    if (choice?.installId === undefined || disabled) return
    const suffix = source === 'huggingface' && quant !== '' ? ':' + quant : ''
    install(choice.installId + suffix); setChoice(undefined)
  }
  return <section className={styles['studio']} aria-label={t('studioLibrary')}>
    <div className={styles['studioHeader']}><div><strong>{t('studioLibrary')}</strong><p className={styles['muted']}>{t('studioLibraryHint')}</p></div><span className={styles['badge']}>GGUF</span></div>
    <div className={styles['sourceTabs']} role="group" aria-label={t('studioSource')}>
      <button type="button" aria-pressed={source === 'ollama'} onClick={() => { if (source !== 'ollama') { reset(); setSource('ollama') } }}>Ollama</button>
      <button type="button" aria-pressed={source === 'huggingface'} onClick={() => { if (source !== 'huggingface') { reset(); setSource('huggingface') } }}>Hugging Face</button>
    </div>
    <form className={styles['studioSearch']} onSubmit={event => { event.preventDefault(); void lookup() }}>
      <label className={styles['field']}><span className={styles['label']}>{t('studioSearch')}</span><input type="search" maxLength={100} value={query} placeholder="Qwen, Gemma, Llama…" onChange={event => setQuery(event.currentTarget.value)} /></label>
      {source === 'huggingface' && <label className={styles['field']}><span className={styles['label']}>{t('studioSort')}</span><select value={sort} onChange={event => setSort(event.currentTarget.value as 'popular' | 'recent')}><option value="popular">{t('studioPopular')}</option><option value="recent">{t('studioRecent')}</option></select></label>}
      <button type="submit" className={styles['primary']} disabled={pending}>{t('studioSearchAction')}</button>
    </form>
    {family !== undefined && <button type="button" className={styles['secondary']} disabled={pending} onClick={() => { void lookup() }}>← {t('studioFamilies')} · {family}</button>}
    {pending && <p role="status" className={styles['muted']}>{t('studioSearching')}</p>}
    {error && <p role="alert" className={styles['muted']}>{t('studioSearchError')}</p>}
    {result !== undefined && <><div className={styles['directoryMeta']}><span>{result.entries.length} · {t('studioResults')}</span><time dateTime={result.fetchedAt}>{new Date(result.fetchedAt).toLocaleString()}</time></div>
      {result.entries.length === 0 && <p className={styles['muted']}>{t('studioEmpty')}</p>}
      <div className={styles['directoryRows']}>{result.entries.map(entry => <div className={styles['directoryRow']} key={entry.name}>
        <div className={styles['modelGlyph']} aria-hidden="true">{entry.name.split('/').at(-1)?.slice(0,1).toUpperCase()}</div>
        <div className={styles['directoryIdentity']}><strong>{entry.name}</strong><span>{source === 'ollama' ? 'Ollama' : 'Hugging Face · GGUF'}{entry.downloads === undefined ? '' : ' · ↓ ' + entry.downloads.toLocaleString()}</span><a href={entry.url} target="_blank" rel="noopener noreferrer">{t('studioDetails')}</a></div>
        {entry.family !== undefined ? <button type="button" className={styles['secondary']} disabled={pending} onClick={() => { void lookup(entry.family) }}>{t('studioVariants')} ›</button>
          : entry.installId !== undefined && <button type="button" className={styles['secondary']} disabled={disabled} onClick={() => { setChoice(entry); setQuant('') }}>{installedIds.includes(entry.installId) ? t('connectOllama') : t('install')}</button>}
      </div>)}</div></>}
    {choice !== undefined && <div role="alertdialog" aria-label={t('studioConfirm')} className={styles['confirm']}><strong>{t('studioConfirm')} · {choice.name}</strong><p>{t('studioConfirmHint')}</p>
      {source === 'huggingface' && <label className={styles['field']}><span className={styles['label']}>{t('studioQuant')}</span><input maxLength={40} value={quant} placeholder="Q4_K_M" onChange={event => setQuant(event.currentTarget.value)} /><span className={styles['muted']}>{t('studioQuantHint')}</span></label>}
      <div className={styles['actions']}><button type="button" className={styles['secondary']} onClick={() => setChoice(undefined)}>{t('cancel')}</button><button type="button" className={styles['primary']} disabled={disabled || (quant !== '' && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/u.test(quant))} onClick={installChoice}>{t('studioConfirm')}</button></div></div>}
  </section>
}
