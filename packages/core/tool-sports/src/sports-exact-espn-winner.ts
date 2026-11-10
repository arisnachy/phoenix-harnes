/** Targeted, keyless ESPN public winner odds recovery for an exact future fixture.
 * Daily league-level odds discovery can silently miss events due to the global
 * request cap or Santo Domingo evening games listed on the following UTC day.
 * This adapter checks both UTC dates by *exact ESPN event ID*; it NEVER
 * promotes an unnamed bookmaker, unmatched fixture, or commenced game.
 * The last-update field is optional; observedAt identifies this ESPN read.
 */
import {fetchPublicEspnOddsDetailed,type EspnOddsObservation} from './espn-odds.ts'
import type {KeylessQuote} from './keyless-odds.ts'

const norm=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const validDate=(day:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(day)&&
  !Number.isNaN(Date.parse(day+'T00:00:00Z'))&&
  new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day
export type ExactEspnWinnerTarget={
  sportKey:string;eventId:string;date:string;home:string;away:string;kickoff:string;
  espnLeague?:string
}
export type ExactEspnWinnerResult={
  eventId:string;source:'ESPN Site/Core (evento exacto, sin clave)'
  quotes:KeylessQuote[];referenceOdds:EspnOddsObservation[]
  referenceCount:number;attempted:boolean;notes:string[]
}
export async function lookupExactEspnWinner(
  target:ExactEspnWinnerTarget,getJSON:<T>(url:string)=>Promise<T>,
  now=Date.now(),
):Promise<ExactEspnWinnerResult>{
  const result:ExactEspnWinnerResult={
    eventId:target.eventId,source:'ESPN Site/Core (evento exacto, sin clave)',
    quotes:[],referenceOdds:[],referenceCount:0,attempted:false,notes:[],
  }
  const kickoff=Date.parse(target.kickoff)
  if(!/^[a-z0-9_]{3,80}$/u.test(target.sportKey)||
    !/^\d{1,16}$/u.test(target.eventId)||!validDate(target.date)||
    !Number.isFinite(kickoff)||kickoff<=now||
    !target.home.trim()||!target.away.trim()||
    (target.sportKey==='soccer_espn_dynamic'&&
      !/^[a-z][a-z0-9.-]{1,39}$/u.test(target.espnLeague??''))) {
    result.notes.push('Evento futuro no validado; no intentar cotización')
    return result
  }
  const day=new Date(Math.min(Date.parse(target.date+'T00:00:00Z'),kickoff))
    .toISOString().slice(0,10)
  result.attempted=true
  try{
    const scanned=await fetchPublicEspnOddsDetailed(
      target.sportKey,'h2h',getJSON,
      {date:day,days:2,eventId:target.eventId,now,cache:false,
        ...(target.sportKey==='soccer_espn_dynamic'?{espnLeague:target.espnLeague}:{})},
    )
    // An official ESPN sportsbook price with no updatedAt is an authentic
    // observation, but never a certified currently executable bookmaker line.
    result.referenceOdds=scanned.observations.filter(q=>
      q.eventId===target.eventId&&q.market==='h2h'&&q.point===null&&
      norm(q.home)===norm(target.home)&&norm(q.away)===norm(target.away)&&
      [norm(target.home),norm(target.away),'draw'].includes(norm(q.selection))&&
      Math.abs(Date.parse(q.timeIso)-kickoff)<=90_000&&
      q.price>1&&q.price<1000&&
      !q.bookmaker.startsWith('ESPN proveedor #'))
    result.referenceCount=result.referenceOdds.length
    const soccer=target.sportKey.startsWith('soccer_')
    const valid=scanned.quotes.filter(q=>
      q.eventId===target.eventId&&q.market==='h2h'&&q.point===null&&
      norm(q.home)===norm(target.home)&&norm(q.away)===norm(target.away)&&
      [norm(target.home),norm(target.away),'draw'].includes(norm(q.selection))&&
      Math.abs(Date.parse(q.timeIso)-kickoff)<=90_000&&
      Number.isFinite(Date.parse(q.observedAt??''))&&
      Date.parse(q.observedAt!)<=now&&
      now-Date.parse(q.observedAt!)<=15*60_000&&
      q.price>1&&q.price<1000&&!q.bookmaker.startsWith('ESPN proveedor #'))
    const soccerBooks=new Set(valid.filter(q=>norm(q.selection)==='draw')
      .map(q=>q.bookmaker))
    // Soccer 1X2 requires an actual draw price from the SAME bookmaker.
    result.quotes=valid.filter(q=>!soccer||soccerBooks.has(q.bookmaker))
      .map(q=>({
        eventId:q.eventId,bookmaker:q.bookmaker,
        market:soccer?'1x2':'h2h',
        selection:q.selection,point:null,price:q.price,home:q.home,away:q.away,
        time:q.timeIso,updatedAt:q.updatedAt,observedAt:q.observedAt,
        source:result.source,sportKey:target.sportKey,
      }))
    result.notes.push(...scanned.diagnostics.notes.slice(0,3))
    if(!result.quotes.length)result.notes.push(
      result.referenceCount?
        'ESPN publicó referencias sin proveedor identificado o con hora inconsistente; '+
        'no se añadieron como cuotas observadas.':
        'Sin cuotas de ganador con casa, ID y mercado cotejables para este evento')
  }catch(error){
    result.notes.push((error instanceof Error?error.message:String(error)).slice(0,240))
  }
  return result
}
