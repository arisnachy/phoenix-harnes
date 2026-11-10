/**
 * Direct, read-only ESPN player and team evidence. Every athlete is joined by
 * an athlete ID obtained from a verified team roster; headlines, free-text
 * searches and inferred team membership never create a player record.
 *
 * ESPN Site/Common/Core APIs are unofficial and may fail by sport or season.
 * Failures are reported per endpoint, never converted into fictional stats.
 */
import {getFeed,sportsCatalog} from './sports.ts'

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
}
export type DirectTeam={
  id:string;name:string;athleteCount:number;selectedCount:number
  stats:DirectMetric[];depthChart:DirectMetric[];athletes:DirectAthlete[]
  coverage:Array<{endpoint:string;status:'available'|'empty'|'unavailable'}>
}
export type DirectDossier={
  source:'ESPN public Site/Common v3';checkedAt:string;sport:string;league:string
  teams:DirectTeam[];requests:number;errors:number
  limitations:string[]
}
const safePhoto=(x:unknown)=>{
  const raw=word(x,480)
  try{const url=new URL(raw);return url.protocol==='https:'&&
    url.hostname==='a.espncdn.com'&&!url.username&&!url.password?url.toString():null}
  catch{return null}
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
    const labels=arr(node.labels).length?arr(node.labels):arr(node.displayNames)
    const values=arr(node.stats)
    if(labels.length&&labels.length===values.length&&
      values.every(v=>typeof v==='string'||typeof v==='number')){
      labels.slice(0,25).forEach((v,i)=>insert(v,values[i]))
    }
    const label=node.displayName??node.label??node.name??node.abbreviation
    const value=node.displayValue??node.value
    if(label!==undefined&&value!==undefined)insert(label,value)
    if(next.depth>=5)continue
    // ESPN's live team-statistics route returns metrics under results, while
    // depthcharts uses a singular depthchart object. Omitting these keys
    // silently turned HTTP 200 with data into "no advanced metrics".
    for(const key of ['results','depthchart','depthCharts','categories','statistics',
      'stats','splits','records','seasonTypes','tables','rows','items','totals']){
      const child=node[key]
      if(child!==undefined)queue.push({value:child,depth:next.depth+1})
    }
  }
  return found
}
/** A gamelog is a sequence of event-level observations, not generic
 * season totals. Preserve the event/date and the provider's stat labels.
 * @param raw - ESPN Common v3 athlete gamelog response.
 * @returns Up to eight actual event stat rows with source labels.
 */
function gameLog(raw:unknown):DirectMetric[]{
  const root=obj(raw),events=obj(root.events)
  const results:DirectMetric[]=[]
  const queue:Array<{v:unknown;depth:number}>=[{v:raw,depth:0}]
  let examined=0
  while(queue.length&&examined++<70&&results.length<8){
    const next=queue.shift()!,node=obj(next.v),labels=arr(node.labels)
    for(const event of arr(node.events).slice(0,12)){
      const e=obj(event),values=arr(e.stats),eventId=id(e.eventId)
      if(!eventId||!values.length||labels.length!==values.length)continue
      const game=obj(events[eventId])
      const title=word(game.shortName??game.name??e.displayName??eventId,90)
      const facts=labels.slice(0,6).map((label,i)=>
        word(label,18)+': '+word(values[i],18)).join(' · ')
      if(title&&facts)results.push({name:title,value:facts.slice(0,175)})
      if(results.length>=8)break
    }
    if(next.depth>=4)continue
    for(const field of ['seasonTypes','categories','tables'])
      for(const child of arr(node[field]).slice(0,15))queue.push({v:child,depth:next.depth+1})
  }
  return results.length?results:extract(raw,8)
}
function rosterRows(raw:unknown):Array<{id:string;name:string;position:string;jersey:string;headshot:string|null}>{
  const listed=arr(obj(raw).athletes).flatMap(group=>{
    const r=obj(group)
    return arr(r.items).length?arr(r.items):[group]
  })
  const seen=new Set<string>()
  return listed.flatMap(entry=>{
    const row=obj(entry),athlete=obj(row.athlete),person=Object.keys(athlete).length?athlete:row
    const athleteId=id(person.id??row.id),name=word(person.displayName??person.fullName??person.name,90)
    if(!athleteId||!name||seen.has(athleteId))return []
    seen.add(athleteId)
    return [{id:athleteId,name,position:word(obj(person.position).abbreviation??
      obj(person.position).displayName??person.position,35),
      jersey:word(person.jersey,8),headshot:safePhoto(obj(person.headshot).href??person.headshot)}]
  }).slice(0,55)
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
  const result:DirectTeam[]=[],jobs:Task[]=[]
  let requests=0,errors=0
  const add=(url:string,type:string,destination:(value:unknown|null)=>void)=>
    jobs.push({url,type,destination})
  for(const t of teams){
    const team:DirectTeam={id:t.id,name:word(t.name),athleteCount:0,
      selectedCount:0,stats:[],depthChart:[],athletes:[],coverage:[]}
    result.push(team)
    const root=site+'teams/'+t.id+'/'
    add(root+'statistics','team_statistics',value=>{
      team.stats=extract(value,18)
      team.coverage.push({endpoint:'team_statistics',
        status:value===null?'unavailable':team.stats.length?'available':'empty'})
    })
    add(root+'depthcharts','team_depthcharts',value=>{
      team.depthChart=extract(value,10)
      team.coverage.push({endpoint:'team_depthcharts',
        status:value===null?'unavailable':team.depthChart.length?'available':'empty'})
    })
    // Rosters are fetched first: unverified athlete IDs never reach Web v3.
    const roster=await fetchBounded(root+'roster',fetcher,now);requests++
    const people=rosterRows(roster)
    team.athleteCount=people.length
    team.coverage.push({endpoint:'team_roster',status:roster===null?'unavailable':
      people.length?'available':'empty'})
    // Goalies/pitchers/QBs before generic roster order; do NOT call them
    // confirmed starters solely because of position.
    const priority=(a:typeof people[number])=>
      /^(?:g|gk|sp|rp|p|qb)$/iu.test(a.position)?0:1
    people.sort((a,b)=>priority(a)-priority(b))
    const chosen=people.slice(0,maxPlayers)
    team.selectedCount=chosen.length
    for(const person of chosen){
      const athlete:DirectAthlete={...person,teamId:t.id,stats:[],lastGames:[],
        splits:[],status:'unavailable',verifiedSources:[]}
      team.athletes.push(athlete)
      const uri=web+'athletes/'+person.id+'/'
      // Avoid 60-100 redundant player endpoints when ESPN returns empty
      // responses. Probe the roster once, then request deeper metrics only
      // for athletes whose first probe yields actual records or the top three
      // whose gamelog may exist independently of season stats.
      const early=team.athletes.length<=3
      add(uri+'stats','athlete_stats',value=>{
        athlete.stats=extract(value,12)
        if(athlete.stats.length)athlete.verifiedSources.push('stats')
        if(athlete.stats.length||early||priority(person)===0){
          add(uri+'gamelog','athlete_gamelog',data=>{
            athlete.lastGames=gameLog(data)
            if(athlete.lastGames.length)athlete.verifiedSources.push('gamelog')
          })
        }
        if(athlete.stats.length&&(priority(person)===0||early)){
          add(uri+'splits','athlete_splits',data=>{
            athlete.splits=extract(data,6)
            if(athlete.splits.length)athlete.verifiedSources.push('splits')
          })
        }
      })
    }
  }
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
