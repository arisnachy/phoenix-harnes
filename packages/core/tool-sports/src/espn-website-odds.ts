/** Read-only fallback for public ESPN odds pages. Unlike the unofficial
 * Site/Core JSON feed, HTML is best-effort: JavaScript challenges, robots
 * checks and layouts can prevent retrieval. Never evade those controls or
 * infer a bookmaker price from an odds label.
 *
 * Only explicit ESPN event/competition/odds JSON may generate outcomes, and
 * every event is reconciled with ESPN's independent official scoreboard.
 */
import {normalizeEspnMarkets,type EspnMarketQuote} from './espn-odds.ts'

export type EspnWebStatus='observed'|'empty'|'blocked'|'unavailable'|'unsupported'
export type EspnWebResult={url:string|null;status:EspnWebStatus;
  quotes:EspnMarketQuote[];detail:string;matchedEvents:number;checkedAt:string}
const routes:Readonly<Record<string,readonly [string,string,string]>>={
  americanfootball_nfl:['football','nfl','/nfl/odds'],
  baseball_mlb:['baseball','mlb','/mlb/odds'],
  basketball_nba:['basketball','nba','/nba/odds'],
  basketball_wnba:['basketball','wnba','/wnba/odds'],
  icehockey_nhl:['hockey','nhl','/nhl/odds'],
  soccer_epl:['soccer','eng.1','/soccer/odds'],
  soccer_spain_la_liga:['soccer','esp.1','/soccer/odds'],
  soccer_usa_mls:['soccer','usa.1','/soccer/odds'],
  soccer_mexico_ligamx:['soccer','mex.1','/soccer/odds'],
  soccer_uefa_champs_league:['soccer','uefa.champions','/soccer/odds'],
  soccer_germany_bundesliga:['soccer','ger.1','/soccer/odds'],
  soccer_italy_serie_a:['soccer','ita.1','/soccer/odds'],
  soccer_france_ligue_one:['soccer','fra.1','/soccer/odds'],
  soccer_portugal_primeira_liga:['soccer','por.1','/soccer/odds'],
  soccer_netherlands_eredivisie:['soccer','ned.1','/soccer/odds'],
  soccer_brazil_campeonato:['soccer','bra.1','/soccer/odds'],
  soccer_argentina_primera_division:['soccer','arg.1','/soccer/odds'],
}
export const espnOddsWebsiteCatalog=Object.freeze(Object.entries(routes).map(([sportKey,entry])=>
  ({sportKey,league:entry[1],url:'https://www.espn.com'+entry[2]})))
export const espnOddsWebsiteUrl=(sportKey:string):string|null=>
  routes[sportKey]?'https://www.espn.com'+routes[sportKey]![2]:null

const object=(v:unknown):Record<string,unknown>|null=>
  v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null
