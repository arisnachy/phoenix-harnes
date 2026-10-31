/**
 * ESPN historical market explorer: day-scoped Site scoreboard + per-game Core
 * provider collections + Site summary. This is NOT a historical odds database.
 * Old games can retain incomplete quotes with no line timestamp.
 */
import { normalizeEspnMarkets,type EspnMarketQuote } from './espn-odds.ts'

type Dict=Record<string,unknown>
const obj=(v:unknown):v is Dict=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v)
const records=(v:unknown):Dict[]=>Array.isArray(v)?v.filter(obj):obj(v)?[v]:[]
const numericId=(v:unknown):string|null=>/^\d{1,16}$/u.test(String(v??''))?String(v):null
const sportValid=(v:string)=>/^[a-z][a-z-]{1,35}$/u.test(v)
const leagueValid=(v:string)=>/^[a-z0-9][a-z0-9._-]{0,45}$/u.test(v)
const maxRequests=42
export type HistoricalEspnRow=EspnMarketQuote&{
  historical:true;priceStatus:'historical_unverified';source:'ESPN Scoreboard'|'ESPN Core'|'ESPN Summary'
  quoteTimestampKnown:boolean;eventDate:string
}
export type HistoricalEspnReport={
  historical:true;source:'ESPN Site/Core (sin clave, no oficial)';sport:string;league:string
  requestedStart:string;daysScanned:number;eventCount:number;eventsWithPrices:number
  rawEntries:number;requests:number;refsResolved:number;rows:HistoricalEspnRow[]
  errors:string[];coverage:string;examples:string[]
  warning:string
}
type Options={ sport:string;league:string;date:string;days?:number|undefined
  eventsPerDay?:number|undefined }
function safeRef(ref:unknown,sport:string,league:string,eventId:string,competitionId:string):string|null{
  if(typeof ref!=='string'||ref.length>700)return null
  try{
    const u=new URL(ref)
    if(u.protocol!=='https:'||u.port||u.username||u.password||
      !['sports.core.api.espn.com','sports.core.api.espn.pvt'].includes(u.hostname))return null
    const path='/v2/sports/'+sport+'/leagues/'+league+'/events/'+eventId+
      '/competitions/'+competitionId+'/odds/'
    if(!u.pathname.startsWith(path)||!/^\/\d{1,16}$/u.test(u.pathname.slice(path.length-1))||
      u.search||u.hash)return null
    u.hostname='sports.core.api.espn.com'
    return u.toString()
  }catch{return null}
}
function dayAt(start:string,offset:number):string{
  const dt=new Date(start+'T12:00:00Z')
  dt.setUTCDate(dt.getUTCDate()+offset)
  return dt.toISOString().slice(0,10)
}
const priceEntries=(value:unknown):Dict[]=>{
  if(Array.isArray(value))return records(value)
  if(!obj(value))return []
  const list=[...records(value.odds),...records(value.pickcenter),...records(value.items)]
  return list.length?list:(value.provider||value.sportsbook||value.homeTeamOdds)?[value]:[]
}
/** Bounded historical lookup with no guarantee of full market coverage.
 * Never uses a past line as a current sportsbook offer.
 */
