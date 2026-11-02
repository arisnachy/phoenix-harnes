/** Bounded daily multi-sport discovery. Scheduling availability is NOT a prediction. */
import { getFeed,hasSportsPermission,sportsCatalog } from './sports.ts'

type Side = { homeAway?:string, team?:{id?:string|number,displayName?:string,name?:string},
  athlete?:{id?:string|number,displayName?:string,name?:string} }
type Event = { id?:string|number, date?:string,
  status?:{type?:{state?:string}},
  competitions?:Array<{competitors?:Side[]}> }
type Board = { events?:Event[] }
type Schedule = {sport:string,league:string}
const schedule:Schedule[]=[
  {sport:'basketball',league:'nba'}, {sport:'basketball',league:'wnba'},
  {sport:'baseball',league:'mlb'}, {sport:'football',league:'nfl'},
  {sport:'hockey',league:'nhl'}, {sport:'tennis',league:'atp'},
  {sport:'tennis',league:'wta'}, {sport:'soccer',league:'eng.1'},
  {sport:'soccer',league:'esp.1'}, {sport:'soccer',league:'mex.1'},
  {sport:'soccer',league:'usa.1'}, {sport:'soccer',league:'uefa.champions'},
]
const dateValid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(s)
  &&Number.isFinite(Date.parse(s+'T00:00:00Z'))
  &&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s
const dayNow=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
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
 * @param limit - Maximum diverse future fixtures to return, from 1 to 20.
 * @param fetcher - Injected HTTP adapter for deterministic tests.
 * @param now - Observation time; only fixtures with kickoffs after now survive.
 * @param env - Provider permissions, including ESPN opt-out.
 * @returns Timestamped, verified fixture candidates and per-league coverage.
 */
export async function scoutDailySports(
  date=dayNow(),limit=12,fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,
):Promise<{date:string,checkedAt:string,events:DailySportsEvent[],
  totalEligible:number,coverage:DailySportsCoverage[],
  warning:string}>{
  if(!dateValid(date))throw Error('Fecha inválida, usar AAAA-MM-DD')
  if(!Number.isInteger(limit)||limit<1||limit>20)throw Error('Límite de 1 a 20 eventos')
  if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado por configuración')
  const coverage:DailySportsCoverage[]=[]
  const all:DailySportsEvent[]=[]
  const seen=new Set<string>()
  // Four concurrent league calls; do not scrape every team and player yet.
  for(let offset=0;offset<schedule.length;offset+=4){
    const batch=schedule.slice(offset,offset+4)
    const reports=await Promise.allSettled(batch.map(async item=>{
      if(!sportsCatalog[item.sport]?.includes(item.league))throw Error('Liga fuera del catálogo')
      return getFeed<Board>('https://site.api.espn.com/apis/site/v2/sports/'
        +item.sport+'/'+item.league+'/scoreboard?dates='+date.replaceAll('-',''),fetcher)
    }))
    for(let i=0;i<batch.length;i++){
      const item=batch[i]
      const report=reports[i]
      if(!item||!report)continue
      if(report.status!=='fulfilled'||!Array.isArray(report.value.events)){
        coverage.push({...item,status:'unavailable',futureEvents:0,
          reason:'Sin cartelera verificable desde ESPN'})
        continue
      }
      let valid=0
      for(const event of report.value.events.slice(0,150)){
        if(event.status?.type?.state!=='pre')continue
        const at=Date.parse(event.date??'')
        const id=String(event.id??'')
        if(!Number.isFinite(at)||at<=now||!/^\d{1,20}$/u.test(id))continue
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
      coverage.push({...item,status:valid?'available':'empty',futureEvents:valid,
        reason:valid?'Participantes y evento futuro confirmados':'Sin futuros verificables'})
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
    coverage,warning:'Lista de partidos verificables, NO ranking de ganancias ni probabilidades. '
      +'Investiga estadísticas, bajas, titulares, noticias y cuotas por mercado solo para '
      +'los candidatos priorizados. Sin precio fechado no hay selección cotizada.'}
}
