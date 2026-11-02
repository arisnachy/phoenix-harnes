/** Evidence-only NBA pregame form research. No player roster, injury or odds claims. */
import { getFeed, hasSportsPermission } from './sports.ts'

type EspnTeam = {
  homeAway?: string
  score?: string | number
  team?: { id?: string | number; displayName?: string; name?: string }
  records?: Array<{ summary?: string }>
}
type EspnEvent = {
  id?: string | number
  date?: string
  status?: { type?: { state?: string } }
  competitions?: Array<{ competitors?: EspnTeam[] }>
}
type Board = { events?: EspnEvent[] }
type Result = { eventId: string; date: string; opponent: string; margin: number; result: 'W' | 'L' | 'T' }
export type NbaSideResearch = {
  teamId: string
  team: string
  seasonRecord: string | null
  gamesObserved: number
  recentWins: number
  recentLosses: number
  recentAverageMargin: number | null
  restHours: number | null
  recentResults: Result[]
}
export type NbaMatchResearch = {
  eventId: string
  matchup: string
  kickoff: string
  home: NbaSideResearch
  away: NbaSideResearch
  sampleAdequate: boolean
  evidenceStatus: 'limited' | 'insufficient'
  missing: string[]
}
export type NbaResearchReport = {
  sport: 'basketball'; league: 'nba'; date: string
  source: string; observedAt: string; lookbackDays: number; daysRetrieved: number
  matches: NbaMatchResearch[]
  note: string
}
const dayValid = (day: string): boolean => /^\d{4}-\d{2}-\d{2}$/u.test(day)
  && Number.isFinite(Date.parse(day+'T00:00:00Z'))
  && new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day
const isoDay = (d: Date): string => d.toISOString().slice(0,10)
const numberScore = (value: string | number | undefined): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const raw = String(value).trim()
  if (!/^\d{1,3}$/u.test(raw)) return null
  const result = Number(raw)
  return Number.isInteger(result) ? result : null
}
const sides = (e: EspnEvent): { home: EspnTeam | undefined; away: EspnTeam | undefined } => {
  const rows=e.competitions?.[0]?.competitors ?? []
  return { home:rows.find(x=>x.homeAway==='home'),away:rows.find(x=>x.homeAway==='away') }
}
const teamId = (team: EspnTeam | undefined): string => String(team?.team?.id ?? '')
const teamName = (team: EspnTeam | undefined): string => (team?.team?.displayName ?? team?.team?.name ?? '').slice(0,100)
const resultFor = (event: EspnEvent, id: string, before: number): Result | null => {
  if(event.status?.type?.state!=='post')return null
  const gameAt = Date.parse(event.date ?? '')
  if (!Number.isFinite(gameAt)||gameAt>=before)return null
  const {home,away}=sides(event)
  const isHome=teamId(home)===id
  const isAway=teamId(away)===id
  if(!isHome&&!isAway)return null
  const own = isHome ? home : away, opponent = isHome ? away : home
  const score=numberScore(own?.score),opScore=numberScore(opponent?.score)
  if(score===null||opScore===null)return null
  const margin=score-opScore
  return { eventId:String(event.id ?? ''),date:event.date ?? '',opponent:teamName(opponent),margin,
    result:margin>0?'W':margin<0?'L':'T' }
}
const summarize=(team:EspnTeam,history:EspnEvent[],before:number):NbaSideResearch=>{
  const id=teamId(team)
  const results=history.flatMap(e=>{
    const r=resultFor(e,id,before)
    return r?[r]:[]
  }).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,10)
  const wins=results.filter(r=>r.result==='W').length
  const losses=results.filter(r=>r.result==='L').length
  const last=results[0]
  return {teamId:id,team:teamName(team),seasonRecord:team.records?.find(x=>/^\d+-\d+$/u.test(x.summary??''))?.summary??null,
    gamesObserved:results.length,recentWins:wins,recentLosses:losses,
    recentAverageMargin:results.length ? Number((results.reduce((a,b)=>a+b.margin,0)/results.length).toFixed(2)):null,
    restHours:last?Number(((before-Date.parse(last.date))/3_600_000).toFixed(1)):null,recentResults:results}
}
const nowDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
/**
 * Research one NBA slate from ESPN fixtures plus completed game results, using one
 * bounded board request per date, shared across all events (no requests per team).
 * Does not substitute descriptive form for a calibrated win probability.
 */
