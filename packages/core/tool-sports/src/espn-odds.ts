/**
 * Keyless ESPN betting-market observations.
 * These are informal publicly reachable ESPN JSON fields, not a sportsbook API.
 * Never invent missing bookmaker prices or treat ESPN probabilities as wager odds.
 */
export interface EspnMarketQuote {
  eventId: string
  bookmaker: string
  market: string
  selection: string
  point: number | null
  price: number
  home: string
  away: string
  time: string
  timeIso: string
  updatedAt: string
  endpointSource?: 'scoreboard'|'core'|'summary'
}
type OddsSide = { moneyLine?: number | string; moneyline?: number | string; spreadOdds?: number|string;
  spread?:number|string;spreadValue?:number|string;pointSpread?:number|string }
type EspnOdds = {
  provider?: { name?: string;displayName?: string;id?: string|number } | string
  sportsbook?:{ name?:string;displayName?:string }|string
  details?: string
  homeTeamOdds?: OddsSide;awayTeamOdds?: OddsSide
  overOdds?: number|string;underOdds?: number|string
  overUnder?: number|string;drawOdds?:number|string
  spread?: number|string
  lastUpdated?: string;lastUpdate?: string;updatedAt?: string
}
type ECompetition={ id?:string|number;competitors?:Array<{ homeAway?:string;team?:{ displayName?:string;name?:string } }>;odds?:EspnOdds[] }
type EEvent={ id?:string|number;date?:string;competitions?:ECompetition[] }
type ESPNBoard={ events?:EEvent[] }
const slugs:Readonly<Record<string,readonly [string,string]>>={
  baseball_mlb:['baseball','mlb'],basketball_nba:['basketball','nba'],
  basketball_wnba:['basketball','wnba'],americanfootball_nfl:['football','nfl'],
  icehockey_nhl:['hockey','nhl'],soccer_epl:['soccer','eng.1'],
  soccer_spain_la_liga:['soccer','esp.1'],soccer_usa_mls:['soccer','usa.1'],
  soccer_mexico_ligamx:['soccer','mex.1'],soccer_uefa_champs_league:['soccer','uefa.champions'],
  basketball_ncaab:['basketball','mens-college-basketball'],
  americanfootball_ncaaf:['football','college-football'],
  soccer_world_cup:['soccer','fifa.world'],
}
const americanToDecimal=(value:unknown):number|null=>{
  if(typeof value!=='string'&&typeof value!=='number')return null
  const str=String(value).trim().replace(/\u2212/gu,'-')
  if(!/^[+-]?\d{2,6}$/u.test(str))return null
  const n=Number(str)
  if(!Number.isFinite(n)||Math.abs(n)<100||Math.abs(n)>100000)return null
  return Number((n>0?1+n/100:1+100/Math.abs(n)).toFixed(5))
}
const str=(v:unknown)=>typeof v==='string'?v.slice(0,170):String(v??'').slice(0,170)
const bookmakerName=(odds:EspnOdds):string=>{
  const provider=odds.provider??odds.sportsbook
  if(typeof provider==='string')return provider.trim().slice(0,100)
  return provider?.name?.trim()||provider?.displayName?.trim()||''
}
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const list=(v:unknown):EspnOdds[]=>Array.isArray(v)?v.filter(isRecord):isRecord(v)?[v]:[]
const safeId=(v:unknown)=>/^\d{1,16}$/u.test(String(v??''))?String(v):null
const localTime=(value:string):string=>{
  const time=new Date(value)
  return Number.isFinite(time.getTime())?new Intl.DateTimeFormat('es-DO',{ timeZone:'America/Santo_Domingo',dateStyle:'medium',timeStyle:'short' }).format(time):'Hora no confirmada'
}
/** Parse quoted American moneylines from an ESPN event without filling in missing markets.
 * @param event - Raw ESPN event with a competition.
 * @param oddEntries - Embedded or Core API quotes.
 * @returns Attributed moneyline outcomes with decimal prices.
 */
