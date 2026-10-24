/** MLB pitching analysis for existing Phoenix chat: known roster only, no fabricated statistics. */
import {getFeed,hasSportsPermission} from './sports.ts'

type RosterPlayer={person:{id:number;fullName:string};position?:{type?:string;abbreviation?:string}}
type PitcherStat={era?:string;whip?:string;inningsPitched?:string;strikeOuts?:number;gamesPlayed?:number;gamesStarted?:number;wins?:number;losses?:number}
type PitchStatsResponse={stats?:Array<{splits?:Array<{stat?:PitcherStat}>}>}
/** Attributed pitching roster and its companion inline statistics table. */
export interface PitcherReport {
  readonly teamId:number
  readonly season:number
  readonly pitchers:readonly {id:number;name:string;role:string;era:string;whip:string;innings:string;strikeouts:string;image?:string}[]
  readonly unavailableStats:number
  readonly source:string
  readonly uiBlock:{component:'comparison';version:1;props:{title:string;subtitle:string;columns:string[];rows:{label:string;values:string[]}[]}}
}
/** Fetch a verified MLB pitching comparison, marking unavailable season stats.
 * @param teamId - Canonical MLB team identifier.
 * @param season - Calendar season whose pitching stats are requested.
 * @param env - Host-side provider and image permission settings.
 * @param fetcher - Injectable fetch client used in tests.
 * @returns A bounded pitcher roster with sourced per-season metrics.
 */
export async function getMlbPitcherReport(
  teamId:number,season:number,env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch,
):Promise<PitcherReport>{
  if(!hasSportsPermission('mlb',env))throw Error('MLB Stats API deshabilitada por el operador')
  if(!Number.isSafeInteger(teamId)||teamId<1||teamId>99999)throw Error('ID de equipo inválido')
  if(!Number.isSafeInteger(season)||season<1871||season>2100)throw Error('Temporada inválida')
  const roster=await getFeed<{roster?:RosterPlayer[]}>('https://statsapi.mlb.com/api/v1/teams/'+teamId+'/roster?rosterType=active',fetcher)
  if(!Array.isArray(roster.roster))throw Error('MLB no devolvió roster válido')
  const pitchers=roster.roster.filter(x=>(x.position?.type==='Pitcher'||x.position?.abbreviation==='P')
    && Number.isSafeInteger(x.person?.id)).slice(0,12)
  const report=[]
  let unavailableStats=0
  for(let i=0;i<pitchers.length;i+=4){
    const batch=await Promise.all(pitchers.slice(i,i+4).map(async p=>{
      let stats:PitcherStat={}
      try {
        const response=await getFeed<PitchStatsResponse>('https://statsapi.mlb.com/api/v1/people/'+p.person.id+'/stats?stats=season&group=pitching&season='+season,fetcher)
        stats=response.stats?.[0]?.splits?.[0]?.stat??{}
        if(!Object.keys(stats).length)unavailableStats++
      }catch {unavailableStats++}
      const fmt=(x:string|number|undefined):string=>x===undefined?'—':String(x).slice(0,24)
      const image=env.PHOENIX_SPORTS_MLB_IMAGES_ALLOWED==='1'
        ? 'https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/'+p.person.id+'/headshot/67/current':undefined
      return {id:p.person.id,name:p.person.fullName.slice(0,150),role:(stats.gamesStarted??0)>0?'Abridor / relevista':'Relevista o sin confirmar',
        era:fmt(stats.era),whip:fmt(stats.whip),innings:fmt(stats.inningsPitched),strikeouts:fmt(stats.strikeOuts),
        ...(image?{image}:{})}
    }))
    report.push(...batch)
  }
  return {teamId,season,pitchers:report,unavailableStats,source:'MLB Stats API · '+new Date().toISOString(),
    uiBlock:{component:'comparison',version:1,props:{title:'Cuerpo de lanzadores · MLB',
      subtitle:'Equipo '+teamId+' · '+season+' · estadísticas de temporada disponibles; “—” indica dato ausente',
      columns:['Rol','ERA','WHIP','IP','K'],rows:report.map(p=>({label:p.name,values:[p.role,p.era,p.whip,p.innings,p.strikeouts]}))}}}
}
