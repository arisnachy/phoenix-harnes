/** Read-only score tracking for research picks with no bookmaker receipt.
 * A forecast's sporting outcome is NOT a settled or paid betting ticket.
 */
import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react'
import {evaluateSportsPick,type SportsPickGrade,type SportsTrackedPick} from './SportsBetProgress.tsx'
import {SportsLiveProvider,type PhoenixLiveGame,type PhoenixLiveMeta} from './SportsLive.tsx'
import css from './SportsForecastLive.module.css'

export type ForecastLeg={
  event:string;selection:string;market?:string;league?:string;sport?:string;providerLeague?:string;
  eventDate?:string;eventId?:string;when?:string;homeTeam?:string;awayTeam?:string
}
type Grade=SportsPickGrade['state']
type Store={states:Record<number,Grade>;report:(index:number,state:Grade)=>void;total:number}
const Context=createContext<Store|null>(null)
const normalize=(value?:string)=>value?.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .replace(/[^a-zA-Z0-9]/gu,'').toLowerCase()??''
const dateFromLeg=(leg:ForecastLeg):string|undefined=>{
  if(leg.eventDate&&/^\d{4}-\d{2}-\d{2}$/u.test(leg.eventDate))return leg.eventDate
  const m=leg.when?.match(/(?:^|\s)(\d{1,2})\s+(?:de\s+)?(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-záéíóú]*\s+(?:de\s+)?(20\d{2})(?!\d)/iu)
  if(!m)return undefined
  const months=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  const month=months.indexOf(m[2]!.toLowerCase())
  const day=Number(m[1])
  return month>=0&&day>=1&&day<=31?m[3]+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0'):undefined
}
const leagueFeeds:Record<string,[string,string]>={
  nfl:['football','nfl'],nba:['basketball','nba'],wnba:['basketball','wnba'],mlb:['baseball','mlb'],
  nhl:['hockey','nhl'],mls:['soccer','usa.1'],usa1:['soccer','usa.1'],
  laliga:['soccer','esp.1'],esp1:['soccer','esp.1'],
  premierleague:['soccer','eng.1'],eng1:['soccer','eng.1'],
  ligamx:['soccer','mex.1'],mex1:['soccer','mex.1'],
  seriea:['soccer','ita.1'],ita1:['soccer','ita.1'],
  primeiraliga:['soccer','por.1'],por1:['soccer','por.1'],
  eredivisie:['soccer','ned.1'],ned1:['soccer','ned.1'],
  bundesliga:['soccer','ger.1'],ger1:['soccer','ger.1'],
  ligue1:['soccer','fra.1'],fra1:['soccer','fra.1'],
  brasileiraoseriea:['soccer','bra.1'],bra1:['soccer','bra.1'],
  ligaprofesional:['soccer','arg.1'],arg1:['soccer','arg.1'],
  uefaeuropaleague:['soccer','uefa.europa'],uefaeuropa:['soccer','uefa.europa'],
  copamundial:['soccer','fifa.world'],fifaworld:['soccer','fifa.world'],
  uefachampionsleague:['soccer','uefa.champions'],uefachampions:['soccer','uefa.champions'],
}
export function forecastFeed(leg:ForecastLeg):{sport:string;league:string;date:string}|null{
  const known=leagueFeeds[normalize(leg.league)]??leagueFeeds[normalize(leg.providerLeague)]
  const date=dateFromLeg(leg)
  if(!known||!date)return null
  // An explicit provider slug may be used only when it matches this known competition.
  if(leg.providerLeague&&normalize(leg.providerLeague)!==normalize(known[1]))return null
  return {sport:known[0],league:known[1],date}
}
/** Derive only exact, self-evident goals. Do not guess a bet from a team's mere appearance. */
export function forecastPick(leg:ForecastLeg):SportsTrackedPick|null{
  const home=normalize(leg.homeTeam),away=normalize(leg.awayTeam)
  if(!home||!away||home===away)return null
  const chosen=normalize(leg.selection)
  const market=normalize(leg.market)
  const selected=chosen===home?'home':chosen===away?'away':null
  if(selected&&(!market||[
    'ganador','ganadorpronostico','moneyline','h2h','ganadorfinal',
    '1x2pronostico','1x2','win',
  ].includes(market)))
    return {receipt:'forecast',market:'moneyline',side:selected}
  const over=leg.selection.match(/^(?:más de|mas de|arriba|over)\s+(\d+(?:[.,]\d+)?)\s*(?:puntos|goles|carreras)?$/iu)
  const under=leg.selection.match(/^(?:menos de|abajo|under)\s+(\d+(?:[.,]\d+)?)\s*(?:puntos|goles|carreras)?$/iu)
  const total=over??under
  if(total&&(!market||/total|over|under|masde|menosde|arriba|abajo/u.test(market))){
    const line=Number(total[1]!.replace(',','.'))
    if(Number.isFinite(line)&&line>=0&&line<=10000)return{
      receipt:'forecast',market:'total',side:over?'over':'under',line}
  }
  const handicap=leg.selection.match(/\s([+-]\d+(?:[.,]\d+)?)$/u)
  if(handicap&&/spread|handicap|hándicap|linea|line|runline|puckline/iu.test(leg.market??'')){
    const team=normalize(leg.selection.slice(0,handicap.index))
    const side=team===home?'home':team===away?'away':null
    const line=Number(handicap[1]!.replace(',','.'))
    if(side&&Number.isFinite(line)&&Math.abs(line)<=10000)
      return {receipt:'forecast',market:'spread',side,line}
  }
  return null
}
export function ForecastTicketScope({legs,children}:{legs:readonly ForecastLeg[];children:ReactNode}):ReactNode{
  const [states,setStates]=useState<Record<number,Grade>>({})
  const report=useCallback((index:number,state:Grade)=>{
    setStates(prev=>prev[index]===state?prev:{...prev,[index]:state})
  },[])
  const value=useMemo(()=>({states,report,total:legs.length}),[states,report,legs.length])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function ForecastTicketSummary():ReactNode{
  const store=useContext(Context)
  if(!store)return null
  const all=Array.from({length:store.total},(_,i)=>store.states[i]??'pending')
  const won=all.filter(x=>x==='won').length,lost=all.filter(x=>x==='lost').length
  const leading=all.filter(x=>x==='leading').length,trailing=all.filter(x=>x==='trailing').length
  const unresolved=all.filter(x=>['pending','review','push'].includes(x)).length
  const complete=store.total>0&&won===store.total
  return <div className={css.summary} aria-label="Estado deportivo de los pronósticos">
    <div><strong>{complete?'Todos los resultados deportivos acertados':lost?'Hay pronósticos fallados':'Seguimiento inteligente de las selecciones'}</strong>
      <small>{won} aciertos finales · {lost} fallos finales · {leading} acertando ahora · {trailing} sin acertar ahora · {unresolved} pendientes/revisión</small></div>
    <span className={css.count}>{won} / {store.total}<small>Finales acertados</small></span>
    <small className={css.disclaimer}>Solo marcadores deportivos: no son apuestas aceptadas, liquidadas ni pagadas.</small>
  </div>
}
const labels:Record<Grade,string>={
  pending:'Pendiente de verificar',leading:'Acertando ahora',trailing:'Sin acertar ahora',
  won:'Acertada al final · provisional',lost:'Fallada al final · provisional',
  push:'Línea exacta · revisar',review:'Revisión necesaria',
}
function ForecastLiveState({leg,index,game,meta,pick}:{leg:ForecastLeg;index:number;game?:PhoenixLiveGame|undefined;
  meta:PhoenixLiveMeta;pick:SportsTrackedPick}):ReactNode{
  const store=useContext(Context)
  const exact=game&&(!leg.eventId||game.id===leg.eventId)
    &&normalize(game.home)===normalize(leg.homeTeam)&&normalize(game.away)===normalize(leg.awayTeam)?game:undefined
  const sport=forecastFeed(leg)?.sport
  const grade=exact?evaluateSportsPick(pick,exact,sport):null
  const current:Grade=exact?.phase==='in'&&(meta.error||meta.stale)?'review':grade?.state??'pending'
  useEffect(()=>{store?.report(index,current)},[store?.report,index,current])
  return <span className={css.live} data-forecast-leg-state={current}>
    <strong className={css.status}>{labels[current]}</strong>
    {exact&&<span className={css.score}>{exact.awayScore??'–'} – {exact.homeScore??'–'} · {
      exact.phase==='post'?'Final':exact.phase==='in'?exact.status:'No iniciado'}</span>}
    {exact&&grade&&<small>{grade.target}</small>}
    {(meta.error||meta.stale)&&<small>Marcador sin actualización reciente</small>}
    {!exact&&<small>{meta.error?'ESPN no disponible':'Buscando partido verificado por fecha y equipos'}</small>}
  </span>
}
export function ForecastTicketLegStatus({leg,index}:{leg:ForecastLeg;index:number}):ReactNode{
  const store=useContext(Context)
  const feed=forecastFeed(leg),pick=forecastPick(leg)
  useEffect(()=>{if(!feed||!pick)store?.report(index,'pending')},[store?.report,index,Boolean(feed&&pick)])
  if(!feed||!pick)return <span className={css.live} data-forecast-leg-state="pending">
    <strong className={css.unlinked}>Seguimiento sin vincular</strong>
    <small>Faltan datos verificables del partido o del mercado</small>
  </span>
  return <SportsLiveProvider sport={feed.sport} league={feed.league} date={feed.date}>
    {(get,meta)=><ForecastLiveState leg={leg} index={index} meta={meta} pick={pick}
      game={get({...(leg.eventId?{eventId:leg.eventId}:{}),
        home:{label:leg.homeTeam!},away:{label:leg.awayTeam!}})}/>}
  </SportsLiveProvider>
}
