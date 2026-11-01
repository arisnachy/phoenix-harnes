import { useEffect, useState, type ReactNode } from 'react'
import type { CanvasAction } from './GenerativeCanvas.tsx'
import css from './SportsNewsPanel.module.css'

export type SportsNewsArticle = {
  label:string;value?:string;detail?:string;image?:string;href?:string
  action?:{ label:string;prompt:string }
}

type BrowserTranslator={
  translate:(text:string)=>Promise<string>
  destroy?:()=>void
}
type TranslationHost={
  Translator?:{
    availability?:(options:{sourceLanguage:string;targetLanguage:string})=>Promise<string>
    create:(options:{sourceLanguage:string;targetLanguage:string})=>Promise<BrowserTranslator>
  }
}
const translations=new Map<string,string>()
const languageOptions={sourceLanguage:'en',targetLanguage:'es'}
const isIso=(value:string)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/u.test(value)
const displayDate=(value:string):string=>{
  if(!isIso(value))return value
  const date=new Date(value)
  if(!Number.isFinite(date.getTime()))return value
  return new Intl.DateTimeFormat('es-DO',{
    dateStyle:'medium',timeStyle:'short',timeZone:'America/Santo_Domingo',
  }).format(date)
}
const translationCandidate=(value:string)=>value.length>3&&!isIso(value)
const textFor=(value:string,translated:Readonly<Record<string,string>>):string=>
  translated[value]??value
/** Translate verified provider text on-device when the browser already has an English-to-Spanish model.
 * No text is sent to an external translation endpoint, and unsupported browsers preserve the source text.
 * @param texts - Original titles and summaries from the validated provider payload.
 * @returns Original text until a local translation becomes available.
 */
export function useSpanishSportsNews(texts:readonly string[]):{
  translated:Readonly<Record<string,string>>;unavailable:boolean
}{
  const [translated,setTranslated]=useState<Readonly<Record<string,string>>>({})
  const [unavailable,setUnavailable]=useState(false)
  const signature=JSON.stringify(texts)
  useEffect(()=>{
    let active=true
    const values=(JSON.parse(signature) as string[])
      .filter(translationCandidate).slice(0,24)
    const pending=values.filter(value=>!translations.has(value))
    const cached=Object.fromEntries(values.flatMap(value=>{
      const result=translations.get(value)
      return result?[[value,result]]:[]
    }))
    setTranslated(cached)
    if(!pending.length){setUnavailable(false);return}
    const api=(globalThis as typeof globalThis & TranslationHost).Translator
    if(!api){setUnavailable(true);return}
    let translator:BrowserTranslator|undefined
    const run=async()=>{
      try{
        // Do not silently download a browser language pack over a metered connection.
        if(!api.availability || await api.availability(languageOptions)!=='available'){
          if(active)setUnavailable(true)
          return
        }
        translator=await api.create(languageOptions)
        for(const value of pending){
          if(!active)break
          const text=await translator.translate(value)
          if(!active)break
          const result=text.trim()
          if(result){
            translations.set(value,result)
            setTranslated(previous=>({...previous,[value]:result}))
          }
        }
      }catch{
        if(active)setUnavailable(true)
      }finally{translator?.destroy?.()}
    }
    void run()
    return()=>{active=false}
  },[signature])
  return {translated,unavailable}
}

/** Responsive sports news tiles with readable images and optional local Spanish translation.
 * @param props - Validated articles and the existing conversation action handler.
 * @returns The compact image-first news section without external translation requests.
 */
export function SportsNewsPanel({title,articles,onAction}:{
  title:string;articles:readonly SportsNewsArticle[];onAction?:CanvasAction|undefined
}):ReactNode{
  const visible=articles.slice(0,8)
  const texts=visible.flatMap(article=>[article.label,article.detail??''])
  const {translated,unavailable}=useSpanishSportsNews(texts)
  return <section className={css.news} data-generative-ui="sports_espn_dashboard" aria-label="Noticias deportivas">
    <div className={css.header}>
      <div><span className={css.eyebrow}>PHOENIX / INTELIGENCIA DEPORTIVA · NOTICIAS</span>
        <h3>{title}</h3><small>Últimos titulares</small></div>
      <span className={css.count}>{articles.length} noticias</span>
    </div>
    <div className={css.grid}>
      {visible.map((article,i)=><article key={i} className={css.article}>
        <div className={css.media}>
          {article.image?<img src={article.image} alt="" loading="lazy" decoding="async"
            referrerPolicy="no-referrer" onError={event=>{event.currentTarget.style.display='none'}}/>:
            <span aria-hidden="true">PH</span>}
        </div>
        <div className={css.body}>
          <strong>{textFor(article.label,translated)}</strong>
          {article.value&&<time className={css.date}>{displayDate(article.value)}</time>}
          {article.detail&&<p>{textFor(article.detail,translated)}</p>}
          {article.href&&<a href={article.href} target="_blank"
            rel="noopener noreferrer" className={css.link}>Leer noticia</a>}
          {article.action&&onAction&&<button type="button" className={css.link}
            onClick={()=>{if(article.action)onAction(article.action.prompt,'draft')}}>{article.action.label}</button>}
        </div>
      </article>)}
    </div>
    {articles.length>visible.length&&<small className={css.more}>Se muestran {visible.length} de {articles.length} titulares.</small>}
    {unavailable&&onAction&&<button type="button" className={css.translate}
      onClick={()=>{onAction('Kira, traduce fielmente al español los siguientes titulares y resúmenes deportivos, sin añadir hechos y conservando los enlaces de origen: '+visible.map(article=>[article.label,article.detail].filter(Boolean).join(' — ')).join('; ').slice(0,3500),'draft')}}>
      Traducir titulares con Kira
    </button>}
  </section>
}
