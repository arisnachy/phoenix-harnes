/**
 * Direct, read-only ESPN player and team evidence. Every athlete is joined by
 * an athlete ID obtained from a verified team roster; headlines, free-text
 * searches and inferred team membership never create a player record.
 *
 * ESPN Site/Common/Core APIs are unofficial and may fail by sport or season.
 * Failures are reported per endpoint, never converted into fictional stats.
 */
import {getFeed,sportsCatalog} from './sports.ts'
import {recoverEspnRoster,type EspnRosterPerson} from './espn-public-roster.ts'
import {parseEspnGameLog,parseEspnSplits,parseEspnVenueSplitsFromGameLog} from './espn-player-history.ts'

type Obj=Record<string,unknown>
const obj=(x:unknown):Obj=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Obj:{}
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const word=(x:unknown,max=140)=>typeof x==='string'||typeof x==='number'?
  String(x).replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,max):''
const id=(x:unknown)=>/^\d{1,18}$/u.test(String(x??''))?String(x):''
const validSlug=(s:string)=>/^[a-z0-9][a-z0-9._-]{0,45}$/u.test(s)
export type DirectMetric={name:string;value:string}
export type DirectAthlete={
  id:string;name:string;teamId:string;position:string;jersey:string;headshot:string|null
  stats:DirectMetric[];lastGames:DirectMetric[];splits:DirectMetric[]
  status:'verified'|'partial'|'unavailable';verifiedSources:string[]
  /** Per-athlete fetch state; empty 200 differs from unavailable endpoint. */
  coverage:Array<{endpoint:string;url:string;status:'available'|'empty'|'unavailable'}>
}
export type DirectTeam={
  id:string;name:string;athleteCount:number;selectedCount:number
  stats:DirectMetric[];depthChart:DirectMetric[];athletes:DirectAthlete[]
  /** Entire verified team roster; costly stats are fetched for a bounded subset. */
  roster:EspnRosterPerson[]
  coverage:Array<{endpoint:string;status:'available'|'empty'|'unavailable'}>
}
export type DirectDossier={
  source:'ESPN public Site/Common v3';checkedAt:string;sport:string;league:string
  teams:DirectTeam[];requests:number;errors:number
  limitations:string[]
}
const extract=(raw:unknown,max=10):DirectMetric[]=>{
  const found:DirectMetric[]=[]
  const used=new Set<string>()
  const queue:Array<{value:unknown;depth:number}>=[{value:raw,depth:0}]
  let visited=0
  const insert=(name:unknown,value:unknown)=>{
    const label=word(name,64),val=word(value,65)
    if(!label||!val||used.has(label)||found.length>=max)return
    used.add(label);found.push({name:label,value:val})
  }
  while(queue.length&&visited++<140&&found.length<max){
    const next=queue.shift()!,node=obj(next.value)
    if(Array.isArray(next.value)){
      for(const item of next.value.slice(0,35))queue.push({value:item,depth:next.depth})
      continue
    }
    const labels=arr(node.labels).length?arr(node.labels):
      arr(node.displayNames).length?arr(node.displayNames):arr(node.names)
    // ESPN Common v3 sends parallel labels/totals (not stats). Only pair
    // arrays when their lengths match, so a value cannot be assigned to the
    // wrong metric. Includes WNBA, NBA, MLB, NHL and NFL athlete stats.
    const candidates=[node.totals,node.stats,node.statistics,node.displayValues,node.values]
    for(const candidate of candidates){
      const rawValues=arr(candidate)
      const values=rawValues.map(x=>{
        const item=obj(x);return Object.keys(item).length?
          item.displayValue??item.value??item.total:x
      })
      if(labels.length&&labels.length===values.length&&values.length&&
        values.every(v=>typeof v==='string'||typeof v==='number')){
        labels.slice(0,80).forEach((v,i)=>insert(v,values[i]))
        break
      }
    }
    const label=node.displayName??node.label??node.name??node.abbreviation
    const value=node.displayValue??node.value
    if(label!==undefined&&value!==undefined)insert(label,value)
    if(next.depth>=5)continue
    // ESPN's live team-statistics route returns metrics under results, while
    // depthcharts uses a singular depthchart object. Omitting these keys
    // silently turned HTTP 200 with data into "no advanced metrics".
    for(const key of ['results','depthchart','depthCharts','categories','statistics',
      'stats','splits','splitCategories','records','seasonTypes','tables','rows',
      'items','totals','averages']){
      const child=node[key]
      if(child!==undefined)queue.push({value:child,depth:next.depth+1})
    }
  }
  return found
}
type Task={url:string;destination:(value:unknown|null)=>void;type:string}
const cache=new Map<string,{at:number;value:unknown|null}>()
async function fetchBounded(url:string,fetcher:typeof fetch,now:number):Promise<unknown|null>{
  const cached=fetcher===fetch?cache.get(url):undefined
  if(cached&&now>=cached.at&&now-cached.at<(cached.value===null?30_000:600_000))
    return cached.value
  let value:unknown|null=null
  try{value=await getFeed<unknown>(url,fetcher)}catch{}
  if(fetcher===fetch){
    if(cache.size>180)cache.clear()
    cache.set(url,{at:now,value})
  }
  return value
}
/** Automatic, bounded, direct ESPN team/athlete research.
 * @param sport - Validated ESPN discipline.
 * @param league - Validated league slug.
 * @param teams - Real ESPN scoreboard team IDs and names.
 * @param fetcher - Injectable network adapter for CI and runtime.
 * @param now - Evidence observation time.
 * @param maxPlayers - Maximum individually queried athletes per team (1..20).
 * @returns Team and player metric payloads, plus per-endpoint coverage.
 */
