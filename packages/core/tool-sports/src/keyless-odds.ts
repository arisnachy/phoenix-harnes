/**
 * PHOENIX keyless multideporte odds adapter for a locally installed OddsHarvester CLI.
 * https://github.com/jordantete/OddsHarvester (MIT)
 * A local browser scraper is NOT an unlimited odds API. Site access, market licensing,
 * geoblocks and rate limits remain subject to the data publisher's policies.
 * Disabled by default; the host opts in after reviewing those conditions.
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runFile = promisify(execFile)
export const keylessSports = {
  football:['1x2','double_chance','btts','over_under'],
  basketball:['moneyline','1x2','over_under'],
  baseball:['moneyline','over_under'],
  'american-football':['moneyline','over_under'],
  tennis:['match_winner','total_sets_over_under','total_games_over_under'],
  'ice-hockey':['home_away','1x2','double_chance','btts','over_under'],
  'rugby-league':['home_away','over_under'],
  'rugby-union':['home_away','over_under'],
  handball:['1x2','home_away','over_under'],
  volleyball:['home_away','total_sets_over_under','total_points_over_under'],
  cricket:['home_away'],
} as const

export type KeylessSport = keyof typeof keylessSports
export type KeylessQuote = {
  eventId:string;bookmaker:string;market:string;selection:string;point:number|null
  price:number;home:string;away:string;time:string;updatedAt:string
  source:string
  sportKey:string
  league?:string
  matchLink?:string
}
type ScrapedGame = {
  match_date?:unknown;scraped_date?:unknown;match_link?:unknown
  home_team?:unknown;away_team?:unknown;league_name?:unknown
  [key:string]:unknown
}
const str=(value:unknown,max=150):string=>typeof value==='string'
  ?value.replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,max):''
const when=(value:unknown):number=>{
  const raw=str(value,48)
  return Date.parse(raw.replace(/ UTC$/u,'Z').replace(' ','T'))
}
const price=(value:unknown):number|null=>{
  if(typeof value!=='number'&&typeof value!=='string')return null
  const n=Number(value)
  return Number.isFinite(n)&&n>1&&n<1000?n:null
}
const sportOK=(value:string):value is KeylessSport=>Object.hasOwn(keylessSports,value)
const marketOK=(sport:KeylessSport,market:string):boolean=>
  (keylessSports[sport] as readonly string[]).includes(market)
const safeLink=(value:unknown):string|null=>{
  const raw=str(value,500)
  try{
    const parsed=new URL(raw)
    return parsed.protocol==='https:'&&parsed.hostname==='www.oddsportal.com'?parsed.toString():null
  }catch{return null}
}
const eventKey=(link:string):string=>createHash('sha256').update(link).digest('hex').slice(0,24)
const getLine=(key:string):number|null=>{
  const match=key.match(/^(?:over_under|over_under_games|over_under_sets|over_under_points)_(\d{1,4})_(\d)_market$/u)
  return match?Number(match[1])+Number(match[2])/10:null
}
/** Accept only bookmaker markets with an unambiguous score/selection interpretation. */
export function normalizeOddsHarvester(
  input:unknown,sportKey:string,now=Date.now(),maxAgeMs=3_600_000,
  historical=false,
):KeylessQuote[]{
  if(!Array.isArray(input))throw Error('OddsHarvester no devolvió un array JSON')
  if(!Number.isFinite(now)||!Number.isFinite(maxAgeMs)||maxAgeMs<0)throw Error('Reloj de cuotas inválido')
  const result:KeylessQuote[]=[]
  const dedupe=new Set<string>()
  for(const raw of input.slice(0,500)){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))continue
    const game=raw as ScrapedGame
    const link=safeLink(game.match_link),home=str(game.home_team),away=str(game.away_team)
    const kickoff=when(game.match_date),observed=when(game.scraped_date)
    if(!link||!home||!away||!Number.isFinite(kickoff)||(!historical&&kickoff<=now)
      ||!Number.isFinite(observed)||observed>now+120_000||(!historical&&now-observed>maxAgeMs))continue
    const eventId=eventKey(link)
    for(const [field,value] of Object.entries(game)){
      if(!field.endsWith('_market')||!Array.isArray(value))continue
      let market:string
      let selections:ReadonlyArray<readonly [string,string,number|null]>=[]
      const overUnder=getLine(field)
      if(field==='home_away_market'||field==='moneyline_market'||field==='match_winner_market'){
        market='h2h'
        selections=[['1',home,null],['2',away,null],['player_1',home,null],['player_2',away,null]]
      }else if(field==='1x2_market'){
        // The 3-way basketball market excludes overtime: keep distinct from 2-way h2h.
        market='1x2'
        selections=[['1',home,null],['X','Empate',null],['2',away,null]]
      }else if(field==='double_chance_market'){
        market='double_chance'
        selections=[['1X','1X',null],['12','12',null],['X2','X2',null]]
      }else if(field==='btts_market'){
        market='btts'
        selections=[['btts_yes','Sí',null],['btts_no','No',null]]
      }else if(overUnder!==null){
        market='totals'
        selections=[['odds_over','Más',overUnder],['odds_under','Menos',overUnder]]
      }else continue // no guessing which team/line wins an ambiguous handicap
      for(const item of value.slice(0,40)){
        if(!item||typeof item!=='object'||Array.isArray(item))continue
        const row=item as Record<string,unknown>
        const period=str(row.period,50)
        if(period!=='FullTime'&&period!=='FullIncludingOT')continue
        const bookmaker=str(row.bookmaker_name,100)
        if(!bookmaker)continue
        const blocked=new Set(Array.isArray(row.blocked_outcomes)?row.blocked_outcomes.filter(x=>typeof x==='string'):[])
        for(const [key,selection,point] of selections){
          if(blocked.has(key))continue // Withdrawn markets are not active quotes.
          const decimal=price(row[key])
          if(decimal===null)continue
          const identity=[eventId,bookmaker,market,selection,point??''].join('|')
          if(dedupe.has(identity))continue
          dedupe.add(identity)
          result.push({eventId,bookmaker,market,selection,point,price:decimal,home,away,
            time:new Date(kickoff).toISOString(),updatedAt:new Date(observed).toISOString(),
            league:str(game.league_name,120),matchLink:link,
            source:historical?'OddsHarvester/OddsPortal (histórico, no vigente)':'OddsHarvester/OddsPortal (sin API key)',sportKey})
          if(result.length>=2500)return result
        }
      }
    }
  }
  return result
}

