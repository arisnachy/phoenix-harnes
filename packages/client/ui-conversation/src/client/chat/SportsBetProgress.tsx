/** Per-match user-authored bet tracking. A scoreboard is never a verified bookmaker settlement. */
import { useEffect,useState,type ReactNode } from 'react'
import type { PhoenixLiveGame,PhoenixLiveMeta } from './SportsLive.tsx'
import css from './SportsBetProgress.module.css'

export type SportsTrackedPick = {
  receipt:string
  market:'moneyline'|'spread'|'total'|'three-way'
  side:'home'|'away'|'over'|'under'|'draw'
  line?:number
}
export type SportsPickGrade = {
  state:'pending'|'leading'|'trailing'|'won'|'lost'|'push'|'review'
  label:string
  target:string
}
const keyOf=(p:SportsTrackedPick)=>[p.receipt,p.market,p.side,p.line??''].join('|')
const numeric=(value:unknown):number|null=>
  typeof value==='string'&&/^\d{1,4}(?:\.\d)?$/u.test(value)&&Number(value)<=10000?Number(value):null
const choose=(market:SportsTrackedPick['market'],side:SportsTrackedPick['side'])=>
  market==='total'?side==='over'||side==='under':
    market==='three-way'?side==='home'||side==='away'||side==='draw':
      side==='home'||side==='away'
