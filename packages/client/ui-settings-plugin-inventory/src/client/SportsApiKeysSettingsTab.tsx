/** Secure owner-only sports API credentials under Settings -> Conectores.
 * A password input sends the key directly to a Host Remote, never to Kira/Ask.
 */
import {useEffect,useState,type ReactNode} from 'react'
import type {SportsApiKeyId,SportsApiKeyState} from '@phoenix-ai/dsh-api-remotes/client'
import type {InjectFace,PropsLocale,PropsRuntime} from '@phoenix-ai/dsh-client-ui-slots'
import type {PluginInventoryLocaleKey} from './locales.ts'
import css from './SportsApiKeysSettingsTab.module.css'

export interface SportsApiKeysInjected{
  listSportsApiKeys:()=>Promise<SportsApiKeyState[]>
  saveSportsApiKey:(id:SportsApiKeyId,apiKey:string)=>Promise<SportsApiKeyState>
  removeSportsApiKey:(id:SportsApiKeyId)=>Promise<SportsApiKeyState>
  verifySportsApiKey:(id:SportsApiKeyId)=>Promise<SportsApiKeyState>
}
export type SportsApiKeysSettingsTabProps=PropsRuntime<'settings.plugins.tab'>
  &PropsLocale<'settings.pluginInventory'>&InjectFace<SportsApiKeysInjected>
type View={status:'loading'|'error'}|{status:'ready';rows:SportsApiKeyState[]}

export function SportsApiKeysSettingsTab({
  listSportsApiKeys,saveSportsApiKey,removeSportsApiKey,verifySportsApiKey,t,
}:SportsApiKeysSettingsTabProps):ReactNode{
  const [view,setView]=useState<View>({status:'loading'})
  const [editing,setEditing]=useState<SportsApiKeyId|null>(null)
  const [secret,setSecret]=useState('')
  const [busy,setBusy]=useState<SportsApiKeyId|null>(null)
  const [notice,setNotice]=useState('')
  useEffect(()=>{
    let active=true
    void listSportsApiKeys().then(rows=>{if(active)setView({status:'ready',rows})},
      ()=>{if(active)setView({status:'error'})})
    return()=>{active=false;setSecret('')}
  },[listSportsApiKeys])
  const refresh=()=>{
    void listSportsApiKeys().then(rows=>setView({status:'ready',rows}),
      ()=>setNotice(t('sportsKeysLoadError')))
  }
  const patch=(row:SportsApiKeyState)=>{
    setView(old=>old.status!=='ready'?old:{status:'ready',
      rows:old.rows.map(x=>x.id===row.id?row:x)})
  }
  const edit=(id:SportsApiKeyId|null)=>{setSecret('');setNotice('');setEditing(id)}
  const save=(id:SportsApiKeyId)=>{
    if(busy||!secret.trim())return
    const entered=secret
    setSecret('');setBusy(id);setNotice('')
    void saveSportsApiKey(id,entered).then(row=>{
      patch(row);setEditing(null);setNotice(row.verified?
        t('sportsKeysVerified'):t('sportsKeysSavedUnverified'))
    },()=>setNotice(t('sportsKeysSaveError'))).finally(()=>setBusy(null))
  }
  const remove=(id:SportsApiKeyId)=>{
    if(busy)return
    edit(null);setBusy(id)
    void removeSportsApiKey(id).then(row=>{
      patch(row);setNotice(t('sportsKeysRemoved'))
    },()=>setNotice(t('sportsKeysSaveError'))).finally(()=>setBusy(null))
  }
  const verify=(id:SportsApiKeyId)=>{
    if(busy)return
    setBusy(id);setNotice('')
    void verifySportsApiKey(id).then(row=>{
      patch(row);setNotice(row.verified?t('sportsKeysVerified'):t('sportsKeysUnverified'))
    },()=>setNotice(t('sportsKeysSaveError'))).finally(()=>setBusy(null))
  }
  const statusLabel=(row:SportsApiKeyState)=>row.status==='ready'?
    t('sportsKeysReady'):row.status==='missing-key'?t('sportsKeysMissing'):
    row.status==='vault-unavailable'?t('sportsKeysNoVault'):
    row.status==='invalid-key'?t('sportsKeysInvalid'):
    row.status==='rate-limited'?t('sportsKeysLimited'):t('sportsKeysUnverified')
  return <section className={css.section}>
    <header className={css.header}>
      <div><h3>{t('sportsKeysHeading')}</h3><p>{t('sportsKeysDescription')}</p></div>
      <button type="button" onClick={refresh} disabled={busy!==null}>{t('sportsKeysRefresh')}</button>
    </header>
    <p className={css.privacy}>{t('sportsKeysPrivacy')}</p>
    {view.status==='loading'?<p role="status">{t('loading')}</p>:null}
    {view.status==='error'?<p role="alert">{t('sportsKeysLoadError')}</p>:null}
    {notice?<p role="status" className={css.notice}>{notice}</p>:null}
    {view.status==='ready'?<ul className={css.grid}>
      {view.rows.map(row=><li key={row.id} className={css.card}>
        <div className={css.top}>
          <strong>{row.name}</strong>
          <span className={css.phase} data-status={row.status}>{statusLabel(row)}</span>
        </div>
        <p>{row.purpose}</p>
        <small>{row.source==='vault'?t('sportsKeysVault'):
          row.source==='environment'?t('sportsKeysEnvironment'):t('sportsKeysOptional')}</small>
        <div className={css.actions}>
          <a href={row.signup} target="_blank" rel="noopener noreferrer">{t('sportsKeysRegister')}</a>
          {row.writable?<button type="button" onClick={()=>edit(editing===row.id?null:row.id)}
            disabled={busy!==null}>{editing===row.id?t('sportsKeysCancel'):
              row.configured?t('sportsKeysReplace'):t('sportsKeysConfigure')}</button>:null}
          {row.configured&&row.writable?<button type="button" onClick={()=>remove(row.id)}
            disabled={busy!==null}>{t('sportsKeysRemove')}</button>:null}
          {row.id==='THE_ODDS_API_KEY'&&row.configured?<button type="button"
            onClick={()=>verify(row.id)} disabled={busy!==null}>{t('sportsKeysVerify')}</button>:null}
        </div>
        {editing===row.id&&row.writable?<form className={css.secure} autoComplete="off"
          onSubmit={event=>{event.preventDefault();save(row.id)}}>
          <label htmlFor={'sports-credential-'+row.id}>{t('sportsKeysPaste')}</label>
          <input id={'sports-credential-'+row.id} type="password" autoComplete="new-password"
            spellCheck={false} value={secret} maxLength={512}
            placeholder={t('sportsKeysPlaceholder')}
            onChange={event=>setSecret(event.currentTarget.value)}
            aria-label={t('sportsKeysPaste')}/>
          <button type="submit" disabled={busy!==null||secret.trim().length<8}>
            {busy===row.id?t('sportsKeysSaving'):t('sportsKeysSave')}
          </button>
        </form>:null}
      </li>)}
    </ul>:null}
  </section>
}
