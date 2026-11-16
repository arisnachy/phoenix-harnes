/** Browser-local user favorites, separate from both PHOENIX forecasts and bookmaker receipts.
 * A final ESPN score is a sporting outcome, never proof of a settled wager.
 */
import {PHOENIX_TICKET_UPDATE,type SportsReceiptLookup} from './SportsTicketAutoLink.ts'

export type SportsUserChoice={
  side:'home'|'away'
  selectedAt:string
  eligibleForHistory:boolean
  final?:'won'|'lost'
}
const PREFIX='phoenix:sports:user-pick:v1:'
const clean=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .replace(/[^a-z0-9]/giu,'').toLowerCase()
const validDay=(value:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(value)
  &&!Number.isNaN(Date.parse(value+'T00:00:00Z'))
  &&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value

/** Do not store a choice unless date, league, both teams and ESPN event ID are known. */
export function sportsUserChoiceKey(match:SportsReceiptLookup):string|null{
  if(!match.sport||!match.league||!validDay(match.date)
    ||!match.eventId||!/^\d{1,20}$/u.test(match.eventId)
    ||!match.home||!match.away||clean(match.home)===clean(match.away))return null
  return PREFIX+JSON.stringify([clean(match.sport),clean(match.league),match.date,
    match.eventId,clean(match.home),clean(match.away)])
}
const validChoice=(v:unknown):v is SportsUserChoice=>{
  if(!v||typeof v!=='object'||Array.isArray(v))return false
  const p=v as Record<string,unknown>
  return Object.keys(p).every(k=>['side','selectedAt','eligibleForHistory','final'].includes(k))
    &&(p.side==='away'||p.side==='home')
    &&typeof p.selectedAt==='string'&&p.selectedAt.length<=40
    &&!Number.isNaN(Date.parse(p.selectedAt))
    &&typeof p.eligibleForHistory==='boolean'
    &&(p.final===undefined||p.final==='won'||p.final==='lost')
}
/** Read one precisely identified event; invalid or disabled local storage returns null. */
export function readSportsUserChoice(key:string|null):SportsUserChoice|null{
  if(!key||!key.startsWith(PREFIX))return null
  try{
    if(typeof localStorage==='undefined')return null
    const value=JSON.parse(localStorage.getItem(key)??'null') as unknown
    return validChoice(value)?value:null
  }catch{return null}
}
/** Persist or remove one user-only choice and notify all visible scoreboards. */
export function saveSportsUserChoice(key:string|null,choice:SportsUserChoice|null):boolean{
  if(!key||!key.startsWith(PREFIX)||choice!==null&&!validChoice(choice))return false
  try{
    if(typeof localStorage==='undefined')return false
    if(choice)localStorage.setItem(key,JSON.stringify(choice))
    else localStorage.removeItem(key)
    if(typeof window!=='undefined')window.dispatchEvent(new Event(PHOENIX_TICKET_UPDATE))
    return true
  }catch{return false}
}
/** Grade only a pregame choice against a verified final and never rewrite a prior result. */
export function finalizeSportsUserChoice(key:string|null,choice:SportsUserChoice,
  result:'won'|'lost'):boolean{
  if(!key||!choice.eligibleForHistory||choice.final)return false
  const current=readSportsUserChoice(key)
  if(!current||current.side!==choice.side||current.selectedAt!==choice.selectedAt||current.final)return false
  return saveSportsUserChoice(key,{...current,final:result})
}
/** Local history includes only pregame picks whose exact ESPN finals have been observed. */
export function sportsUserHistory():{won:number;lost:number;pending:number;accuracy:number|null}{
  let won=0,lost=0,pending=0
  try{
    if(typeof localStorage==='undefined')return {won,lost,pending,accuracy:null}
    for(let i=0;i<Math.min(localStorage.length,5000);i++){
      const k=localStorage.key(i)
      if(!k?.startsWith(PREFIX))continue
      const choice=readSportsUserChoice(k)
      if(!choice?.eligibleForHistory)continue
      if(choice.final==='won')won++
      else if(choice.final==='lost')lost++
      else pending++
    }
  }catch{return {won:0,lost:0,pending:0,accuracy:null}}
  return {won,lost,pending,accuracy:won+lost?Math.round(won/(won+lost)*1000)/10:null}
}
