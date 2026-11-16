/** Integrated PHOENIX, user and receipt picks for compact ESPN scoreboards.
 * A scoreboard grades sporting outcomes, not bookmaker settlement.
 */
import {useEffect,useState,type ReactNode} from 'react'
import {evaluateSportsPick,validTrackedPick,type SportsTrackedPick} from './SportsBetProgress.tsx'
import {readSportsForecastGoals} from './SportsForecastAutoLink.ts'
import {PHOENIX_TICKET_UPDATE,readSportsReceiptGoals} from './SportsTicketAutoLink.ts'
import {finalizeSportsUserChoice,readSportsUserChoice,saveSportsUserChoice,
  sportsUserChoiceKey,sportsUserHistory,type SportsUserChoice} from './SportsUserPick.ts'
import type {PhoenixLiveGame,PhoenixLiveMeta} from './SportsLive.tsx'
import css from './GenerativeUi.module.css'

type Side={label:string;score?:string;logo?:string;meta?:string}
type PickState=ReturnType<typeof evaluateSportsPick>['state']
type PickOrigin='receipt'|'forecast'|'user'
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase()
  .replace(/[^a-z0-9]+/gu,' ').trim()
const contains=(phrase:string,name:string)=>phrase===name||phrase.startsWith(name+' ')
  ||phrase.endsWith(' '+name)||phrase.includes(' '+name+' ')
