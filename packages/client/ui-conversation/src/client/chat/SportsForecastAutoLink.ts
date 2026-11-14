/** Browser-local Kira forecast lookup. Predictions are never proof of a wager.
 * Only structured ticket legs with a known competition, both teams, exact
 * event date and ESPN event ID can appear on a separate scoreboard card.
 */
import { forecastFeed, forecastPick, type ForecastLeg } from './SportsForecastLive.tsx'
import { PHOENIX_TICKET_UPDATE, type SportsReceiptLookup } from './SportsTicketAutoLink.ts'
import type { SportsTrackedPick } from './SportsBetProgress.tsx'

type ForecastRecord={ eventId:string;pick:SportsTrackedPick }
const prefix='phoenix:sports:forecast:v1:'
const clean=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').replace(/[^a-z0-9]/giu,'').toLowerCase()
const key=(m:{sport:string;league:string;date:string;home:string;away:string})=>
  prefix+[clean(m.sport),clean(m.league),m.date,clean(m.home),clean(m.away)].join(':')
const marketKey=(r:ForecastRecord)=>[r.eventId,r.pick.market,r.pick.side,r.pick.line??''].join(':')
const validRecord=(v:unknown):v is ForecastRecord=>{
  if(!v||typeof v!=='object'||Array.isArray(v))return false
  const row=v as Record<string,unknown>
  if(Object.keys(row).some(k=>!['eventId','pick'].includes(k)))return false
  if(typeof row.eventId!=='string'||!/^\d{1,20}$/u.test(row.eventId))return false
  const p=row.pick
  if(!p||typeof p!=='object'||Array.isArray(p))return false
  const pick=p as Record<string,unknown>
  if(pick.receipt!=='forecast'||Object.keys(pick).some(k=>!['receipt','market','side','line'].includes(k)))return false
  const m=pick.market,s=pick.side
  return (m==='moneyline'&&(s==='home'||s==='away')
    ||m==='spread'&&(s==='home'||s==='away')
    ||m==='total'&&(s==='over'||s==='under'))
    &&(m!=='spread'&&m!=='total'||typeof pick.line==='number'
      &&Number.isFinite(pick.line)&&Math.abs(pick.line)<=10000)
}
function readRecords(k:string):ForecastRecord[]{
  try{
    if(typeof localStorage==='undefined')return []
    const v=JSON.parse(localStorage.getItem(k)??'[]') as unknown
    return Array.isArray(v)?v.filter(validRecord).slice(-8):[]
  }catch{return []}
}
/** Register only explicit structured forecasts; never infer a chosen side from prose. */
export function importSportsForecast(legs:readonly ForecastLeg[]):number{
  if(typeof localStorage==='undefined')return 0
  let written=0
  for(const leg of legs.slice(0,12)){
    const feed=forecastFeed(leg),pick=forecastPick(leg)
    if(!feed||!pick||!leg.eventId||!/^\d{1,20}$/u.test(leg.eventId)
      ||!leg.homeTeam||!leg.awayTeam||clean(leg.homeTeam)===clean(leg.awayTeam))continue
    const k=key({sport:feed.sport,league:feed.league,date:feed.date,home:leg.homeTeam,away:leg.awayTeam})
    const entry:ForecastRecord={eventId:leg.eventId,pick}
    const prior=readRecords(k)
    const next=[...new Map([...prior,entry].map(r=>[marketKey(r),r])).values()].slice(-8)
    try{
      const json=JSON.stringify(next)
      if(localStorage.getItem(k)!==json){localStorage.setItem(k,json);written++}
    }catch{/* Storage can be disabled: never imply a prediction was saved. */}
  }
  if(written&&typeof window!=='undefined')window.dispatchEvent(new Event(PHOENIX_TICKET_UPDATE))
  return written
}
/** Return predictions only when fixture IDs, dates, league and both names match. */
export function readSportsForecastGoals(match:SportsReceiptLookup):SportsTrackedPick[]{
  if(!match.eventId||!/^\d{1,20}$/u.test(match.eventId)||!match.sport||!match.league
    ||!/^\d{4}-\d{2}-\d{2}$/u.test(match.date)||!match.home||!match.away)return []
  return readRecords(key(match)).filter(r=>r.eventId===match.eventId).map(r=>r.pick)
}
