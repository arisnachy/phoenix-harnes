/** ESPN Site v2 public rosters for every verified ESPN sport/league.
 * A roster proves membership on the fetched roster, never a starting lineup.
 * IDs are extracted ONLY from the corresponding athlete's own fields/links.
 */
type R=Record<string,unknown>
const rec=(x:unknown):R=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as R:{}
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const str=(x:unknown,n=100):string=>(typeof x==='string'||typeof x==='number')?
  String(x).replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,n):''
const digits=(x:unknown):string=>/^\d{1,18}$/u.test(String(x??''))?String(x):''
const norm=(x:string)=>x.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
export type EspnRosterPerson={
  id:string;name:string;position:string;jersey:string;headshot:string|null
}
export type EspnRosterAttempt={
  url:string;status:'available'|'empty'|'unavailable'
}
const photo=(value:unknown):string|null=>{
  const raw=str(value,480)
  try{const u=new URL(raw)
    return u.protocol==='https:'&&u.hostname==='a.espncdn.com'&&!u.username&&!u.password
      ?u.toString():null
  }catch{return null}
}
const fromUrl=(input:unknown):string=>{
  if(typeof input!=='string'||input.length>750)return''
  try{
    const u=new URL(input)
    if(!['espn.com','espn.com.do'].includes(u.hostname)&&
      !u.hostname.endsWith('.espn.com')&&!u.hostname.endsWith('.espn.pvt'))return''
    const m=u.pathname.match(/\/(?:athletes|athlete)\/(\d{1,18})(?:\/|$)/u)
      ??u.pathname.match(/\/id\/(\d{1,18})(?:\/|$)/u)
    return digits(m?.[1])
  }catch{return''}
}
/** Never search a serialized injury/roster JSON blob: a second player's id
 * could be incorrectly attributed to the athlete under examination. */
export function espnAthleteId(person:unknown,entry?:unknown):string{
  const p=rec(person),e=rec(entry)
  const direct=digits(p.id??p.athleteId??e.athleteId)
  if(direct)return direct
  const links=[...arr(p.links),...arr(e.links)]
  const refs=[p.$ref,e.$ref,...links.map(x=>rec(x).href??rec(x).url)]
  for(const ref of refs){const resolved=fromUrl(ref);if(resolved)return resolved}
  return''
}
export function parseEspnRoster(raw:unknown):EspnRosterPerson[]{
  const r=rec(raw)
  const roots=[...arr(r.athletes),...arr(r.roster),...arr(rec(r.team).athletes),
    ...arr(rec(r.roster).athletes)]
  const rows:unknown[]=[]
  for(const item of roots.slice(0,80)){
    const group=rec(item),children=[...arr(group.items),...arr(group.athletes),
      ...arr(group.entries),...arr(group.players)]
    if(children.length)rows.push(...children.slice(0,70))
    else rows.push(item)
  }
  const seen=new Set<string>()
  return rows.flatMap(entry=>{
    const row=rec(entry),athlete=rec(row.athlete)
    const person=Object.keys(athlete).length?athlete:row
    const athleteId=espnAthleteId(person,row)
    const name=str(person.displayName??person.fullName??person.name,90)
    if(!athleteId||!name||seen.has(athleteId))return[]
    seen.add(athleteId)
    const position=rec(person.position)
    return[{id:athleteId,name,
      position:str(position.abbreviation??position.displayName??person.position,35),
      jersey:str(person.jersey,8),
      headshot:photo(rec(person.headshot).href??person.headshot)}]
  }).slice(0,55)
}
/** Read exact numeric team roster, then recover by abbreviation obtained from
 * the SAME team ID and display name, not from a user-provided guessed alias. */
export async function recoverEspnRoster(
  sport:string,league:string,team:{id:string;name:string},
  get:(url:string)=>Promise<unknown|null>,
):Promise<{people:EspnRosterPerson[];attempts:EspnRosterAttempt[]}>{
  if(!/^[a-z][a-z-]{1,35}$/u.test(sport)||
    !/^[a-z0-9][a-z0-9._-]{0,45}$/u.test(league)||!digits(team.id))
    throw Error('Identificador ESPN de equipo o liga inválido')
  const root='https://site.api.espn.com/apis/site/v2/sports/'+sport+'/'+league+'/teams/'
  const attempts:EspnRosterAttempt[]=[]
  const read=async(url:string):Promise<{raw:unknown|null;people:EspnRosterPerson[]}>=>{
    let raw:unknown|null=null
    try{raw=await get(url)}catch{/* Provider unavailable, reported separately. */}
    const people=parseEspnRoster(raw)
    attempts.push({url,status:raw===null?'unavailable':people.length?'available':'empty'})
    return{raw,people}
  }
  const primary=await read(root+team.id+'/roster')
  if(primary.people.length)return{people:primary.people,attempts}
  const metadata=await read(root+team.id)
  const body=rec(rec(metadata.raw).team)
  const t=Object.keys(body).length?body:rec(metadata.raw)
  const abbr=str(t.abbreviation,8).toLowerCase()
  const name=str(t.displayName??t.name,110)
  const sameTeam=digits(t.id)===team.id&&norm(name)===norm(team.name)
  if(!sameTeam||!/^[a-z0-9]{2,5}$/u.test(abbr))
    return{people:[],attempts}
  const backup=await read(root+abbr+'/roster')
  return{people:backup.people,attempts}
}
