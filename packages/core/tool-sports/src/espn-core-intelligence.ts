/**
 * Read-only ESPN Core betting intelligence: all paths are built from validated IDs.
 *
 * ESPN Core is an undocumented, keyless data interface; a route being documented
 * does NOT imply the market is present, current, or offered in the user's region.
 * Predictions, ATS and historical records are NOT sportsbook quotations.
 */
export const espnCoreModes = {
  odds:'Cuotas por evento (referencias a proveedores)',
  provider:'Cuotas de un proveedor y encuentro',
  movement:'Movimientos históricos de cuotas de un proveedor',
  head_to_heads:'Mercados de enfrentamiento por proveedor',
  ats:'Récord contra el spread, temporada/equipo',
  futures:'Apuestas de temporada/futuros (si ESPN publica)',
  past_performances:'Historial según cuotas de equipo y proveedor',
  odds_records:'Récord por cuotas/favorito/equipo y temporada',
  probabilities:'Probabilidades ESPN del encuentro (NO cuotas)',
  predictor:'Indicadores ESPN de predicción (NO cuotas)',
  providers:'Catálogo de proveedores ESPN Core',
} as const
export type EspnCoreMode=keyof typeof espnCoreModes
export type EspnCoreInput={
  mode:EspnCoreMode;sport:string;league:string;eventId?:string|undefined
  competitionId?:string|undefined;teamId?:string|undefined
  providerId?:string|undefined;season?:number|undefined
  seasonType?:number|undefined;movementType?:number|undefined
  limit?:number|undefined;page?:number|undefined
}
type Data=Record<string,unknown>
const record=(v:unknown):v is Data=>v!==null&&typeof v==='object'&&!Array.isArray(v)
const arr=(v:unknown):Data[]=>Array.isArray(v)?v.filter(record):[]
const text=(v:unknown,max=160)=>typeof v==='string'?v.slice(0,max):typeof v==='number'&&Number.isFinite(v)?String(v):''
const safeId=(v:unknown):string=>{
  const s=text(v,30)
  if(!/^\d{1,16}$/u.test(s))throw Error('Identificador ESPN inválido o ausente')
  return s
}
const sportOK=(v:string)=>/^[a-z][a-z-]{1,35}$/u.test(v)
const leagueOK=(v:string)=>/^[a-z0-9][a-z0-9._-]{0,45}$/u.test(v)
export const coreRoot='https://sports.core.api.espn.com/v2/sports/'
const bounded=(v:number|undefined,max:number,fallback:number):number=>Number.isInteger(v)&&v!==undefined&&v>=1&&v<=max?v:fallback
/** Build a fixed, immutable HTTPS provider URL from validated path segments. */
export function espnCoreUrl(input:EspnCoreInput):string{
  const { mode,sport,league }=input
  if(!Object.hasOwn(espnCoreModes,mode))throw Error('Modo ESPN Core no admitido')
  if(!sportOK(sport)||!leagueOK(league))throw Error('Deporte o liga ESPN inválidos')
  const base=coreRoot+sport+'/leagues/'+league
  let path=''
  switch(mode){
    case 'odds':case 'provider':case 'movement':case 'head_to_heads':
    case 'probabilities':case 'predictor':{
      const event=safeId(input.eventId)
      const comp=input.competitionId?safeId(input.competitionId):event
      path='/events/'+event+'/competitions/'+comp
      if(mode==='probabilities'||mode==='predictor')path+='/'+mode
      else{
        path+='/odds'
        if(mode!=='odds')path+='/'+safeId(input.providerId)
        if(mode==='movement'){
          const movement=input.movementType??0
          if(!Number.isInteger(movement)||movement<0||movement>1)
            throw Error('Tipo de movimiento inválido: 0 moneyline o 1 spread')
          path+='/history/'+movement+'/movement'
        }
        if(mode==='head_to_heads')path+='/head-to-heads'
      }
      break
    }
    case 'ats':case 'odds_records':case 'futures':{
      const year=input.season
      if(!Number.isInteger(year)||year===undefined||year<1900||year>2100)throw Error('Temporada ESPN inválida')
      path='/seasons/'+year
      if(mode==='futures'){path+='/futures';break}
      const defaultType=mode==='odds_records'?0:2
      const seasonType=input.seasonType??defaultType
      if(!Number.isInteger(seasonType)||seasonType<0||seasonType>4)throw Error('Tipo de temporada inválido')
      path+='/types/'+seasonType+'/teams/'+safeId(input.teamId)
      path+='/'+(mode==='ats'?'ats':'odds-records')
      break
    }
    case 'past_performances':
      path='/teams/'+safeId(input.teamId)+'/odds/'+safeId(input.providerId)+'/past-performances'
      break
    case 'providers':
      path='/providers'
      break
  }
  const url=new URL(base+path)
  url.searchParams.set('limit',String(bounded(input.limit,100,25)))
  url.searchParams.set('page',String(bounded(input.page,1000,1)))
  return url.toString()
}
function trustedRef(ref:unknown,sport:string,league:string):string|null{
  if(typeof ref!=='string'||ref.length>600)return null
  try{
    const u=new URL(ref)
    if(!['https:','http:'].includes(u.protocol)||!['sports.core.api.espn.com','sports.core.api.espn.pvt'].includes(u.hostname)
      ||u.username||u.password||u.port)return null
    // Some public Core payloads contain ESPN's internal .pvt references. Restrict
    // rewriting to this exact upstream hostname; never follow arbitrary hosts.
    if(u.hostname==='sports.core.api.espn.pvt')u.hostname='sports.core.api.espn.com'
    u.protocol='https:'
    if(!u.pathname.startsWith('/v2/sports/'+sport+'/leagues/'+league+'/'))return null
    if(u.searchParams.has('apiKey'))return null
    return u.toString()
  }catch{return null}
}
const cache=new Map<string,{ at:number;data:unknown }>()
const inFlight=new Map<string,Promise<unknown>>()
/** Bounded cache and in-flight request sharing; no model calls for repeated snapshots. */
export async function espnCoreRead(url:string,getJSON:<T>(url:string)=>Promise<T>,
  now=Date.now(),ttl=60_000):Promise<unknown>{
  const seen=cache.get(url)
  if(seen&&now-seen.at<ttl&&now>=seen.at)return seen.data
  const waiting=inFlight.get(url)
  if(waiting)return waiting
  const running=(async()=>{
    const value=await getJSON<unknown>(url)
    if(cache.size>120)cache.clear()
    cache.set(url,{ at:Date.now(),data:value })
    return value
  })()
  inFlight.set(url,running)
  try{return await running}finally{inFlight.delete(url)}
}
const trimmed=(value:unknown,max=9500):unknown=>{
  // Retain JSON structure while bounding tool tokens; never stringify raw references as instructions.
  const json=JSON.stringify(value)
  if(!json)return null
  if(json.length<=max)return value
  if(Array.isArray(value))return value.slice(0,3).map(x=>trimmed(x,Math.floor(max/3)))
  if(record(value)){
    const selected:Data={}
    for(const [key,v] of Object.entries(value)){
      if(JSON.stringify(selected).length>=max-120)break
      if(key==='$ref')selected[key]=text(v,400)
      else if(typeof v==='string')selected[key]=v.slice(0,320)
      else if(Array.isArray(v))selected[key]=v.slice(0,5).map(x=>trimmed(x,950))
      else if(record(v))selected[key]=trimmed(v,900)
      else selected[key]=v
    }
    return selected
  }
  return value
}
export type EspnCoreReport={
  mode:EspnCoreMode;source:'ESPN Core API (pública, sin clave)'
  endpoint:string;state:'data'|'empty'|'unavailable';count:number
  page?:Data|undefined;observedAt:string;items:unknown[]
  details?:unknown|undefined;refCount:number;resolvedRefs:number
  warning:string;error?:string|undefined
}
/**
 * Retrieve one bounded Core collection with optional same-host $ref resolution.
 * ESPN sometimes returns only references: expand at most six sequentially to
 * respect upstream and cap token output. Missing child links remain visible.
 */