export async function researchNbaSlate(
  date=nowDay(),eventId?:string,fetcher:typeof fetch=fetch,now=Date.now(),
  env:NodeJS.ProcessEnv=process.env,lookbackDays=14,maxMatches=6,
):Promise<NbaResearchReport>{
  if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado por el operador')
  if(!dayValid(date))throw Error('Fecha NBA inválida (AAAA-MM-DD)')
  if(eventId!==undefined&&!/^\d{1,20}$/u.test(eventId))throw Error('ID NBA inválido')
  if(!Number.isInteger(lookbackDays)||lookbackDays<1||lookbackDays>21)throw Error('Ventana NBA fuera de rango')
  if(!Number.isInteger(maxMatches)||maxMatches<1||maxMatches>25)throw Error('Cantidad de encuentros NBA fuera de rango')
  const root='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates='
  const getBoard=async(day:string):Promise<Board>=>{
    const board=await getFeed<Board>(root+day.replaceAll('-',''),fetcher)
    if(!Array.isArray(board.events))throw Error('ESPN devolvió una cartelera NBA inválida')
    return board
  }
  const board=await getBoard(date)
  const pending=board.events?.filter(e=>{
    const kickoff=Date.parse(e.date??'')
    return Number.isFinite(kickoff)&&kickoff>now
      && (e.status?.type?.state===undefined||e.status?.type?.state==='pre')
      && (eventId===undefined||String(e.id)===eventId)
  }).slice(0,maxMatches)??[]
  if(!pending.length)throw Error('No hay partidos NBA futuros verificables con esos filtros')
  const starting=new Date(date+'T12:00:00Z').getTime()
  const days=Array.from({length:lookbackDays},(_,i)=>isoDay(new Date(starting-(i+1)*86_400_000)))
  // A failed archive date cannot be interpreted as a zero-win day.
  const archives=await Promise.allSettled(days.map(getBoard))
  const completed=archives.flatMap(job=>job.status==='fulfilled'?job.value.events??[]:[])
  const daysRetrieved=archives.filter(job=>job.status==='fulfilled').length
  const matches:NbaMatchResearch[]=pending.flatMap(event=>{
    const {home,away}=sides(event)
    if(!home||!away||!teamId(home)||!teamId(away)||!teamName(home)||!teamName(away))return []
    const kickoff=Date.parse(event.date??'')
    const homeReport=summarize(home,completed,kickoff)
    const awayReport=summarize(away,completed,kickoff)
    const enough=daysRetrieved===lookbackDays&&homeReport.gamesObserved>=3&&awayReport.gamesObserved>=3
    const missing=[
      ...(!enough?['Muestra histórica insuficiente o fechas no accesibles']:[]),
      'Lesiones y quintetos oficiales sin contrastar',
      'Eficiencia avanzada y emparejamientos tácticos sin contrastar',
      'Cuotas por casa y valor esperado sin contrastar',
    ]
    const summary: NbaMatchResearch = {eventId:String(event.id),matchup:teamName(away)+' vs '+teamName(home),kickoff:event.date??'',
      home:homeReport,away:awayReport,sampleAdequate:enough,
      evidenceStatus:enough?'limited':'insufficient',missing}
    return [summary]
  })
  if(!matches.length)throw Error('ESPN no identificó correctamente a los equipos de los próximos partidos')
  return {sport:'basketball',league:'nba',date,source:'ESPN Site API · scoreboards históricos',
    observedAt:new Date(now).toISOString(),lookbackDays,daysRetrieved,matches,
    note:'Los márgenes y descansos se derivan solo de marcadores completos. Son tendencias descriptivas, no predicciones. Antes de recomendar una apuesta Kira debe comprobar lesiones oficiales, alineaciones, eficiencia, mercados, frescura y correlación. No atribuir jugadores sin corroborar su equipo actual.'}
}