const text=(v:unknown):string=>typeof v==='string'?v:''
const digits=(v:unknown):string|null=>/^\d{1,16}$/u.test(String(v??''))?String(v):null
const norm=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const LIVE_AGE=60*60_000
const cache=new Map<string,{until:number;value:Promise<string>}>()
const maxHtml=1_500_000
async function getHtml(url:string,fetcher:typeof fetch,now:number):Promise<string>{
  if(fetcher===fetch){
    const cached=cache.get(url)
    if(cached&&cached.until>now)return cached.value
  }
  const work=(async()=>{
    // The URL is never user-controlled; do not follow redirects (including bot
    // challenges), send cookies, emulate a browser or attempt CAPTCHA bypass.
    const response=await fetcher(url,{headers:{accept:'text/html'},
      redirect:'error',signal:AbortSignal.timeout(6500)})
    if(!response.ok)throw Error('HTTP '+response.status)
    if(Number(response.headers.get('content-length')||0)>maxHtml)
      throw Error('HTML superior al límite')
    const contentType=response.headers.get('content-type')??''
    if(contentType&&!contentType.toLowerCase().includes('text/html'))
      throw Error('Respuesta no HTML')
    const html=await response.text()
    if(html.length>maxHtml)throw Error('HTML superior al límite')
    return html
  })()
  if(fetcher!==fetch)return work
  if(cache.size>20)cache.clear()
  cache.set(url,{until:now+45_000,value:work})
  try{return await work}catch(error){cache.delete(url);throw error}
}
function embeddedEvents(html:string):Record<string,unknown>[]{
  const events:Record<string,unknown>[]=[]
  // Only script tags with explicit JSON payloads are parsed. No execution of
  // JS assignments, dynamic imports, scripted DOM or scraping obfuscated data.
  const scripts=/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu
  let match:RegExpExecArray|null,scanned=0
  while((match=scripts.exec(html))!==null&&scanned++<80&&events.length<80){
    const attrs=match[1]??'',body=(match[2]??'').trim()
    if(!/type\s*=\s*["']application\/json["']/iu.test(attrs)&&
      !/id\s*=\s*["'](?:__NEXT_DATA__|__ESPN_DATA__)["']/iu.test(attrs))continue
    if(body.length<3||body.length>900_000)continue
    let root:unknown
    try{root=JSON.parse(body)}catch{continue}
    const work:Array<{node:unknown;depth:number}>=[{node:root,depth:0}]
    let visited=0
    while(work.length&&visited++<1800&&events.length<80){
      const {node,depth}=work.pop()!
      if(depth>9)continue
      if(Array.isArray(node)){
        for(const entry of node.slice(0,140))work.push({node:entry,depth:depth+1})
        continue
      }
      const row=object(node)
      if(!row)continue
      const comp=Array.isArray(row.competitions)?object(row.competitions[0]):null
      if(digits(row.id)&&text(row.date)&&Array.isArray(comp?.competitors)&&
        Array.isArray(comp.odds)&&comp.odds.length>0){
        events.push(row)
        continue
      }
      for(const [key,value] of Object.entries(row).slice(0,70)){
        if(key==='odds'||key==='statistics'||key==='players')continue
        if(Array.isArray(value)||object(value))
          work.push({node:value,depth:depth+1})
      }
    }
  }
  return events
}
type Scoreboard={events?:Array<{id?:string|number;date?:string;
  competitions?:Array<{competitors?:Array<{homeAway?:string;
    team?:{displayName?:string;name?:string}}>} >}>}
const side=(rows:unknown,homeAway:string)=>{
  if(!Array.isArray(rows))return''
  const row=rows.map(object).find(x=>x?.homeAway===homeAway)
  const team=object(row?.team)
  return text(team?.displayName)||text(team?.name)
}
function matchingFixture(embedded:Record<string,unknown>,official:Scoreboard):boolean{
  const id=digits(embedded.id),kickoff=Date.parse(text(embedded.date))
  if(!id||!Number.isFinite(kickoff)||!Array.isArray(official.events))return false
  const actual=official.events.find(x=>digits(x.id)===id)
  if(!actual||!Number.isFinite(Date.parse(actual.date??''))||
    Math.abs(Date.parse(actual.date??'')-kickoff)>2*60_000)return false
  const from=object((embedded.competitions as unknown[])?.[0])
  const to=actual.competitions?.[0]
  return !!from&&!!to&&
    norm(side(from.competitors,'home'))===norm(side(to.competitors,'home'))&&
    norm(side(from.competitors,'away'))===norm(side(to.competitors,'away'))&&
    !!side(from.competitors,'home')&&!!side(from.competitors,'away')
}
/** Web fallback is opportunistic and read-only. HTML may have no embedded
 * structured odds even though a human browser renders numbers with JS.
 */
export async function fetchEspnWebsiteOdds(
  sportKey:string,markets:string,
  fetcher:typeof fetch=fetch,
  readJSON:<T>(url:string)=>Promise<T>,
  now=Date.now(),
):Promise<EspnWebResult>{
  const route=routes[sportKey]
  const url=espnOddsWebsiteUrl(sportKey)
  const base={url,status:'empty' as EspnWebStatus,quotes:[] as EspnMarketQuote[],
    matchedEvents:0,checkedAt:new Date(now).toISOString()}
  if(!route||!url)return{...base,status:'unsupported',detail:'Liga sin página ESPN configurada'}
  const allowed=new Set(markets.split(',').filter(x=>
    x==='h2h'||x==='spreads'||x==='totals'))
  if(!allowed.size)return{...base,status:'unsupported',detail:'Mercado ESPN no compatible'}
  let html:string
  try{html=await getHtml(url,fetcher,now)}
  catch(e){
    const message=e instanceof Error?e.message:String(e)
    return{...base,status:/\b(?:403|429|401)\b/u.test(message)?'blocked':'unavailable',
      detail:'Sitio ESPN no disponible: '+message.slice(0,110)}
  }
  if(/verify that you're not a robot|captcha|access denied|javascript is disabled/iu.test(html))
    return{...base,status:'blocked',detail:'ESPN requiere navegador/JS o verificación; no se elude CAPTCHA'}
  const candidates=embeddedEvents(html).slice(0,24)
  if(!candidates.length)return{...base,
    detail:'ESPN web no publicó un bloque JSON de eventos con precios; el HTML visible no permite cotización automática'}
  const quotes:EspnMarketQuote[]=[],seen=new Set<string>()
  const boards=new Map<string,Promise<Scoreboard>>()
  let matches=0
  for(const event of candidates){
    const kickoff=Date.parse(text(event.date))
    if(!Number.isFinite(kickoff)||kickoff<=now)continue
    const day=new Date(kickoff).toISOString().slice(0,10).replaceAll('-','')
    if(!boards.has(day)){
      if(boards.size>=3)continue
      const boardUrl='https://site.api.espn.com/apis/site/v2/sports/'+
        route[0]+'/'+route[1]+'/scoreboard?dates='+day
      boards.set(day,readJSON<Scoreboard>(boardUrl).catch(()=>({events:[]})))
    }
    const board=await boards.get(day)!
    if(!matchingFixture(event,board))continue
    matches++
    const comp=object((event.competitions as unknown[])?.[0])
    const raw=comp?.odds
    if(!Array.isArray(raw))continue
    const rows=normalizeEspnMarkets(
      event as Parameters<typeof normalizeEspnMarkets>[0],
      raw as Parameters<typeof normalizeEspnMarkets>[1],{now})
    for(const q of rows){
      const stamp=Date.parse(q.updatedAt)
      if(!allowed.has(q.market)||!Number.isFinite(stamp)||
        stamp>now||now-stamp>LIVE_AGE||
        q.bookmaker.startsWith('ESPN proveedor #')||q.price<=1||q.price>=1000)continue
      // Soccer moneyline requires a separately published three-way DRAW price
      // from the same bookmaker, not just two team names.
      if(route[0]==='soccer'&&q.market==='h2h'&&!rows.some(v=>v.market==='h2h'&&
        v.bookmaker===q.bookmaker&&norm(v.selection)==='draw'))continue
      const key=[q.eventId,q.bookmaker,q.market,q.selection,q.point??''].join('|')
      if(!seen.has(key)){seen.add(key);quotes.push({...q,endpointSource:'website'})}
    }
  }
  return{...base,matchedEvents:matches,quotes:quotes.slice(0,120),
    status:quotes.length?'observed':'empty',
    detail:quotes.length?'Mercados del HTML estructurado ESPN cotejados con scoreboard oficial':
      matches?'Eventos cotejados; sin precio/bookmaker/timestamp vigente':'Sin eventos que coincidan con la liga y el marcador oficial'}
}