/** Safe v0.20.0 historical query. Results are dated past-match observations,
 * never usable as a live ticket price.
 */
export function oddsHarvesterHistoricArgs(
  sport:KeylessSport,league:string,season:string,market:string,file:string,
):string[]{
  if(!sportOK(sport)||!marketOK(sport,market)||
    !/^[a-z0-9][a-z0-9-]{2,80}$/u.test(league)||
    !/^(?:20[0-9]{2})(?:-20[0-9]{2})?$/u.test(season)||
    !file||file.length>512)throw Error('Consulta histórica inválida')
  return ['historic','--sport',sport,'--league',league,'--season',season,
    '--market',market,'--max-pages','2','--headless','--format','json',
    '--stream-ndjson','--output',file]
}
export async function keylessHistoricOdds(
  sport:string,league:string,season:string,market:string,
  env:NodeJS.ProcessEnv=process.env,now=Date.now(),
  runner?:()=>Promise<unknown>,
):Promise<{historical:true;source:string;rows:KeylessQuote[]}>{
  if(!sportOK(sport)||!marketOK(sport,market))throw Error('Deporte histórico no soportado')
  // Validation before spawning; fixed CLI subcommands, no arbitrary site URLs.
  oddsHarvesterHistoricArgs(sport,league,season,market,'odds.json')
  if(!keylessEnabled(env))throw Error('OddsHarvester histórico desactivado por el operador')
  const load=async()=>{
    const folder=await mkdtemp(join(tmpdir(),'phoenix-history-'))
    const file=join(folder,'historical.json')
    try{
      const executable=env.PHOENIX_SPORTS_ODDSHARVESTER_BIN||'oddsharvester'
      let stdout='',failure:unknown=null
      try{
        const result=await runFile(executable,
          oddsHarvesterHistoricArgs(sport,league,season,market,file),
          {shell:false,windowsHide:true,timeout:90_000,maxBuffer:4_000_000,
            env:{...process.env,...env}})
        stdout=result.stdout
      }catch(error){
        failure=error;stdout=typeof (error as {stdout?:unknown}).stdout==='string'?
          (error as {stdout:string}).stdout:''
      }
      let output:unknown=null
      try{
        if((await stat(file)).size<=4_000_000)
          output=JSON.parse(await readFile(file,'utf8')) as unknown
      }catch{/* NDJSON rows still recoverable */}
      const rows=recoverScraperRows(stdout,output)
      if(rows.length)return rows
      if(failure)throw Error('OddsHarvester histórico sin resultados: '+
        (failure instanceof Error?failure.message.slice(0,180):'Fallo del proceso'))
      return Array.isArray(output)?output:[]
    }finally{await rm(folder,{recursive:true,force:true})}
  }
  const raw=runner?await runner():await load()
  const rows=normalizeOddsHarvester(raw,sport,now,3_600_000,true).slice(0,200)
  return{historical:true,source:'OddsHarvester/OddsPortal: archivo por liga y temporada',rows}
}
export const keylessEnabled=(env:NodeJS.ProcessEnv=process.env):boolean=>
  env.PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED==='1'

