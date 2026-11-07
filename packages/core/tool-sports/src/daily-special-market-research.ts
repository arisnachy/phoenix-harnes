/** Discovery of real period/alternate/player markets for researched daily games.
 * These quotes are research-only until a market-specific outcome model exists.
 * Never treat a player prop or first-five-innings line as a full-game projection.
 */
import {dailyOddsSportKey,type DailyMarketCandidate} from './daily-market-shortlist.ts'
import {readSportsEventMarketMenu,type ExtraSportsbookOutcome} from './sports-event-market-menu.ts'

export type DailySpecialMarketObservation={
  sport:string;league:string;espnEventId:string;bookmakerEventId:string
  fixture:string;bookmaker:string;status:'observed'|'empty'|'error'|'unconfigured'|'unsupported'
  publishedMarketCount:number;marketsObserved:string[]
  offers:Array<{
    market:string;family:string;period:string;selection:string;participant:string|null
    line:number|null;decimalOdds:number;updatedAt:string;source:'The Odds API v4'
    eligibleForTicket:false;estimatedProbability:null
  }>
  warnings:string[]
}
export type DailySpecialMarketReport={
  status:'observed'|'empty'|'unconfigured';eventsChecked:number
  observations:DailySpecialMarketObservation[]
  warning:string
}
const eventIdentity=(v:DailyMarketCandidate)=>v.sport+'|'+v.league+'|'+v.espnEventId
const message=(reason:unknown):string=>{
  const detail=reason instanceof Error?reason.message:'No se pudo consultar el proveedor'
  // Error messages must not echo credential-bearing request URLs or keys.
  return /^Proveedor HTTP \d{3}$/u.test(detail)?detail:'Error de catálogo o respuesta de proveedor'
}
const authenticSameBook=(candidate:DailyMarketCandidate,offer:ExtraSportsbookOutcome)=>
  offer.bookmaker===candidate.bookmaker&&
  offer.eventId===candidate.bookmakerEventId&&
  offer.sportKey===dailyOddsSportKey(candidate.sport,candidate.league)

/** Look up special markets for a bounded group of verified standard-market fixtures.
 * @param candidates - Independently cross-matched sportsbook and ESPN observations.
 * @param env - Credential vault env; credentials are never serialized in the output.
 * @param fetcher - Safe HTTP adapter.
 * @param now - Analysis timestamp.
 * @param limit - Maximum games 1–6; default five, at most two requests in flight.
 * @returns Real observed special-market menu, without invented picks.
 */
export async function researchDailySpecialMarkets(
  candidates:readonly DailyMarketCandidate[],env:NodeJS.ProcessEnv=process.env,
  fetcher:typeof fetch=fetch,now=Date.now(),limit=5,
):Promise<DailySpecialMarketReport>{
  if(!Number.isInteger(limit)||limit<1||limit>6)throw Error('Investigar 1–6 eventos')
  const unique=new Map<string,DailyMarketCandidate>()
  for(const c of candidates){
    if(!dailyOddsSportKey(c.sport,c.league)||c.source!=='The Odds API'||
      !c.bookmakerEventId||!c.bookmaker)continue
    if(!unique.has(eventIdentity(c)))unique.set(eventIdentity(c),c)
  }
  const eligible=[...unique.values()].slice(0,limit)
  const warning='Ofertas especiales reales observadas, NO selecciones aprobadas. F5, props, períodos y alternativos necesitan datos y modelos específicos de ese mercado; las cuotas NO pertenecen a Juancito salvo identificación explícita. No se realiza ninguna apuesta.'
  if(!env.THE_ODDS_API_KEY?.trim()){
    return {status:'unconfigured',eventsChecked:0,observations:[],warning:
      warning+' Falta configurar la clave autorizada de The Odds API v4.'}
  }
  const observations:DailySpecialMarketObservation[]=[]
  for(let i=0;i<eligible.length;i+=2){
    const group=eligible.slice(i,i+2)
    const results=await Promise.allSettled(group.map(c=>readSportsEventMarketMenu(
      dailyOddsSportKey(c.sport,c.league)!,c.bookmakerEventId,env,fetcher,now,10)))
    results.forEach((result,j)=>{
      const c=group[j]!
      if(result.status!=='fulfilled'){
        observations.push({sport:c.sport,league:c.league,espnEventId:c.espnEventId,
          bookmakerEventId:c.bookmakerEventId,fixture:c.fixture,bookmaker:c.bookmaker,
          status:'error',publishedMarketCount:0,marketsObserved:[],offers:[],
          warnings:[message(result.reason)]})
        return
      }
      const report=result.value
      const matched=report.quotes.filter(offer=>authenticSameBook(c,offer))
      observations.push({
        sport:c.sport,league:c.league,espnEventId:c.espnEventId,
        bookmakerEventId:c.bookmakerEventId,fixture:c.fixture,bookmaker:c.bookmaker,
        status:matched.length?'observed':report.status==='observed'?'empty':report.status,
        publishedMarketCount:report.publishedMarkets.length,
        marketsObserved:[...new Set(matched.map(x=>x.market))],
        offers:matched.slice(0,36).map(offer=>({
          market:offer.market,family:offer.family,period:offer.period,
          selection:offer.selection,participant:offer.participant,line:offer.point,
          decimalOdds:offer.decimalOdds,updatedAt:offer.updatedAt,source:offer.source,
          eligibleForTicket:false as const,estimatedProbability:null,
        })),
        warnings:[...report.errors.map(message),
          ...(report.status==='observed'&&!matched.length?
            ['El proveedor cotizó mercados, pero no esta casa exacta']:[])],
      })
    })
  }
  return {status:observations.some(x=>x.status==='observed')?'observed':'empty',
    eventsChecked:observations.length,observations,warning}
}
