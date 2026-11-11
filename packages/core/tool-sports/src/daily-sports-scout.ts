/** Bounded daily multi-sport discovery. Scheduling availability is NOT a prediction. */
import { getFeed,hasSportsPermission,sportsCatalog } from './sports.ts'
import {fetchEspnScoreboardWithFallback} from './espn-nfl-weekly.ts'

type Side = { homeAway?:string, team?:{id?:string|number,displayName?:string,name?:string},
  athlete?:{id?:string|number,displayName?:string,name?:string} }
type Event = { id?:string|number, date?:string,
  status?:{type?:{state?:string}},
  competitions?:Array<{competitors?:Side[]}> }
type Board = { events?:Event[] }
/** Cache is scoped to a transport, exact league and UTC partition; never
 * promote yesterday's fixtures or a different adapter into live ESPN data. */
const scoreboardCache=new WeakMap<typeof fetch,Map<string,{at:number;board:Board}>>()
const SCOREBOARD_CACHE_MS=5*60_000

type Schedule = {sport:string,league:string}
const schedule:Schedule[]=[
  {sport:'basketball',league:'nba'}, {sport:'basketball',league:'wnba'},
  {sport:'baseball',league:'mlb'}, {sport:'football',league:'nfl'},
  {sport:'hockey',league:'nhl'},
  {sport:'tennis',league:'atp'}, {sport:'tennis',league:'wta'},
  ...(sportsCatalog.soccer??[]).map(league=>({sport:'soccer',league})),
]
/** Accept user-facing league names without broadening an explicit league selection. */
function normalizeDailySelection(value:string):{sport:string;league:string|null}|null{
  const input=value.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
    .trim().toLowerCase().replace(/\s+/gu,' ')
  const sportAlias:Readonly<Record<string,string>>={
    futbol:'soccer',futbolamericano:'football','futbol americano':'football',
    basquetbol:'basketball',baloncesto:'basketball',beisbol:'baseball',
    tenis:'tennis','ice hockey':'hockey',
  }
  const name=sportAlias[input]??input
  if(schedule.some(item=>item.sport===name))return{sport:name,league:null}
  const league=schedule.find(item=>item.league===name)
  return league?{sport:league.sport,league:league.league}:null
}
const dateValid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(s)
  &&Number.isFinite(Date.parse(s+'T00:00:00Z'))
  &&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s
const localDay=(when:Date)=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit',
}).format(when)
const dayNow=()=>localDay(new Date())
/** A provider which never settles must not hold Kira's tool indefinitely.
 * The lower-level HTTP transport still enforces its own timeout; this guard
 * also covers cache and filesystem stalls and test adapters ignoring aborts.
 */
function settleWithin<T>(operation:Promise<T>,ms:number):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined
  const timeout=new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>reject(Error('ESPN: tiempo de espera agotado')),ms)
  })
  return Promise.race([operation,timeout]).finally(()=>{
    if(timer!==undefined)clearTimeout(timer)
  })
}
const participant=(s:Side|undefined)=>{
  const rawId=s?.team?.id??s?.athlete?.id
  const id=typeof rawId==='number'||typeof rawId==='string'?String(rawId):''
  const name=s?.team?.displayName??s?.athlete?.displayName??s?.team?.name??s?.athlete?.name
  return /^\d{1,20}$/u.test(id)
    &&typeof name==='string'&&name.trim()&&name.length<=120
    ?{id,name:name.trim()}:null
}
type DailySportsEvent = {
  sport:string,league:string,eventId:string,kickoff:string,
  home:{id:string,name:string},away:{id:string,name:string},
  source:'ESPN Site API',status:'scheduled'
}
type DailySportsCoverage = {
  sport:string,league:string,status:'available'|'empty'|'unavailable',
  futureEvents:number,reason:string
}