export async function fetchEspnHistoricalOdds(
  options:Options,getJSON:<T>(url:string)=>Promise<T>,now=Date.now(),
):Promise<HistoricalEspnReport>{
  const { sport,league,date }=options
  if(!sportValid(sport)||!leagueValid(league)||
    !/^\d{4}-\d{2}-\d{2}$/u.test(date)||
    !Number.isFinite(Date.parse(date+'T00:00:00Z'))||
    new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||
    Date.parse(date+'T00:00:00Z')>now)
    throw Error('ESPN histórico: deporte, liga o fecha inválida/futura')
  const days=Number.isInteger(options.days)&&options.days!==undefined
    ?Math.min(3,Math.max(1,options.days)):1
  const eventsPerDay=Number.isInteger(options.eventsPerDay)&&options.eventsPerDay!==undefined
    ?Math.min(8,Math.max(1,options.eventsPerDay)):6
  const errors:string[]=[],examples:string[]=[]
  const report:HistoricalEspnReport={
    historical:true,source:'ESPN Site/Core (sin clave, no oficial)',sport,league,
    requestedStart:date,daysScanned:0,eventCount:0,eventsWithPrices:0,
    rawEntries:0,requests:0,refsResolved:0,rows:[],errors,examples,
    coverage:'Consulta parcial por días y encuentros, NO un archivo histórico completo',
    warning:'Solo investigación y backtesting. Las líneas son observaciones almacenadas por ESPN sin garantía de apertura/cierre, hora exacta ni derechos de reutilización. NO son cuotas vigentes.',
  }
  const urlSite='https://site.api.espn.com/apis/site/v2/sports/'+sport+'/'+league+'/'
  const urlCore='https://sports.core.api.espn.com/v2/sports/'+sport+'/leagues/'+league+'/events/'
  const seenEvents=new Set<string>(),seenQuotes=new Set<string>()
  const get=async(url:string):Promise<unknown>=>{
    if(report.requests>=maxRequests)throw Error('Límite de consultas históricas alcanzado')
    report.requests++
    return getJSON<unknown>(url)
  }
  const capture=(event:Dict,lines:Dict[],source:HistoricalEspnRow['source']):number=>{
    report.rawEntries+=lines.length
    const eventDate=typeof event.date==='string'?event.date:''
    const quotes=normalizeEspnMarkets(event,
      lines,{ historical:true })
    let saved=0
    for(const q of quotes){
      if(report.rows.length>=120)break
      const key=[q.eventId,q.bookmaker,q.market,q.selection,q.point??'',q.price,q.updatedAt].join('|')
      if(seenQuotes.has(key))continue
      seenQuotes.add(key)
      report.rows.push({ ...q,historical:true,priceStatus:'historical_unverified',source,
        quoteTimestampKnown:Number.isFinite(Date.parse(q.updatedAt)),eventDate })
      saved++
    }
    return saved
  }
  for(let i=0;i<days&&report.requests<maxRequests;i++){
    const day=dayAt(date,i)
    if(Date.parse(day+'T00:00:00Z')>now)break
    const dayCode=day.replaceAll('-','')
    let board:unknown
    try{board=await get(urlSite+'scoreboard?dates='+dayCode);report.daysScanned++}
    catch(e){errors.push('scoreboard '+day+': '+(e instanceof Error?e.message:'fallo'));continue}
    if(!obj(board)||!Array.isArray(board.events)){
      errors.push('scoreboard '+day+': events ausente');continue
    }
    for(const event of records(board.events).slice(0,eventsPerDay)){
      const id=numericId(event.id),comp=records(event.competitions)[0]
      if(!id||!comp||seenEvents.has(id))continue
      const kickoff=Date.parse(typeof event.date==='string'?event.date:'')
      if(!Number.isFinite(kickoff)||kickoff>now)continue
      seenEvents.add(id)
      report.eventCount++
      let added=capture(event,records(comp.odds),'ESPN Scoreboard')
      const compId=numericId(comp.id)??id
      const coreBase=urlCore+id+'/competitions/'+compId+'/odds'
      if(report.requests>=maxRequests)break
      try{
        const result=await get(coreBase+'?limit=25')
        const items=priceEntries(result)
        const direct=items.filter(x=>typeof x.$ref!=='string')
        added+=capture(event,direct,'ESPN Core')
        const refs=[...new Set(items.map(item=>safeRef(item.$ref,sport,league,id,compId))
          .filter((ref):ref is string=>ref!==null))].slice(0,2)
        for(const target of refs){
          if(report.requests>=maxRequests)break
          try{
            const details=await get(target)
            report.refsResolved++
            added+=capture(event,priceEntries(details),'ESPN Core')
          }catch(e){errors.push('Core ref '+id+': '+(e instanceof Error?e.message:'fallo'))}
        }
      }catch(e){errors.push('Core odds '+id+': '+(e instanceof Error?e.message:'fallo'))}
      if(!added&&report.requests<maxRequests){
        try{added+=capture(event,priceEntries(await get(urlSite+'summary?event='+id)),'ESPN Summary')}
        catch(e){errors.push('summary '+id+': '+(e instanceof Error?e.message:'fallo'))}
      }
      if(added>0)report.eventsWithPrices++
      if(examples.length<8)examples.push(urlCore+id+'/competitions/'+compId+'/odds')
      if(report.rows.length>=120)break
    }
  }
  report.errors=errors.slice(0,12)
  return report
}
