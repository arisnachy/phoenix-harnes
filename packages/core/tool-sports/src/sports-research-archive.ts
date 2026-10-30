/**
 * PHOENIX local research archive. Records already-observed price references,
 * including ESPN lines without provider update times. Never requests a network
 * resource, scrapes a website, or upgrades a saved line to a live sportsbook offer.
 * Persistence is disabled by operator opt-out; source usage remains subject to
 * rights and terms, and this is intended for private local analysis only.
 */
import {createHash} from 'node:crypto'
import {mkdir,readdir,readFile,stat,writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join,resolve} from 'node:path'

export type ResearchMarket='h2h'|'spreads'|'totals'|'1x2'|'double_chance'
export type ResearchSource='ESPN Scoreboard'|'ESPN Core'|'ESPN Summary'|'OddsHarvester/OddsPortal'
export type ResearchPriceInput={
  eventId:string;home:string;away:string;market:ResearchMarket;selection:string
  bookmaker:string;price:number;source:ResearchSource;point?:number|null
  eventStartsAt?:string;eventDate?:string;providerUpdatedAt?:string
}
export type ArchivedResearchPrice=ResearchPriceInput&{
  observedAt:string;sourceTimeStatus:'missing'|'reported';historical:true
  quoteIsCurrent:false;providerUpdatedAt?:string
}
export type ResearchArchiveCapture={
  sportKey:string;observedAt:string;historical:true;quoteIsCurrent:false
  rows:ArchivedResearchPrice[]
}
const keyOK=(v:string)=>/^[a-z0-9_]{3,80}$/u.test(v)
const eventOK=(v:string)=>/^[0-9a-z_-]{1,64}$/iu.test(v)
const dateOK=(v:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(v)
  &&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v
const isTimestamp=(v:unknown):v is string=>typeof v==='string'
  &&v.length<=45&&Number.isFinite(Date.parse(v))
const clean=(v:unknown,max=120):string=>typeof v==='string'
  ?v.replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,max):''
const archiveHome=(env:NodeJS.ProcessEnv)=>resolve(env.PHOENIX_SPORTS_SOURCE_HOME?.trim()
  ||join(homedir(),'.phoenix','sports-sources'))
const folderFor=(env:NodeJS.ProcessEnv,sportKey:string,day:string)=>
  join(archiveHome(env),'research-odds',sportKey,day)
const sources:ResearchSource[]=['ESPN Scoreboard','ESPN Core','ESPN Summary','OddsHarvester/OddsPortal']
const markets:ResearchMarket[]=['h2h','spreads','totals','1x2','double_chance']
const sanitize=(q:ResearchPriceInput,observedAt:string):ArchivedResearchPrice|null=>{
  if(!eventOK(q.eventId)||!sources.includes(q.source)||!markets.includes(q.market)
    ||!Number.isFinite(q.price)||q.price<=1||q.price>=1000
    ||(q.point!==null&&q.point!==undefined&&(!Number.isFinite(q.point)||Math.abs(q.point)>2000)))return null
  const home=clean(q.home),away=clean(q.away),selection=clean(q.selection,120)
  const bookmaker=clean(q.bookmaker,100)
  if(!home||!away||!selection||!bookmaker||home===away)return null
  const eventDate=typeof q.eventDate==='string'&&dateOK(q.eventDate)?q.eventDate:undefined
  const eventStartsAt=isTimestamp(q.eventStartsAt)?new Date(q.eventStartsAt).toISOString():undefined
  const providerUpdatedAt=isTimestamp(q.providerUpdatedAt)
    &&Date.parse(q.providerUpdatedAt)<=Date.parse(observedAt)+120_000
    ?new Date(q.providerUpdatedAt).toISOString():undefined
  return {eventId:q.eventId,home,away,selection,bookmaker,
    market:q.market,source:q.source,price:Number(q.price.toFixed(5)),
    ...(q.point===null||q.point===undefined?{}:{point:q.point}),
    ...(eventDate?{eventDate}:{}),...(eventStartsAt?{eventStartsAt}:{}),
    ...(providerUpdatedAt?{providerUpdatedAt}:{}),
    observedAt,sourceTimeStatus:providerUpdatedAt?'reported':'missing',
    historical:true,quoteIsCurrent:false}
}
/** Persist the prices a tool ALREADY saw (no additional fetches).
 * @param sportKey - Verified market sport key, e.g. basketball_nba.
 * @param input - Authenticated data extracted from an already-observed result.
 * @param env - Operator-controlled local archive path and opt-out setting.
 * @param now - Actual local observation epoch milliseconds.
 * @returns Saved row count and whether the archive was disabled.
 */
