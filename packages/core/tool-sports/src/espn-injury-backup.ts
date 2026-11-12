/** ESPN public injury feeds. Read-only, unofficial, attributed and bounded.
 * A roster is not an injury report, a league feed is not a game-day inactive
 * list and an old report cannot confirm that an athlete will miss tonight.
 */
import {getFeed} from './sports.ts'
import {espnAthleteId} from './espn-public-roster.ts'

export type InjuryFixture={sport:string;league:string;home:string;away:string;
  date?:string;eventId?:string;kickoff?:string}
export type InjuryRecord={team:string;athlete:string;athleteId:string|null;
  status:string;reportedAt:string|null;details:string;returnDate:string|null;
  source:string}
export type InjuryBackup={status:'verified'|'partial'|'stale'|'unavailable'|'unsupported';
  league:string;checkedAt:string;feedUpdatedAt:string|null;
  source:string;officialSource:string|null;
  home:{name:string;matched:boolean;injuries:InjuryRecord[]};
  away:{name:string;matched:boolean;injuries:InjuryRecord[]};
  notes:string[]}
const sources:Readonly<Record<string,{sport:string;league:string;official:string|null}>>={
  'basketball|nba':{sport:'basketball',league:'nba',
    official:'https://official.nba.com/nba-injury-report-2026-27-season/'},
  'basketball|wnba':{sport:'basketball',league:'wnba',official:null},
  'football|nfl':{sport:'football',league:'nfl',official:null},
  'baseball|mlb':{sport:'baseball',league:'mlb',official:null},
  'hockey|nhl':{sport:'hockey',league:'nhl',official:null},
}
export const espnInjuryCatalog=Object.freeze(Object.entries(sources).map(([key,route])=>({
  key,url:'https://site.api.espn.com/apis/site/v2/sports/'+route.sport+'/'+
    route.league+'/injuries',officialSource:route.official,
})))
const row=(x:unknown):Record<string,unknown>|null=>
  !!x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:null
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const str=(x:unknown,max=180):string=>typeof x==='string'||typeof x==='number'?
  String(x).replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,max):''
const norm=(x:string)=>x.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const aliases:Readonly<Record<string,string>>={
  laclippers:'losangelesclippers',nyknicks:'newyorkknicks',
  okcthunder:'oklahomacitythunder',gswarriors:'goldenstatewarriors',
  brooklynnets:'brooklynnets',
}
const same=(a:string,b:string):boolean=>{
  const x=norm(a),y=norm(b)
  return x.length>3&&y.length>3&&(aliases[x]??x)===(aliases[y]??y)
}
const validId=(x:unknown):string|null=>/^\d{1,16}$/u.test(String(x??''))?
  String(x):null
