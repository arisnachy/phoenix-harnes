/** Multi-sport verified recent-results research using provider-published completed games.
 * Reuses the same fixed-host ESPN adapter used by PHOENIX game cards.
 * This provides descriptive features, NOT calibrated odds or win probabilities.
 */
import { getFeed, hasSportsPermission, sportsCatalog } from './sports.ts'
import {fetchEspnScoreboardWithFallback} from './espn-nfl-weekly.ts'
import {readHistoricalScoreboard} from './sports-historical-scoreboard.ts'
import {isVerifiedRegularSeason} from './sports-regular-season.ts'

type Competitor = {
  id?:string|number;homeAway?:string;score?:number|string
  team?:{id?:string|number;displayName?:string;name?:string}
  athlete?:{id?:string|number;displayName?:string;name?:string}
}
type Game = {
  id?:string|number;date?:string
  status?:{type?:{state?:string}}
  competitions?:Array<{competitors?:Competitor[];venue?:{name?:string;fullName?:string}}>
}
type Scoreboard={events?:Game[]}
export type FormSide = {
  id:string;name:string;completedGames:number;wins:number;losses:number;draws:number
  averageScored:number|null;averageAllowed:number|null;averageMargin:number|null
  restHours:number|null;lastResults:Array<{eventId:string;date:string;opponent:string;scored:number;allowed:number;homeAway?:'home'|'away';venue?:string|null}>
}
export type ResearchMatch = {
  eventId:string;date:string;sport:string;league:string;home:FormSide;away:FormSide
  source:'ESPN Site API'; evidence:'descriptive'|'insufficient'
  coverageDays:number;successfulDays:number;limitations:string[]
  /** Exact ESPN pregame fixture observed during research, reused at final validation. */
  verifiedEvent:Game
}
const valid=(v:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(v)&&
  Number.isFinite(Date.parse(v+'T00:00:00Z'))&&
  new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v
const pid=(c:Competitor|undefined):string=>String(c?.team?.id??c?.athlete?.id??c?.id??'')
const pname=(c:Competitor|undefined):string=>
  (c?.team?.displayName??c?.athlete?.displayName??c?.team?.name??c?.athlete?.name??'').slice(0,100)
const sides=(e:Game):{home:Competitor|undefined;away:Competitor|undefined}=>{
  const rows=e.competitions?.[0]?.competitors??[]
  return{home:rows.find(c=>c.homeAway==='home'),away:rows.find(c=>c.homeAway==='away')}
}
const cleanScore=(s:unknown):number|null=>{
  if(typeof s!=='number'&&typeof s!=='string')return null
  if(!/^\d{1,3}$/u.test(String(s)))return null
  return Number(s)
}
const form=(current:Competitor,all:Game[],kickoff:number,sport:string):FormSide=>{
  const id=pid(current)
  const seenEvents=new Set<string>()
  const records=all.flatMap(e=>{
    if(e.status?.type?.state!=='post'||
      ((sport==='basketball'||sport==='football')&&!isVerifiedRegularSeason(e)))return []
    const at=Date.parse(e.date??'')
    if(!Number.isFinite(at)||at>=kickoff)return []
    const eventId=String(e.id??'')
    if(!/^\d{1,20}$/u.test(eventId)||seenEvents.has(eventId))return []
    const {home,away}=sides(e)
    const mine=pid(home)===id?home:pid(away)===id?away:undefined
    const rival=mine===home?away:home
    if(!mine||!rival)return []
    const scored=cleanScore(mine.score),allowed=cleanScore(rival.score)
    if(scored===null||allowed===null)return []
    seenEvents.add(eventId)
    const place=e.competitions?.[0]?.venue
    const venue=String(place?.fullName??place?.name??'').trim().slice(0,100)||null
    return[{eventId:String(e.id??''),date:e.date??'',opponent:pname(rival),scored,allowed,
      homeAway:mine===home?'home' as const:'away' as const,venue}]
  }).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,10)
  const wins=records.filter(r=>r.scored>r.allowed).length
  const losses=records.filter(r=>r.scored<r.allowed).length
  const draws=records.filter(r=>r.scored===r.allowed).length
  const total=records.length
  const last=records[0]
  return{id,name:pname(current),completedGames:total,wins,losses,draws,
    averageScored:total?Number((records.reduce((n,r)=>n+r.scored,0)/total).toFixed(2)):null,
    averageAllowed:total?Number((records.reduce((n,r)=>n+r.allowed,0)/total).toFixed(2)):null,
    averageMargin:total?Number((records.reduce((n,r)=>n+r.scored-r.allowed,0)/total).toFixed(2)):null,
    restHours:last?Number(((kickoff-Date.parse(last.date))/3_600_000).toFixed(1)):null,
    lastResults:records.slice(0,10)}
}
const today=()=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date())
/** Research ESPN results for a supported sport and league.
 * @param sport - ESPN sport identifier.
 * @param league - League identifier in the sports catalog.
 * @param date - Fixture day in Santo Domingo.
 * @param fetcher - Injected public ESPN fetch adapter.
 * @param now - Reference instant for upcoming events.
 * @param env - Host sports permissions.
 * @param lookbackDays - Number of past scoreboards to inspect.
 * @returns Verified upcoming match form with missing-evidence diagnostics; never calibrated win chances.
 */