export async function saveResearchOdds(
  sportKey:string,input:readonly ResearchPriceInput[],
  env:NodeJS.ProcessEnv=process.env,now=Date.now(),
):Promise<{saved:boolean;count:number;disabled:boolean}>{
  if(!keyOK(sportKey)||!Number.isFinite(now)||now<0)throw Error('Archivo: fecha o liga inválida')
  if(env.PHOENIX_SPORTS_RESEARCH_ARCHIVE_DISABLED==='1')
    return {saved:false,count:0,disabled:true}
  const observedAt=new Date(now).toISOString(),dedupe=new Set<string>()
  const rows:ArchivedResearchPrice[]=[]
  for(const candidate of input.slice(0,300)){
    const row=sanitize(candidate,observedAt)
    if(!row)continue
    const fingerprint=[row.eventId,row.bookmaker,row.market,row.selection,row.point??'',row.price,row.source].join('|')
    if(dedupe.has(fingerprint))continue
    dedupe.add(fingerprint);rows.push(row)
    if(rows.length>=200)break
  }
  if(!rows.length)return{saved:false,count:0,disabled:false}
  const day=observedAt.slice(0,10),hour=observedAt.slice(11,13)
  const bucket=createHash('sha256').update(JSON.stringify(rows.map(row=>[
    row.eventId,row.bookmaker,row.market,row.selection,row.point??null,row.price,row.source,row.providerUpdatedAt??null,
  ]))).digest('hex').slice(0,16)
  const folder=folderFor(env,sportKey,day)
  const filename=hour+'-'+bucket+'.json'
  await mkdir(folder,{recursive:true})
  const payload:ResearchArchiveCapture={sportKey,observedAt,historical:true,quoteIsCurrent:false,rows}
  try{await writeFile(join(folder,filename),JSON.stringify(payload),{encoding:'utf8',flag:'wx'})}
  catch(error){
    if((error as NodeJS.ErrnoException).code==='EEXIST')return{saved:false,count:0,disabled:false}
    throw error
  }
  return{saved:true,count:rows.length,disabled:false}
}
/** Return bounded historical local captures, NEVER live prices.
 * @param sportKey - Key of the sport being investigated.
 * @param fromDate - First UTC observation day, inclusive.
 * @param toDate - Last UTC observation day, inclusive, max 31 days.
 * @param eventId - Optional exact provider event ID.
 * @param env - Optional operator-controlled source home.
 * @param limit - Maximum stored rows returned, 1..300.
 * @returns Sources, evidence time range, archival rows, errors and truncation.
 */
export async function readResearchOdds(
  sportKey:string,fromDate:string,toDate:string,eventId?:string,
  env:NodeJS.ProcessEnv=process.env,limit=200,
):Promise<{rows:ArchivedResearchPrice[];capturedFiles:number;days:number;
  earliest:string|null;latest:string|null;truncated:boolean;errors:string[];historical:true}>{
  if(!keyOK(sportKey)||!dateOK(fromDate)||!dateOK(toDate)
    ||(eventId!==undefined&&!eventOK(eventId))
    ||!Number.isInteger(limit)||limit<1||limit>300)throw Error('Consulta de archivo inválida')
  const start=Date.parse(fromDate+'T00:00:00Z'),end=Date.parse(toDate+'T00:00:00Z')
  const days=Math.round((end-start)/86_400_000)+1
  if(days<1||days>31)throw Error('Archivo: máximo 31 días por consulta')
  const rows:ArchivedResearchPrice[]=[],errors:string[]=[]
  let capturedFiles=0,truncated=false,earliest:string|null=null,latest:string|null=null
  const seen=new Set<string>()
  for(let offset=days-1;offset>=0;offset--){
    const day=new Date(start+offset*86_400_000).toISOString().slice(0,10)
    let files:string[]
    try{
      const names=(await readdir(folderFor(env,sportKey,day)))
        .filter(n=>/^\d{2}-[0-9a-f]{16}\.json$/u.test(n)).sort().reverse()
      truncated ||=names.length>80
      files=names.slice(0,80)
    }catch(error){
      if((error as NodeJS.ErrnoException).code==='ENOENT')continue
      errors.push('Lectura de carpeta '+day+' fallida');continue
    }
    for(const filename of files){
      if(rows.length>=limit){truncated=true;break}
      try{
        const path=join(folderFor(env,sportKey,day),filename)
        if((await stat(path)).size>1_000_000){errors.push('Registro demasiado grande');continue}
        const payload=JSON.parse(await readFile(path,'utf8')) as ResearchArchiveCapture
        if(payload.sportKey!==sportKey||!payload.historical||payload.quoteIsCurrent!==false
          ||!isTimestamp(payload.observedAt)||payload.observedAt.slice(0,10)!==day
          ||!Array.isArray(payload.rows))throw Error('Registro de archivo inválido')
        capturedFiles++
        for(const candidate of payload.rows.slice(0,200)){
          if(rows.length>=limit){truncated=true;break}
          const safe=sanitize(candidate,payload.observedAt)
          if(!safe|| (eventId!==undefined&&safe.eventId!==eventId))continue
          const signature=[safe.observedAt,safe.eventId,safe.bookmaker,safe.market,safe.selection,safe.point??'',safe.price].join('|')
          if(seen.has(signature))continue
          seen.add(signature);rows.push(safe)
          if(earliest===null||safe.observedAt<earliest)earliest=safe.observedAt
          if(latest===null||safe.observedAt>latest)latest=safe.observedAt
        }
      }catch(error){errors.push(error instanceof Error?error.message.slice(0,100):'Error de lectura')}
    }
    if(rows.length>=limit)break
  }
  return{rows,capturedFiles,days,earliest,latest,truncated,errors:errors.slice(0,15),historical:true}
}
