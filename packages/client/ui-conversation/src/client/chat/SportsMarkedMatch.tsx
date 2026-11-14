/** Integrated pick and analytic favorite for PHOENIX's compact ESPN scoreboards.
 * An ESPN score provides only provisional sporting status, never settlement.
 */
import { useEffect,useState,type ReactNode } from 'react'
import {evaluateSportsPick,validTrackedPick,type SportsTrackedPick} from './SportsBetProgress.tsx'
import {readSportsForecastGoals} from './SportsForecastAutoLink.ts'
import {PHOENIX_TICKET_UPDATE,readSportsReceiptGoals} from './SportsTicketAutoLink.ts'
import type {PhoenixLiveGame,PhoenixLiveMeta} from './SportsLive.tsx'
import css from './GenerativeUi.module.css'

type Side={label:string;score?:string;logo?:string;meta?:string}
type PickState=ReturnType<typeof evaluateSportsPick>['state']
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase()
  .replace(/[^a-z0-9]+/gu,' ').trim()
const contains=(phrase:string,name:string)=>phrase===name||phrase.startsWith(name+' ')
  ||phrase.endsWith(' '+name)||phrase.includes(' '+name+' ')
/** Team name or clear nickname only; ambiguous references never highlight a side. */
export function sportsFavoriteSide(favorite:string|undefined,away:string,home:string):'away'|'home'|undefined{
  if(!favorite)return undefined
  const phrase=norm(favorite)
  const matches=(teamName:string)=>{
    const team=norm(teamName),nickname=team.split(' ').at(-1)??''
    return !!team&&(contains(phrase,team)||(nickname.length>=4&&contains(phrase,nickname)))
  }
  const a=matches(away),h=matches(home)
  return a===h?undefined:a?'away':'home'
}
const key=(p:SportsTrackedPick)=>[p.receipt,p.market,p.side,p.line??''].join(':')
const label:Record<PickState,string>={
  pending:'Pendiente',leading:'Va acertando',trailing:'Va fallando',
  won:'Acertó · provisional',lost:'Falló · provisional',
  review:'Por verificar',push:'Línea exacta · revisar',
}
function Portrait({side}:{side:Side}):ReactNode{
  return <span className={css.sportsPortrait}>
    <span>{side.label.slice(0,2).toUpperCase()}</span>
    {side.logo&&<img src={side.logo} alt={side.label} loading="lazy" referrerPolicy="no-referrer"
      onError={e=>{e.currentTarget.style.display='none'}}/>}
  </span>
}
function pickLabel(p:SportsTrackedPick,away:Side,home:Side):string{
  if(p.market==='total')return (p.side==='over'?'Más de ':'Menos de ')+String(p.line)
  if(p.side==='draw')return 'Empate · 1X2'
  const team=p.side==='home'?home.label:away.label
  if(p.market==='spread')return team+' '+((p.line??0)>0?'+':'')+String(p.line)
  return team+(p.market==='three-way'?' · 1X2':' · ML')
}
/** Reuses the receipt ledger and the separate, never-wager, Kira forecast ledger. */
export function SportsMarkedMatch({away,home,hasStarted,favorite,trackedBets=[],sport='',league='',date='',
  eventId,game,meta,pendingLabel='VS · No iniciado'}:{
  away:Side;home:Side;hasStarted:boolean;favorite?:string|undefined
  trackedBets?:SportsTrackedPick[]|undefined;sport?:string|undefined;league?:string|undefined
  date?:string|undefined;eventId?:string|undefined;pendingLabel?:string|undefined
  game?:PhoenixLiveGame|undefined;meta?:PhoenixLiveMeta|undefined
}):ReactNode{
  const readReceipt=()=>readSportsReceiptGoals({sport,league,date,home:home.label,away:away.label,eventId})
  const readForecast=()=>readSportsForecastGoals({sport,league,date,home:home.label,away:away.label,eventId})
  const [receipts,setReceipts]=useState<SportsTrackedPick[]>(readReceipt)
  const [forecasts,setForecasts]=useState<SportsTrackedPick[]>(readForecast)
  useEffect(()=>{
    const refresh=()=>{setReceipts(readReceipt());setForecasts(readForecast())}
    refresh()
    if(typeof window==='undefined')return
    window.addEventListener(PHOENIX_TICKET_UPDATE,refresh)
    window.addEventListener('storage',refresh)
    return()=>{window.removeEventListener(PHOENIX_TICKET_UPDATE,refresh);window.removeEventListener('storage',refresh)}
  // Read helpers capture only these stable primitive fixture fields.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sport,league,date,home.label,away.label,eventId])
  const ticketPicks=[...new Map([...trackedBets.filter(validTrackedPick),...receipts]
    .map(p=>[key(p),p])).values()]
  const isForecast=ticketPicks.length===0
  const picks=isForecast?forecasts:ticketPicks
  const uniqueSides=new Set(picks.filter(p=>['moneyline','three-way','spread'].includes(p.market)
    &&(p.side==='home'||p.side==='away')).map(p=>p.side))
  const selectedSide=uniqueSides.size===1?uniqueSides.values().next().value:undefined
  const analyticSide=sportsFavoriteSide(favorite,away.label,home.label)
  // All three identifiers must agree with the original fixture. ESPN's
  // approximate match fallback is insufficient for a betting verdict.
  const verifiedGame=game&&(!eventId||game.id===eventId)
    &&norm(game.home)===norm(home.label)&&norm(game.away)===norm(away.label)?game:undefined
  const stale=Boolean(meta?.stale||meta?.error)
  return <>
    <div className={css.sportsSlateMatch}>
      {(['away','home'] as const).map(side=>{
        const team=side==='away'?away:home
        const chosen=selectedSide===side,analytic=analyticSide===side
        const marked=chosen||(!selectedSide&&analytic)
        return <div key={side} data-selected-favorite={marked?'true':undefined}
          data-selected-pick={chosen?'true':undefined}
          data-analytical-favorite={analytic?'true':undefined}
          className={[chosen?css.sportsPickedRow:'',analytic?css.sportsAnalyticalRow:''].filter(Boolean).join(' ')||undefined}>
          <Portrait side={team}/>
          <span><strong>{team.label}</strong>
            {chosen&&<small className={css.sportsPickTag}>✓ {isForecast?'Pronóstico Kira':'Tu selección · boleto'}</small>}
            {analytic&&<small className={css.sportsFavoriteTag}>★ Favorito PHOENIX</small>}
            {team.meta&&<small>{team.meta}</small>}</span>
          {hasStarted&&team.score!==undefined&&<b>{team.score}</b>}
        </div>
      })}
      {!hasStarted&&<span className={css.sportsSlateVs}>{pendingLabel}</span>}
    </div>
    {picks.length>0&&<div className={css.sportsPickPanel} aria-label="Estado de la selección"
      data-pick-source={isForecast?'forecast':'receipt'}>
      {picks.slice(0,3).map(p=>{
        const grade=evaluateSportsPick(p,verifiedGame,sport)
        const state=verifiedGame?.phase==='in'&&stale?'review':grade.state
        return <div key={key(p)} className={css.sportsPickLine} data-pick-status={state}>
          <div className={css.sportsPickGoal}>
            <small>{isForecast?'Pronóstico de Kira':'Boleto #'+p.receipt}</small>
            <strong>{pickLabel(p,away,home)}</strong>
          </div>
          <strong className={css.sportsPickResult}>{verifiedGame?.phase==='in'&&stale
            ?'Marcador desactualizado':label[state]}</strong>
          {verifiedGame&&grade.state!=='pending'&&<small className={css.sportsPickDetail}>{grade.target}</small>}
          {(!verifiedGame||stale)&&<small className={css.sportsPickDetail}>{stale
            ?'La fuente puede tener retraso.':'Esperando marcador ESPN vinculado.'}</small>}
        </div>
      })}
      {picks.length>3&&<small>+{picks.length-3} selecciones adicionales.</small>}
      <small className={css.sportsPickDisclaimer}>
        Estado deportivo provisional · solo la casa liquida apuestas.
      </small>
    </div>}
  </>
}
