/** One bounded GDELT DOC 2.0 discovery query for ALL selected fixtures.
 * GDELT indexes articles. Metadata are not verified injuries or predictions.
 * No article body is fetched and social images are never embedded.
 */
export type GdeltMatch={eventId:string;home:string;away:string}
export type GdeltMention={eventId:string;title:string;indexedAt:string|null;
  publisher:string;articleUrl:string;provider:'GDELT DOC 2.0';status:'indexed-only'}
export type GdeltReport={status:'observed'|'empty'|'unavailable'|'rate-limited';
  checkedAt:string;sourceUrl:string|null;byEvent:Record<string,GdeltMention[]>;
  scanned:number;note:string}
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const clean=(s:unknown,n=170)=>typeof s==='string'
  ?s.replace(/[\u0000-\u001f<>]/gu,' ').trim().slice(0,n):''
const name=(s:string)=>clean(s,65).replace(/[^a-zA-ZÀ-ž .'-]/gu,' ')
  .replace(/\s+/gu,' ').trim()
const aliases=(s:string)=>{
  const tokens=s.split(' ').filter(Boolean)
  return [norm(s),...tokens.filter(x=>x.length>=5).map(norm)]
    .filter(x=>x.length>=5)
}
const url=(raw:unknown):string|null=>{
  if(typeof raw!=='string')return null
  try{
    const u=new URL(raw)
    return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.includes('.')?
      u.toString():null
  }catch{return null}
}
const seen=(x:unknown)=>{
  const s=clean(x,38)
  const d=/^\d{8}T\d{6}Z$/u.test(s)?
    s.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/u,'$1-$2-$3T$4:$5:$6Z'):s
  const n=Date.parse(d)
  return Number.isFinite(n)?new Date(n).toISOString():null
}
const empty=(status:GdeltReport['status'],now:number,note:string,sourceUrl:string|null=null):GdeltReport=>
  ({status,checkedAt:new Date(now).toISOString(),sourceUrl,byEvent:{},scanned:0,note})
const cache=new Map<string,{at:number;report:GdeltReport}>()
let lastCallAt=-Infinity
/** Query GDELT at most once in five seconds per PHOENIX process. */
export async function discoverGdeltTicketNews(fixtures:readonly GdeltMatch[],
  fetcher:typeof fetch=fetch,now=Date.now()):Promise<GdeltReport>{
  const games=fixtures.slice(0,6).filter(f=>/^\d{1,20}$/u.test(f.eventId)&&
    name(f.home).length>=4&&name(f.away).length>=4)
  if(!games.length)return empty('empty',now,'Sin encuentros verificables')
  // One OR query rather than N per-leg requests; return no result on quota.
  const query=games.map(f=>'("'+name(f.home)+'" "'+name(f.away)+'")').join(' OR ')
  const endpoint=new URL('https://api.gdeltproject.org/api/v2/doc/doc')
  endpoint.searchParams.set('query',query)
  endpoint.searchParams.set('mode','ArtList')
  endpoint.searchParams.set('format','json')
  endpoint.searchParams.set('sort','DateDesc')
  endpoint.searchParams.set('timespan','7d')
  endpoint.searchParams.set('maxrecords','75')
  const target=endpoint.toString()
  const previous=cache.get(target)
  if(previous&&now>=previous.at&&now-previous.at<20*60_000)return previous.report
  if(fetcher===fetch&&now-lastCallAt<5_000)
    return empty('rate-limited',now,'GDELT necesita al menos 5 s entre solicitudes',target)
  if(fetcher===fetch)lastCallAt=now
  try{
    const response=await fetcher(target,{headers:{Accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(9_000)})
    if(!response.ok)return empty('unavailable',now,'GDELT HTTP '+response.status,target)
    const raw=await response.text()
    if(raw.length>1_000_000)return empty('unavailable',now,'Respuesta excesiva',target)
    const data=JSON.parse(raw) as {articles?:unknown}
    if(!Array.isArray(data.articles))
      return empty('unavailable',now,'Formato sin lista de artículos',target)
    const byEvent:Record<string,GdeltMention[]>={}
    const visited=new Set<string>()
    for(const row of data.articles.slice(0,75)){
      if(!row||typeof row!=='object'||Array.isArray(row))continue
      const a=row as Record<string,unknown>
      const title=clean(a.title,190),articleUrl=url(a.url)
      const indexedAt=seen(a.seendate),publisher=clean(a.domain,90)
      if(!title||!articleUrl||!indexedAt||Date.parse(indexedAt)>now+60_000||
        now-Date.parse(indexedAt)>8*86_400_000)continue
      for(const game of games){
        const normalized=norm(title)
        const paired=aliases(name(game.home)).some(x=>normalized.includes(x))&&
          aliases(name(game.away)).some(x=>normalized.includes(x))
        if(!paired||visited.has(game.eventId+'|'+articleUrl))continue
        visited.add(game.eventId+'|'+articleUrl)
        const targetList=byEvent[game.eventId]??[]
        if(targetList.length>=3)continue
        targetList.push({eventId:game.eventId,title,indexedAt,publisher,articleUrl,
          provider:'GDELT DOC 2.0',status:'indexed-only'})
        byEvent[game.eventId]=targetList
      }
    }
    const observed=Object.values(byEvent).reduce((n,items)=>n+items.length,0)
    const report:GdeltReport={status:observed?'observed':'empty',
      checkedAt:new Date(now).toISOString(),sourceUrl:target,byEvent,
      scanned:data.articles.length,
      note:'GDELT https://www.gdeltproject.org/: indexedAt indica cuándo la noticia fue vista en el índice, NO cuándo se publicó; título y URL no confirman hechos, lesiones o picks.'}
    if(cache.size>=20)cache.clear()
    if(fetcher===fetch)cache.set(target,{at:now,report})
    return report
  }catch(e){
    return empty('unavailable',now,
      'GDELT indisponible: '+String(e instanceof Error?e.message:e).slice(0,120),target)
  }
}
