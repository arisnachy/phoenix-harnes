/**
 * Third-party editorial *discovery* through public Google News RSS indexes.
 * This does not scrape Covers, VegasInsider, ScoresAndOdds or OddsPortal,
 * unlock paid picks, obtain betting lines, or imply the indexed story is true.
 * All discovered mentions are secondary opinions requiring independent checks.
 */
/** Exact allowlist of independent sports editorial publishers. */
export const editorialDomains={
  covers:'covers.com',
  vegasinsider:'vegasinsider.com',
  scoresandodds:'scoresandodds.com',
  oddsportal:'oddsportal.com',
} as const
/** One trusted publisher-key discriminator for RSS-only discovery. */
export type EditorialSource=keyof typeof editorialDomains
/** One attributed, dated RSS headline, not a confirmed betting pick. */
export type EditorialHit={
  source:EditorialSource;headline:string;publishedAt:string|null
  discoveryUrl:string;publisher:string;observedAt:string
  status:'indexed-headline-only';quoteUpdatedAt:null
}
/** Verified index coverage and failures for each requested source. */
export type EditorialDiscovery={
  status:'observed'|'unavailable'|'empty';checkedAt:string
  lookup:'syndicated-index-not-direct-site';hits:EditorialHit[]
  diagnostics:Array<{source:EditorialSource;status:'observed'|'empty'|'unavailable';count:number;error?:string}>
  warning:string
}
const sanitize=(value:string,max=210)=>value.replace(/<[^>]*>/gu,'')
  .replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,max)
const entities=(s:string)=>s.replace(/&#(x[0-9a-f]+|[0-9]+);|&([a-z]+);/giu,(_full,num:string|undefined,key:string|undefined)=>{
  if(num){
    const parsed=num[0]?.toLowerCase()==='x'?parseInt(num.slice(1),16):parseInt(num,10)
    return Number.isFinite(parsed)&&parsed>=32&&parsed<=0x10ffff?
      String.fromCodePoint(parsed):''
  }
  return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '} as Record<string,string>)[(key??'').toLowerCase()]??''
})
const tag=(xml:string,name:string)=>{
  const match=new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','iu').exec(xml)
  return entities(match?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/gu,'')??'')
}
const publisher=(xml:string)=>{
  const match=/<source\s+url="([^"]+)"[^>]*>([\s\S]*?)<\/source>/iu.exec(xml)
  return {url:match?.[1]??'',name:sanitize(entities(match?.[2]??''),90)}
}
/** Fixed-host RSS index discovery URL; only known publisher domains are queried.
 * @param source - Exactly one allowed source key.
 * @param query - Human-selected matchup words, not a URL or request expression.
 * @returns Bounded Google News RSS query URL.
 */
export function editorialIndexUrl(source:EditorialSource,query:string):string{
  if(!Object.hasOwn(editorialDomains,source))throw Error('Fuente editorial desconocida')
  const clean=query.replace(/[^\p{L}\p{N} .-]/gu,' ').replace(/\s+/gu,' ').trim().slice(0,90)
  if(clean.length<3)throw Error('Se necesita una consulta de al menos tres caracteres')
  const url=new URL('https://news.google.com/rss/search')
  url.searchParams.set('q','site:'+editorialDomains[source]+' '+clean)
  url.searchParams.set('hl','en-US')
  url.searchParams.set('gl','US')
  url.searchParams.set('ceid','US:en')
  return url.toString()
}
/** Strictly parse headlines from syndicated RSS with verified publisher identity.
 * @param xml - RSS response text, never executed or rendered as markup.
 * @param source - Expected publisher domain.
 * @param now - Local observation timestamp in epoch milliseconds.
 * @returns At most five dated metadata-only results.
 */