const date=(value:unknown):string|null=>{
  const text=str(value,40)
  return text&&Number.isFinite(Date.parse(text))?new Date(text).toISOString():null
}
const nowStamp=(now:number)=>new Date(now).toISOString()
const routeFor=(fixture:InjuryFixture)=>sources[fixture.sport+'|'+fixture.league]
export const espnInjuryFeedUrl=(sport:string,league:string):string|null=>{
  const route=sources[sport+'|'+league]
  return route?'https://site.api.espn.com/apis/site/v2/sports/'+route.sport+
    '/'+route.league+'/injuries':null
}
const empty=(fixture:InjuryFixture,now:number,status:InjuryBackup['status'],
  notes:string[]):InjuryBackup=>{
  const source=espnInjuryFeedUrl(fixture.sport,fixture.league)??''
  return{status,league:fixture.league,checkedAt:nowStamp(now),
    feedUpdatedAt:null,source,officialSource:routeFor(fixture)?.official??null,
    home:{name:fixture.home,matched:false,injuries:[]},
    away:{name:fixture.away,matched:false,injuries:[]},notes}
}
type ParsedGroup={name:string;athletes:InjuryRecord[]}
function parseGroups(payload:unknown,source:string):ParsedGroup[]{
  const data=row(payload)
  const groups=arr(data?.injuries)
  const records:ParsedGroup[]=[]
  // ESPN Site feeds group injuries under a team name and can include many
  // athlete metadata/logos. Keep only the small medically relevant fields.
  for(const raw of groups.slice(0,60)){
    const group=row(raw)
    if(!group)continue
    const team=str(group.displayName??group.name)
    if(!team)continue
    const individuals:InjuryRecord[]=[]
    for(const injury of arr(group.injuries).slice(0,120)){
      const i=row(injury),athlete=row(i?.athlete),details=row(i?.details)
      if(!i||!athlete)continue
      const athleteName=str(athlete.displayName??athlete.fullName)
      if(!athleteName)continue
      const injuryStatus=str(i.status??row(i.type)?.description??'No indicado',70)
      const description=str(details?.type??details?.detail??i.shortComment,240)
      individuals.push({
        team,athlete:athleteName,
        athleteId:validId(athlete.id)??validId(espnAthleteId(athlete,i)),status:injuryStatus,
        reportedAt:date(i.date??i.updatedAt),details:description,
        returnDate:date(details?.returnDate),
        source,
      })
    }
    records.push({name:team,athletes:individuals})
  }
  return records
}
type Scoreboard={events?:Array<{id?:string|number;
  competitions?:Array<{competitors?:Array<{
    homeAway?:string;team?:{id?:string|number;displayName?:string;name?:string}
  }>}>}>}
async function officialIds(fixture:InjuryFixture,
  readJSON:<T>(url:string)=>Promise<T>):Promise<{
    home:string;away:string}|null>{
  if(!fixture.eventId||!validId(fixture.eventId)||!fixture.date||
    !/^\d{4}-\d{2}-\d{2}$/u.test(fixture.date))return null
  const route=routeFor(fixture)
  if(!route)return null
  const url='https://site.api.espn.com/apis/site/v2/sports/'+route.sport+'/'+
    route.league+'/scoreboard?dates='+fixture.date.replaceAll('-','')
  try{
    const board=await readJSON<Scoreboard>(url)
    const game=arr(board.events).map(row).find(g=>validId(g?.id)===fixture.eventId)
    const comp=row(arr(game?.competitions)[0])
    const competitors=arr(comp?.competitors).map(row)
    const home=competitors.find(x=>x?.homeAway==='home')
    const away=competitors.find(x=>x?.homeAway==='away')
    const h=row(home?.team),a=row(away?.team)
    if(!same(str(h?.displayName??h?.name),fixture.home)||
      !same(str(a?.displayName??a?.name),fixture.away))return null
    const homeId=validId(h?.id),awayId=validId(a?.id)
    return homeId&&awayId?{home:homeId,away:awayId}:null
  }catch{return null}
}
const readCache=new Map<string,{expiry:number;data:Promise<unknown>}>()
async function publicRead(url:string,fetcher:typeof fetch,now:number):Promise<unknown>{
  // Never let mocked test fixtures pollute cache across tests.
  if(fetcher!==fetch)return getFeed<unknown>(url,fetcher)
  const cached=readCache.get(url)
  if(cached&&cached.expiry>now)return cached.data
  if(readCache.size>=64)readCache.clear()
  const promise=getFeed<unknown>(url,fetcher)
  readCache.set(url,{expiry:now+45_000,data:promise})
  try{return await promise}catch(error){readCache.delete(url);throw error}
}
/** Discover injury status for the two teams, preferring targeted ESPN team feeds.
 * Missing/blocked sources return an honest diagnostic, never a healthy roster.
 */