export async function researchSport(
  sport:string,league:string,date=today(),fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,lookbackDays=14,
):Promise<{sport:string;league:string;date:string;source:string;fetchedAt:string;
  matches:ResearchMatch[];failedDays:number;note:string}>{
  if(!Object.hasOwn(sportsCatalog,sport)||!sportsCatalog[sport]?.includes(league))
    throw Error('Deporte/liga fuera de catálogo verificado')
  if(!valid(date))throw Error('Fecha inválida (AAAA-MM-DD)')
  if(!Number.isInteger(lookbackDays)||lookbackDays<1||lookbackDays>62)
    throw Error('Ventana histórica requiere entre 1 y 62 días')
  if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado por el operador')
  const retrieve=async(day:string):Promise<Scoreboard>=>{
    const board=await fetchEspnScoreboardWithFallback(sport,league,
      day.replaceAll('-',''),uri=>getFeed<Scoreboard>(uri,fetcher))
    if(!Array.isArray(board.events))throw Error('ESPN devolvió eventos inválidos')
    return board
  }
  // A Santo Domingo late game can live on the NEXT ESPN UTC scoreboard.
  // Tolerate one failed date partition without replacing verified fixture data.
  const nextDay=new Date(Date.parse(date+'T00:00:00Z')+86_400_000)
    .toISOString().slice(0,10)
  const boards=await Promise.allSettled([retrieve(date),retrieve(nextDay)])
  const validBoards=boards.flatMap(x=>x.status==='fulfilled'?[x.value]:[])
  if(!validBoards.length)throw Error('ESPN no publicó una cartelera verificable en ninguna partición')
  const localDay=(stamp:number)=>new Intl.DateTimeFormat('en-CA',{
    timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit',
  }).format(new Date(stamp))
  const known=new Set<string>()
  const upcoming=validBoards.flatMap(board=>board.events??[]).filter(e=>{
    const at=Date.parse(e.date??''),id=String(e.id??'')
    if(!Number.isFinite(at)||at<=now||localDay(at)!==date||
      !/^\d{1,20}$/u.test(id)||known.has(id)||
      (e.status?.type?.state!==undefined&&e.status.type.state!=='pre'))return false
    known.add(id)
    return true
  }).slice(0,12)
  if(!upcoming.length)throw Error('No hay encuentros futuros verificables')
  const starting=Date.parse(date+'T12:00:00Z')
  const first=new Date(starting-lookbackDays*86_400_000).toISOString().slice(0,10)
  const last=new Date(starting-86_400_000).toISOString().slice(0,10)
  // When league history fails, recover across several candidate fixtures,
  // not only the two sides of the very first matchup. The downstream reader
  // imposes a strict cap on independent team-schedule calls.
  const teamIds=upcoming.flatMap(e=>{
    const pair=sides(e)
    return[pid(pair.home),pid(pair.away)].filter(Boolean)
  })
  const archive=await readHistoricalScoreboard(
    'https://site.api.espn.com/apis/site/v2/sports/'+sport+'/'+league+'/',
    first,last,async url=>{
      try{return await getFeed<Scoreboard>(url,fetcher)}catch{return null}
    },teamIds)
  const archived=archive.events as Game[]
  const successfulDays=archive.verifiedCalendarDays
  const matches:ResearchMatch[]=upcoming.flatMap(event=>{
    const {home,away}=sides(event)
    if(!home||!away||!pid(home)||!pid(away)||!pname(home)||!pname(away))return []
    const kickoff=Date.parse(event.date??'')
    const homeForm=form(home,archived,kickoff,sport),awayForm=form(away,archived,kickoff,sport)
    const requiredGames=sport==='football'?3:5
    // Research reports a preliminary minimum, while the automatic-ticket
    // promotion layer requires five distinct games per team (NFL: three).
    // Coverage shortfalls are recorded, but do not invalidate a sufficient
    // sample of DISTINCT verified matches for BOTH teams.
    const sufficient=archive.status!=='unavailable'&&
      homeForm.completedGames>=requiredGames&&awayForm.completedGames>=requiredGames
    const result:ResearchMatch={eventId:String(event.id??''),date:event.date??'',sport,league,
      verifiedEvent:event,
      home:homeForm,away:awayForm,source:'ESPN Site API',evidence:sufficient?'descriptive':'insufficient',
      coverageDays:lookbackDays,successfulDays,
      limitations:[
        ...(!sufficient?['Muestra inferior a '+requiredGames+' partidos distintos por equipo'+
          ((sport==='basketball'||sport==='football')?' de temporada regular verificada':'')]:[]),
        ...(archive.status!=='verified'?['Cobertura ESPN parcial: '+archive.explanation]:[]),
        'Lesiones/ausencias y alineaciones pendientes de verificación',
        'Rendimiento ajustado por rival y métricas específicas pendientes',
        'Mercados y probabilidad calibrada no verificados',
      ]}
    return[result]
  })
  return{sport,league,date,source:'ESPN Site API · historial mensual/diario y calendario de equipos (no predicciones)',
    fetchedAt:new Date(now).toISOString(),matches,failedDays:lookbackDays-successfulDays,
    note:'Son estadísticas históricas observadas, no cuotas ni probabilidades calculadas. La investigación definitiva debe añadir datos específicos de cada deporte: lesiones/rotaciones NBA; pitchers/bullpen MLB; xG/plantilla fútbol; sets/superficie tenis; portero NHL; y mercados actuales verificables.'}
}