/**
 * Scan a limited set of known ESPN leagues cheaply before expensive matchup research.
 * @param date - Target date, YYYY-MM-DD in the ESPN request.
 * @param limit - Maximum diverse future fixtures to return, from 1 to 36.
 * @param fetcher - Injected HTTP adapter for deterministic tests.
 * @param now - Observation time; only fixtures with kickoffs after now survive.
 * @param env - Provider permissions, including ESPN opt-out.
 * @returns Timestamped, verified fixture candidates and per-league coverage.
 */
export async function scoutDailySports(
  date=dayNow(),limit=30,fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,
  onlySports:readonly string[]|undefined=undefined,
):Promise<{date:string,checkedAt:string,events:DailySportsEvent[],
  totalEligible:number,coverage:DailySportsCoverage[],
  diagnostics:{elapsedMs:number;requestTimeoutMs:number;requestedPartitions:number;
    partialLeagues:number;unavailableLeagues:number;cachedPartitions:number},
  warning:string}>{
  if(!dateValid(date))throw Error('Fecha inválida, usar AAAA-MM-DD')
  if(!Number.isInteger(limit)||limit<1||limit>36)throw Error('Límite de 1 a 36 eventos')
  if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado por configuración')
  const requested=onlySports?.map(value=>typeof value==='string'?
    normalizeDailySelection(value):null)
  if(onlySports!==undefined&&(!Array.isArray(onlySports)||!onlySports.length||
    requested?.some(item=>item===null)))
    throw Error('Deportes solicitados fuera del calendario conocido')
  const scanPlan=requested? schedule.filter(item=>requested.some(selected=>
    selected?.sport===item.sport&&(selected.league===null||selected.league===item.league))):schedule
  const startedAt=Date.now()
  // Only the requested sports are scanned when known; keep UTC partitions for local late games.
  // Optional shorter budget is useful for operators and deterministic tests.
  const requestedMs=Number(env.PHOENIX_SPORTS_SCAN_TIMEOUT_MS)
  const requestTimeoutMs=Number.isInteger(requestedMs)&&requestedMs>=30&&requestedMs<=6000
    ?requestedMs:4_500
  const cache=scoreboardCache.get(fetcher)??new Map<string,{at:number;board:Board}>()
  scoreboardCache.set(fetcher,cache)
  const readPartition=async(item:Schedule,partition:string)=>{
    const key=item.sport+'|'+item.league+'|'+partition
    try{
      const board=await settleWithin(fetchEspnScoreboardWithFallback(
        item.sport,item.league,partition,
        uri=>getFeed<Board>(uri,fetcher)),requestTimeoutMs)
      if(Array.isArray(board.events)){
        // Keep only a bounded set of recent, same-provider partitions.
        if(cache.size>=100)cache.delete(cache.keys().next().value!)
        cache.set(key,{at:now,board})
      }
      return{board,cached:false}
    }catch(error){
      const prior=cache.get(key)
      if(prior&&now>=prior.at&&now-prior.at<=SCOREBOARD_CACHE_MS)
        return{board:prior.board,cached:true}
      throw error
    }
  }
  const coverage:DailySportsCoverage[]=[]
  const all:DailySportsEvent[]=[]
  let cachedPartitions=0
  const seen=new Set<string>()
  // The target is a Santo Domingo calendar day (UTC-4). Late local games
  // can fall on the following UTC date, so query both ESPN date partitions.
  // Keep the per-league concurrency bounded and de-duplicate official IDs.
  const nextUtcDay=new Date(Date.parse(date+'T00:00:00Z')+86_400_000)
    .toISOString().slice(0,10).replaceAll('-','')
  const partitions=[date.replaceAll('-',''),nextUtcDay]
  // Eight leagues concurrently; both date partitions are independent and
  // cannot block the other. Four-digit league groups and timeout budget remain
  // visible in diagnostics instead of silently returning an empty slate.
  for(let offset=0;offset<scanPlan.length;offset+=8){
    const batch=scanPlan.slice(offset,offset+8)
    const reports=await Promise.allSettled(batch.map(async item=>{
      if(!sportsCatalog[item.sport]?.includes(item.league))throw Error('Liga fuera del catálogo')
      return Promise.allSettled(partitions.map(day=>readPartition(item,day)))
    }))
    for(let i=0;i<batch.length;i++){
      const item=batch[i]
      const report=reports[i]
      if(!item||!report)continue
      const partitionsRead=report.status==='fulfilled'?report.value:[]
      const boards=partitionsRead.filter((partition):partition is PromiseFulfilledResult<{
        board:Board;cached:boolean
      }>=>
        partition.status==='fulfilled'&&Array.isArray(partition.value.board.events))
      cachedPartitions+=boards.filter(board=>board.value.cached).length
      if(!boards.length){
        coverage.push({...item,status:'unavailable',futureEvents:0,
          reason:'Sin cartelera verificable desde ESPN en ambos días UTC'})
        continue
      }
      let valid=0
      for(const board of boards)for(const event of (board.value.board.events??[]).slice(0,150)){
        if(event.status?.type?.state!=='pre')continue
        const at=Date.parse(event.date??'')
        const id=String(event.id??'')
        if(!Number.isFinite(at)||at<=now||!/^\d{1,20}$/u.test(id)
          ||localDay(new Date(at))!==date)continue
        const sides=event.competitions?.[0]?.competitors
        if(!Array.isArray(sides))continue
        const home=participant(sides.find(s=>s.homeAway==='home'))
        const away=participant(sides.find(s=>s.homeAway==='away'))
        if(!home||!away||home.id===away.id)continue
        const key=item.sport+'|'+item.league+'|'+id
        if(seen.has(key))continue
        seen.add(key)
        valid++
        all.push({...item,eventId:id,kickoff:new Date(at).toISOString(),
          home,away,source:'ESPN Site API',status:'scheduled'})
      }
      const full=boards.length===partitions.length
      const cached=boards.some(x=>x.value.cached)
      coverage.push({...item,status:valid?'available':full&&!cached?'empty':'unavailable',
        futureEvents:valid,reason:cached?
          'Cobertura parcial: partición recuperada de caché local menor a 5 minutos; requiere revalidación en ESPN':
          full?(valid?'Participantes y evento futuro confirmados':'Sin futuros verificables'):
          'Cobertura parcial: falta una partición UTC; los partidos recuperados sí se conservan'})
    }
  }
  // A high-fixture league must not displace all other disciplines.
  const sports=[...new Set(all.map(e=>e.sport))]
  const pools=new Map(sports.map(s=>[s,all.filter(e=>e.sport===s)
    .sort((a,b)=>a.kickoff.localeCompare(b.kickoff)||a.eventId.localeCompare(b.eventId))]))
  sports.sort((a,b)=>((pools.get(a)?.[0]?.kickoff??'').localeCompare(
    pools.get(b)?.[0]?.kickoff??''))||a.localeCompare(b))
  const events:DailySportsEvent[]=[]
  while(events.length<limit){
    let progressed=false
    for(const sport of sports){
      if(events.length>=limit)break
      const match=pools.get(sport)?.shift()
      if(!match)continue
      events.push(match)
      progressed=true
    }
    if(!progressed)break
  }
  return{date,checkedAt:new Date(now).toISOString(),events,totalEligible:all.length,
    coverage,diagnostics:{elapsedMs:Date.now()-startedAt,requestTimeoutMs,
      requestedPartitions:scanPlan.length*partitions.length,
      partialLeagues:coverage.filter(x=>x.reason.startsWith('Cobertura parcial')).length,
      unavailableLeagues:coverage.filter(x=>x.status==='unavailable').length,
      cachedPartitions},
    warning:'Lista de partidos verificables, NO ranking de ganancias ni probabilidades. '
      +'Investiga estadísticas, bajas, titulares, noticias y cuotas por mercado solo para '
      +'los candidatos priorizados. Sin precio fechado no hay selección cotizada.'}
}
