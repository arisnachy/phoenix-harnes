/** Per-match user-authored bet tracking. A scoreboard is never a verified bookmaker settlement. */
import { useEffect,useState,type ReactNode } from 'react'
import {PHOENIX_TICKET_UPDATE,readSportsReceiptGoals} from './SportsTicketAutoLink.ts'
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
/** Units refer to the SCORE difference, not to the number of field goals, shots or plays.
 * Twenty-five NBA points cannot be described as twenty-five baskets.
 */
export function sportScoreUnit(sport?:string):string{
  switch((sport??'').toLowerCase()){
    case 'basketball':case 'nba':case 'wnba':return 'puntos (canastas o tiros libres)'
    case 'baseball':case 'mlb':return 'carreras'
    case 'soccer':case 'football-soccer':return 'goles'
    case 'hockey':case 'nhl':return 'goles'
    case 'football':case 'nfl':return 'puntos'
    default:return 'unidades del marcador'
  }
}
/** Only score-supported full-game outcomes; never infer regulation scores from final totals. */
export function evaluateSportsPick(pick:SportsTrackedPick,game:PhoenixLiveGame|undefined,sport?:string):SportsPickGrade{
  const pending=(label:string,target:string):SportsPickGrade=>({state:'pending',label,target})
  const selected=pick.side==='home'?game?.home:game?.away
  const target=pick.market==='total'
    ?(pick.side==='over'?'Más de ':'Menos de ')+pick.line
    :pick.market==='spread'?(selected??'Equipo')+' '+signed(pick.line??0)
      :pick.side==='draw'?'Empate':selected??'Equipo sin confirmar'
  if(!game||game.phase==='pre')return pending('Pendiente del inicio o marcador','Objetivo: '+target)
  const finalHome=numeric(game.homeScore),finalAway=numeric(game.awayScore)
  if(finalHome===null||finalAway===null)return pending('Marcador aún no verificable','Objetivo: '+target)
  const finished=game.phase==='post'
  // Soccer 90-minute markets and hockey 1X2 require regulation-only scores.
  // Never infer the period from an extra-time or shootout final.
  const periods=game.periods??[]
  const partial=(count:number)=>{
    if(periods.length<count)return null
    const rows=periods.slice(0,count).map(x=>({home:numeric(x.home),away:numeric(x.away)}))
    if(rows.some(x=>x.home===null||x.away===null))return null
    return {home:rows.reduce((s,x)=>s+x.home!,0),away:rows.reduce((s,x)=>s+x.away!,0)}
  }
  const regulation=sport==='soccer'&&periods.length===2?partial(2):
    sport==='hockey'&&pick.market==='three-way'?partial(3):null
  const needRegulation=sport==='soccer'||sport==='hockey'&&pick.market==='three-way'
  if(finished&&needRegulation&&!regulation)return {
    state:'review',label:'Finalizado · verificar marcador reglamentario',
    target:'Resultado final '+finalAway+'–'+finalHome+'; el período del mercado no está verificado',
  }
  const home=regulation?.home??finalHome,away=regulation?.away??finalAway
  let diff=0,description=''
  const scoreUnit=sportScoreUnit(sport)
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
      +(missing?' · necesita '+missing+' '+scoreUnit+' de margen adicional para cubrir':' · está cubriendo la línea')
      :'Marcador '+away+'–'+home+(diff>0?' · equipo adelante':diff===0?' · empate':' · necesita '+missing+' '+scoreUnit+' para pasar al frente')
  }
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

/** A verified receipt automatically carries the goal; the user never fills a per-game form. */
export function SportsBetProgress({sport,league,date,home,away,eventId,game,meta,initialBets=[]}:{
  sport:string;league:string;date:string;home:string;away:string;eventId?:string|undefined
  game?:PhoenixLiveGame|undefined;meta:PhoenixLiveMeta;initialBets?:SportsTrackedPick[]
}):ReactNode{
  const lookup={sport,league,date,home,away,eventId}
  const [saved,setSaved]=useState<SportsTrackedPick[]>(()=>readSportsReceiptGoals(lookup))
  useEffect(()=>{
    const update=()=>setSaved(readSportsReceiptGoals({sport,league,date,home,away,eventId}))
    update()
    if(typeof window==='undefined')return
    window.addEventListener(PHOENIX_TICKET_UPDATE,update)
    window.addEventListener('storage',update)
    return()=>{window.removeEventListener(PHOENIX_TICKET_UPDATE,update);window.removeEventListener('storage',update)}
  },[sport,league,date,home,away,eventId])
  const picks=[...new Map([...initialBets.filter(validTrackedPick),...saved].map(x=>[keyOf(x),x])).values()].slice(0,24)
  // No betting objective without a verified linked ticket. Never force the user
  // to retype a receipt, guess a market, or imply an unmatched game was bet.
  if(picks.length===0)return null
  return <section className={css.root} aria-label="Objetivos de mis boletos">
    <strong>Seguimiento automático del boleto</strong>
    <div className={css.grades}>{picks.map((pick)=>{
      const grade=evaluateSportsPick(pick,game,sport)
      return <article key={keyOf(pick)} className={css.pick} data-bet-state={grade.state}>
        <div className={css.header}><strong>Boleto #{pick.receipt}</strong><span className={css.status}>{grade.label}</span></div>
        <b>{pick.market==='total'?(pick.side==='over'?'Arriba ':'Abajo ')+pick.line:
          pick.market==='spread'?(pick.side==='home'?home:away)+' '+signed(pick.line??0):
            pick.side==='draw'?'Empate':pick.side==='home'?home:away}</b>
        <small>{grade.target}</small>
        {meta.stale||meta.error?<small>El último marcador puede estar desactualizado.</small>:null}
      </article>
    })}</div>
    <small>Datos ESPN y objetivos de recibos aportados; solo la casa confirma liquidación, anulaciones y pagos.</small>
  </section>
}