export function normalizeEspnMoneylines(event:EEvent,oddEntries:EspnOdds[],now=Date.now()):EspnMarketQuote[]{
  const competition=event.competitions?.[0]
  const id=safeId(event.id)
  if(!id||!competition)return []
  const home=competition.competitors?.find(c=>c.homeAway==='home')
  const away=competition.competitors?.find(c=>c.homeAway==='away')
  const homeName=home?.team?.displayName||home?.team?.name
  const awayName=away?.team?.displayName||away?.team?.name
  if(!homeName||!awayName)return []
  const kickoff=new Date(event.date||'')
  // Do not present pregame lines as current for matches which have already started.
  if(!Number.isFinite(kickoff.getTime())||kickoff.getTime()<=now)return []
  const result:EspnMarketQuote[]=[]
  for(const odd of oddEntries.slice(0,5)){
    const provider=bookmakerName(odd)
    if(!provider)continue
    const updatedAt=odd.lastUpdated||odd.lastUpdate||odd.updatedAt||'No indicada por ESPN'
    for(const [selection,value] of [[homeName,odd.homeTeamOdds?.moneyLine??odd.homeTeamOdds?.moneyline],[awayName,odd.awayTeamOdds?.moneyLine??odd.awayTeamOdds?.moneyline]] as const){
      const price=americanToDecimal(value)
      if(price!==null)result.push({ eventId:id,bookmaker:str(provider),market:'h2h',selection:str(selection),point:null,price,home:str(homeName),away:str(awayName),time:localTime(event.date||''),timeIso:kickoff.toISOString(),updatedAt:str(updatedAt) })
    }
  }
  return result
}
/** Normalize only markets with explicit price, bookmaker and selection; never infer a spread side. */
export function normalizeEspnMarkets(event:EEvent,odds:EspnOdds[],now=Date.now()):EspnMarketQuote[]{
  const money=normalizeEspnMoneylines(event,odds,now)
  const comp=event.competitions?.[0]
  const eventId=safeId(event.id)
  const kickoff=Date.parse(event.date||'')
  if(!comp||!eventId||!Number.isFinite(kickoff)||kickoff<=now)return money
  const home=comp.competitors?.find(x=>x.homeAway==='home')?.team
  const away=comp.competitors?.find(x=>x.homeAway==='away')?.team
  const homeName=home?.displayName||home?.name
  const awayName=away?.displayName||away?.name
  if(!homeName||!awayName)return money
  const lines:EspnMarketQuote[]=[...money]
  const number=(v:unknown):number|null=>{
    if(v===null||v===undefined||v==='')return null
    const n=Number(v)
    return Number.isFinite(n)&&Math.abs(n)<=1000?n:null
  }
  for(const odd of odds.slice(0,5)){
    const provider=bookmakerName(odd)
    if(!provider)continue
    const name=str(provider)
    const updatedAt=str(odd.lastUpdated||odd.lastUpdate||odd.updatedAt||'No indicada por ESPN')
    const common={eventId,bookmaker:name,home:str(homeName),away:str(awayName),
      time:localTime(event.date||''),timeIso:new Date(kickoff).toISOString(),updatedAt}
    const total=number(odd.overUnder)
    if(total!==null){
      for(const [selection,oddsValue] of [['Over',odd.overOdds],['Under',odd.underOdds]] as const){
        const price=americanToDecimal(oddsValue)
        if(price!==null)lines.push({...common,market:'totals',selection,
          point:total,price})
      }
    }
    for(const [selection,side] of [[homeName,odd.homeTeamOdds],[awayName,odd.awayTeamOdds]] as const){
      if(!side)continue
      const point=number(side.spreadValue??side.pointSpread??side.spread)
      const price=americanToDecimal(side.spreadOdds)
      if(point!==null&&price!==null)lines.push({...common,market:'spreads',
        selection:str(selection),point,price})
    }
    const draw=americanToDecimal(odd.drawOdds)
    if(draw!==null)lines.push({...common,market:'h2h',selection:'Draw',point:null,price:draw})
  }
  return lines.slice(0,120)
}
/**
 * ESPN public endpoints are undocumented and may be blocked or changed at any time.
 * Preserve provenance: probabilities, predictors, ATS and historical movements
 * are intelligence inputs, not live bookmaker quotes.
 */
