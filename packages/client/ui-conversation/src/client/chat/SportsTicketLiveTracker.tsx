/** Native grouped receipt tracker: one ticket, every matched ESPN fixture.
 * Scores can satisfy goals provisionally; only the sportsbook settles bets.
 */
import {useCallback,useEffect,useMemo,useState,type ReactNode} from 'react'
import {evaluateSportsPick,validTrackedPick,type SportsPickGrade,type SportsTrackedPick} from './SportsBetProgress.tsx'
import {SportsLiveProvider,type PhoenixLiveGame,type PhoenixLiveMeta} from './SportsLive.tsx'
import {importSportsReceipt,type SportsReceiptFixture} from './SportsTicketAutoLink.ts'
import css from './SportsTicketLiveTracker.module.css'

export type TicketLeg={
  event:string;selection:string;price:string;bookmaker:string;when?:string;
  sport?:string;league?:string;providerLeague?:string;eventDate?:string;eventId?:string;
  homeTeam?:string;awayTeam?:string;homeLogo?:string;awayLogo?:string;
  trackedBet?:SportsTrackedPick
}
export type TicketProps={
  ticketReference?:string;title:string;subtitle?:string;source:string;note:string;
  stake?:string;grossReturn?:string;legs:TicketLeg[]
}
export type TicketState=SportsPickGrade['state']
export type TicketSummary={
  total:number;won:number;lost:number;leading:number;trailing:number;pending:number;review:number;push:number;
  completed:number;covering:number;label:string;state:'pending'|'live'|'won'|'lost'|'review'
}
export function summarizeTicketGrades(states:readonly TicketState[]):TicketSummary{
  const n=(v:TicketState)=>states.filter(x=>x===v).length
  const won=n('won'),lost=n('lost'),leading=n('leading'),trailing=n('trailing')
  const pending=n('pending'),review=n('review'),push=n('push'),total=states.length
  const completed=won+lost+review+push
  const state:TicketSummary['state']=lost?'lost':
    total>0&&won===total?'won':
      review||push?'review':leading||trailing?'live':'pending'
  const label=state==='won'?'Todas las patas cumplen · resultado provisional':
    state==='lost'?'Una o más patas perdidas · resultado provisional':
      state==='review'?'Falta revisar reglas de liquidación':
        state==='live'?'Boleto en juego · los marcadores pueden cambiar':
          'Pendiente de marcadores oficiales'
  return {total,won,lost,leading,trailing,pending,review,push,completed,covering:won+leading,state,label}
}
const pendingGrade:SportsPickGrade={state:'pending',label:'Sin verificación',target:'Marcador pendiente'}
const isLinked=(leg:TicketLeg,reference:string)=>Boolean(leg.sport&&leg.providerLeague&&leg.eventId&&
  leg.eventDate&&leg.homeTeam&&leg.awayTeam&&validTrackedPick(leg.trackedBet)&&leg.trackedBet.receipt===reference)
const stateCss=(s:TicketState)=>s==='won'||s==='leading'?css.positive:
  s==='lost'||s==='trailing'?css.negative:
    s==='review'||s==='push'?css.review:css.pending
