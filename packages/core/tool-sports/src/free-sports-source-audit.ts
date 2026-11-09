/** Read-only free secondary research providers. A fixture match is NOT a
 * betting probability, confirmed starter, medical report or bookmaker price.
 * No-match in a small/free feed never negates a verified primary fixture.
 */
import {getFeed,sportsCatalog} from './sports.ts'
import {createHash} from 'node:crypto'
import {dailyResearchFetcher} from './sports-daily-preload.ts'

export type FreeFixture={sport:string;league:string;eventId:string;date:string;
  home:string;away:string;kickoff:string}
export type BackupFinding={provider:'TheSportsDB'|'OpenLigaDB'|'OpenFootball'|'FootballData.org'|'balldontlie'|'API-Football'|'MLB StatsAPI'|'NHL Web API'|'nflverse schedules';
  status:'verified'|'partial'|'not-found'|'unavailable'|'conflict';
  url:string;checkedAt:string;detail:string}
type Obj=Record<string,unknown>
const obj=(x:unknown):Obj=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Obj:{}
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const str=(x:unknown):string=>typeof x==='string'?x.trim():''
const norm=(x:string)=>x.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const canonical=(x:string)=>norm(x.replace(/\s+(?:FC|CF|AFC|SC)$/iu,''))
const validDate=(d:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(d)&&
  Number.isFinite(Date.parse(d+'T00:00:00Z'))&&
  new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d
const sportNames:Record<string,string>={
  soccer:'Soccer',basketball:'Basketball',baseball:'Baseball',
  football:'American Football',hockey:'Ice Hockey',tennis:'Tennis'}
const footballJsonLeagues:Record<string,string>={
  'eng.1':'en.1','esp.1':'es.1','ger.1':'de.1',
  'ita.1':'it.1','fra.1':'fr.1','ned.1':'nl.1','por.1':'pt.1'}
const footballDataCompetitions:Record<string,string>={
  'eng.1':'PL','esp.1':'PD','ger.1':'BL1','ita.1':'SA',
  'fra.1':'FL1','ned.1':'DED','por.1':'PPL'}
const checked=(now:number)=>new Date(now).toISOString()
const inside90=(candidate:string,kickoff:string):boolean=>{
  const a=Date.parse(candidate),b=Date.parse(kickoff)
  return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=90*60_000
}
function compare(home:string,away:string,when:string,input:FreeFixture,
  dateOnly=false):'verified'|'partial'|'not-found'|'conflict'{
  const h=canonical(home),a=canonical(away)
  const expectedH=canonical(input.home),expectedA=canonical(input.away)
  if(!h||!a||!expectedH||!expectedA)return'not-found'
  const same=h===expectedH&&a===expectedA
  const reverse=h===expectedA&&a===expectedH
  if(!same&&!reverse)return'not-found'
  const timeOK=dateOnly?when.slice(0,10)===input.date:inside90(when,input.kickoff)
  if(!timeOK)return'not-found'
  if(reverse)return'conflict'
  return dateOnly?'partial':'verified'
}
type EventRow={home:string;away:string;when:string}
const cache=new Map<string,{until:number;value:Promise<unknown>}>()
/** Cached only for the production transport. Unit tests with an injected fetch
 * never share cached values. Bounded cache prevents duplicated multi-leg calls.
 */
async function publicJson(url:string,fetcher:typeof fetch,now:number):Promise<unknown>{
  if(fetcher!==fetch)return getFeed<unknown>(url,fetcher)
  const existing=cache.get(url)
  if(existing&&existing.until>now)return existing.value
  if(cache.size>64)cache.clear()
  const value=getFeed<unknown>(url,fetcher).catch(err=>{cache.delete(url);throw err})
  cache.set(url,{until:now+10*60_000,value})
  return value
}
async function probe(provider:BackupFinding['provider'],url:string,
  rows:(json:unknown)=>unknown[],interpret:(r:unknown)=>EventRow,
  input:FreeFixture,fetcher:typeof fetch,now:number,dateOnly=false,
):Promise<BackupFinding>{
  const base={provider,url,checkedAt:checked(now)}
  try{
    const data=await publicJson(url,fetcher,now)
    const records=rows(data).slice(0,900)
    let conflict=false
    for(const raw of records){
      const parsed=interpret(raw)
      const status=compare(parsed.home,parsed.away,parsed.when,input,dateOnly)
      if(status==='verified'||status==='partial')
        return{...base,status,detail:status==='partial'?
          'Equipos y fecha corresponden, pero la fuente NO aporta UTC verificable: cotejo parcial':
          'Dos equipos, localía y horario coinciden; solo calendario corroborado'}
      if(status==='conflict')conflict=true
    }
    return{...base,status:conflict?'conflict':'not-found',
      detail:conflict?'La fuente invierte la localía: investigar discrepancia':
        'Sin coincidencia en esta fuente; su cobertura limitada NO prueba ausencia del partido'}
  }catch(e){
    return{...base,status:'unavailable',detail:'Proveedor no disponible: '+
      (e instanceof Error?e.message:String(e)).slice(0,120)}
  }
}

const optionalResponses=new Map<string,{until:number;value:Promise<unknown>}>()
const optionalBudgets=new Map<string,{
  minute:number;minuteCalls:number;day:number;dayCalls:number;cooldownUntil:number}>()
const providerLimits={
  'balldontlie':{perMinute:4,perDay:1000},
  'API-Football':{perMinute:8,perDay:80},
  'football-data.org':{perMinute:8,perDay:1000},
} as const
type OptionalProvider=keyof typeof providerLimits
/** One official, bounded, credential-scoped GET. Locally caches data and
 * respects quotas / Retry-After instead of retrying or bypassing 403/429.
 * Injected test fetches are isolated from production cache and rate budgets.
 */
async function optionalJson(provider:OptionalProvider,url:string,headers:Record<string,string>,
  secret:string,fetcher:typeof fetch,now:number):Promise<unknown>{
  const request=async(budgetKey:string|null):Promise<unknown>=>{
    // Every production API-Football request, not only ticket preflight, shares
    // the persisted 80/100 UTC quota budget. Injected test transports stay isolated.
    const transport=provider==='API-Football'&&fetcher===fetch?
      dailyResearchFetcher(fetcher,process.env,()=>now):fetcher
    const response=await transport(url,{headers,redirect:'error',signal:AbortSignal.timeout(8000)})
    if(!response.ok){
      if(budgetKey&&(response.status===429||response.status===503)){
        const raw=response.headers.get('retry-after')??''
        const seconds=Number(raw)
        const parsed=Number.isFinite(seconds)&&seconds>=0?seconds*1000:
          Number.isFinite(Date.parse(raw))?Date.parse(raw)-now:60_000
        const wait=Math.max(60_000,Math.min(30*60_000,parsed))
        const bucket=optionalBudgets.get(budgetKey)
        if(bucket)bucket.cooldownUntil=now+wait
      }
      if(budgetKey&&(response.status===401||response.status===403)){
        const bucket=optionalBudgets.get(budgetKey)
        if(bucket)bucket.cooldownUntil=now+15*60_000
      }
      throw Error('HTTP '+response.status)
    }
    if(Number(response.headers.get('content-length')||0)>3_000_000)
      throw Error('Respuesta superior al límite')
    const body=await response.text()
    if(body.length>3_000_000)throw Error('Respuesta superior al límite')
    return JSON.parse(body) as unknown
  }
  if(fetcher!==fetch)return request(null)
  const digest=createHash('sha256').update(secret).digest('hex').slice(0,20)
  const bucketKey=provider+':'+digest
  const cachedKey=bucketKey+':'+url
  const cached=optionalResponses.get(cachedKey)
  if(cached&&cached.until>now)return cached.value
  const minute=Math.floor(now/60_000),day=Math.floor(now/86_400_000)
  const budget=optionalBudgets.get(bucketKey)??{
    minute,minuteCalls:0,day,dayCalls:0,cooldownUntil:0}
  if(budget.minute!==minute){budget.minute=minute;budget.minuteCalls=0}
  if(budget.day!==day){budget.day=day;budget.dayCalls=0}
  if(budget.cooldownUntil>now)throw Error('Proveedor en enfriamiento por HTTP 429/403/503')
  const limit=providerLimits[provider]
  if(budget.minuteCalls>=limit.perMinute||budget.dayCalls>=limit.perDay)
    throw Error('Presupuesto local de peticiones agotado; use otro proveedor autorizado')
  budget.minuteCalls++
  budget.dayCalls++
  optionalBudgets.set(bucketKey,budget)
  if(optionalResponses.size>128)optionalResponses.clear()
  if(optionalBudgets.size>64)optionalBudgets.clear()
  const value=request(bucketKey).catch(err=>{optionalResponses.delete(cachedKey);throw err})
  optionalResponses.set(cachedKey,{until:now+10*60_000,value})
  return value
}

async function footballData(input:FreeFixture,fetcher:typeof fetch,
  now:number,token:string):Promise<BackupFinding>{
  const code=footballDataCompetitions[input.league]!
  const url='https://api.football-data.org/v4/competitions/'+code+
    '/matches?dateFrom='+input.date+'&dateTo='+input.date
  const base={provider:'FootballData.org' as const,url,checkedAt:checked(now)}
  try{
    // Credential is never embedded in a URL, cache key, card or audit detail.
    const data=await optionalJson('football-data.org',url,
      {'X-Auth-Token':token,accept:'application/json'},token,fetcher,now)
    const list=arr(obj(data).matches).slice(0,150)
    for(const row of list){
      const x=obj(row)
      const home=str(obj(x.homeTeam).name),away=str(obj(x.awayTeam).name)
      const status=compare(home,away,str(x.utcDate),input)
      if(status==='verified')return{...base,status,detail:
        'Competición, local/visita y hora confirmadas por FootballData.org'}
      if(status==='conflict')return{...base,status,detail:
        'Conflicto en local/visita con FootballData.org'}
    }
    return{...base,status:'not-found',detail:
      'Sin coincidencia bajo el plan gratuito; no confirma cancelación ni inexistencia'}
  }catch(e){
    return{...base,status:'unavailable',detail:
      'Proveedor sin acceso/mercado: '+(e instanceof Error?e.message:String(e)).slice(0,80)}
  }
}

/** Optional independent NBA/WNBA fixture corroboration.
 * Free tier provides games, teams and players (not injuries, props or box scores).
 * A provider key is never sent to the client or embedded in the URL.
 */
async function ballDontLieFixture(input:FreeFixture,fetcher:typeof fetch,now:number,
  key:string):Promise<BackupFinding>{
  const baseUrl=input.league==='wnba'?'https://api.balldontlie.io/wnba/v1/games':
    'https://api.balldontlie.io/v1/games'
  // Only one GET, without attempting to circumvent rate limits.
  const eventUtcDay=new Date(Date.parse(input.kickoff)).toISOString().slice(0,10)
  const days=[...new Set([input.date,eventUtcDay])]
  const url=baseUrl+'?'+days.map(day=>'dates%5B%5D='+day).join('&')+'&per_page=100'
  const base={provider:'balldontlie' as const,url,checkedAt:checked(now)}
  try{
    const root=obj(await optionalJson('balldontlie',url,
      {Authorization:key,accept:'application/json'},key,fetcher,now))
    for(const item of arr(root.data).slice(0,100)){
      const game=obj(item)
      const home=str(obj(game.home_team).full_name)
      const away=str(obj(game.visitor_team).full_name)
      const status=compare(home,away,str(game.date),input)
      if(status==='verified')return{...base,status,detail:
        'Calendario cotejado con balldontlie; sin inferir lesión, boxscore ni cuota'}
      if(status==='conflict')return{...base,status,detail:
        'balldontlie contradice la localía del partido'}
    }
    return{...base,status:'not-found',detail:
      'Sin coincidencia en la página gratuita recibida; no demuestra partido inexistente'}
  }catch(e){return{...base,status:'unavailable',detail:
    'balldontlie sin acceso: '+(e instanceof Error?e.message:String(e)).slice(0,80)}}
}
const apiFootballIds:Record<string,number>={
  'eng.1':39,'esp.1':140,'ger.1':78,'ita.1':135,'fra.1':61,
  'por.1':94,'ned.1':88,'usa.1':253,'mex.1':262,
  'bra.1':71,'arg.1':128,'uefa.champions':2,'uefa.europa':3,
}
/** Optional API-Football fixture check; free plans have limited seasons,
 * 100 requests/day and 10/min. Never substitute a paid-only response.
 */
async function apiFootballFixture(input:FreeFixture,fetcher:typeof fetch,now:number,
  key:string):Promise<BackupFinding>{
  const league=apiFootballIds[input.league]
  // API-Football fixture.date uses UTC; local-day labels can cross midnight.
  const utcDay=new Date(Date.parse(input.kickoff)).toISOString().slice(0,10)
  const year=Number(utcDay.slice(0,4))
  const month=Number(utcDay.slice(5,7))
  const season=['usa.1','mex.1','bra.1','arg.1'].includes(input.league)?
    year:year-(month<7?1:0)
  const url='https://v3.football.api-sports.io/fixtures?league='+league+
    '&season='+season+'&date='+utcDay
  const base={provider:'API-Football' as const,url,checkedAt:checked(now)}
  try{
    const root=obj(await optionalJson('API-Football',url,
      {'x-apisports-key':key},key,fetcher,now))
    if(Object.keys(obj(root.errors)).length>0||arr(root.errors).length>0)
      throw Error('Plan, temporada o cuota no habilitados')
    for(const item of arr(root.response).slice(0,300)){
      const row=obj(item),teams=obj(row.teams)
      const status=compare(str(obj(teams.home).name),str(obj(teams.away).name),
        str(obj(row.fixture).date),input)
      if(status==='verified')return{...base,status,detail:
        'Calendario y UTC corroborados; no implica cuota o alineación confirmada'}
      if(status==='conflict')return{...base,status,detail:
        'API-Football contradice local/visita en esta fecha'}
    }
    return{...base,status:'not-found',detail:
      'Sin cotejo en el plan/temporada consultada; no prueba ausencia del evento'}
  }catch(e){return{...base,status:'unavailable',detail:
    'API-Football no disponible: '+(e instanceof Error?e.message:String(e)).slice(0,80)}}
}


/** First-party MLB schedule and NHL web scoreboard: verified fixture identity
 * and start time only. These sources do NOT publish book-specific prices here.
 */
const nhlName=(team:unknown):string=>{
  const item=obj(team)
  const direct=str(obj(item.name).default)||str(item.name)
  if(direct)return direct
  const place=str(obj(item.placeName).default)||str(item.placeName)
  const mascot=str(obj(item.commonName).default)||str(item.commonName)
  return [place,mascot].filter(Boolean).join(' ')
}

/** nflverse nfldata publishes schedules as a community-maintained CC BY 4.0
 * CSV. It contains local calendar dates without a guaranteed UTC kickoff; its
 * corroboration is ALWAYS partial. Avoid claiming that CSV lines are odds.
 * Source: https://github.com/nflverse/nfldata/blob/master/data/games.csv
 */
const nflTeams:Readonly<Record<string,string>>={
  ARI:'Arizona Cardinals',ATL:'Atlanta Falcons',BAL:'Baltimore Ravens',
  BUF:'Buffalo Bills',CAR:'Carolina Panthers',CHI:'Chicago Bears',
  CIN:'Cincinnati Bengals',CLE:'Cleveland Browns',DAL:'Dallas Cowboys',
  DEN:'Denver Broncos',DET:'Detroit Lions',GB:'Green Bay Packers',
  HOU:'Houston Texans',IND:'Indianapolis Colts',JAX:'Jacksonville Jaguars',
  KC:'Kansas City Chiefs',LA:'Los Angeles Rams',LAC:'Los Angeles Chargers',
  LV:'Las Vegas Raiders',MIA:'Miami Dolphins',MIN:'Minnesota Vikings',
  NE:'New England Patriots',NO:'New Orleans Saints',NYG:'New York Giants',
  NYJ:'New York Jets',PHI:'Philadelphia Eagles',PIT:'Pittsburgh Steelers',
  SEA:'Seattle Seahawks',SF:'San Francisco 49ers',TB:'Tampa Bay Buccaneers',
  TEN:'Tennessee Titans',WAS:'Washington Commanders',
}
const nflCode=(name:string):string=>
  Object.keys(nflTeams).find(key=>canonical(nflTeams[key]!)===canonical(name))??''
const nflCsvUrl='https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
let nflCsvCache:{until:number;value:Promise<string>}|null=null
async function loadNflCsv(fetcher:typeof fetch,now:number):Promise<string>{
  if(fetcher===fetch&&nflCsvCache&&nflCsvCache.until>now)
    return nflCsvCache.value
  const request=(async()=>{
    const response=await fetcher(nflCsvUrl,{headers:{accept:'text/csv'},
      redirect:'error',signal:AbortSignal.timeout(8_000)})
    if(!response.ok)throw Error('HTTP '+response.status)
    if(Number(response.headers.get('content-length')||0)>3_000_000)
      throw Error('NFL CSV supera el máximo de 3 MB')
    const body=await response.text()
    if(body.length>3_000_000)throw Error('NFL CSV supera el máximo de 3 MB')
    if(!body.startsWith('game_id,')||!body.includes(',home_team,'))
      throw Error('NFL CSV sin columnas verificables')
    return body
  })()
  if(fetcher!==fetch)return request
  nflCsvCache={until:now+20*60_000,value:request}
  try{return await request}catch(e){nflCsvCache=null;throw e}
}
async function nflverseFixture(input:FreeFixture,fetcher:typeof fetch,
  now:number):Promise<BackupFinding>{
  const base={provider:'nflverse schedules' as const,url:nflCsvUrl,checkedAt:checked(now)}
  try{
    const csv=await loadNflCsv(fetcher,now)
    const lines=csv.split(/\r?\n/u)
    const columns=lines[0]!.split(',')
    const at=(name:string)=>columns.indexOf(name)
    const gameDate=at('gameday'),home=at('home_team'),
      away=at('away_team'),espn=at('espn')
    if([gameDate,home,away].some(i=>i<0))throw Error('NFL CSV sin columnas obligatorias')
    const homeCode=nflCode(input.home),awayCode=nflCode(input.away)
    if(!homeCode||!awayCode)return{...base,status:'not-found',
      detail:'Equipo NFL sin correspondencia confirmada: no se inventó abreviatura'}
    let reversed=false
    // Recent calendar rows only: bounded scan of ~four seasons, no mass API.
    for(const line of lines.slice(-1200)){
      if(!line)continue
      const cells=line.split(',')
      if(cells[gameDate]!==input.date)continue
      const recordedId=espn>=0?(cells[espn]??'').trim():''
      if(recordedId&&/^\d{7,16}$/u.test(input.eventId)&&
        recordedId!==input.eventId)continue
      if(cells[home]===homeCode&&cells[away]===awayCode)
        return{...base,status:'partial',
          detail:'Equipos/localía y fecha coinciden con nflverse (CC BY 4.0); horario UTC NO corroborado'}
      if(cells[home]===awayCode&&cells[away]===homeCode)reversed=true
    }
    return{...base,status:reversed?'conflict':'not-found',
      detail:reversed?'nflverse contradice localía; revisar el evento':
        'Sin partido cotejado en CSV de cobertura reciente; no demuestra ausencia'}
  }catch(e){return{...base,status:'unavailable',
    detail:'nflverse no accesible: '+(e instanceof Error?e.message:String(e)).slice(0,110)}}
}

/** Sources are independent checks, never sources of fresh bookmaker odds.
 * A no-key football.json JSON file has local kickoff times, NOT validated UTC;
 * it can only corroborate date and teams. Optional key is server-side.
 */
export async function crosscheckFreeFixture(input:FreeFixture,
  fetcher:typeof fetch=fetch,now=Date.now(),
  env:NodeJS.ProcessEnv=process.env):Promise<BackupFinding[]>{
  if(!validDate(input.date)||!Number.isFinite(Date.parse(input.kickoff))||
    !input.home.trim()||!input.away.trim())throw Error('Partido secundario inválido')
  if(env.PHOENIX_SPORTS_FREE_BACKUPS_DISABLED==='1')return[]
  const reports:Promise<BackupFinding>[]=[]
  const kind=sportNames[input.sport]
  if(kind){
    const url='https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d='+
      input.date+'&s='+encodeURIComponent(kind)
    reports.push(probe('TheSportsDB',url,x=>arr(obj(x).events),x=>{
      const o=obj(x)
      return{home:str(o.strHomeTeam),away:str(o.strAwayTeam),
        when:str(o.strTimestamp)||str(o.dateEvent)}
    },input,fetcher,now))
  }
  if(input.sport==='baseball'&&input.league==='mlb'){
    const url='https://statsapi.mlb.com/api/v1/schedule?sportId=1&date='+input.date
    reports.push(probe('MLB StatsAPI',url,x=>
      arr(obj(x).dates).flatMap(d=>arr(obj(d).games)),x=>{
      const game=obj(x),teams=obj(game.teams)
      return{home:str(obj(obj(teams.home).team).name),
        away:str(obj(obj(teams.away).team).name),when:str(game.gameDate)}
    },input,fetcher,now))
  }
  if(input.sport==='hockey'&&input.league==='nhl'){
    const url='https://api-web.nhle.com/v1/score/'+input.date
    reports.push(probe('NHL Web API',url,x=>arr(obj(x).games),x=>{
      const game=obj(x)
      return{home:nhlName(game.homeTeam),away:nhlName(game.awayTeam),
        when:str(game.startTimeUTC)}
    },input,fetcher,now))
  }
  if(input.sport==='football'&&input.league==='nfl')
    reports.push(nflverseFixture(input,fetcher,now))
  const bdlKey=env.PHOENIX_BALLDONTLIE_API_KEY?.trim()
  if(input.sport==='basketball'&&(input.league==='nba'||input.league==='wnba')&&bdlKey)
    reports.push(ballDontLieFixture(input,fetcher,now,bdlKey))
  if(input.sport==='soccer'&&input.league==='ger.1'){
    const year=Number(input.date.slice(0,4))-(Number(input.date.slice(5,7))<7?1:0)
    const url='https://api.openligadb.de/getmatchdata/bl1/'+year
    reports.push(probe('OpenLigaDB',url,arr,x=>{
      const o=obj(x)
      return{home:str(obj(o.team1).teamName),away:str(obj(o.team2).teamName),
        when:str(o.matchDateTimeUTC)||str(o.matchDateTime)}
    },input,fetcher,now))
  }
  if(input.sport==='soccer'){
    const file=footballJsonLeagues[input.league]
    if(file){
      const year=Number(input.date.slice(0,4))-(Number(input.date.slice(5,7))<7?1:0)
      const url='https://raw.githubusercontent.com/openfootball/football.json/master/'+
        year+'-'+String(year+1).slice(-2)+'/'+file+'.json'
      reports.push(probe('OpenFootball',url,x=>arr(obj(x).matches),x=>{
        const o=obj(x)
        return{home:str(o.team1),away:str(o.team2),when:str(o.date)}
      },input,fetcher,now,true))
    }
    const apiKey=env.PHOENIX_API_FOOTBALL_KEY?.trim()
    if(apiKey&&apiFootballIds[input.league])
      reports.push(apiFootballFixture(input,fetcher,now,apiKey))
    const token=env.PHOENIX_FOOTBALL_DATA_TOKEN?.trim()
    if(token&&footballDataCompetitions[input.league])
      reports.push(footballData(input,fetcher,now,token))
  }
  return Promise.all(reports)
}
export function freeOfficialFollowUps(sport:string,date:string):string[]{
  if(!validDate(date))return[]
  if(sport==='basketball'){
    const year=Number(date.slice(0,4))-(Number(date.slice(5,7))<7?1:0)
    return['NBA: informe oficial, verificar jugador, fecha/hora y estado: '+
      'https://official.nba.com/nba-injury-report-'+year+'-'+String(year+1).slice(-2)+'-season/']
  }
  if(sport==='football')return[
    'NFL: inactivos y QB oficiales por comprobar; lesiones nflverse '+
    'https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html']
  if(sport==='hockey')return[
    'NHL: confirmar portero anunciado con club y reglas OT; roster no confirma titular']
  return[]
}
/** Auditable source inventory. A catalog entry is NEVER proof that the source
 * worked for the specific fixture, or that its free tier covers the data.
 */
export const freeSourceInventory=[
  {name:'ESPN Site/Core',access:'no-key',sport:'multi',capability:'fixtures,results,rosters',state:'primary'},
  {name:'MLB StatsAPI',access:'no-key',sport:'baseball',capability:'fixtures,probable pitchers,stats',state:'primary'},
  {name:'NHL Web API',access:'no-key',sport:'hockey',capability:'fixtures,rosters,stats',state:'primary'},
  {name:'TheSportsDB',access:'public-key-123',sport:'multi',capability:'secondary fixtures,partial free',state:'integrated'},
  {name:'OpenLigaDB',access:'no-key',sport:'soccer',capability:'Bundesliga fixtures',state:'integrated'},
  {name:'OpenFootball',access:'no-key',sport:'soccer',capability:'multi-league calendar/historical CC0',state:'integrated'},
  {name:'football-data.org',access:'free-key-optional',sport:'soccer',capability:'fixture matching of seven leagues',state:'integrated-opt-in'},
  {name:'nflverse',access:'no-key',sport:'football',capability:'weekly injury CSV',state:'integrated'},
  {name:'nflverse schedules',access:'no-key-cc-by',sport:'football',capability:'NFL schedule and home/away/date only; partial without UTC',state:'integrated'},
  {name:'NBA Official Injury Report',access:'public-web',sport:'basketball',capability:'official player status',state:'manual-followup'},
  {name:'StatsBomb Open Data',access:'no-key',sport:'soccer',capability:'licensed historical xG/events; limited seasons',state:'historical-only'},
  {name:'The Odds API v4',access:'free-key-optional',sport:'multi',capability:'markets/prices',state:'existing-opt-in'},
  {name:'TheOddsAPI',access:'free-key-optional',sport:'nba-mlb',capability:'moneyline',state:'existing-opt-in'},
  {name:'OddsHarvester',access:'operator-opt-in',sport:'multi',capability:'market observation where allowed',state:'existing-opt-in'},
  {name:'Open-Meteo',access:'no-key-noncommercial',sport:'multi',capability:'weather',state:'existing'},
  {name:'Jolpica F1',access:'no-key',sport:'racing',capability:'F1 results/standings',state:'catalog-only'},
  {name:'OpenF1',access:'no-key-historical',sport:'racing',capability:'F1 telemetry; live may be paid',state:'catalog-only'},
  {name:'SportScore',access:'no-key-attribution',sport:'multi',capability:'scores/stats with UI attribution required',state:'catalog-only'},
  {name:'API-Football',access:'free-key-optional',sport:'soccer',capability:'fixture UTC by league where free season allows, 100/day',state:'integrated-opt-in'},
  {"name":"NBA Stats / LiveData","access":"no-key-restricted","sport":"basketball","capability":"NBA boxscores/play-by-play; bloqueo 403/timeout posible","state":"catalog-only"},
  {"name":"WNBA Stats","access":"no-key-restricted","sport":"basketball","capability":"WNBA estadísticas, LeagueID=10; acceso externo no garantizado","state":"catalog-only"},
  {"name":"balldontlie","access":"free-key-optional","sport":"basketball","capability":"NBA/WNBA juegos gratuitos con key, 5/min; no props, boxscore ni lesiones","state":"integrated-opt-in"},
  {"name":"Basketball Reference","access":"public-web","sport":"basketball","capability":"estadística histórica y comparaciones web; no API abierta oficial","state":"manual-followup"},
  {"name":"College Football Data","access":"free-key-optional","sport":"football","capability":"NCAA football histórico y analítica; cuotas/plan por verificar","state":"catalog-only"},
  {"name":"NFL Official Gamebooks","access":"public-web","sport":"football","capability":"actas, inactivos y reportes oficiales; páginas/PDF","state":"manual-followup"},
  {"name":"nflverse Play-by-Play","access":"public-files","sport":"football","capability":"EPA, jugadas, rosters y calendarios con frescura por dataset","state":"historical-only"},
  {"name":"Fantasy Premier League","access":"no-key-restricted","sport":"soccer","capability":"estadística y disponibilidad Premier League; CORS/no oficial","state":"catalog-only"},
  {"name":"Understat","access":"public-web","sport":"soccer","capability":"xG y tiros en ciertas ligas; sin API pública garantizada","state":"manual-followup"},
  {"name":"ATPTour Official","access":"public-web","sport":"tennis","capability":"marcadores, cuadros, superficies y rankings; sin API libre estable","state":"manual-followup"},
  {"name":"WTA Official","access":"public-web","sport":"tennis","capability":"marcadores y clasificaciones; sin API libre estable","state":"manual-followup"},
  {"name":"Sackmann ATP/WTA Archive","access":"public-files-noncommercial","sport":"tennis","capability":"CSV histórico y rankings; atribución/licencia CC BY-NC-SA","state":"historical-only"},
  {"name":"Official Formula 1","access":"public-web","sport":"racing","capability":"calendario y resultados; verificar licencia de datos","state":"manual-followup"},
  {"name":"NASCAR Official Results","access":"public-web","sport":"racing","capability":"clasificaciones y resultados en web; no API pública garantizada","state":"manual-followup"},
  {"name":"Cricsheet","access":"public-files","sport":"cricket","capability":"histórico bola por bola de competiciones cubiertas","state":"historical-only"},
  {"name":"ESPNcricinfo","access":"public-web","sport":"cricket","capability":"marcadores y crónicas; acceso automatizado sujeto a condiciones","state":"manual-followup"},
  {"name":"World Rugby","access":"public-web","sport":"rugby","capability":"calendario, resultados y selecciones; no API abierta garantizada","state":"manual-followup"},
  {"name":"NRL Official","access":"public-web","sport":"rugby-league","capability":"resultados y estadísticas NRL; sin API estable publicada","state":"manual-followup"},
  {"name":"AFL Official","access":"public-web","sport":"australian-football","capability":"resultados y estadísticas AFL; no API libre garantizada","state":"manual-followup"},
  {"name":"PGA TOUR","access":"public-web","sport":"golf","capability":"clasificación y resultados de torneos; uso sujeto a términos","state":"manual-followup"},
  {"name":"LPGA","access":"public-web","sport":"golf","capability":"resultados y tabla de clasificación; uso sujeto a términos","state":"manual-followup"},
  {"name":"UFCStats","access":"public-web","sport":"mma","capability":"historial de peleas y luchadores; interfaz web no API abierta","state":"manual-followup"},
  {"name":"PFL Official","access":"public-web","sport":"mma","capability":"calendario y resultados de artes marciales mixtas","state":"manual-followup"},
  {"name":"PLL Official","access":"public-web","sport":"lacrosse","capability":"partidos y estadísticas de Premier Lacrosse League","state":"manual-followup"},
  {"name":"NCAA Volleyball","access":"public-web","sport":"volleyball","capability":"resultados NCAA; no API libre documentada","state":"manual-followup"},
  {"name":"NCAA Water Polo","access":"public-web","sport":"water-polo","capability":"calendario y resultados NCAA; no API libre documentada","state":"manual-followup"},
  {"name":"NCAA Field Hockey","access":"public-web","sport":"field-hockey","capability":"resultados NCAA; no API libre documentada","state":"manual-followup"},
  {"name":"LIDOM Oficial","access":"public-web","sport":"baseball","capability":"béisbol invernal RD; resultados y rosters, web, no API garantizada","state":"manual-followup"},
  {"name":"Serie del Caribe Oficial","access":"public-web","sport":"baseball","capability":"calendario y resultados; cobertura manual","state":"manual-followup"},
  {"name":"NCAA Basketball","access":"public-web","sport":"basketball","capability":"estadísticas y torneos NCAA; web, sin API libre estable","state":"manual-followup"},
] as const

/** Discipline-aware coverage, NOT a claim of successful HTTP access.
 * A listed reference never becomes a live adapter just by being catalogued.
 * Respect 403/429, published limits, licensing and source provenance.
 */
export function freeSourceCoverageForSport(sport:string,env:NodeJS.ProcessEnv=process.env){
  if(!Object.hasOwn(sportsCatalog,sport))return{sport,supported:false,
    wired:[] as string[],configuredOptional:[] as string[],
    unconfiguredOptional:[] as string[],referenceOnly:[] as string[],
    caveats:['Disciplina fuera del catálogo ESPN de PHOENIX']}
  const rows=freeSourceInventory.filter(p=>p.sport==='multi'||p.sport===sport||
    (p.sport==='nba-mlb'&&(sport==='basketball'||sport==='baseball')))
  const wired:string[]=[],configuredOptional:string[]=[],
    unconfiguredOptional:string[]=[],referenceOnly:string[]=[]
  for(const source of rows){
    const key=source.name==='football-data.org'?'PHOENIX_FOOTBALL_DATA_TOKEN':
      source.name==='API-Football'?'PHOENIX_API_FOOTBALL_KEY':
      source.name==='balldontlie'?'PHOENIX_BALLDONTLIE_API_KEY':
      source.name==='The Odds API v4'?'THE_ODDS_API_KEY':
      source.name==='TheOddsAPI'?'THEODDSAPI_API_KEY':null
    // TheSportsDB fixture crosscheck currently maps six sports only.
    // Other sports are listed as references until an event schema is implemented.
    if(source.name==='TheSportsDB'&&!['soccer','basketball','baseball',
      'football','hockey','tennis'].includes(sport)){
      referenceOnly.push(source.name+' (sin adaptador de cotejo en esta disciplina)')
      continue
    }
    const isPrimary=source.state==='primary'
    const isWired=source.state==='integrated'||source.state==='existing'||isPrimary
    const isOptional=source.state==='integrated-opt-in'||source.state==='existing-opt-in'
    if(isPrimary&&((source.name==='ESPN Site/Core'&&env.PHOENIX_SPORTS_ESPN_DISABLED==='1')||
      (source.name==='MLB StatsAPI'&&env.PHOENIX_SPORTS_MLB_DISABLED==='1'))){
      unconfiguredOptional.push(source.name+' (deshabilitado por operador)')
    }else if(source.state==='integrated'&&env.PHOENIX_SPORTS_FREE_BACKUPS_DISABLED==='1'){
      unconfiguredOptional.push(source.name+' (respaldos deshabilitados)')
    }else if(isWired)wired.push(source.name)
    else if(isOptional){
      if(key&&!!env[key]?.trim())configuredOptional.push(source.name)
      else unconfiguredOptional.push(source.name)
    }else referenceOnly.push(source.name)
  }
  return{sport,supported:true,wired,configuredOptional,unconfiguredOptional,
    referenceOnly,caveats:[
      'Conectado/configurado NO significa respuesta HTTP verificada para este partido.',
      '403/429 y cuotas agotadas no autorizan evadir bloqueos ni fabricar datos.',
      'Fuente histórica o enlace público NO confirma precio, lesión o titular del día.',
    ]}
}