/** Identify a single team, never an ambiguous nickname or an ESPN probability. */
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
  won:'Acertó · resultado deportivo',lost:'Falló · resultado deportivo',
  review:'Por verificar',push:'Línea exacta · revisar',
}
const icon:Record<PickState,string>={
  pending:'◷',leading:'↗',trailing:'↘',won:'✓',lost:'×',review:'!',push:'=',
}
function Portrait({side}:{side:Side}):ReactNode{
  return <span className={css.sportsPortrait}>
    <span>{side.label.slice(0,2).toUpperCase()}</span>
    {side.logo&&<img src={side.logo} alt={side.label} loading="lazy" referrerPolicy="no-referrer"
      onError={e=>{e.currentTarget.style.display='none'}}/>}
  </span>
}
function pickLabel(p:SportsTrackedPick,away:Side,home:Side):string{
  if(p.market==='total')return(p.side==='over'?'Más de ':'Menos de ')+String(p.line)
  if(p.side==='draw')return 'Empate · 1X2'
  const team=p.side==='home'?home.label:away.label
  if(p.market==='spread')return team+' '+((p.line??0)>0?'+':'')+String(p.line)
  return team+(p.market==='three-way'?' · 1X2':' · ML')
}
const pickSide=(picks:readonly SportsTrackedPick[]):'home'|'away'|undefined=>{
  const sides=new Set(picks.filter(p=>['moneyline','three-way','spread'].includes(p.market)
    &&(p.side==='home'||p.side==='away')).map(p=>p.side))
  if(sides.size!==1)return undefined
  const side=sides.values().next().value
  return side==='home'||side==='away'?side:undefined
}
/** Distinct pregame user picks graded from exact observed ESPN finals, never sportsbook wins. */
export function SportsUserHistorySummary():ReactNode{
  const [history,setHistory]=useState(sportsUserHistory)
  useEffect(()=>{
    const refresh=()=>setHistory(sportsUserHistory())
    if(typeof window==='undefined')return
    window.addEventListener(PHOENIX_TICKET_UPDATE,refresh)
    window.addEventListener('storage',refresh)
    return()=>{window.removeEventListener(PHOENIX_TICKET_UPDATE,refresh);window.removeEventListener('storage',refresh)}
  },[])
  if(!history.won&&!history.lost&&!history.pending)return null
  return <small className={css.sportsUserHistory} aria-label="Historial local de tus favoritos">
    Mis favoritos: <strong>{history.won}/{history.won+history.lost}</strong> acertados
    {history.accuracy!==null&&<> · <strong>{history.accuracy.toLocaleString('es-DO')}%</strong></>}
    {history.pending>0&&<> · {history.pending} pendiente(s)</>}
    <span> · Solo elecciones previas al inicio, con finales consultados</span>
  </small>
}
/** Three independent markers: user choice, explicit PHOENIX forecast and attributed receipt. */
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

  const userKey=sportsUserChoiceKey({sport,league,date,eventId,home:home.label,away:away.label})
  const [storedUser,setStoredUser]=useState<{key:string|null;choice:SportsUserChoice|null}>(()=>({
    key:userKey,choice:readSportsUserChoice(userKey)}))
  const userChoice=storedUser.key===userKey?storedUser.choice:null
  useEffect(()=>{
    const refresh=()=>setStoredUser({key:userKey,choice:readSportsUserChoice(userKey)})
    refresh()
    if(typeof window==='undefined')return
    window.addEventListener(PHOENIX_TICKET_UPDATE,refresh)
    window.addEventListener('storage',refresh)
    return()=>{window.removeEventListener(PHOENIX_TICKET_UPDATE,refresh);window.removeEventListener('storage',refresh)}
  },[userKey])

  const ticketPicks=[...new Map([...trackedBets.filter(validTrackedPick),...receipts]
    .map(p=>[key(p),p])).values()]
  const receiptSide=pickSide(ticketPicks)
  const kiraSide=pickSide(forecasts)
  const analyticSide=sportsFavoriteSide(favorite,away.label,home.label)
  const canChoose=Boolean(userKey)&&(!hasStarted||game?.phase==='in')
  const chooseUser=(side:'home'|'away')=>{
    if(!canChoose||!userKey)return
    const next:SportsUserChoice|null=userChoice?.side===side?null:{
      side,selectedAt:new Date().toISOString(),eligibleForHistory:!hasStarted}
    if(saveSportsUserChoice(userKey,next))setStoredUser({key:userKey,choice:next})
  }
  // All three identifiers must agree with the original fixture. ESPN's
  // approximate match fallback is insufficient for a sporting verdict.
  const verifiedGame=game&&(!eventId||game.id===eventId)
    &&norm(game.home)===norm(home.label)&&norm(game.away)===norm(away.label)?game:undefined
  const stale=Boolean(meta?.stale||meta?.error)
  useEffect(()=>{
    if(!userChoice?.eligibleForHistory||userChoice.final||!userKey||verifiedGame?.phase!=='post')return
    const grade=evaluateSportsPick({receipt:'user',market:'moneyline',side:userChoice.side},verifiedGame,sport)
    if(grade.state==='won'||grade.state==='lost')
      finalizeSportsUserChoice(userKey,userChoice,grade.state)
  },[userChoice,userKey,verifiedGame,sport])
  const picks:Array<{pick:SportsTrackedPick;origin:PickOrigin}>=[
    ...ticketPicks.map(pick=>({pick,origin:'receipt' as const})),
    ...forecasts.map(pick=>({pick,origin:'forecast' as const})),
    ...(userChoice?[{pick:{receipt:'user',market:'moneyline',side:userChoice.side} as SportsTrackedPick,
      origin:'user' as const}]:[]),
  ]
  const origins:Record<PickOrigin,string>={receipt:'Boleto',forecast:'PHOENIX',user:'Mi favorito'}
  return <>
    <div className={css.sportsSlateMatch}>
      {(['away','home'] as const).map(side=>{
        const team=side==='away'?away:home
        const chosenUser=userChoice?.side===side
        const chosenReceipt=receiptSide===side
        const chosenKira=kiraSide===side
        const chosen=chosenUser||chosenReceipt||chosenKira
        const analytic=analyticSide===side
        const marked=chosen||analytic
        return <div key={side} data-selected-favorite={marked?'true':undefined}
          data-selected-pick={chosen?'true':undefined}
          data-selected-user={chosenUser?'true':undefined}
          data-selected-phoenix={chosenKira?'true':undefined}
          data-analytical-favorite={analytic?'true':undefined}
          className={[chosen?css.sportsPickedRow:'',analytic?css.sportsAnalyticalRow:''].filter(Boolean).join(' ')||undefined}>
          <Portrait side={team}/>
          <span><strong>{team.label}</strong>
            {chosenUser&&<small className={css.sportsPickTag}>✓ Tu elección</small>}
            {chosenReceipt&&<small className={css.sportsPickTag}>✓ Tu selección · boleto</small>}
            {chosenKira&&<small className={css.sportsKiraPickTag}>✦ PHOENIX eligió</small>}
            {analytic&&<small className={css.sportsFavoriteTag}>★ Favorito analítico</small>}
            {team.meta&&<small>{team.meta}</small>}</span>
          {hasStarted&&team.score!==undefined&&<b>{team.score}</b>}
          {canChoose&&<button type="button" className={css.sportsChooseFavorite}
            aria-pressed={Boolean(chosenUser)}
            aria-label={(chosenUser?'Quitar mi favorito: ':'Elegir mi favorito: ')+team.label}
            onClick={()=>chooseUser(side)}>{chosenUser?'✓ Elegido':'☆ Elegir'}</button>}
        </div>
      })}
      {!hasStarted&&<span className={css.sportsSlateVs}>{pendingLabel}</span>}
    </div>
    {picks.length>0&&<div className={css.sportsPickPanel} aria-label="Estado de la selección">
      {picks.slice(0,5).map(({pick:p,origin})=>{
        const grade=evaluateSportsPick(p,verifiedGame,sport)
        const state=verifiedGame?.phase==='in'&&stale?'review':grade.state
        return <div key={origin+key(p)} className={css.sportsPickLine}
          data-pick-status={state} data-pick-origin={origin}>
          <div className={css.sportsPickGoal}>
            <small>{origin==='receipt'?'Boleto #'+p.receipt:origins[origin]}</small>
            <strong>{pickLabel(p,away,home)}</strong>
          </div>
          <strong className={css.sportsPickResult} aria-label={label[state]}>
            <span className={css.sportsPickResultIcon} aria-hidden="true">{icon[state]}</span>
            {verifiedGame?.phase==='in'&&stale?'Marcador desactualizado':label[state]}
          </strong>
          {verifiedGame&&grade.state!=='pending'&&<small className={css.sportsPickDetail}>{grade.target}</small>}
          {(!verifiedGame||stale)&&<small className={css.sportsPickDetail}>{stale
            ?'La fuente puede tener retraso.':'Esperando marcador ESPN vinculado.'}</small>}
        </div>
      })}
      {picks.length>5&&<small>+{picks.length-5} selecciones adicionales.</small>}
      <small className={css.sportsPickDisclaimer}>
        Acierto deportivo estimado por marcador oficial; ninguna selección manual implica una apuesta.
        La casa liquida los boletos por sus propias reglas.
      </small>
    </div>}
  </>
}
