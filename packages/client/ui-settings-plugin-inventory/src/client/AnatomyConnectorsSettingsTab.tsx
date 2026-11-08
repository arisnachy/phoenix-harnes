/** Explicit, truthful installer for local clinical-research dependencies. */
import { useEffect, useState, type ReactNode } from 'react'
import type {AnatomyConnectorId,AnatomyConnectorInstallReceipt,AnatomyConnectorSnapshot}
  from '@phoenix-ai/dsh-api-remotes/client'
import type {InjectFace,PropsLocale,PropsRuntime} from '@phoenix-ai/dsh-client-ui-slots'
import type {PluginInventoryLocaleKey} from './locales.ts'
import css from './AnatomyConnectorsSettingsTab.module.css'

export interface AnatomyConnectorsInjected {
  listAnatomy:()=>Promise<AnatomyConnectorSnapshot>
  installAnatomy:(id:AnatomyConnectorId|'all')=>Promise<AnatomyConnectorInstallReceipt>
}
export type AnatomyConnectorsSettingsTabProps=PropsRuntime<'settings.plugins.tab'>
  &PropsLocale<'settings.pluginInventory'>&InjectFace<AnatomyConnectorsInjected>
type State={phase:'loading'|'error'}|{phase:'ready';value:AnatomyConnectorSnapshot}
const PHASE:Record<AnatomyConnectorSnapshot['entries'][number]['phase'],PluginInventoryLocaleKey>={
  ready:'anatomyReady',libraries:'anatomyLibraries',installing:'anatomyInstalling',
  missing:'anatomyMissing',error:'anatomyError',external:'anatomyExternal',
}
export function AnatomyConnectorsSettingsTab({listAnatomy,installAnatomy,t}:AnatomyConnectorsSettingsTabProps):ReactNode{
  const [state,setState]=useState<State>({phase:'loading'})
  const [busy,setBusy]=useState<AnatomyConnectorId|'all'|null>(null)
  const [notice,setNotice]=useState('')
  const [poll,setPoll]=useState(false)
  useEffect(()=>{
    let active=true
    void listAnatomy().then(v=>{if(active)setState({phase:'ready',value:v})},
      ()=>{if(active)setState({phase:'error'})})
    return()=>{active=false}
  },[listAnatomy])
  useEffect(()=>{
    if(state.phase==='ready'&&state.value.running)setPoll(true)
  },[state])
  useEffect(()=>{
    if(!poll)return
    let active=true
    let count=0
    const timer=setInterval(()=>{
      if(++count>720){setPoll(false);return}
      void listAnatomy().then(v=>{
        if(active){
          setState({phase:'ready',value:v})
          if(!v.running&&count>2)setPoll(false)
        }
      },()=>{if(active)setPoll(false)})
    },7000)
    return()=>{active=false;clearInterval(timer)}
  },[listAnatomy,poll])
  const refresh=()=>{
    setState({phase:'loading'})
    void listAnatomy().then(v=>setState({phase:'ready',value:v}),
      ()=>setState({phase:'error'}))
  }
  const install=(id:AnatomyConnectorId|'all')=>{
    if(busy!==null)return
    setBusy(id);setNotice('')
    void installAnatomy(id).then(receipt=>{
      setNotice(receipt.detail)
      if(receipt.status==='started'||receipt.status==='running')setPoll(true)
      void listAnatomy().then(v=>setState({phase:'ready',value:v}),
        ()=>setState({phase:'error'}))
    },e=>setNotice(e instanceof Error?e.message.slice(0,180):t('anatomyError')))
      .finally(()=>setBusy(null))
  }
  return <section className={css.section} aria-busy={state.phase==='loading'}>
    <header className={css.header}>
      <div><h3>{t('anatomyHeading')}</h3><p>{t('anatomyDescription')}</p></div>
      <button type="button" onClick={refresh} disabled={busy!==null}>{t('anatomyRefresh')}</button>
    </header>
    <p className={css.notice}>{t('anatomyWarning')}</p>
    {state.phase==='ready'?<div className={css.bulk}>
      <div><strong>{t('anatomyInstallAll')}</strong><p>{t('anatomyInstallAllDescription')}</p></div>
      <button type="button" onClick={()=>install('all')} disabled={busy!==null||state.value.running||state.value.entries.every(e=>e.installed||!e.canInstall)}>
        {busy==='all'||state.value.running?t('anatomyInstalling'):t('anatomyInstallAll')}
      </button>
    </div>:null}
    {state.phase==='ready'&&state.value.progress?<div role="status" className={css.progress}>
      <span>{t('anatomyProgress')}: {state.value.progress.completed}/{state.value.progress.total}
        {state.value.progress.status==='running'&&state.value.progress.current?' · '+(state.value.entries.find(e=>e.id===state.value.progress?.current)?.title||''):''}
      </span>
      <progress value={state.value.progress.completed} max={state.value.progress.total}/>
    </div>:null}
    {notice?<p role="status" className={css.notice}>{notice}</p>:null}
    {state.phase==='loading'?<p role="status">{t('loading')}</p>:null}
    {state.phase==='error'?<p role="alert">{t('anatomyError')}</p>:null}
    {state.phase==='ready'?<ul className={css.grid}>
      {state.value.entries.map(entry=><li key={entry.id} className={css.card}>
        <div className={css.top}>
          <label className={css.check}>
            <input type="checkbox" checked={entry.installed} disabled readOnly
              aria-label={entry.title+': '+(entry.installed?t('anatomyInstalled'):t('anatomyMissing'))}/>
            <strong>{entry.title}</strong>
          </label>
          <span className={css.phase} data-phase={entry.phase}>{t(PHASE[entry.phase])}</span>
        </div>
        <p className={css.detail}>{entry.detail}</p>
        <div className={css.actions}>
          {entry.canInstall&&!entry.installed?
            <button type="button" onClick={()=>install(entry.id)} disabled={busy!==null||state.value.running}>
              {busy===entry.id?t('anatomyInstalling'):t('anatomyInstall')}
            </button>:null}
          {!entry.canInstall?<span className={css.hint}>{t('anatomyExternalHelp')}</span>:null}
          {entry.docs?<a href={entry.docs} target="_blank" rel="noopener noreferrer">{t('anatomyDocs')}</a>:null}
        </div>
      </li>)}
    </ul>:null}
  </section>
}