export type EspnOddsDiagnostics = {
  scoreboards:number
  games:number
  embedded:number
  core:number
  summary:number
  resolvedRefs:number
  failures:number
  notes:string[]
  eventMatched:boolean
  datesQueried:string[]
}
export type EspnOddsResult={quotes:EspnMarketQuote[];diagnostics:EspnOddsDiagnostics}
const MAX_QUOTE_AGE_MS=60*60*1000
const MAX_REQUESTS=28
const MAX_GAMES_PER_DAY=8
const MAX_REFS_PER_GAME=3
const oddsCache=new Map<string,{until:number;value:unknown}>()
const oddsInflight=new Map<string,Promise<unknown>>()
const dayInDR=(value:number)=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date(value)).replaceAll('-','')
const plusUtcDay=(date:string,offset:number):string=>{
  const y=Number(date.slice(0,4)),m=Number(date.slice(4,6)),d=Number(date.slice(6,8))
  const next=new Date(Date.UTC(y,m-1,d+offset))
  return next.toISOString().slice(0,10).replaceAll('-','')
}
const safeCoreRef=(value:unknown,route:readonly [string,string],
  eventId:string,competitionId:string):string|null=>{
  if(typeof value!=='string'||value.length>600)return null
  try{
    const u=new URL(value)
    if(u.protocol!=='https:'||u.username||u.password||u.port||
      !['sports.core.api.espn.com','sports.core.api.espn.pvt'].includes(u.hostname))return null
    const prefix='/v2/sports/'+route[0]+'/leagues/'+route[1]+'/events/'+eventId+
      '/competitions/'+competitionId+'/odds/'
    if(!u.pathname.startsWith(prefix)||!/^\/\d{1,16}$/u.test(u.pathname.slice(prefix.length-1)))return null
    // ESPN occasionally emits internal .pvt links in public Core collections.
    if(u.hostname==='sports.core.api.espn.pvt')u.hostname='sports.core.api.espn.com'
    if(u.searchParams.has('apiKey'))return null
    return u.toString()
  }catch{return null}
}
const quotationEntries=(value:unknown):EspnOdds[]=>{
  if(Array.isArray(value))return list(value)
  if(!isRecord(value))return []
  const items=[...list(value.odds),...list(value.pickcenter),...list(value.items)]
  return items.length?items:('provider'in value||'sportsbook'in value||'homeTeamOdds'in value)?
    [value as EspnOdds]:[]
}
const availableQuote=(quote:EspnMarketQuote,now:number):boolean=>{
  const updated=Date.parse(quote.updatedAt)
  return Number.isFinite(updated)&&updated<=now+5*60_000&&now-updated<=MAX_QUOTE_AGE_MS
}
/** Request-scoped budget plus in-process short cache only for trusted, live transport.
 * The injected test transport never shares global cache data between fixtures.
 */
async function readOddsJSON(
  url:string,getJSON:<T>(url:string)=>Promise<T>,
  budget:{used:number},cached:boolean,
):Promise<unknown>{
  const prior=cached?oddsCache.get(url):undefined
  if(prior&&prior.until>Date.now())return prior.value
  const pending=cached?oddsInflight.get(url):undefined
  if(pending)return pending
  if(budget.used>=MAX_REQUESTS)throw Error('Límite prudente de consultas ESPN alcanzado')
  budget.used++
  const request=(async()=>{
    const value=await getJSON<unknown>(url)
    if(cached){
      if(oddsCache.size>=160)oddsCache.clear()
      const ttl=url.includes('/scoreboard?')?45_000:90_000
      oddsCache.set(url,{until:Date.now()+ttl,value})
    }
    return value
  })()
  if(cached)oddsInflight.set(url,request)
  try{return await request}
  finally{if(cached&&oddsInflight.get(url)===request)oddsInflight.delete(url)}
}
/**
 * Multi-route keyless ESPN collector: daily scoreboard → Core odds ($ref) →
 * site summary/pickcenter. Never assume a successful HTTP response contains prices.
 * Stops on a bounded request budget and caches only actual network reads.
 */
