/** NHL official gamecenter is a free no-key endpoint. A rostered goalie, a
 * projected starter and a starting goalie are different evidence grades.
 * Never borrow a postgame boxscore for a historical pregame claim.
 */
export type NhlStarterProbe={
  state:'confirmed'|'not-published'|'unavailable'|'not-pregame'|'identity-conflict'
  url:string
  homeGoalie:string|null;awayGoalie:string|null
  /** Only explicitly listed *pregame* NHL boxscore scratches, not roster omissions. */
  scratches?:{home:Array<{playerId:string;name:string|null}>;
    away:Array<{playerId:string;name:string|null}>}
  note:string;checkedAt:string
}
type R=Record<string,unknown>
const obj=(value:unknown):R=>value&&typeof value==='object'&&!Array.isArray(value)?
  value as R:{}
const arr=(value:unknown):unknown[]=>Array.isArray(value)?value:[]
const name=(v:unknown):string=>{
  const x=obj(v);return String(x.default??x.en??v??'').trim().slice(0,100)
}
function officialStarter(payload:unknown):string|null{
  const items=arr(payload).map(obj).filter(x=>x.starter===true||x.isStarter===true||
    x.startingGoalie===true)
  if(items.length!==1)return null
  const p=items[0]!
  const label=[name(p.firstName),name(p.lastName)].filter(Boolean).join(' ').trim()
  const full=String(p.name??p.fullName??label).trim().slice(0,110)
  return full.length>=4?full:null
}
/** Strict NHL player ID only; name is descriptive and cannot replace an ID. */
function pregameScratches(payload:unknown){
  const rows=arr(payload)
  return rows.flatMap(value=>{
    const x=obj(value)
    const rawId=x.playerId??x.id??(
      typeof value==='number'||typeof value==='string'?value:null)
    const playerId=String(rawId??'')
    if(!/^\d{5,18}$/u.test(playerId))return[]
    const label=[name(x.firstName),name(x.lastName)].filter(Boolean).join(' ').trim()
    return[{playerId,name:label||String(x.name??x.fullName??'').trim()||null}]
  })
}
export async function probeNhlOfficialStarters(args:{
  gameId:string;homeAbbrev:string;awayAbbrev:string;kickoff:string
},fetcher:typeof fetch=fetch,now=Date.now()):Promise<NhlStarterProbe>{
  const url='https://api-web.nhle.com/v1/gamecenter/'+encodeURIComponent(args.gameId)+'/boxscore'
  const result={url,checkedAt:new Date(now).toISOString(),homeGoalie:null,awayGoalie:null}
  if(!/^\d{10}$/u.test(args.gameId)||!Number.isFinite(Date.parse(args.kickoff))||
    Date.parse(args.kickoff)<=now)return{...result,state:'not-pregame',
      note:'No usar boxscore posterior al inicio ni identificador NHL inválido'}
  try{
    const response=await fetcher(url,{signal:AbortSignal.timeout(4_500),
      headers:{Accept:'application/json'}})
    // A 404/204 before faceoff normally means the NHL has not published a
    // boxscore yet. It is not proof that the provider is down or the team lacks a goalie.
    if(response.status===404||response.status===204)return{...result,
      state:'not-published',note:'Gamecenter sin boxscore pregame publicado (HTTP '+
        response.status+'); reconsultar cerca del inicio'}
    if(!response.ok)throw Error('HTTP '+response.status)
    const data=obj(await response.json())
    if(String(data.id??'')!==args.gameId)return{...result,state:'identity-conflict',
      note:'ID NHL del gamecenter no coincide con el partido seleccionado'}
    const home=obj(data.homeTeam),away=obj(data.awayTeam)
    if(String(home.abbrev??'').toUpperCase()!==args.homeAbbrev.toUpperCase()||
      String(away.abbrev??'').toUpperCase()!==args.awayAbbrev.toUpperCase())
      return{...result,state:'identity-conflict',
        note:'Local/visitante NHL no coinciden con la cartelera oficial'}
    if(!['FUT','PRE'].includes(String(data.gameState??'')))
      return{...result,state:'not-pregame',
        note:'El estado del gamecenter no acredita un parte antes de kickoff'}
    const stats=obj(data.playerByGameStats),h=officialStarter(obj(stats.homeTeam).goalies)
    const a=officialStarter(obj(stats.awayTeam).goalies)
    const scratches={
      home:pregameScratches(obj(stats.homeTeam).scratches),
      away:pregameScratches(obj(stats.awayTeam).scratches),
    }
    if(h&&a)return{...result,scratches,state:'confirmed',homeGoalie:h,awayGoalie:a,
      note:'Ambos porteros marcados explícitamente starter en gamecenter oficial antes del inicio'}
    return{...result,scratches,state:'not-published',
      note:'Gamecenter consultado: porteros no identificados de forma explícita como titulares'}
  }catch(error){return{...result,state:'unavailable',note:
    'NHL gamecenter sin datos confirmables: '+
    (error instanceof Error?error.message:String(error)).slice(0,100)}
  }
}