const goal=(leg:TicketLeg)=>{
  const p=leg.trackedBet
  if(!p)return leg.selection
  if(p.market==='total')return(p.side==='over'?'Más de ':'Menos de ')+p.line
  if(p.side==='draw')return 'Empate'
  const team=p.side==='home'?leg.homeTeam:leg.awayTeam
  if(p.market==='spread')return(team??'Equipo')+' '+((p.line??0)>0?'+':'')+String(p.line)
  return(team??'Equipo')+' gana'
}
function Team({name,logo,selected,score}:{
  name:string;logo?:string|undefined;selected:boolean;score?:string|undefined
}):ReactNode{
  const url=logo&&/^https:\/\/a\.espncdn\.com\//u.test(logo)
  return <div className={css.team} data-selected={selected?'true':'false'}>
    <span className={css.avatar}>{url?<img src={logo} alt="" loading="lazy" referrerPolicy="no-referrer"/>:
      <span aria-hidden="true">{name.slice(0,2).toUpperCase()}</span>}</span>
    <strong className={css.teamName}>{name}</strong>
    {selected&&<span className={css.selected} aria-label="Selección del boleto">✓</span>}
    <b className={css.score}>{score??'–'}</b>
  </div>
}
function LiveLegContent({leg,index,receipt,game,meta,onGrade}:{
  leg:TicketLeg;index:number;receipt:string;game?:PhoenixLiveGame|undefined;
  meta:PhoenixLiveMeta;onGrade:(i:number,s:TicketState)=>void
}):ReactNode{
  const linked=isLinked(leg,receipt)
  // ESPN matchEspnGame allows an ID fallback for MLB. Real receipts require
  // exact ESPN ID and team identities before any provisional grading.
  const exact=linked&&game!==undefined&&game.id===leg.eventId&&game.home===leg.homeTeam&&game.away===leg.awayTeam?game:undefined
  const p=leg.trackedBet
  const grade=linked&&p?evaluateSportsPick(p,exact,leg.sport):pendingGrade
  useEffect(()=>onGrade(index,grade.state),[index,grade.state,onGrade])
  const phase=exact?.phase==='post'?'Finalizado':exact?.phase==='in'?'EN VIVO · '+exact.status:
    exact?.phase==='pre'?'No iniciado':'Marcador pendiente'
  return <article className={css.leg+' '+stateCss(grade.state)}
    data-leg-state={grade.state} data-ticket-leg={index+1}>
    <div className={css.legHead}>
      <span className={css.number}>{String(index+1).padStart(2,'0')}</span>
      <div><strong>{leg.sport==='hockey'?'🏒':leg.sport==='soccer'?'⚽':
        leg.sport==='basketball'?'🏀':leg.sport==='baseball'?'⚾':'🏆'} {leg.league??leg.providerLeague??'Evento'}</strong>
        <small>{leg.when??leg.eventDate??'Hora pendiente'}</small></div>
      <span className={css.phase}>{phase}</span>
    </div>
    <div className={css.teams}>
      <Team name={leg.awayTeam??'Equipo visitante sin verificar'} logo={leg.awayLogo}
        selected={Boolean(linked&&p?.side==='away'&&p.market!=='total')} score={exact?.awayScore}/>
      <Team name={leg.homeTeam??'Equipo local sin verificar'} logo={leg.homeLogo}
        selected={Boolean(linked&&p?.side==='home'&&p.market!=='total')} score={exact?.homeScore}/>
    </div>
    <div className={css.goal}>
      <small>OBJETIVO DE LA PATA · BOLETO #{receipt}</small>
      <strong>{goal(leg)}</strong>
      <span className={css.grade}>{grade.label}</span>
      <span>{linked?grade.target:'Falta vincular este partido inequívocamente con ESPN.'}</span>
      {meta.error||meta.stale?<small>Datos sin actualizar; el estado puede haber cambiado.</small>:null}
    </div>
    <details className={css.details}><summary>Detalles del partido</summary>
      <small>ESPN: {leg.eventId??'Sin ID'} · {leg.eventDate??'Sin fecha'} · {leg.sport??'Deporte'}</small>
      {exact?.periods?.length?<small>Períodos: {exact.periods.map(v=>v.label+': '+v.away+'–'+v.home).join(' · ')}</small>:null}
      {exact?.lastPlay&&<small>Última jugada: {exact.lastPlay}</small>}
    </details>
  </article>
}
function LiveLeg({leg,index,receipt,onGrade}:{
  leg:TicketLeg;index:number;receipt:string;onGrade:(i:number,s:TicketState)=>void
}):ReactNode{
  if(!isLinked(leg,receipt))return <LiveLegContent leg={leg} index={index} receipt={receipt}
    onGrade={onGrade} meta={{enabled:false,stale:true,error:false,updatedAt:0}}/>
  return <SportsLiveProvider sport={leg.sport} league={leg.providerLeague} date={leg.eventDate}>
    {(get,meta)=><LiveLegContent leg={leg} index={index} receipt={receipt}
      game={get({eventId:leg.eventId!,home:{label:leg.homeTeam!},away:{label:leg.awayTeam!}})}
      onGrade={onGrade} meta={meta}/>}
  </SportsLiveProvider>
}
/** One complete grouped panel instead of an unrelated multi-game league slate. */
export function SportsTicketLiveTracker({props}:{props:TicketProps}):ReactNode{
  const receipt=props.ticketReference??''
  const [statuses,setStatuses]=useState<Record<number,TicketState>>({})
  const report=useCallback((i:number,state:TicketState)=>{
    setStatuses(old=>old[i]===state?old:{...old,[i]:state})
  },[])
  const linked=useMemo(()=>props.legs.flatMap(leg=>isLinked(leg,receipt)?[{
    sport:leg.sport!,providerLeague:leg.providerLeague!,eventDate:leg.eventDate!,
    eventId:leg.eventId!,homeTeam:leg.homeTeam!,awayTeam:leg.awayTeam!,
    trackedBet:leg.trackedBet!,
  } satisfies SportsReceiptFixture]:[]),[props.legs,receipt])
  useEffect(()=>{importSportsReceipt(linked)},[linked])
  const summary=summarizeTicketGrades(props.legs.map((_,i)=>statuses[i]??'pending'))
  return <section className={css.root} data-generative-ui="sports_ticket_card"
    data-ticket-reference={receipt} aria-label={'Seguimiento del boleto '+receipt}>
    <header className={css.header}>
      <div className={css.eyebrow}><span>PHOENIX / TICKET TRACKER</span><span>Actualización automática ESPN</span></div>
      <h3>Boleto #{receipt}</h3>
      <p>Seguimiento de las {summary.total} patas de esta acumulada</p>
      <strong className={css.summary+' '+(summary.state==='won'?css.positive:
        summary.state==='lost'?css.negative:summary.state==='review'?css.review:css.pending)}
        data-ticket-state={summary.state}>{summary.label}</strong>
      <div className={css.metrics}>
        <div><b>{summary.total}</b><small>Total de patas</small></div>
        <div><b>{summary.covering}</b><small>Cumpliendo ahora</small></div>
        <div><b>{summary.completed}</b><small>Terminadas / revisión</small></div>
        <div><b>{summary.lost}</b><small>Perdidas provisionales</small></div>
      </div>
      <div className={css.progress} role="progressbar" aria-label="Patas finalizadas o por revisión"
        aria-valuemin={0} aria-valuemax={summary.total} aria-valuenow={summary.completed}>
        <span style={{width:(summary.total?100*summary.completed/summary.total:0)+'%'}}/>
      </div>
      <div className={css.money}>
        {props.stake&&<span>Importe: <b>RD$ {props.stake}</b></span>}
        {props.grossReturn&&<span>Retorno potencial del recibo: <b>RD$ {props.grossReturn}</b></span>}
      </div>
    </header>
    <div className={css.grid}>{props.legs.map((leg,i)=>
      <LiveLeg key={receipt+'-'+i+'-'+(leg.eventId??'sin-id')} leg={leg} index={i}
        receipt={receipt} onGrade={report}/>)}</div>
    <footer className={css.footer}>
      <strong>{summary.won} ganadas provisionalmente · {summary.lost} perdidas · {summary.leading} cumpliendo en vivo · {summary.trailing} sin cumplir en vivo · {summary.pending+summary.review+summary.push} pendientes/revisión.</strong>
      <small>El cálculo utiliza marcadores públicos y el objetivo del comprobante. No confirma aceptación, liquidación ni pago. Las anulaciones, prolongaciones y reglas del operador requieren validación adicional.</small>
    </footer>
  </section>
}