export function parseEditorialIndex(xml:string,source:EditorialSource,now=Date.now()):EditorialHit[]{
  if(xml.length>200_000||!/<rss\b|<feed\b/iu.test(xml))return []
  const expected=editorialDomains[source]
  const hits:EditorialHit[]=[]
  for(const item of xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/giu)?.slice(0,30)??[]){
    const who=publisher(item)
    let publisherHost=''
    try{
      const url=new URL(who.url)
      if(url.protocol==='https:')publisherHost=url.hostname.toLowerCase()
    }catch{continue}
    if(publisherHost!==expected&&publisherHost!=='www.'+expected)continue
    const title=sanitize(tag(item,'title'),180)
    const link=tag(item,'link').trim()
    let validLink=false
    try{const u=new URL(link);validLink=u.protocol==='https:'&&u.hostname==='news.google.com'
        &&!u.username&&!u.password}catch{}
    if(!title||!validLink)continue
    const published=Date.parse(tag(item,'pubDate'))
    // A future or ancient headline is not reliably relevant to the match.
    if(!Number.isFinite(published)||published>now+60_000||now-published>14*86_400_000)continue
    if(hits.some(h=>h.headline===title))continue
    hits.push({source,headline:title,publishedAt:new Date(published).toISOString(),
      discoveryUrl:link,publisher:who.name||expected,observedAt:new Date(now).toISOString(),
      status:'indexed-headline-only',quoteUpdatedAt:null})
    if(hits.length>=5)break
  }
  return hits
}
const CACHE_MS=10*60_000
const cache=new Map<string,{at:number;xml:string}>()
/** Discover public metadata while keeping provider errors and provenance separate.
 * @param query - Teams or sport from a verified ESPN matchup.
 * @param sources - Only supported editorial domains; max four.
 * @param fetcher - Testable network adapter; never loads a portal page.
 * @param now - Timestamp for cache and freshness.
 * @returns Credited headlines and diagnostics, not paid picks or verified odds.
 */
export async function discoverEditorialResearch(
  query:string,sources:readonly EditorialSource[]=Object.keys(editorialDomains) as EditorialSource[],
  fetcher:typeof fetch=fetch,now=Date.now(),
):Promise<EditorialDiscovery>{
  const names=[...new Set(sources)].slice(0,4)
  const responses=await Promise.allSettled(names.map(async source=>{
    const url=editorialIndexUrl(source,query)
    const cached=cache.get(url)
    if(cached&&now>=cached.at&&now-cached.at<CACHE_MS)return parseEditorialIndex(cached.xml,source,now)
    const response=await fetcher(url,{headers:{Accept:'application/rss+xml, application/xml'},
      signal:AbortSignal.timeout(10_000),redirect:'error'})
    if(!response.ok)throw Error('RSS HTTP '+response.status)
    const type=response.headers.get('content-type')??''
    if(!/xml|rss|text\/plain/iu.test(type))throw Error('Formato RSS no reconocido')
    const xml=await response.text()
    if(xml.length>200_000)throw Error('Índice RSS excede el límite')
    if(cache.size>=80)cache.clear()
    cache.set(url,{at:now,xml})
    return parseEditorialIndex(xml,source,now)
  }))
  const diagnostics:EditorialDiscovery['diagnostics']=[]
  const hits:EditorialHit[]=[]
  responses.forEach((response,i)=>{
    const source=names[i]!
    if(response.status==='fulfilled'){
      diagnostics.push({source,status:response.value.length?'observed':'empty',count:response.value.length})
      hits.push(...response.value)
    }else diagnostics.push({source,status:'unavailable',count:0,
      error:String(response.reason instanceof Error?response.reason.message:response.reason).slice(0,140)})
  })
  return {status:hits.length?'observed':diagnostics.some(x=>x.status==='unavailable')?'unavailable':'empty',
    checkedAt:new Date(now).toISOString(),lookup:'syndicated-index-not-direct-site',
    hits:hits.slice(0,16),diagnostics,
    warning:'Metadatos indexados por terceros, no consulta directa al portal ni verificación del contenido. No equivalen a picks consultados, cuotas actuales, confirmación de lesiones o permiso de extracción. Los títulos no se convierten en recomendaciones automáticas.'}
}
