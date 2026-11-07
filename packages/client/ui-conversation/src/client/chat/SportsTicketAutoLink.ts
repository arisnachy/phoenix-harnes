/** Browser-local link between user-provided receipts and verified ESPN fixtures.
 * This ledger never represents an operator-confirmed bet, payout or account.
 * Import only explicit first-party structured ticket cards with exact teams/date/league.
 */
import type { SportsTrackedPick } from './SportsBetProgress.tsx'

export type SportsReceiptFixture={
  sport:string;providerLeague:string;eventDate:string;eventId:string;
  homeTeam:string;awayTeam:string;trackedBet:SportsTrackedPick
}
export type SportsReceiptLookup={
  sport:string;league:string;date:string;eventId?:string|undefined;home:string;away:string
}
const prefix='phoenix:sports:receipt:v2:'
export const PHOENIX_TICKET_UPDATE='phoenix:sports:ticket-updated'
const clean=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').replace(/[^a-z0-9]/giu,'').toLowerCase()
const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(s)&&
  !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s
function validPick(value:unknown):value is SportsTrackedPick{
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const p=value as Record<string,unknown>
  if(Object.keys(p).some(x=>!['receipt','market','side','line'].includes(x)))return false
  if(typeof p.receipt!=='string'||!/^[a-zA-Z0-9-]{1,25}$/u.test(p.receipt))return false
  const m=p.market,s=p.side
  const sideOK=m==='total'?(s==='over'||s==='under'):
    m==='three-way'?(s==='home'||s==='away'||s==='draw'):
      (m==='moneyline'||m==='spread')&&(s==='home'||s==='away')
  return sideOK&&((m!=='spread'&&m!=='total')||
    typeof p.line==='number'&&Number.isFinite(p.line)&&Math.abs(p.line)<=10000)
}
const fixtureOK=(x:unknown):x is SportsReceiptFixture=>{
  if(!x||typeof x!=='object'||Array.isArray(x))return false
  const v=x as Record<string,unknown>
  return Object.keys(v).every(k=>['sport','providerLeague','eventDate','eventId','homeTeam','awayTeam','trackedBet'].includes(k))
    &&typeof v.sport==='string'&&/^[a-z][a-z-]{1,35}$/u.test(v.sport)
    &&typeof v.providerLeague==='string'&&/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(v.providerLeague)
    &&typeof v.eventDate==='string'&&validDate(v.eventDate)
    &&typeof v.eventId==='string'&&/^\d{1,20}$/u.test(v.eventId)
    &&typeof v.homeTeam==='string'&&v.homeTeam.length>0&&v.homeTeam.length<=120
    &&typeof v.awayTeam==='string'&&v.awayTeam.length>0&&v.awayTeam.length<=120
    &&clean(v.homeTeam)!==clean(v.awayTeam)&&validPick(v.trackedBet)
}
const keyFor=(x:{sport:string;providerLeague:string;eventDate:string;homeTeam:string;awayTeam:string})=>
  prefix+[clean(x.sport),clean(x.providerLeague),x.eventDate,clean(x.homeTeam),clean(x.awayTeam)].join(':')
const pickKey=(p:SportsTrackedPick)=>[p.receipt,p.market,p.side,p.line??''].join('|')
function read(key:string):SportsReceiptFixture[]{
  try{
    if(typeof localStorage==='undefined')return []
    const raw=JSON.parse(localStorage.getItem(key)??'[]') as unknown
    return Array.isArray(raw)?raw.filter(fixtureOK).slice(0,24):[]
  }catch{return []}
}
/** Auto-store attributed receipt goals, never unsourced model prose. */
export function importSportsReceipt(legs:readonly unknown[]):number{
  if(typeof localStorage==='undefined'||!Array.isArray(legs))return 0
  let written=0
  for(const leg of legs.slice(0,12)){
    if(!fixtureOK(leg))continue
    const key=keyFor(leg)
    const old=read(key)
    const next=[...new Map([...old.filter(p=>p.trackedBet.receipt!==leg.trackedBet.receipt),leg]
      .map(p=>[pickKey(p.trackedBet),p])).values()].slice(-24)
    try{
      const json=JSON.stringify(next)
      if(localStorage.getItem(key)!==json){localStorage.setItem(key,json);written++}
    }catch{/* Private browsing may disable persistence: do not claim success. */}
  }
  if(written&&typeof window!=='undefined')window.dispatchEvent(new Event(PHOENIX_TICKET_UPDATE))
  return written
}
/** Exact league/date/both teams, plus ESPN event ID when both sides provide one. */
export function readSportsReceiptGoals(match:SportsReceiptLookup):SportsTrackedPick[]{
  if(!match.sport||!match.league||!validDate(match.date)||!match.home||!match.away)return []
  const key=keyFor({sport:match.sport,providerLeague:match.league,eventDate:match.date,
    homeTeam:match.home,awayTeam:match.away})
  const legs=read(key).filter(leg=>!match.eventId||leg.eventId===match.eventId)
  return [...new Map(legs.map(x=>[pickKey(x.trackedBet),x.trackedBet])).values()]
}
