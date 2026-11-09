/** Zero-key, bounded PUBLIC DATA availability diagnostics for PHOENIX.
 * A verified endpoint is not a verified game, lineup, bookmaker or price.
 * Use narrow official feeds and the existing host allowlist, never arbitrary URLs.
 */
import {getFeed,hasSportsPermission} from './sports.ts'

export type FastFreeProbe={
  provider:string;discipline:string;endpoint:string;
  status:'observed'|'empty'|'unavailable'|'disabled';
  records:number;elapsedMs:number;checkedAt:string;detail:string;
}
type Target={provider:string;discipline:string;endpoint:string;
  extract:(json:unknown)=>unknown[]|null;permission:'espn'|'mlb'|'public'}
const asObject=(value:unknown):Record<string,unknown>=>
  value!==null&&typeof value==='object'&&!Array.isArray(value)
    ?value as Record<string,unknown>:{}
const asArray=(value:unknown):unknown[]|null=>Array.isArray(value)?value:null
const localDay=(when:number)=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date(when))
const validDate=(day:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(day)&&
  Number.isFinite(Date.parse(day+'T00:00:00Z'))&&
  new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day
const targets=(day:string):Target[]=>{
  const dt=day.replaceAll('-','')
  return [
    {provider:'ESPN Site',discipline:'NBA',permission:'espn',
      endpoint:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates='+dt,
      extract:x=>asArray(asObject(x).events)},
    {provider:'ESPN Site',discipline:'NFL',permission:'espn',
      endpoint:'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates='+dt,
      extract:x=>asArray(asObject(x).events)},
    {provider:'ESPN Site',discipline:'Liga MX',permission:'espn',
      endpoint:'https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1/scoreboard?dates='+dt,
      extract:x=>asArray(asObject(x).events)},
    {provider:'MLB StatsAPI',discipline:'MLB',permission:'mlb',
      endpoint:'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date='+day,
      extract:x=>{
        const dates=asArray(asObject(x).dates)
        return dates===null?null:dates.flatMap(d=>asArray(asObject(d).games)??[])
      }},
    {provider:'NHL Web API',discipline:'NHL',permission:'public',
      endpoint:'https://api-web.nhle.com/v1/score/'+day,
      extract:x=>asArray(asObject(x).games)},
    {provider:'TheSportsDB',discipline:'Fútbol mundial',permission:'public',
      endpoint:'https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d='+day+'&s=Soccer',
      extract:x=>{
        const events=asObject(x).events
        return events===null?[]:asArray(events)
      }},
  ]
}
const cache=new Map<string,{until:number;result:Promise<FastFreeProbe>}>()
async function check(target:Target,fetcher:typeof fetch,now:number,
  env:NodeJS.ProcessEnv):Promise<FastFreeProbe>{
  const checkedAt=new Date(now).toISOString()
  const disabled=target.permission==='espn'?!hasSportsPermission('espn',env):
    target.permission==='mlb'?!hasSportsPermission('mlb',env):
    target.provider==='TheSportsDB'&&env.PHOENIX_SPORTS_FREE_BACKUPS_DISABLED==='1'
  if(disabled)return{provider:target.provider,discipline:target.discipline,endpoint:target.endpoint,
    status:'disabled',records:0,elapsedMs:0,checkedAt,detail:'Deshabilitado por configuración del operador'}
  const work=async():Promise<FastFreeProbe>=>{
    const start=Date.now()
    try{
      const data=await getFeed<unknown>(target.endpoint,fetcher)
      const rows=target.extract(data)
      if(rows===null)throw Error('Esquema público incompatible: no hay lista verificable')
      return{provider:target.provider,discipline:target.discipline,endpoint:target.endpoint,
        status:rows.length?'observed':'empty',records:rows.length,
        elapsedMs:Date.now()-start,checkedAt,
        detail:rows.length?'Datos de calendario/resultado disponibles, NO precio ni expediente':
          'Endpoint responde, pero no publica eventos para la fecha; puede ser temporada baja'}
    }catch(err){
      const reason=err instanceof Error?err.message:String(err)
      return{provider:target.provider,discipline:target.discipline,endpoint:target.endpoint,
        status:'unavailable',records:0,elapsedMs:Date.now()-start,checkedAt,
        detail:'Fallo de consulta pública: '+reason.slice(0,150)}
    }
  }
  if(fetcher!==fetch)return work()
  const key=target.endpoint
  const prior=cache.get(key)
  if(prior&&prior.until>now)return prior.result
  if(cache.size>48)cache.clear()
  const result=work()
  cache.set(key,{until:now+4*60_000,result})
  return result
}
/** Run six targeted checks, three at a time; no credential or scraped odds involved. */
export async function probeFastFreeSports(
  date=localDay(Date.now()),fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,
):Promise<{date:string;checkedAt:string;sources:FastFreeProbe[];
  observed:number;empty:number;unavailable:number;disabled:number;instruction:string}>{
  if(!validDate(date))throw Error('Fecha inválida, usar AAAA-MM-DD')
  const sources:FastFreeProbe[]=[]
  const feeds=targets(date)
  for(let offset=0;offset<feeds.length;offset+=3){
    sources.push(...await Promise.all(feeds.slice(offset,offset+3).map(t=>
      check(t,fetcher,now,env))))
  }
  const total=(status:FastFreeProbe['status'])=>sources.filter(x=>x.status===status).length
  return {date,checkedAt:new Date(now).toISOString(),sources,
    observed:total('observed'),empty:total('empty'),
    unavailable:total('unavailable'),disabled:total('disabled'),
    instruction:'Estas pruebas verifican accesibilidad y formato de fuentes gratuitas, NO lesiones, titulares, cuotas ni una apuesta ganadora. Una fecha sin partidos no es fallo de API. Confrontar cada evento por IDs, fecha y ambos clubes.'}
}
