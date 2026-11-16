/**
 * NHL gamecenter right-rail exposes gameInfo.{homeTeam,awayTeam}.scratches.
 * Pre-faceoff availability is NOT guaranteed. An observed scratch does not
 * prove injury, suspension or "healthy" status without another dated source.
 */
export type NhlScratchPlayer={id:string;name:string;availability:'scratch-observed'}
export type NhlScratchProbe={
  state:'observed'|'not-published'|'unavailable'|'not-pregame'|'identity-conflict'
  url:string;checkedAt:string;note:string;gameId:string
  home:NhlScratchPlayer[];away:NhlScratchPlayer[]
  /** NHL API does not provide a reliable final roster submission timestamp. */
  officialFinalLineup:false;publishedAt:null
}
type R=Record<string,unknown>
const o=(x:unknown):R=>x&&typeof x==='object'&&!Array.isArray(x)?x as R:{}
const a=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const word=(v:unknown):string=>{
  const x=o(v)
  const n=x.default??x.en??v
  return typeof n==='string'?n.trim().slice(0,100):''
}
const validId=(v:unknown)=>/^\d{7,9}$/u.test(String(v??''))?String(v):''
function list(value:unknown):NhlScratchPlayer[]|null{
  if(!Array.isArray(value))return null
  if(value.length>80)return null
  const seen=new Set<string>(),out:NhlScratchPlayer[]=[]
  for(const v of a(value)){
    const player=o(v),id=validId(player.id??player.playerId)
    if(!id||seen.has(id))continue
    seen.add(id)
    const name=[word(player.firstName),word(player.lastName)].filter(Boolean).join(' ')||
      word(player.name)||word(player.fullName)||'NHL ID '+id
    out.push({id,name,availability:'scratch-observed'})
  }
  return out
}
export function parseNhlRightRailScratches(
  payload:unknown,args:{gameId:string;homeAbbrev:string;awayAbbrev:string;
    kickoff:string},now=Date.now(),
):NhlScratchProbe{
  const url='https://api-web.nhle.com/v1/gamecenter/'+encodeURIComponent(args.gameId)+'/right-rail'
  const blank={url,gameId:args.gameId,checkedAt:new Date(now).toISOString(),
    home:[] as NhlScratchPlayer[],away:[] as NhlScratchPlayer[],
    officialFinalLineup:false as const,publishedAt:null}
  const kickoff=Date.parse(args.kickoff)
  if(!/^\d{10}$/u.test(args.gameId)||!Number.isFinite(kickoff)||now>=kickoff)
    return{...blank,state:'not-pregame',note:'Consulta no es anterior al comienzo'}
  const root=o(payload),info=o(root.gameInfo)
  const actualId=root.id??root.gameId??info.gameId??info.id
  if(actualId!==undefined&&String(actualId)!==args.gameId)
    return{...blank,state:'identity-conflict',note:'Game ID NHL distinto del solicitado'}
  const state=root.gameState??info.gameState
  if(typeof state==='string'&&!['FUT','PRE'].includes(state))
    return{...blank,state:'not-pregame',
      note:'Gamecenter ya no está en estado prepartido'}
  const h=o(info.homeTeam),aw=o(info.awayTeam)
  const homeAbbrev=word(h.abbrev??h.teamAbbrev)
  const awayAbbrev=word(aw.abbrev??aw.teamAbbrev)
  if((homeAbbrev&&homeAbbrev.toUpperCase()!==args.homeAbbrev.toUpperCase())||
    (awayAbbrev&&awayAbbrev.toUpperCase()!==args.awayAbbrev.toUpperCase()))
    return{...blank,state:'identity-conflict',note:'Equipos NHL no coinciden'}
  const home=list(h.scratches),away=list(aw.scratches)
  if(home===null||away===null)
    return{...blank,state:'not-published',
      note:'La NHL no publicó ambos arrays explícitos de scratches pregame'}
  return{...blank,home,away,state:'observed',
    note:'Lista NHL observada, no confirma alineación final ni motivo de baja'}
}
export async function probeNhlPregameScratches(
  args:{gameId:string;homeAbbrev:string;awayAbbrev:string;kickoff:string},
  fetcher:typeof fetch=fetch,now=Date.now(),
):Promise<NhlScratchProbe>{
  const blank=parseNhlRightRailScratches(null,args,now)
  if(blank.state==='not-pregame')return blank
  try{
    const response=await fetcher(blank.url,{signal:AbortSignal.timeout(4_000),
      headers:{Accept:'application/json'}})
    if(response.status===404||response.status===204)
      return{...blank,state:'not-published',note:'NHL right-rail no publicado (HTTP '+response.status+')'}
    if(!response.ok)throw Error('HTTP '+response.status)
    return parseNhlRightRailScratches(await response.json(),args,now)
  }catch(error){
    return{...blank,state:'unavailable',note:'NHL right-rail: '+
      String(error instanceof Error?error.message:error).slice(0,110)}
  }
}
