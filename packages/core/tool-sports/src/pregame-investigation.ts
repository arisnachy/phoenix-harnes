/**
 * Independent ESPN pregame context checks, beyond win/loss scoreboards.
 * A successful HTTP response is not proof that injuries, projected starters,
 * or lineups are available. Empty ESPN payloads must never mean "healthy".
 */
import { getFeed } from './sports.ts'

/** Provider-verified future event identity for source cross-checks. */
export type PregameEvent = {
  sport:string;league:string;eventId:string
}
/** Verified source presence and explicit unresolved clinical/sport context. */
export type PregameAssessment = {
  summaryVerified:boolean
  injuryReportVerified:boolean
  limitations:string[]
}
const record=(value:unknown):value is Record<string,unknown>=>
  value!==null&&typeof value==='object'&&!Array.isArray(value)
const list=(value:unknown):value is unknown[]=>Array.isArray(value)
const EVENT_ID=/^\d{1,20}$/u
const CODE=/^[a-z0-9][a-z0-9._-]{0,79}$/u
const leagueKey=(e:PregameEvent)=>e.sport+'|'+e.league

/**
 * Rechecks selected events and league injury feeds once per league. No
 * unsupported odds, implied probabilities, player statuses or starters are
 * inferred from unstructured HTML or empty responses.
 * @param events - Verified ESPN identifiers from the research slate.
 * @param fetcher - Fixed-host, bounded JSON transport.
 * @returns Auditable coverage and missing pregame-data notices.
 */
export async function investigatePregame(
  events:readonly PregameEvent[],fetcher:typeof fetch=fetch,
):Promise<Map<string,PregameAssessment>> {
  const limited=events.slice(0,6).filter(e=>
    CODE.test(e.sport)&&CODE.test(e.league)&&EVENT_ID.test(e.eventId))
  const leagues=[...new Map(limited.map(e=>[leagueKey(e),e])).values()]
  const injuryReports=await Promise.allSettled(leagues.map(async e=>{
    const data=await getFeed<unknown>(
      'https://site.api.espn.com/apis/site/v2/sports/'+e.sport+'/'+e.league+'/injuries',fetcher)
    // Accept only recognized array-bearing reports. An empty object, HTML
    // rejection, or an unknown response structure is NOT a clean bill of health.
    return record(data)&&(list(data.injuries)||list(data.items)||list(data.teams))
  }))
  const available=new Map<string,boolean>(leagues.map((e,i)=>{
    const check=injuryReports[i]
    return [leagueKey(e),check?.status==='fulfilled'&&check.value===true] as const
  }))
  const summaries=await Promise.allSettled(limited.map(async e=>{
    const data=await getFeed<unknown>(
      'https://site.api.espn.com/apis/site/v2/sports/'+e.sport+'/'+e.league+
      '/summary?event='+e.eventId,fetcher)
    if(!record(data))return false
    // A populated summary is a second event-specific endpoint; no extra
    // claims are made about unverified injuries or starting players.
    return (record(data.header)&&list(data.header.competitions)&&data.header.competitions.length>0)
      ||(record(data.boxscore)&&list(data.boxscore.teams)&&data.boxscore.teams.length>0)
  }))
  return new Map<string,PregameAssessment>(limited.map((e,i)=>{
    const check=summaries[i]
    const summaryVerified=check?.status==='fulfilled'&&check.value===true
    const injuryReportVerified=available.get(leagueKey(e))===true
    return [leagueKey(e)+'|'+e.eventId,{
      summaryVerified,injuryReportVerified,
      limitations:[
        ...(!summaryVerified?['Resumen de partido ESPN sin verificar']:[]),
        ...(!injuryReportVerified?['Parte médico actual no verificable en ESPN']:[]),
        'Titulares y disponibilidad individual pendientes de confirmar',
      ],
    }] as const
  }))
}