export async function fetchPublicEspnOddsDetailed(
  sportKey:string,requestedMarkets:string,getJSON:<T>(url:string)=>Promise<T>,
  options:{now?:number;cache?:boolean;days?:number;date?:string;eventId?:string}={},
):Promise<EspnOddsResult>{
  const route=slugs[sportKey]
  const diagnostics:EspnOddsDiagnostics={
    scoreboards:0,games:0,embedded:0,core:0,summary:0,resolvedRefs:0,failures:0,notes:[],
    eventMatched:false,datesQueried:[],
  }
  if(!route)return {quotes:[],diagnostics:{...diagnostics,notes:['Liga sin ruta ESPN de cuotas confirmada']}}
  const markets=[...new Set(requestedMarkets.split(',').filter(x=>['h2h','totals','spreads'].includes(x)))]
  if(!markets.length)return {quotes:[],diagnostics}
  const now=options.now??Date.now()
  const explicitDate=options.date?.replaceAll('-','')
  if(explicitDate&&(!/^\d{8}$/u.test(explicitDate)||
    plusUtcDay(explicitDate,0)!==explicitDate))throw Error('Fecha ESPN inválida')
  if(options.eventId&&!/^\d{1,16}$/u.test(options.eventId))throw Error('eventId ESPN inválido')
  const start=explicitDate??dayInDR(now)
  const days=Number.isInteger(options.days)&&options.days!==undefined
    ?Math.min(7,Math.max(1,options.days)):(options.eventId?1:3)
  const budget={used:0}
  const quoteMap=new Map<string,EspnMarketQuote>()
  let firstError:string|null=null
  const read=(url:string)=>readOddsJSON(url,getJSON,budget,options.cache===true)
  const remember=(event:EEvent,odds:EspnOdds[],origin:'embedded'|'core'|'summary')=>{
    const found=normalizeEspnMarkets(event,odds,now)
      .filter(q=>markets.includes(q.market)&&availableQuote(q,now))
    if(found.length){
      diagnostics[origin]+=found.length
      for(const quote of found){
        const key=[quote.eventId,quote.bookmaker,quote.market,quote.selection,quote.point??''].join('|')
        const previous=quoteMap.get(key)
        if(previous===undefined||Date.parse(previous.updatedAt)<Date.parse(quote.updatedAt))
          quoteMap.set(key,{...quote,endpointSource:origin==='embedded'?'scoreboard':origin})
      }
    }
  }
  const reportFailure=(context:string,error:unknown)=>{
    diagnostics.failures++
    const message=error instanceof Error?error.message:String(error)
    if(firstError===null)firstError=message
    if(diagnostics.notes.length<7)diagnostics.notes.push(context+': '+message.slice(0,110))
  }
  const coreBase='https://sports.core.api.espn.com/v2/sports/'+route[0]+'/leagues/'+route[1]+'/events/'
  const siteBase='https://site.api.espn.com/apis/site/v2/sports/'+route[0]+'/'+route[1]+'/'
  const seenEvents=new Set<string>()
  for(let offset=0;offset<days&&budget.used<MAX_REQUESTS;offset++){
    const date=plusUtcDay(start,offset)
    diagnostics.datesQueried.push(date)
    let board:ESPNBoard
    try{
      board=await read(siteBase+'scoreboard?dates='+date) as ESPNBoard
      diagnostics.scoreboards++
      if(!Array.isArray(board.events))throw Error('Scoreboard ESPN sin lista events')
    }catch(error){reportFailure('Scoreboard '+date,error);continue}
    const candidates=(board.events??[]).filter(event=>
      safeId(event.id)!==null&&Date.parse(event.date??'')>now&&
      (!options.eventId||safeId(event.id)===options.eventId))
      .sort((a,b)=>Date.parse(a.date??'')-Date.parse(b.date??''))
      .slice(0,30)
    let fallbackEvents=0
    for(const event of candidates){
      const eventId=safeId(event.id),competition=event.competitions?.[0]
      const competitionId=safeId(competition?.id)??eventId
      if(!eventId||!competition||seenEvents.has(eventId))continue
      seenEvents.add(eventId)
      diagnostics.games++
      diagnostics.eventMatched=true
      remember(event,list(competition.odds),'embedded')
      // Do not request additional routes when the scoreboard already provides
      // every requested market, saving ESPN calls and avoiding duplicate prices.
      const observedMarkets=()=>new Set([...quoteMap.values()]
        .filter(q=>q.eventId===eventId).map(q=>q.market))
      if(markets.every(m=>observedMarkets().has(m)))continue
      // Embedded odds are checked for every scoreboard event; expensive Core
      // and summary probes are capped separately to protect ESPN's rate limits.
      if(fallbackEvents>=MAX_GAMES_PER_DAY||!competitionId)continue
      fallbackEvents++
      const corePath=coreBase+eventId+'/competitions/'+competitionId+'/odds'
      try{
        const raw=await read(corePath+'?limit=5')
        const collection=quotationEntries(raw)
        remember(event,collection.filter(x=>!('$ref'in x)),'core')
        const references=isRecord(raw)&&Array.isArray(raw.items)
          ?raw.items.filter(isRecord).map(x=>safeCoreRef(x.$ref,route,eventId,competitionId))
            .filter((x):x is string=>x!==null).slice(0,MAX_REFS_PER_GAME):[]
        for(const link of references){
          if(budget.used>=MAX_REQUESTS)break
          try{
            const resolved=quotationEntries(await read(link))
            remember(event,resolved,'core')
            diagnostics.resolvedRefs++
          }catch(error){reportFailure('Core referencia de '+eventId,error)}
        }
      }catch(error){reportFailure('Core odds de '+eventId,error)}
      if(markets.every(m=>observedMarkets().has(m)))continue
      if(budget.used>=MAX_REQUESTS)break
      try{
        const summary=await read(siteBase+'summary?event='+eventId)
        const entries=quotationEntries(summary)
        remember(event,entries,'summary')
      }catch(error){reportFailure('Summary/pickcenter de '+eventId,error)}
    }
    if(quoteMap.size>=80)break
  }
  if(diagnostics.scoreboards===0&&diagnostics.failures>0)
    throw Error('ESPN Scoreboard no disponible: '+(firstError??'respuesta inválida'))
  if(options.eventId&&!diagnostics.eventMatched)
    diagnostics.notes.push('Evento '+options.eventId+' no localizado como encuentro FUTURO en las fechas consultadas; revisar la fecha, partido y temporada')
  if(quoteMap.size===0&&diagnostics.notes.length===0){
    diagnostics.notes.push(diagnostics.games
      ?'Se encontraron próximos partidos, pero ESPN no publicó líneas con casa y fecha verificables'
      :'No se localizaron próximos encuentros en el período consultado')
  }
  return {quotes:[...quoteMap.values()].slice(0,160),diagnostics}
}
/** Compatibility facade: preserves the original two-stage API for callers. */
export async function fetchPublicEspnOdds(
  sportKey:string,requestedMarkets:string,getJSON:<T>(url:string)=>Promise<T>,
):Promise<EspnMarketQuote[]>{
  return (await fetchPublicEspnOddsDetailed(sportKey,requestedMarkets,getJSON)).quotes
}
