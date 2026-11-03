/** Source-verified ESPN global soccer league discovery and bounded daily slate.
 * Catalog presence does NOT imply fixture or statistical coverage.
 */
import {discoverEspnLeagues,getFeed,hasSportsPermission,sportsCatalog} from './sports.ts'
export type SoccerSource={url:string;observedAt:string;status:'observed'|'empty'|'error';records:number;error?:string}
export type SoccerFixture={
  eventId:string;league:string;scheduledAt:string;status:string;state:string;
  home:{id:string;name:string};away:{id:string;name:string};
  venue:string;neutral:boolean|null
}
type Row=Record<string,unknown>
export const row=(x:unknown):Row=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Row:{}
export const array=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
export const clean=(x:unknown,n=120):string=>typeof x==='string'||typeof x==='number'
  ?String(x).replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,n):''
export const digits=(x:unknown):string=>/^\d{1,18}$/u.test(String(x??''))?String(x):''
export const soccerSlug=(x:string):boolean=>/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(x)
export const soccerDate=(x:string):boolean=>/^\d{4}-\d{2}-\d{2}$/u.test(x)&&
  Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
  new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x
export const normalize=(x:string)=>x.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
export async function sourceRead<T>(url:string,fetcher:typeof fetch,
  sources:SoccerSource[],now:number):Promise<T|null>{
  try{
    const data=await getFeed<T>(url,fetcher)
    const records=data===null||data===undefined?0:1
    sources.push({url,observedAt:new Date(now).toISOString(),status:records?'observed':'empty',records})
    return data
  }catch(error){
    sources.push({url,observedAt:new Date(now).toISOString(),status:'error',records:0,
      error:String(error instanceof Error?error.message:error).slice(0,140)})
    return null
  }
}
export function soccerFixture(raw:unknown,league:string):SoccerFixture|null{
  const v=row(raw),eventId=digits(v.id),c=row(array(v.competitions)[0])
  const teams=array(c.competitors).map(row)
  const get=(side:'home'|'away')=>{
    const r=teams.find(t=>t.homeAway===side),t=row(r?.team)
    const id=digits(t.id??r?.id),name=clean(t.displayName??t.name,115)
    return id&&name?{id,name}:null
  }
  const home=get('home'),away=get('away')
  const scheduledAt=clean(v.date??c.date,50),t=row(row(v.status).type)
  if(!eventId||!home||!away||!Number.isFinite(Date.parse(scheduledAt)))return null
  const venue=row(c.venue)
  return{eventId,league,scheduledAt,
    status:clean(t.description??t.name,75)||'Estado no verificado',
    state:clean(t.state,25).toLowerCase(),home,away,
    venue:clean(venue.fullName??venue.name,120)||'Estadio no verificado',
    neutral:typeof c.neutralSite==='boolean'?c.neutralSite:null}
}
export async function soccerLeagueCatalog(fetcher:typeof fetch=fetch,now=Date.now(),
  env:NodeJS.ProcessEnv=process.env):Promise<{leagues:string[];observedAt:string;source:string;
  worldwideComplete:false;note:string}>{
  if(!hasSportsPermission('espn',env))throw Error('ESPN no autorizado')
  const leagues=await discoverEspnLeagues('soccer',env,fetcher)
  return{leagues:leagues.filter(soccerSlug).slice(0,500),
    observedAt:new Date(now).toISOString(),source:'ESPN Core leagues catalog',
    worldwideComplete:false,
    note:'Catálogo mundial parcial de proveedor: no garantiza cartelera, xG, lesiones ni cuotas.'}
}
/** Up to 12 verified competitions per batch; caller paginates the catalog. */
export async function soccerDailySlate(date:string,leagues:string[],
  fetcher:typeof fetch=fetch,now=Date.now(),env:NodeJS.ProcessEnv=process.env)
  :Promise<{date:string;leagues:string[];games:SoccerFixture[];sources:SoccerSource[];
    worldwideComplete:false}>{
  if(!soccerDate(date))throw Error('Fecha de fútbol inválida')
  if(!hasSportsPermission('espn',env))throw Error('ESPN no autorizado')
  const chosen=[...new Set(leagues)]
  if(!chosen.length||chosen.length>12||chosen.some(l=>!soccerSlug(l)))
    throw Error('Selecciona entre una y doce ligas válidas')
  let available=[...(sportsCatalog.soccer??[])]
  if(chosen.some(l=>!available.includes(l)))
    available=(await soccerLeagueCatalog(fetcher,now,env)).leagues
  if(chosen.some(l=>!available.includes(l)))throw Error('Liga no identificada por ESPN')
  const sources:SoccerSource[]=[],games:SoccerFixture[]=[]
  let cursor=0
  await Promise.all(Array.from({length:Math.min(3,chosen.length)},async()=>{
    while(cursor<chosen.length){
      const league=chosen[cursor++]!
      const url='https://site.api.espn.com/apis/site/v2/sports/soccer/'+league+
        '/scoreboard?dates='+date.replaceAll('-','')
      const data=await sourceRead<{events?:unknown[]}>(url,fetcher,sources,now)
      for(const ev of array(data?.events)){
        const g=soccerFixture(ev,league)
        if(g)games.push(g)
      }
    }
  }))
  const unique=new Map<string,SoccerFixture>()
  for(const game of games)unique.set(game.league+':'+game.eventId,game)
  return{date,leagues:chosen,games:[...unique.values()]
    .sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt)||a.league.localeCompare(b.league)),
    sources,worldwideComplete:false}
}

/**
 * A single bounded page of a worldwide daily scan. Only provider-discovered
 * competitions are included; a page is never represented as exhaustive.
 */
export async function soccerWorldPage(date:string,offset=0,limit=24,
  fetcher:typeof fetch=fetch,now=Date.now(),env:NodeJS.ProcessEnv=process.env)
  :Promise<{date:string;catalogTotal:number;scannedCount:number;offset:number;
    nextOffset:number|null;games:SoccerFixture[];sources:SoccerSource[];
    worldwideComplete:false;note:string}>{
  if(!soccerDate(date))throw Error('Fecha de fútbol inválida')
  if(!Number.isSafeInteger(offset)||offset<0||offset>500)throw Error('Offset inválido')
  if(!Number.isSafeInteger(limit)||limit<1||limit>24)throw Error('Límite por página inválido')
  const catalog=await soccerLeagueCatalog(fetcher,now,env)
  const subset=catalog.leagues.slice(offset,offset+limit)
  const parts:Array<Awaited<ReturnType<typeof soccerDailySlate>>>=[]
  // Keep total effective concurrency bounded to three provider requests.
  for(let i=0;i<subset.length;i+=12)
    parts.push(await soccerDailySlate(date,subset.slice(i,i+12),fetcher,now,env))
  const games=parts.flatMap(p=>p.games)
  return{date,catalogTotal:catalog.leagues.length,scannedCount:subset.length,
    offset,nextOffset:offset+subset.length<catalog.leagues.length?offset+subset.length:null,
    games,sources:parts.flatMap(p=>p.sources),worldwideComplete:false,
    note:'Un lote de las ligas descubiertas por ESPN. Hasta finalizar las páginas, otras ligas siguen sin investigar; incluso todo el catálogo no cubre todas las ligas del planeta.'}
}
