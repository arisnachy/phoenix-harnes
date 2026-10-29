/**
 * PHOENIX keyless multideporte odds adapter for a locally installed OddsHarvester CLI.
 * https://github.com/jordantete/OddsHarvester (MIT)
 * A local browser scraper is NOT an unlimited odds API. Site access, market licensing,
 * geoblocks and rate limits remain subject to the data publisher's policies.
 * Enabled when the user requests free odds, with an explicit host opt-out.
 * Provider availability is always checked independently of this feature flag.
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
  tennis:['match_winner','over_under'],
  'ice-hockey':['home_away','over_under'],
  'rugby-league':['home_away','over_under'],
  'rugby-union':['home_away','over_under'],
  handball:['1x2','over_under'],
  volleyball:['home_away','over_under'],
  cricket:['home_away'],
} as const

export type KeylessSport = keyof typeof keylessSports
export type KeylessQuote = {
  eventId:string;bookmaker:string;market:string;selection:string;point:number|null
  price:number;home:string;away:string;time:string;updatedAt:string
  source:string
  sportKey:string
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
    if(!link||!home||!away||!Number.isFinite(kickoff)||kickoff<=now
      ||!Number.isFinite(observed)||observed>now+120_000||now-observed>maxAgeMs)continue
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
            source:'OddsHarvester/OddsPortal (sin API key)',sportKey})
          if(result.length>=2500)return result
        }
      }
    }
  }
  return result
}

/** Free, read-only odds need no API key. Operators may explicitly opt out. */
export const keylessEnabled=(env:NodeJS.ProcessEnv=process.env):boolean=>
  env.PHOENIX_SPORTS_KEYLESS_ODDS_DISABLED!=='1'
    &&env.PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED!=='0'

const cache=new Map<string,{at:number;rows:KeylessQuote[]}>()
const failures=new Map<string,{at:number;message:string}>()
let lastStatus:{checkedAt:string;status:'quotes'|'no-quotes'|'unavailable';count:number;error?:string}|undefined
/** Observable provider state, not a claim that a future quote will be available. */
export function lastKeylessStatus(){
  return lastStatus&&Date.now()-Date.parse(lastStatus.checkedAt)<3_600_000?lastStatus:undefined
}
const inFlight=new Map<string,Promise<KeylessQuote[]>>()
const localDay=()=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date())
const validDate=(day:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(day)
  &&Number.isFinite(Date.parse(day+'T00:00:00Z'))
  &&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day
/** Run a fixed local executable with fixed command shape, no shell, no user URLs. */
async function runScraper(sport:KeylessSport,market:string,day:string,env:NodeJS.ProcessEnv):Promise<unknown>{
  const folder=await mkdtemp(join(tmpdir(),'phoenix-odds-'))
  const file=join(folder,'odds.json')
  try{
    const executable=env.PHOENIX_SPORTS_ODDSHARVESTER_BIN||'oddsharvester'
    const argv=['upcoming','--sport',sport,'--date',day.replaceAll('-',''),
      '--market',market,'--headless','--format','json','--output',file,'--concurrency','1',
      '--request-delay','2']
    // No shell or arbitrary URLs; uvx is an optional self-contained runner, pinned to a tested package.
    // It may provision the package, but a browser binary must still be present on the host.
    // Child process needs basic OS/browser variables, never the host's API keys or vault secrets.
    const allow=/^(PATH|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|SYSTEMROOT|WINDIR|PLAYWRIGHT_BROWSERS_PATH|UV_CACHE_DIR|UV_PYTHON_INSTALL_DIR|XDG_CACHE_HOME|LANG|LC_ALL)$/u
    const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([name])=>allow.test(name)))
    try{
      await runFile(executable,argv,{shell:false,windowsHide:true,timeout:120_000,maxBuffer:256_000,env:safeEnv})
    }catch(error){
      const missing=(error as NodeJS.ErrnoException).code==='ENOENT'
      if(!missing||env.PHOENIX_SPORTS_ODDSHARVESTER_BIN||env.PHOENIX_SPORTS_ODDSHARVESTER_UVX_DISABLED==='1')throw error
      try{
        await runFile('uvx',['--from','oddsharvester==0.13.0','oddsharvester',...argv],
          {shell:false,windowsHide:true,timeout:120_000,maxBuffer:256_000,env:safeEnv})
      }catch(fallback){
        if((fallback as NodeJS.ErrnoException).code==='ENOENT')throw Error(
          'OddsHarvester no está instalado y uvx no está disponible; instala con pnpm sports:odds:setup')
        throw fallback
      }
    }
    const metadata=await stat(file)
    if(metadata.size>4_000_000)throw Error('Archivo de cuotas supera 4 MB')
    return JSON.parse(await readFile(file,'utf8')) as unknown
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
  if(!keylessEnabled(env))throw Error('OddsHarvester deshabilitado expresamente en PHOENIX_SPORTS_KEYLESS_ODDS_DISABLED=1 o KEYLESS_ODDS_ENABLED=0')
  const key=[sport,market,date].join('|')
  const previousError=runner===runScraper?failures.get(key):undefined
  if(previousError&&now>=previousError.at&&now-previousError.at<90_000)throw Error(previousError.message)
  const cached=runner===runScraper?cache.get(key):undefined
  if(cached&&now>=cached.at&&now-cached.at<300_000)return cached.rows
  const running=runner===runScraper?inFlight.get(key):undefined
  if(running)return running
  const task=(async()=>{
    try{
      const raw=await runner(sport,market,date,env)
      const rows=normalizeOddsHarvester(raw,sport,now,3_600_000)
      if(runner===runScraper){
        if(cache.size>=64)cache.clear()
        cache.set(key,{at:now,rows})
        failures.delete(key)
        lastStatus={checkedAt:new Date(now).toISOString(),status:rows.length?'quotes':'no-quotes',count:rows.length}
      }
      return rows
    }catch(error){
      if(runner===runScraper){
        const message=error instanceof Error?error.message.slice(0,180):'Error del proveedor'
        failures.set(key,{at:now,message})
        if(failures.size>64)failures.clear()
        lastStatus={checkedAt:new Date(now).toISOString(),status:'unavailable',count:0,error:message}
      }
      throw error
    }
  })()
  if(runner===runScraper)inFlight.set(key,task)
  try{return await task}
  finally{if(runner===runScraper)inFlight.delete(key)}
}