export async function collectDirectEspnStats(
  sport:string,league:string,teams:readonly {id:string;name:string}[],
  fetcher:typeof fetch=fetch,now=Date.now(),maxPlayers=12,
):Promise<DirectDossier>{
  if(!Object.hasOwn(sportsCatalog,sport)||!sportsCatalog[sport]?.includes(league)
    ||!validSlug(sport)||!validSlug(league)||teams.length<1||teams.length>2
    ||teams.some(t=>!id(t.id))||!Number.isInteger(maxPlayers)
    ||maxPlayers<1||maxPlayers>20)
    throw Error('IDs ESPN o presupuesto de atletas inválidos')
  const site='https://site.api.espn.com/apis/site/v2/sports/'+sport+'/'+league+'/'
  const web='https://site.web.api.espn.com/apis/common/v3/sports/'+sport+'/'+league+'/'
  const result:DirectTeam[]=[],jobs:Task[]=[],splitFallback=new Map<DirectAthlete,unknown>()
  let requests=0,errors=0
  const add=(url:string,type:string,destination:(value:unknown|null)=>void)=>
    jobs.push({url,type,destination})
  await Promise.all(teams.map(async t=>{
    const team:DirectTeam={id:t.id,name:word(t.name),athleteCount:0,
      selectedCount:0,stats:[],depthChart:[],athletes:[],roster:[],coverage:[]}
    result.push(team)
    const root=site+'teams/'+t.id+'/'
    add(root+'statistics','team_statistics',value=>{
      const all=extract(value,90)
      const important=new RegExp(
        'offensive.*rating|defensive.*rating|net.*rating|pace|expected|'+
        'effective.*field|true.*shoot|turnovers|rebound|points|goals|'+
        'power.play|penalty.kill|whip|era','iu')
      team.stats=all.sort((a,b)=>Number(important.test(b.name))-
        Number(important.test(a.name))).slice(0,35)
      team.coverage.push({endpoint:'team_statistics',
        status:value===null?'unavailable':team.stats.length?'available':'empty'})
    })
    add(root+'depthcharts','team_depthcharts',value=>{
      team.depthChart=extract(value,10)
      team.coverage.push({endpoint:'team_depthcharts',
        status:value===null?'unavailable':team.depthChart.length?'available':'empty'})
    })
    // Resolve only the verified scoreboard team ID. When ESPN returns an empty
    // numeric roster, ask the SAME team's metadata for its abbreviation and
    // retry /teams/{abbreviation}/roster (NBA, NHL, NFL, MLB, WNBA, soccer).
    const recovered=await recoverEspnRoster(sport,league,t,async url=>{
      const value=await fetchBounded(url,fetcher,now)
      requests++
      if(value===null)errors++
      return value
    })
    const people=recovered.people
    team.roster=[...people]
    team.athleteCount=people.length
    for(const [i,attempt] of recovered.attempts.entries())
      team.coverage.push({endpoint:i===0?'team_roster':attempt.url,
        status:attempt.status})
    // Goalies/pitchers/QBs before generic roster order; do NOT call them
    // confirmed starters solely because of position.
    const priority=(a:typeof people[number])=>
      /^(?:g|gk|sp|rp|p|qb)$/iu.test(a.position)?0:1
    people.sort((a,b)=>priority(a)-priority(b))
    const chosen=people.slice(0,maxPlayers)
    team.selectedCount=chosen.length
    for(const person of chosen){
      const athlete:DirectAthlete={...person,teamId:t.id,stats:[],lastGames:[],
        splits:[],status:'unavailable',verifiedSources:[],coverage:[]}
      team.athletes.push(athlete)
      const uri=web+'athletes/'+person.id+'/'
      // Avoid 60-100 redundant player endpoints when ESPN returns empty
      // responses. Probe the roster once, then request deeper metrics only
      // for athletes whose first probe yields actual records or the top three
      // whose gamelog may exist independently of season stats.
      const early=team.athletes.length<=3
      // The explicit ESPN season is a safety-net for incomplete Common-v3
      // defaults. NBA and NHL use season-ending years; summer WNBA uses the
      // calendar year. A prior season is NOT silently labeled current form.
      const observed=new Date(now)
      const calendarYear=observed.getUTCFullYear()
      const seasonYear=calendarYear+
        (((league==='nba'||league==='nhl')&&observed.getUTCMonth()>=6)?1:0)
      const explicitSeason='?season='+seasonYear
      const recorded=(path:string,value:unknown|null,found:number)=>
        athlete.coverage.push({endpoint:path,url:uri+path,
          status:value===null?'unavailable':found?'available':'empty'})
      add(uri+'stats','athlete_stats',value=>{
        athlete.stats=extract(value,12)
        recorded('stats',value,athlete.stats.length)
        if(athlete.stats.length)athlete.verifiedSources.push('stats')
        // NHL Common v3 frequently replies 404 for gamelog. NHL's official
        // player/{NHL-id}/game-log endpoint is handled by investigateNhl()
        // using the NHL roster namespace; never pass an ESPN ID there.
        if(league!=='nhl'&&(athlete.stats.length||early||priority(person)===0)){
          add(uri+'gamelog','athlete_gamelog',data=>{
            athlete.lastGames=parseEspnGameLog(data,now,20)
            recorded('gamelog',data,athlete.lastGames.length)
            if(athlete.lastGames.length){
              athlete.verifiedSources.push('gamelog')
              splitFallback.set(athlete,data)
            }
            else if(early&&athlete.stats.length) {
              // Retry only a bounded roster-verified sample. Never use season
              // averages as a substitute for event-specific player histories.
              add(uri+'gamelog'+explicitSeason,'athlete_gamelog_season',season=>{
                athlete.lastGames=parseEspnGameLog(season,now,20)
                recorded('gamelog'+explicitSeason,season,athlete.lastGames.length)
                if(athlete.lastGames.length){
                  athlete.verifiedSources.push('gamelog:season='+seasonYear)
                  splitFallback.set(athlete,season)
                }
              })
            }
          })
        }
        // ESPN may publish splits even when season totals are empty. Probe
        // the first three roster-verified athletes, but never all 30+ players
        // solely because a provider returned an empty stats payload.
        if(athlete.stats.length&&(priority(person)===0||early)||early){
          add(uri+'splits','athlete_splits',data=>{
            athlete.splits=parseEspnSplits(data,48)
            recorded('splits',data,athlete.splits.length)
            if(athlete.splits.length)athlete.verifiedSources.push('splits')
            else if(early&&athlete.stats.length){
              add(uri+'splits'+explicitSeason,'athlete_splits_season',season=>{
                athlete.splits=parseEspnSplits(season,48)
                recorded('splits'+explicitSeason,season,athlete.splits.length)
                if(athlete.splits.length)
                  athlete.verifiedSources.push('splits:season='+seasonYear)
              })
            }
          })
        }
      })
    }
  }))
  // Strict maximum of five concurrent first-party GET operations, no arbitrary
  // redirects or URLs provided by the model.
  let cursor=0
  await Promise.all(Array.from({length:Math.min(3,jobs.length)},async()=>{
    while(cursor<jobs.length){
      const task=jobs[cursor++]!
      const response=await fetchBounded(task.url,fetcher,now)
      requests++
      if(response===null)errors++
      task.destination(response)
    }
  }))
  for(const team of result)for(const person of team.athletes){
    // ESPN /splits may be absent even when an actual venue-tagged game log
    // exists. Derive strictly from played home/away games, with source proof.
    if(!person.splits.length&&splitFallback.has(person)){
      const observed=parseEspnVenueSplitsFromGameLog(splitFallback.get(person),now)
      if(observed.length){
        person.splits=observed
        person.verifiedSources.push('splits:venue-tagged-gamelog')
        person.coverage.push({endpoint:'splits_from_gamelog',
          url:'ESPN game log (observed homeAway/atVs)',
          status:'available'})
      }
    }
    const count=person.verifiedSources.length
    person.status=count===0?'unavailable':count>=2?'verified':'partial'
  }
  return {source:'ESPN public Site/Common v3',checkedAt:new Date(now).toISOString(),
    sport,league,teams:result,requests,errors,
    limitations:[
      'La API ESPN es pública pero no oficial y no garantiza cobertura por liga o temporada.',
      'Los atletas vienen de plantillas ESPN por ID; no se infiere que sean titulares o estén disponibles.',
      'Estadísticas de temporada, partidos y splits solo se muestran cuando ESPN las publica realmente.',
      'Una posición de portero, lanzador o quarterback no confirma titularidad.',
      'Los datos de jugador no sustituyen partes médicos oficiales ni validación predictiva fuera de muestra.',
    ]}
}
