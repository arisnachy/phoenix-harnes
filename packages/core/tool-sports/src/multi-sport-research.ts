/** Multi-sport verified recent-results research using provider-published completed games.
 * Reuses the same fixed-host ESPN adapter used by PHOENIX game cards.
 * This provides descriptive features, NOT calibrated odds or win probabilities.
 */
import { getFeed, hasSportsPermission, sportsCatalog } from './sports.ts'

type Competitor = {
  id?:string|number;homeAway?:string;score?:number|string
  team?:{id?:string|number;displayName?:string;name?:string}
  athlete?:{id?:string|number;displayName?:string;name?:string}
}
type Game = {
  id?:string|number;date?:string
  status?:{type?:{state?:string}}
  competitions?:Array<{competitors?:Competitor[]}>
}
type Scoreboard={events?:Game[]}
export type FormSide = {
  id:string;name:string;completedGames:number;wins:number;losses:number;draws:number
  averageScored:number|null;averageAllowed:number|null;averageMargin:number|null
  restHours:number|null;lastResults:Array<{eventId:string;date:string;opponent:string;scored:number;allowed:number}>
}
export type ResearchMatch = {
  eventId:string;date:string;sport:string;league:string;home:FormSide;away:FormSide
  source:'ESPN Site API'; evidence:'descriptive'|'insufficient'
  coverageDays:number;successfulDays:number;limitations:string[]
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
const form=(current:Competitor,all:Game[],kickoff:number):FormSide=>{
  const id=pid(current)
  const records=all.flatMap(e=>{
    if(e.status?.type?.state!=='post')return []
    const at=Date.parse(e.date??'')
    if(!Number.isFinite(at)||at>=kickoff)return []
    const {home,away}=sides(e)
    const mine=pid(home)===id?home:pid(away)===id?away:undefined
    const rival=mine===home?away:home
    if(!mine||!rival)return []
    const scored=cleanScore(mine.score),allowed=cleanScore(rival.score)
    if(scored===null||allowed===null)return []
    return[{eventId:String(e.id??''),date:e.date??'',opponent:pname(rival),scored,allowed}]
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
    lastResults:records.slice(0,5)}
}
const today=()=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date())
/** Research a verified slate for ANY ESPN sport and league, not a basketball-only code path. */
export async function researchSport(
  sport:string,league:string,date=today(),fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,lookbackDays=14,
):Promise<{sport:string;league:string;date:string;source:string;fetchedAt:string;
  matches:ResearchMatch[];failedDays:number;note:string}>{
  if(!Object.hasOwn(sportsCatalog,sport)||!sportsCatalog[sport]?.includes(league))
    throw Error('Deporte/liga fuera de catálogo verificado')
  if(!valid(date))throw Error('Fecha inválida (AAAA-MM-DD)')
  if(!Number.isInteger(lookbackDays)||lookbackDays<1||lookbackDays>28)
    throw Error('Ventana histórica requiere entre 1 y 28 días')
  if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado por el operador')
  const url=(day:string)=>'https://site.api.espn.com/apis/site/v2/sports/'+
    sport+'/'+league+'/scoreboard?dates='+day.replaceAll('-','')
  const retrieve=async(day:string):Promise<Scoreboard>=>{
    const board=await getFeed<Scoreboard>(url(day),fetcher)
    if(!Array.isArray(board.events))throw Error('ESPN devolvió eventos inválidos')
    return board
  }
  const current=await retrieve(date)
  const upcoming=current.events?.filter(e=>{
    const at=Date.parse(e.date??'')
    return Number.isFinite(at)&&at>now&&
      (e.status?.type?.state===undefined||e.status.type.state==='pre')
  }).slice(0,12)??[]
  if(!upcoming.length)throw Error('No hay encuentros futuros verificables')
  const starting=Date.parse(date+'T12:00:00Z')
  const days=Array.from({length:lookbackDays},(_,i)=>{
    const stamp=new Date(starting-(i+1)*86_400_000)
    return stamp.toISOString().slice(0,10)
  })
  const jobs=await Promise.allSettled(days.map(retrieve))
  const archived=jobs.flatMap(job=>job.status==='fulfilled'?job.value.events??[]:[])
  const successfulDays=jobs.filter(job=>job.status==='fulfilled').length
  const matches:ResearchMatch[]=upcoming.flatMap(event=>{
    const {home,away}=sides(event)
    if(!home||!away||!pid(home)||!pid(away)||!pname(home)||!pname(away))return []
    const kickoff=Date.parse(event.date??'')
    const homeForm=form(home,archived,kickoff),awayForm=form(away,archived,kickoff)
    const sufficient=successfulDays===lookbackDays&&homeForm.completedGames>=2&&awayForm.completedGames>=2
    const result:ResearchMatch={eventId:String(event.id??''),date:event.date??'',sport,league,
      home:homeForm,away:awayForm,source:'ESPN Site API',evidence:sufficient?'descriptive':'insufficient',
      coverageDays:lookbackDays,successfulDays,
      limitations:[
        ...(!sufficient?['Historial incompleto o muestra de partidos insuficiente']:[]),
        'Lesiones/ausencias y alineaciones pendientes de verificación',
        'Rendimiento ajustado por rival y métricas específicas pendientes',
        'Mercados y probabilidad calibrada no verificados',
      ]}
    return[result]
  })
  return{sport,league,date,source:'ESPN Site API · resultados completos (no predicciones)',
    fetchedAt:new Date(now).toISOString(),matches,failedDays:lookbackDays-successfulDays,
    note:'Son estadísticas históricas observadas, no cuotas ni probabilidades calculadas. La investigación definitiva debe añadir datos específicos de cada deporte: lesiones/rotaciones NBA; pitchers/bullpen MLB; xG/plantilla fútbol; sets/superficie tenis; portero NHL; y mercados actuales verificables.'}
}
