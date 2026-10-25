/** Optional MLB match enrichment. All failures remain explicit, never synthetic.
 * Fixed ESPN/MLB hosts, per-request timeout and bounded enrichment budget are inherited from getFeed.
 */
import {getFeed} from './sports.ts'
type P={person?:{id?:number;fullName?:string};position?:{abbreviation?:string;type?:string};battingOrder?:string;seasonStats?:{batting?:Record<string,number|string>}}
type BoxTeam={battingOrder?:number[];players?:Record<string,P>;bullpen?:number[];team?:{id?:number;name?:string}}
type Boxscore={teams?:{home?:BoxTeam;away?:BoxTeam}}
type SeasonStats={stats?:Array<{splits?:Array<{stat?:Record<string,number|string>}>}>}
type Roster={roster?:Array<{person?:{id?:number;fullName?:string};position?:{abbreviation?:string;type?:string}}>}

export type SportsPlayer={name:string;role?:string;image?:string;stats?:string;id?:number}
export type SportsLineup={team:string;confirmed:boolean;players:SportsPlayer[]}
export type SportsPitcher={team:string;name:string;id?:number;image?:string;stats?:string;probable:boolean}
export type SportsBullpen={team:string;pitchers:SportsPlayer[];note:string}
export type MlbEnrichment={pitchers:SportsPitcher[];lineups:SportsLineup[];bullpen:SportsBullpen[];notes:string[]}
const safeId=(id:unknown):number|null=>typeof id==='number'&&Number.isSafeInteger(id)&&id>0&&id<100000000?id:null
/** ESPN/MLB photos are external assets: operators may opt out of media display. */
const mediaEnabled=(env:NodeJS.ProcessEnv)=>env.PHOENIX_SPORTS_IMAGES_DISABLED!=='1'
const playerImage=(id:number,env:NodeJS.ProcessEnv)=>mediaEnabled(env)
 ? 'https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/'+id+'/headshot/67/current'
 : undefined
const fmt=(v:unknown)=>typeof v==='number'||typeof v==='string'?String(v).slice(0,18):'—'
function orderedHitters(team:BoxTeam|undefined,teamName:string,env:NodeJS.ProcessEnv):SportsLineup {
  const order=Array.isArray(team?.battingOrder)?team.battingOrder:[]
  const players=order.slice(0,9).flatMap(id=>{
    const row=team?.players?.['ID'+id]
    if(!row?.person?.fullName)return []
    const s=row.seasonStats?.batting
    const image=playerImage(id,env)
    return [{name:row.person.fullName,role:row.position?.abbreviation??'Bateador',
      ...(image?{image}:{}),id,stats:s?'AVG '+fmt(s.avg)+' · HR '+fmt(s.homeRuns)+' · RBI '+fmt(s.rbi):'Estadísticas no disponibles'}]
  })
  return {team:teamName,confirmed:players.length>=9,players}
}
async function pitcherSeason(id:number,season:number,fetcher:typeof fetch):Promise<string|undefined>{
  try {
    const data=await getFeed<SeasonStats>('https://statsapi.mlb.com/api/v1/people/'+id+'/stats?stats=season&group=pitching&season='+season,fetcher)
    const stat=data.stats?.[0]?.splits?.[0]?.stat
    if(!stat)return undefined
    const parts=[['ERA',stat.era],['WHIP',stat.whip],['IP',stat.inningsPitched],['K',stat.strikeOuts]]
    return parts.filter(([,value])=>value!==undefined).map(([key,value])=>key+' '+fmt(value)).join(' · ')||undefined
  }catch{return undefined}
}
/**
 * Enrich a single MLB fixture with probable starters, lineups published by
 * MLB, and a bounded group of potential bullpen arms with season figures.
 * @param gamePk - The verified numeric MLB game ID from schedule.
 * @param homeId - Home team numeric ID.
 * @param awayId - Away team numeric ID.
 * @param homeName - Display name.
 * @param awayName - Display name.
 * @param starting - Source-provided probable starters, never inferred.
 * @param season - MLB season.
 * @param env - Optional media disable settings.
 * @param fetcher - HTTP dependency used by tests.
 * @returns Optional verified data; absent fields remain absent.
 */
export async function enrichMlbMatch(
  gamePk:number,homeId:number,awayId:number,homeName:string,awayName:string,
  starting:{home?:{id?:number;fullName?:string};away?:{id?:number;fullName?:string}},
  season:number,env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch,
):Promise<MlbEnrichment>{
  const notes:string[]=[]
  if(!safeId(gamePk))return {pitchers:[],lineups:[],bullpen:[],notes:['ID de partido inválido']}
  const entries=([['away',awayName],['home',homeName]] as const)
  const starterStats=await Promise.all(entries.map(async([side,name])=>{
    const row=starting[side],id=safeId(row?.id)
    if(!id||!row?.fullName)return null
    const image=playerImage(id,env)
    const stats=await pitcherSeason(id,season,fetcher)
    return {team:name,name:row.fullName,id,probable:true,...(image?{image}:{}),
      ...(stats?{stats}:{})}
  }))
  const pitchers=starterStats.filter((x):x is NonNullable<typeof x>=>x!==null)
  let box:Boxscore|null=null
  try {box=await getFeed<Boxscore>('https://statsapi.mlb.com/api/v1/game/'+gamePk+'/boxscore',fetcher)}
  catch {notes.push('Alineaciones oficiales aún no disponibles')}
  const lineups=entries.map(([side,name])=>orderedHitters(box?.teams?.[side],name,env))
  if(lineups.some(l=>!l.confirmed))notes.push('Alineaciones pendientes de confirmación; no se muestran jugadores inventados')
  const bullpen=await Promise.all(([['away',awayId,awayName],['home',homeId,homeName]] as const).map(async([side,teamId,name])=>{
    if(!safeId(teamId))return {team:name,pitchers:[],note:'Equipo no confirmado'}
    try {
      const r=await getFeed<Roster>('https://statsapi.mlb.com/api/v1/teams/'+teamId+'/roster?rosterType=active',fetcher)
      const starterId=safeId(starting[side]?.id)
      const available=(r.roster??[]).filter(p=>p.position?.type==='Pitcher'||p.position?.abbreviation==='P')
        .filter(p=>safeId(p.person?.id)!==null&&p.person?.id!==starterId)
        .slice(0,4)
      const profiles=await Promise.all(available.map(async p=>{
        const id=p.person!.id!, image=playerImage(id,env)
        const stats=await pitcherSeason(id,season,fetcher)
        return {name:p.person?.fullName||'No confirmado',role:'Plantilla de lanzadores',id,...(image?{image}:{}),
          ...(stats?{stats}:{})}
      }))
      return {team:name,pitchers:profiles,note:'Lanzadores de plantilla activa; su aparición en el juego no está confirmada'}
    }catch{return {team:name,pitchers:[],note:'Bullpen no disponible en la fuente'}}
  }))
  return {pitchers,lineups,bullpen,notes}
}
