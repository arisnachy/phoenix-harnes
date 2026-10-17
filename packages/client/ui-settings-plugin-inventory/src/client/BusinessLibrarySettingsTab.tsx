import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { BusinessLibrarySnapshot } from '@phoenix-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import css from './BusinessLibrarySettingsTab.module.css'

export interface BusinessLibraryInjected {
  /** Always reads the trusted Host projection, not browser localStorage. */
  readBusinessLibrary: () => Promise<BusinessLibrarySnapshot>
}
export type BusinessLibrarySettingsTabProps = PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'> & InjectFace<BusinessLibraryInjected>

type View = {status:'loading'} | {status:'error'} | {status:'ready';data:BusinessLibrarySnapshot}
type Product = BusinessLibrarySnapshot['products'][number]

const label = (product:Product): string => product.buildStatus === 'stale' ? 'Exportación desactualizada'
  : product.buildStatus === 'current' ? 'Exportación vigente' : 'Sin exportación'
const listingLabel = (stage:Product['listingStage']):string => ({
  'not-prepared':'Sin ficha comercial', 'assets-missing':'Faltan archivos',
  'review-required':'Revisión pendiente', 'integrity-failed':'Integridad fallida',
})[stage]

/** Read-only browser shelf. Never implies a locally prepared listing was published. */
export function BusinessLibrarySettingsTab({readBusinessLibrary,t}:BusinessLibrarySettingsTabProps):ReactNode {
  const [reload,setReload]=useState(0)
  const [state,setState]=useState<View>({status:'loading'})
  const [search,setSearch]=useState('')
  const [kind,setKind]=useState('all')
  useEffect(()=>{
    let mounted=true
    void readBusinessLibrary().then(
      data=>{if(mounted)setState({status:'ready',data})},
      ()=>{if(mounted)setState({status:'error'})},
    )
    return ()=>{mounted=false}
  },[readBusinessLibrary,reload])
  const products = useMemo(()=>state.status==='ready'
    ? state.data.products.filter(product=>(kind==='all'||product.type===kind)
      && (`${product.title} ${product.id}`).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    : [],[kind,search,state])
  const refresh=():void=>{setState({status:'loading'});setReload(n=>n+1)}
  return <section className={css.library} aria-busy={state.status==='loading'}>
    <header className={css.header}>
      <div><h3>{t('businessHeading')}</h3><p>{t('businessDescription')}</p></div>
      <button type="button" onClick={refresh}>{t('businessRefresh')}</button>
    </header>
    {state.status==='loading' && <p role="status">{t('businessLoading')}</p>}
    {state.status==='error' && <p role="alert">{t('businessError')}</p>}
    {state.status==='ready' && <>
      <p className={css.count}>{state.data.totalCount} {t('businessProducts')}
        {state.data.truncated ? ` · ${t('businessTruncated')}` : ''}</p>
      <div className={css.filters}>
        <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder={t('businessSearch')} aria-label={t('businessSearch')}/>
        <select value={kind} onChange={e=>setKind(e.target.value)} aria-label={t('businessFilter')}>
          <option value="all">{t('businessAll')}</option>
          <option value="book">Libros</option><option value="course">Cursos</option>
          <option value="software">Software</option><option value="game">Juegos</option>
          <option value="design">Diseños</option><option value="research">Investigación</option>
          <option value="video">Vídeos</option><option value="audio">Audio</option><option value="other">Otros</option>
        </select>
      </div>
      {products.length===0 && <p className={css.empty}>{t('businessEmpty')}</p>}
      <div className={css.products}>
        {products.map(product=><article className={css.product} key={product.id}>
          <div className={css.productHead}><span>{product.type}</span><span>{label(product)}</span></div>
          <h4>{product.title}</h4>
          <p>{product.chapterCount} capítulos · {product.fileCount} archivos · {product.listingCount} fichas</p>
          {product.targetWords!==null && <p>{product.writtenWords.toLocaleString()} / {product.targetWords.toLocaleString()} palabras · {product.plannedChapters} capítulos previstos</p>}
          <p>{listingLabel(product.listingStage)}</p>
          <small>{product.updatedAt ? new Date(product.updatedAt).toLocaleDateString() : '—'}</small>
        </article>)}
      </div>
      <p className={css.note}>{t('businessWarning')}</p>
    </>}
  </section>
}