const needLine=(market:SportsTrackedPick['market'])=>market==='total'||market==='spread'
export function validTrackedPick(p:unknown):p is SportsTrackedPick{
  if(!p||typeof p!=='object'||Array.isArray(p))return false
  const row=p as Record<string,unknown>
  if(Object.keys(row).some(k=>!['receipt','market','side','line'].includes(k)))return false
  if(typeof row.receipt!=='string'||!/^[a-zA-Z0-9-]{1,25}$/u.test(row.receipt))return false
  if(!['moneyline','spread','total','three-way'].includes(String(row.market)))return false
  if(!['home','away','over','under','draw'].includes(String(row.side)))return false
  const market=row.market as SportsTrackedPick['market'],side=row.side as SportsTrackedPick['side']
  return choose(market,side)&&(!needLine(market)||typeof row.line==='number'
    &&Number.isFinite(row.line)&&Math.abs(row.line)<=10000)
}
const signed=(n:number)=>n>0?'+'+n:String(n)
/** Only score-supported full-game outcomes; never infer regulation scores from final totals. */
export function evaluateSportsPick(pick:SportsTrackedPick,game:PhoenixLiveGame|undefined,sport?:string):SportsPickGrade{
  const pending=(label:string,target:string):SportsPickGrade=>({state:'pending',label,target})
  const selected=pick.side==='home'?game?.home:game?.away
  const target=pick.market==='total'
    ?(pick.side==='over'?'Más de ':'Menos de ')+pick.line
    :pick.market==='spread'?(selected??'Equipo')+' '+signed(pick.line??0)
      :pick.side==='draw'?'Empate':selected??'Equipo sin confirmar'
  if(!game||game.phase==='pre')return pending('Pendiente del inicio o marcador','Objetivo: '+target)
  const home=numeric(game.homeScore),away=numeric(game.awayScore)
  if(home===null||away===null)return pending('Marcador aún no verificable','Objetivo: '+target)
  const finished=game.phase==='post'
  let diff=0,description=''
  if(pick.market==='total'){
    const total=home+away
    diff=pick.side==='over'?total-(pick.line??0):(pick.line??0)-total
    description='Total actual '+total+' · '+(pick.side==='over'
      ?diff>0?'umbral alcanzado, falta confirmar final': 'faltan '+(Math.floor((pick.line??0)-total)+1)+' para superar la línea'
      :diff>0?'margen bajo la línea: '+diff:'línea alcanzada o superada')
  }else if(pick.market==='three-way'&&pick.side==='draw'){
    diff=home===away?1:-1
    description='Marcador actual '+away+'–'+home+' · empate requerido'
  }else {
    const yours=pick.side==='home'?home:away,other=pick.side==='home'?away:home
    diff=yours-other+(pick.market==='spread'?(pick.line??0):0)
    const missing=Math.max(0,Math.floor(-diff)+1)
    description=pick.market==='spread'?'Marcador '+away+'–'+home+' · ajustado '+signed(diff)
      +(missing?' · necesita '+missing+' gol(es)/punto(s) de ventaja adicional':' · está cubriendo la línea')
      :'Marcador '+away+'–'+home+(diff>0?' · equipo adelante':diff===0?' · empate':' · necesita '+missing+' gol(es)/punto(s) para liderar')
  }
  if(finished&&(sport==='soccer'&&['moneyline','three-way'].includes(pick.market)
    ||sport==='hockey'&&pick.market==='three-way'))
    return {state:'review',label:'Finalizado · verificar período de la casa',target:description}
  if(finished){
    const result=diff>0?'won':diff<0?'lost':'push'
    const state=(pick.market==='moneyline'&&diff===0||pick.market==='three-way'&&pick.side!=='draw'&&diff===0)
      ?'review':result
    return {state,label:state==='won'?'Objetivo alcanzado · resultado provisional':
      state==='lost'?'Objetivo no alcanzado · resultado provisional':
        state==='push'?'Línea exacta · posible reembolso':'Empate · revisar reglas de la casa',target:description}
  }
  // A live score may still change. Never show a won/lost outcome before the final whistle.
  const covering=diff>0
  return {state:covering?'leading':'trailing',
    label:covering?'Cumpliendo por ahora · NO final':'Todavía no cumple · NO final',target:description}
}
function safeStoreKey(sport:string,league:string,date:string,away:string,home:string):string|null{
  if(!/^\d{4}-\d{2}-\d{2}$/u.test(date)||!sport||!league||!away||!home)return null
  const clean=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').replace(/[^a-z0-9]/giu,'').toLowerCase().slice(0,80)
  return 'phoenix:sports:tracked:v1:'+clean(sport)+':'+clean(league)+':'+date+':'+clean(away)+':'+clean(home)
}
function load(key:string|null):SportsTrackedPick[]{
  if(!key||typeof localStorage==='undefined')return []
  try{
    const obj=JSON.parse(localStorage.getItem(key)??'[]') as unknown
    return Array.isArray(obj)?obj.filter(validTrackedPick).slice(0,24):[]
  }catch{return []}
}
export function SportsBetProgress({sport,league,date,home,away,game,meta,initialBets=[]}:{
  sport:string;league:string;date:string;home:string;away:string
  game?:PhoenixLiveGame|undefined;meta:PhoenixLiveMeta;initialBets?:SportsTrackedPick[]
}):ReactNode{
  const key=safeStoreKey(sport,league,date,away,home)
  const [saved,setSaved]=useState<SportsTrackedPick[]>(()=>load(key))
  const [receipt,setReceipt]=useState('')
  const [market,setMarket]=useState<SportsTrackedPick['market']>('moneyline')
  const [side,setSide]=useState<SportsTrackedPick['side']>('home')
  const [line,setLine]=useState('')
  const [notice,setNotice]=useState('')
  useEffect(()=>{setSaved(load(key))},[key])
  if(!key)return null
  const picks=[...new Map([...initialBets.filter(validTrackedPick),...saved].map(x=>[keyOf(x),x])).values()].slice(0,24)
  const availableSides=market==='total'?[
    ['over','Arriba (Over)'],['under','Abajo (Under)']]:
    market==='three-way'?[
      ['home','Local'],['away','Visitante'],['draw','Empate']]:
      [['home','Local'],['away','Visitante']]
  const submit=()=>{
    const p:SportsTrackedPick={receipt:receipt.trim(),market,side:availableSides.some(s=>s[0]===side)?side:availableSides[0]![0] as SportsTrackedPick['side'],
      ...(needLine(market)?{line:Number(line)}:{})}
    if(!validTrackedPick(p)||needLine(market)&&line.trim()===''){
      setNotice('Comprueba el número de boleto, mercado y línea exacta.');return
    }
    const next=[...new Map([...saved,p].map(v=>[keyOf(v),v])).values()].slice(-24)
    try{localStorage.setItem(key,JSON.stringify(next));setSaved(next);setNotice('Selección guardada en este dispositivo.')}
    catch{setNotice('No se pudo guardar; comprueba almacenamiento privado del navegador.')}
  }
  const remove=(pick:SportsTrackedPick)=>{
    const next=saved.filter(p=>keyOf(p)!==keyOf(pick))
    try{localStorage.setItem(key,JSON.stringify(next));setSaved(next);setNotice('Selección local eliminada.')}
    catch{setNotice('No se pudo actualizar el almacenamiento.')}
  }
  return <section className={css.root} aria-label="Seguimiento de mis apuestas">
    {picks.length>0&&<div className={css.grades}>
      {picks.map((pick)=>{
        const grade=evaluateSportsPick(pick,game,sport)
        return <article key={keyOf(pick)} className={css.pick} data-bet-state={grade.state}>
          <div className={css.header}><strong>Boleto {pick.receipt}</strong><span className={css.status}>{grade.label}</span></div>
          <b>{pick.market==='total'?(pick.side==='over'?'Arriba ':'Abajo ')+pick.line:
              pick.market==='spread'?(pick.side==='home'?home:away)+' '+signed(pick.line??0):
              pick.side==='draw'?'Empate':pick.side==='home'?home:away}</b>
          <small>{grade.target}</small>
          {meta.stale||meta.error?<small>Último marcador recibido; puede estar desactualizado.</small>:null}
          {saved.some(p=>keyOf(p)===keyOf(pick))&&<button type="button" onClick={()=>remove(pick)}>Quitar</button>}
        </article>
      })}
    </div>}
    <details className={css.edit}>
      <summary>{picks.length?'Añadir otra selección':'Registrar mi apuesta para seguir el objetivo'}</summary>
      <div className={css.form}>
        <label>Número del boleto<input value={receipt} onChange={e=>setReceipt(e.target.value.slice(0,25))} placeholder="Ej.: 12126409" inputMode="text"/></label>
        <label>Mercado<select value={market} onChange={e=>{const m=e.target.value as SportsTrackedPick['market'];setMarket(m);setSide(m==='total'?'over':'home')}}>
          <option value="moneyline">Ganador</option><option value="spread">Hándicap</option>
          <option value="total">Total arriba / abajo</option><option value="three-way">Ganador 1X2 / empate</option>
        </select></label>
        <label>Selección<select value={availableSides.some(s=>s[0]===side)?side:availableSides[0]![0]}
          onChange={e=>setSide(e.target.value as SportsTrackedPick['side'])}>
          {availableSides.map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select></label>
        {needLine(market)&&<label>Línea exacta<input type="number" step="0.5" value={line} onChange={e=>setLine(e.target.value)} placeholder="Ej.: +1.5 o 223.5"/></label>}
        <button type="button" onClick={submit}>Guardar selección</button>
      </div>
      {notice&&<small role="status">{notice}</small>}
      <small>El registro local no programa correos ni verifica que la banca haya aceptado el boleto. Resultado provisional a partir de ESPN; confirma pago y reglas en la casa.</small>
    </details>
  </section>
}
