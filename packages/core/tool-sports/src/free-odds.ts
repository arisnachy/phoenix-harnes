import { createHash } from 'node:crypto'

/** Optional independently keyed odds feed at api.theoddsapi.com.
 * This is NOT api.the-odds-api.com/v4. Endpoint, auth and JSON differ.
 * See https://theoddsapi.com/docs/ . Never echo the private credential.
 */
export type FreeOddsQuote = {
  eventId:string
  bookmaker:string
  market:string
  selection:string
  point:number|null
  price:number
  home:string
  away:string
  time:string
  updatedAt:string
  source:'TheOddsAPI'
}
type Outcome = {name?:string;price?:number;point?:number|null}
type Book = {book?:string;market?:string;updated_at?:string;outcomes?:Outcome[]}
type Event = {
  event_id?:string;home_team?:string;away_team?:string;start_time?:string;books?:Book[]
}
type Payload = {success?:boolean;data?:Event[]}
const safeName=(text:unknown,size=120):string=>
  typeof text==='string'?text.trim().replace(/[\u0000-\u001f]/gu,' ').slice(0,size):''
const localTime=(input:string):string=>
  new Intl.DateTimeFormat('es-DO',{timeZone:'America/Santo_Domingo',dateStyle:'medium',timeStyle:'short'})
    .format(new Date(input))
const cache=new Map<string,{at:number;quotes:FreeOddsQuote[]}>()
/**
 * Fixed-host, server-only optional free provider, with a 90s in-process cache.
 * @param sportKey - Provider-recognized league identifier
 * @param markets - h2h/spreads/totals (free access may permit only h2h)
 * @param credential - Private header token; never included in responses or URLs
 * @param fetcher - Injectable, restricted HTTP client
 * @param now - Clock injectable for deterministic tests
 */
export async function fetchTheOddsApi(
  sportKey:string,markets:string,credential:string,fetcher:typeof fetch=fetch,now=Date.now(),
):Promise<FreeOddsQuote[]>{
  if(!/^[a-z0-9_]{3,80}$/u.test(sportKey)||
    !/^(h2h|spreads|totals)(,(h2h|spreads|totals))*$/u.test(markets))throw Error('Filtros de cuotas inválidos')
  if(typeof credential!=='string'||!credential.trim())throw Error('THEODDSAPI_API_KEY no configurada')
  // Hash the credential for per-account cache separation; never retain raw secrets in keys.
  const cacheKey=createHash('sha256').update(credential).digest('hex').slice(0,20)+'|'+sportKey+'|'+markets
  const cached=fetcher===fetch?cache.get(cacheKey):undefined
  if(cached&&now-cached.at>=0&&now-cached.at<90_000)return cached.quotes
  const url=new URL('https://api.theoddsapi.com/odds/')
  url.searchParams.set('sport_key',sportKey)
  url.searchParams.set('markets',markets)
  url.searchParams.set('oddsFormat','decimal')
  url.searchParams.set('regions','us')
  const response=await fetcher(url.toString(),{
    headers:{'accept':'application/json','x-api-key':credential},
    redirect:'error',signal:AbortSignal.timeout(9_000),
  })
  if(!response.ok)throw Error('TheOddsAPI HTTP '+response.status)
  if(Number(response.headers.get('content-length')||0)>4_000_000)throw Error('TheOddsAPI respuesta demasiado grande')
  const raw=await response.text()
  if(raw.length>4_000_000)throw Error('TheOddsAPI respuesta demasiado grande')
  const parsed=JSON.parse(raw) as Payload
  if(parsed?.success!==true||!Array.isArray(parsed.data))throw Error('TheOddsAPI respuesta inválida')
  const result:FreeOddsQuote[]=[]
  for(const event of parsed.data.slice(0,80)){
    const eventId=safeName(event.event_id,100)
    const home=safeName(event.home_team),away=safeName(event.away_team)
    const start=Date.parse(event.start_time??'')
    if(!eventId||!home||!away||!Number.isFinite(start)||start<=now)continue
    for(const book of (Array.isArray(event.books)?event.books:[]).slice(0,30)){
      const bookmaker=safeName(book.book),market=safeName(book.market,60)
      if(!bookmaker||!markets.split(',').includes(market))continue
      for(const outcome of (Array.isArray(book.outcomes)?book.outcomes:[]).slice(0,6)){
        const selection=safeName(outcome.name)
        const price=Number(outcome.price)
        const point=outcome.point==null?null:Number(outcome.point)
        if(!selection||!Number.isFinite(price)||price<=1||price>100000||point!==null&&!Number.isFinite(point))continue
        result.push({eventId,bookmaker,market,selection,point,price,home,away,
          time:localTime(event.start_time??''),updatedAt:safeName(book.updated_at,80)||'Sin fecha del proveedor',
          source:'TheOddsAPI'})
      }
    }
  }
  const quotes=result.slice(0,500)
  if(fetcher===fetch)cache.set(cacheKey,{at:now,quotes})
  return quotes
}
