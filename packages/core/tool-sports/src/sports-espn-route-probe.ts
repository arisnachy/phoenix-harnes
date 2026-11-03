/** Probe every explicitly registered, public ESPN route for a REAL ESPN
 * event/team/athlete context. No private APIs, scraping, arbitrary hosts,
 * automatic per-message mass scanning or claims that HTTP 200 implies metrics.
 */
import {extendedEspnRoutes,extendedEspnUrl,type ExtendedEspnInput,
  type ExtendedEspnMode} from './espn-extra-intelligence.ts'
export type RouteProbe={mode:ExtendedEspnMode;status:'data'|'ref_only'|'empty'|'error'|'skipped';
  endpoint:string|null;reason?:string;observedAt:string;records:number}
const dict=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?
 v as Record<string,unknown>:{}
const meaningful=(data:unknown):boolean=>{
  if(data===null||data===undefined)return false
  if(Array.isArray(data))return data.slice(0,10).some(meaningful)
  if(typeof data==='object'){
    return Object.entries(dict(data)).some(([key,val])=>
      !['$ref','count','pageCount','pageIndex','pageSize','timestamp','items'].includes(key)
      && meaningful(val))||Array.isArray(dict(data).items)&&
      (dict(data).items as unknown[]).slice(0,10).some(meaningful)
  }
  return typeof data==='string'?data.length>0:true
}
/** Determine operational ESPN route status; no unsupported routes are silently
 * counted as success.
 * @param input - Verified ESPN IDs required by the route templates.
 * @param provider - Read-only JSON transport with bounded response size.
 * @param now - Source audit timestamp.
 * @returns Every registered mode with a status and endpoint/error.
 */
export async function probeExtendedEspnCatalog(
  input:Omit<ExtendedEspnInput,'mode'>,
  provider:<T>(url:string)=>Promise<T>,now=Date.now(),
):Promise<{checkedAt:string;total:number;available:number;unavailable:number;
  results:RouteProbe[];disclaimer:string}>{
  const keys=Object.keys(extendedEspnRoutes) as ExtendedEspnMode[]
  const out:RouteProbe[]=Array(keys.length)
  let cursor=0
  await Promise.all(Array.from({length:3},async()=>{
    while(cursor<keys.length){
      const idx=cursor++,mode=keys[idx]!
      let endpoint:string
      try{endpoint=extendedEspnUrl({...input,mode,limit:5})}
      catch(error){
        out[idx]={mode,status:'skipped',endpoint:null,records:0,
          observedAt:new Date(now).toISOString(),
          reason:error instanceof Error?error.message:'Falta ID o temporada'}
        continue
      }
      try{
        const data=await provider<unknown>(endpoint)
        const x=dict(data)
        const items=Array.isArray(x.items)?x.items:Array.isArray(data)?data:null
        const records=items?.length??(Object.keys(x).length?1:0)
        const isRef=items!==null&&items.length>0&&items.every(v=>
          Object.keys(dict(v)).every(key=>key==='$ref'))
        out[idx]={mode,status:records===0?'empty':isRef?'ref_only':
          meaningful(data)?'data':'empty',endpoint,records,
          observedAt:new Date(now).toISOString()}
      }catch(error){
        out[idx]={mode,status:'error',endpoint,records:0,
          observedAt:new Date(now).toISOString(),
          reason:String(error instanceof Error?error.message:error).slice(0,170)}
      }
    }
  }))
  return {checkedAt:new Date(now).toISOString(),total:keys.length,
    available:out.filter(x=>x.status==='data').length,
    unavailable:out.filter(x=>x.status!=='data').length,results:out,
    disclaimer:'Verificación puntual de las rutas permitidas: no supone que el proveedor funcione en otros deportes, fechas o temporadas. ref_only no es una estadística recuperada. Rutas ESPN no oficiales sujetas a cambios.'}
}