export async function fetchEspnInjuryBackup(
  fixture:InjuryFixture,fetcher:typeof fetch=fetch,now=Date.now(),
):Promise<InjuryBackup>{
  const route=routeFor(fixture)
  if(!route)return empty(fixture,now,'unsupported',
    ['ESPN no tiene un reporte de lesiones de liga integrado para este deporte'])
  const base=empty(fixture,now,'unavailable',[])
  const notes:string[]=[]
  const readJSON=<T>(url:string)=>publicRead(url,fetcher,now) as Promise<T>
  let groups:ParsedGroup[]=[]
  let feedUpdatedAt:string|null=null
  let offSeason=false
  const observeSeason=(value:unknown)=>{
    const season=row(row(value)?.season)
    if(season&&(str(season.name??season.displayName).toLowerCase().includes('off season')||
      season.type===4))offSeason=true
  }
  // Empirically working ESPN league feeds are the primary route.
  // The sampled team /injuries routes replied HTTP 200 with an empty [].
  // Never interpret an empty team response as healthy athletes.
  try{
    const payload=await readJSON<unknown>(base.source)
    const root=row(payload)
    observeSeason(payload)
    feedUpdatedAt=date(root?.timestamp)??feedUpdatedAt
    groups=parseGroups(payload,base.source)
    if(!groups.length)notes.push('ESPN liga: sin grupos de lesiones reconocibles')
  }catch(error){notes.push('ESPN lesiones por liga: '+
    (error instanceof Error?error.message:String(error)).slice(0,85))}
  if(!groups.some(g=>same(g.name,fixture.home))||
    !groups.some(g=>same(g.name,fixture.away))){
    const ids=await officialIds(fixture,readJSON)
    if(ids){
      const prefix='https://site.api.espn.com/apis/site/v2/sports/'+
        route.sport+'/'+route.league+'/teams/'
      const targets=[{name:fixture.home,id:ids.home},{name:fixture.away,id:ids.away}]
        .filter(t=>!groups.some(g=>same(g.name,t.name)))
      const results=await Promise.allSettled(targets.map(t=>
        readJSON<unknown>(prefix+t.id+'/injuries')))
      for(const [idx,item] of results.entries()){
        if(item.status!=='fulfilled'){
          notes.push(targets[idx]!.name+' ESPN equipo: acceso fallido')
          continue
        }
        const payload=row(item.value)
        observeSeason(item.value)
        const parsed=parseGroups(item.value,prefix+targets[idx]!.id+'/injuries')
        if(parsed.length){
          for(const team of parsed)
            if(!groups.some(g=>same(g.name,team.name)))groups.push(team)
        }else notes.push(targets[idx]!.name+
          ' ruta de equipo vacía: NO demuestra plantilla sana')
        feedUpdatedAt=date(payload?.timestamp)??feedUpdatedAt
      }
    }
  }
  const h=groups.find(x=>same(x.name,fixture.home))
  const a=groups.find(x=>same(x.name,fixture.away))
  const fresh=feedUpdatedAt!==null&&Date.parse(feedUpdatedAt)<=now+15*60_000&&
    now-Date.parse(feedUpdatedAt)<=36*60*60_000
  const stale=feedUpdatedAt!==null&&!fresh
  let status:InjuryBackup['status']=
    h&&a&&fresh?'verified':h||a?'partial':stale?'stale':'unavailable'
  // A season-level feed can be current but report only teams with injuries;
  // an absent group does NOT prove there are no injured athletes.
  if(stale||offSeason)status='stale'
  if(!feedUpdatedAt)notes.push('Sin fecha confiable de actualización del feed ESPN')
  if(!h||!a)notes.push('Uno o ambos equipos ausentes: NO significa plantilla sana')
  if(stale)notes.push('Reporte desactualizado; no confirmar disponibilidad para este partido')
  if(offSeason)notes.push('Liga fuera de temporada; el reporte de lesiones NO es un parte prepartido actual')
  if(fixture.kickoff&&Date.parse(fixture.kickoff)<=now)
    notes.push('Partido iniciado: el parte NO confirma una baja prepartido actual')
  if(route.official)notes.push('NBA: cotejar estatus definitivos en '+route.official)
  notes.push('Una baja ESPN no es alineación titular ni informe oficial de inactivos')
  return{...base,status,feedUpdatedAt,
    home:{name:fixture.home,matched:!!h,injuries:h?.athletes.slice(0,30)??[]},
    away:{name:fixture.away,matched:!!a,injuries:a?.athletes.slice(0,30)??[]},
    notes}
}