export async function queryEspnCore(input:EspnCoreInput,getJSON:<T>(url:string)=>Promise<T>,
  options:{ resolveRefs?:boolean;now?:number }={}):Promise<EspnCoreReport>{
  const endpoint=espnCoreUrl(input)
  const at=options.now??Date.now()
  const base={
    mode:input.mode,source:'ESPN Core API (pública, sin clave)' as const,
    endpoint,observedAt:new Date(at).toISOString(),
    warning:'ESPN Core es una interfaz no oficial sin SLA. Las probabilidades/predictores/ATS e históricos NO son cotizaciones disponibles. Las cuotas requieren proveedor, mercado, evento y vigencia comprobados.',
  }
  try{
    const raw=await espnCoreRead(endpoint,getJSON,at)
    if(!record(raw)&&!Array.isArray(raw))return { ...base,state:'empty',count:0,items:[],refCount:0,resolvedRefs:0 }
    const root=record(raw)?raw:{}
    const original=Array.isArray(raw)?arr(raw):arr(root.items)
    const refs=original.filter(v=>trustedRef(v.$ref,input.sport,input.league)!==null)
    const results:unknown[]=[]
    let resolvedRefs=0
    for(const item of original.slice(0,12)){
      const ref=trustedRef(item.$ref,input.sport,input.league)
      if(ref&&options.resolveRefs!==false&&resolvedRefs<6){
        try{
          const resolved=await espnCoreRead(ref,getJSON,at)
          results.push(trimmed(resolved,1700));resolvedRefs++
        }catch{results.push({ $ref:ref,unavailable:true })}
      }else results.push(trimmed(item,900))
    }
    const details=original.length===0?trimmed(raw,5200):undefined
    const count=typeof root.count==='number'&&root.count>=0?root.count:original.length||((record(raw)&&Object.keys(raw).length>0)?1:0)
    return { ...base,state:count>0?'data':'empty',count,
      items:results,details,refCount:refs.length,resolvedRefs,
      ...(record(root.pageInfo)?{ page:trimmed(root.pageInfo,350) as Data }:{}) }
  }catch(error){
    return { ...base,state:'unavailable',count:0,items:[],refCount:0,resolvedRefs:0,
      error:error instanceof Error?error.message.slice(0,220):'Error desconocido del proveedor' }
  }
}
