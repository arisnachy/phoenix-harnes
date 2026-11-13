/** Final sports_chat_odds gate: an ESPN observation is NOT a bookmaker
 * last-change timestamp. Live ESPN readings may have old/missing updatedAt.
 * Do not promote already-started fixtures, anonymous providers or missing prices.
 */
export type QuoteGateInput={
  eventId:string;bookmaker:string;market:string;selection:string;price:number
  time?:string;timeIso?:string;source?:string;updatedAt?:string;observedAt?:string
}
export type QuoteGateDecision=
  'espn_observed'|'provider_recent'|'started_or_invalid_event'|
  'missing_price_or_bookmaker'|'espn_observation_missing_or_old'|
  'future_bookmaker_timestamp'|'provider_timestamp_missing_or_old'

export function explainOddsEligibility(q:QuoteGateInput,now=Date.now()):QuoteGateDecision{
  const kickoff=Date.parse(q.timeIso??q.time??'')
  if(!Number.isFinite(kickoff)||kickoff<=now)return 'started_or_invalid_event'
  if(!q.eventId?.trim()||!q.bookmaker?.trim()||
    q.bookmaker.startsWith('ESPN proveedor #')||
    !q.market?.trim()||!q.selection?.trim()||
    !Number.isFinite(q.price)||q.price<=1||q.price>=1000)
    return 'missing_price_or_bookmaker'
  const updated=Date.parse(q.updatedAt??'')
  if(Number.isFinite(updated)&&updated>now+5*60_000)
    return 'future_bookmaker_timestamp'
  if(q.source?.startsWith('ESPN ')===true){
    const observed=Date.parse(q.observedAt??'')
    // A fresh ESPN fetch supplies the observation date even when the house
    // does not give the last price-change date. Keep the two timestamps distinct.
    return Number.isFinite(observed)&&observed<=now&&now-observed<=15*60_000?
      'espn_observed':'espn_observation_missing_or_old'
  }
  // A fresh provider read is sufficient; the bookmaker last-change time is optional.
  const observed=Date.parse(q.observedAt??'')
  if(Number.isFinite(observed))return observed<=now&&now-observed<=15*60_000?
    'provider_recent':'provider_timestamp_missing_or_old'
  // Compatible fallback for providers supplying only a recent last-change time.
  return Number.isFinite(updated)&&updated<=now&&now-updated<=60*60_000?
    'provider_recent':'provider_timestamp_missing_or_old'
}
export const eligibleOddsForResearch=(q:QuoteGateInput,now=Date.now()):boolean=>{
  const result=explainOddsEligibility(q,now)
  return result==='espn_observed'||result==='provider_recent'
}
