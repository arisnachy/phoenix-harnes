/** ESPN play-by-play: fetch only for an explicitly opened match, not every fixture. */
import { useEffect,useState,type ReactNode } from 'react'
import { espnLiveSummaryUrl,type PhoenixLiveGame } from './SportsLive.tsx'
import css from './SportsGameCenter.module.css'
type Obj=Record<string,unknown>
const obj=(x:unknown):Obj=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Obj:{}
const rows=(x:unknown):Obj[]=>Array.isArray(x)?x.filter(v=>v!==null&&typeof v==='object'&&!Array.isArray(v)) as Obj[]:[]
const txt=(v:unknown,n=200):string=>(typeof v==='string'||typeof v==='number'
  ?String(v).replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,n):'')
export type EspnPlay={ id:string;text:string;clock?:string;period?:string;team?:string;score?:string }
/**
 * Use actual provider descriptions only; preserve event chronology and deduplicate IDs.
 * @param input - Untrusted ESPN summary data.
 * @returns Deduplicated provider events, newest first.
 */
export function parseEspnGamePlays(input:unknown):EspnPlay[]{
  const root=obj(input),plays=rows(root.plays),scores=rows(root.scoringPlays)
  const source=plays.length?plays:scores.length?scores:rows(root.keyEvents)
  const seen=new Set<string>(),out:EspnPlay[]=[]
  for(const [i,p] of source.slice(-100).entries()){
    const description=txt(p.text||p.description||obj(p.type).text,240)
    if(!description)continue
    const clock=txt(obj(p.clock).displayValue||p.displayClock,30)
    const period=txt(obj(p.period).displayValue||obj(p.period).number||p.period,15)
    const team=txt(obj(p.team).displayName||obj(p.team).name,80)
    const away=txt(p.awayScore,10),home=txt(p.homeScore,10)
    const id=txt(p.id,70)||String(i)+':'+clock+':'+description
    if(seen.has(id))continue
    seen.add(id)
    out.push({ id,text:description,...(clock?{ clock }:{}),...(period?{ period }:{}),
      ...(team?{ team }:{}),...(away&&home?{ score:away+' – '+home}:{})})
  }
  return out.reverse().slice(0,45)
}
type Snapshot={ url:string;plays:EspnPlay[];at:number;error:boolean;loading:boolean }
const empty:Snapshot={ url:'',plays:[],at:0,error:false,loading:false }
/**
 * Show in-chat, on-demand ESPN play-by-play for one verified event.
 * @param props - ESPN sport, league, identifier, phase and observed scoreboard entry.
 * @returns A compact opt-in game timeline or null for unsupported identifiers.
 */
export function SportsGameCenter({ sport,league,eventId,phase,game }:{
  sport?:string|undefined;league?:string|undefined;eventId?:string|undefined;
  phase?:'pre'|'in'|'post'|undefined;game?:PhoenixLiveGame|undefined
}):ReactNode{
  const [open,setOpen]=useState(false),[state,setState]=useState<Snapshot>(empty)
  // MLB Stats gamePk and ESPN eventId differ: only use a confirmed ESPN ID for MLB.
  const providerId=game?.id??(sport==='baseball'?undefined:eventId)
  const url=espnLiveSummaryUrl(sport,league,providerId)
  useEffect(()=>{
    if(!open||!url)return
    let active=true,busy=false,controller:AbortController|undefined
    const update=async()=>{
      if(!active||busy||typeof document!=='undefined'&&document.visibilityState==='hidden')return
      if(typeof navigator!=='undefined'&&navigator.onLine===false)return
      busy=true
      controller=new AbortController()
      const current=controller
      const timeout=setTimeout(()=>current.abort(),9000)
      setState(s=>({ url,plays:s.url===url?s.plays:[],at:s.url===url?s.at:0,error:false,loading:true }))
      try{
        const res=await fetch(url,{ signal:current.signal,cache:'no-store',headers:{ accept:'application/json' } })
        if(!res.ok)throw Error('ESPN '+res.status)
        if(Number(res.headers.get('content-length')??0)>3_000_000)throw Error('ESPN payload too large')
        const value=await res.json() as unknown
        if(active)setState({ url,plays:parseEspnGamePlays(value),at:Date.now(),error:false,loading:false })
      }catch{
        if(active)setState(s=>({ ...s,url,error:true,loading:false }))
      }finally{clearTimeout(timeout);busy=false}
    }
    void update()
    const interval=phase==='post'?undefined:setInterval(()=>{void update()},phase==='in'?20_000:60_000)
    return()=>{active=false;controller?.abort();if(interval!==undefined)clearInterval(interval)}
  },[open,url,phase])
  if(!url)return null
  const valid=state.url===url,plays=valid?state.plays:[]
  return <section className={css.center} aria-label="Seguimiento ESPN del partido">
    <button type="button" className={css.toggle} aria-expanded={open}
      onClick={()=>setOpen(!open)}> {open?'Cerrar seguimiento':'Seguir partido · Jugadas'} <span aria-hidden="true">{open?'▴':'▾'}</span></button>
    {open&&<div className={css.panel}>
      <div className={css.heading}><strong>Jugadas · ESPN</strong><small>{
        valid&&state.at>0?'Recibido '+new Date(state.at).toLocaleTimeString('es-DO',{ hour:'2-digit',minute:'2-digit' }):
          'Sin actualización confirmada'}</small></div>
      {valid&&state.error&&<p role="status">ESPN no respondió; se muestran los últimos datos recibidos.</p>}
      {(!valid||state.loading&&!state.at)&&<p role="status">Consultando cronología…</p>}
      {valid&&!state.loading&&!plays.length&&<p>ESPN no publicó jugadas detalladas para este encuentro.</p>}
      {plays.length>0&&<ol className={css.plays}>{plays.map(play=><li key={play.id}>
        <span className={css.minute}>{[play.period,play.clock].filter(Boolean).join(' · ')||'—'}</span>
        <span className={css.description}>{play.text}
          {(play.team||play.score)&&<small>{[play.team,play.score].filter(Boolean).join(' · ')}</small>}</span>
      </li>)}</ol>}
      <small className={css.disclaimer}>Datos de ESPN sujetos a retrasos y cobertura por liga. Sin video.</small>
    </div>}
  </section>
}