const cache=new Map<string,{at:number;rows:KeylessQuote[]}>()
const inFlight=new Map<string,Promise<KeylessQuote[]>>()
const localDay=()=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date())
const validDate=(day:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(day)
  &&Number.isFinite(Date.parse(day+'T00:00:00Z'))
  &&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day
/** OddsPortal has distinct period tabs: NHL full-including-OT winner is NOT the
 * 3-way regulation 1X2 market. Request exactly the published period rather than
 * silently treating missing odds as a missing provider.
 */
export function oddsHarvesterArgs(sport:KeylessSport,market:string,day:string,file:string):string[]{
  if(!sportOK(sport)||!marketOK(sport,market)||!validDate(day))throw Error('Petición no permitida')
  const period=(sport==='ice-hockey'&&market==='home_away')?'full_including_ot':
    ((sport==='basketball'||sport==='american-football')&&market==='1x2')?'full_time':null
  return ['upcoming','--sport',sport,'--date',day.replaceAll('-',''),
    '--market',market,...(period?['--period',period]:[]),
    '--headless','--format','json','--stream-ndjson','--output',file]
}
/** Run a fixed local executable with fixed command shape, no shell, no user URLs. */
/**
 * OddsHarvester v0.20 emits valid match records as NDJSON before batch completion.
 * Keep those rows if the CLI fails after scraping some matches. If neither
 * streaming stdout nor a finished batch file is valid, surface the real error.
 */
export function recoverScraperRows(stdout:unknown,output:unknown):unknown[]{
  const rows:unknown[]=[]
  const seen=new Set<string>()
  const add=(value:unknown)=>{
    if(!value||typeof value!=='object'||Array.isArray(value))return
    const row=value as Record<string,unknown>
    if(typeof row.match_link!=='string'||!row.match_link.startsWith('https://www.oddsportal.com/')
      ||typeof row.home_team!=='string'||typeof row.away_team!=='string')return
    const key=[row.match_link,row.scraped_date??'',row.match_date??''].join('|')
    if(seen.has(key)||rows.length>=500)return
    seen.add(key);rows.push(row)
  }
  if(Array.isArray(output))for(const row of output.slice(0,500))add(row)
  if(typeof stdout==='string'){
    for(const line of stdout.split(/\r?\n/u).slice(0,5000)){
      if(line.length>35_000||!line.trim().startsWith('{'))continue
      try{add(JSON.parse(line) as unknown)}catch{/* malformed/truncated NDJSON line */}
    }
  }
  return rows
}
/** Run a fixed local executable with fixed command shape, no shell, no user URLs. */
/** Sanitized transport failure: retain exit status and stderr diagnostics without
 * exposing environment variables, authorization headers or a raw shell command.
 */
export function describeScraperError(error:unknown):string{
  const record=error&&typeof error==='object'?error as Record<string,unknown>:{}
  const raw=typeof record.stderr==='string'?record.stderr:''
  const scrub=(v:string)=>v.replace(/\u001b\[[0-9;]*m/gu,'')
    // Redact the entire Authorization bearer value, not just the word "Bearer".
    .replace(/\bauthorization\s*[:=]\s*bearer\s+[^\s,;]+/giu,'[credencial oculta]')
    .replace(/\bbearer\s+[a-z0-9._~+\/-]{8,}/giu,'[credencial oculta]')
    .replace(/(?:api[_-]?key|access[_-]?token|token|authorization|password|secret)\s*[:=]\s*(?:"[^"]+"|'[^']+'|[^\s,;]+)/giu,'[credencial oculta]')
    .replace(/(?:--(?:api-key|token|password|secret)\s+)[^\s]+/giu,'[credencial oculta]')
    .replace(/([?&](?:api[_-]?key|access_token|token|key|secret|password)=)[^&#\s]+/giu,'$1[oculto]')
    .replace(/\b(?:sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_]{20,})\b/giu,'[credencial oculta]')
    .replace(/[\r\n]+/gu,' ').trim()
  const diagnostic=scrub(raw).slice(-900)
  const code=typeof record.code==='number'||typeof record.code==='string'?
    String(record.code).slice(0,40):'desconocido'
  const signal=typeof record.signal==='string'?record.signal.slice(0,30):'ninguna'
  const killed=record.killed===true
  const category=code==='ENOENT'?'missing-executable':
    code==='ETIMEDOUT'||killed?'timeout':
      /executable doesn.t exist|playwright.*install|chromium.*not found/iu.test(raw)?
        'missing-playwright-browser':
      /403|429|access denied|captcha|cloudflare/iu.test(raw)?
        'site-blocked-or-limited':'scraper-exit-error'
  return 'category='+category+'; exitCode='+code+'; signal='+signal+
    '; killed='+String(killed)+'; stderr='+ (diagnostic||'sin detalles de stderr')+
    '; verificar el log local del instalador y una consulta CLI controlada.'
}
async function runScraper(sport:KeylessSport,market:string,day:string,env:NodeJS.ProcessEnv):Promise<unknown>{
  const folder=await mkdtemp(join(tmpdir(),'phoenix-odds-'))
  const file=join(folder,'odds.json')
  try{
    const executable=env.PHOENIX_SPORTS_ODDSHARVESTER_BIN||'oddsharvester'
    let stdout='',failure:unknown=null
    try{
      const execution=await runFile(executable,oddsHarvesterArgs(sport,market,day,file),
        {shell:false,windowsHide:true,timeout:65_000,maxBuffer:4_000_000,
          env:{...process.env,...env}})
      stdout=execution.stdout
    }catch(error){
      failure=error
      const captured=error as {stdout?:unknown}
      stdout=typeof captured.stdout==='string'?captured.stdout:''
    }
    let output:unknown=null
    try{
      const metadata=await stat(file)
      if(metadata.size>4_000_000)throw Error('Archivo de cuotas supera 4 MB')
      output=JSON.parse(await readFile(file,'utf8')) as unknown
    }catch(error){
      if(!failure&&error instanceof Error&&error.message.includes('supera 4 MB'))throw error
    }
    const recovered=recoverScraperRows(stdout,output)
    if(recovered.length)return recovered
    if(failure){
      throw Error('OddsHarvester falló sin cuotas recuperables: '+describeScraperError(failure))
    }
    return Array.isArray(output)?output:[]
  }finally{
    await rm(folder,{recursive:true,force:true})
  }
}
/**
 * Reuses one scrape across callers; short TTL avoids re-scraping the same sport/market.
 * No API key needed. A missing installation or blocked source must fail explicitly.
 */
export async function keylessOdds(
  sport:string,market:string,date=localDay(),env:NodeJS.ProcessEnv=process.env,
  now=Date.now(),runner:typeof runScraper=runScraper,
):Promise<KeylessQuote[]>{
  if(!sportOK(sport)||!marketOK(sport,market))throw Error('Deporte o mercado sin soporte verificado en OddsHarvester')
  if(!validDate(date))throw Error('Fecha de cuotas inválida')
  if(!keylessEnabled(env))throw Error('Scraping sin API key desactivado por el operador')
  const key=[sport,market,date].join('|')
  const cached=runner===runScraper?cache.get(key):undefined
  if(cached&&now>=cached.at&&now-cached.at<300_000)return cached.rows
  const running=runner===runScraper?inFlight.get(key):undefined
  if(running)return running
  const task=(async()=>{
    const raw=await runner(sport,market,date,env)
    const rows=normalizeOddsHarvester(raw,sport,now,3_600_000)
    if(Array.isArray(raw)&&raw.length>0&&rows.length===0)
      throw Error('OddsHarvester procesó '+raw.length+
        ' partidos, pero no encontró precios elegibles: comprobar fecha de captura, '+
        'inicio del partido, mercado, casa, período y líneas retiradas.')
    if(runner===runScraper){
      if(cache.size>=64)cache.clear()
      cache.set(key,{at:now,rows})
    }
    return rows
  })()
  if(runner===runScraper)inFlight.set(key,task)
  try{return await task}
  finally{if(runner===runScraper)inFlight.delete(key)}
}
