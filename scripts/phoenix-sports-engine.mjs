/**
 * Phoenix Sports Intelligence: source discovery, provenance, schedules and odds.
 * Standalone, dependency-free Node 22+ module. No wagering, no prediction promises.
 * Provider access requires the operator to confirm applicable terms and licenses.
 */
export const SPORTS = Object.freeze({
  soccer: ['eng.1','esp.1','mex.1','usa.1','uefa.champions','fifa.world','bra.1','arg.1'],
  basketball: ['nba','wnba','mens-college-basketball','womens-college-basketball'],
  baseball: ['mlb','dominican-winter-league','caribbean-series','world-baseball-classic'],
  football: ['nfl','college-football','cfl','ufl'],
  hockey: ['nhl','mens-college-hockey'],
  tennis: ['atp','wta'],
  mma: ['ufc','pfl','bellator'],
  racing: ['f1','irl','nascar-premier'],
  golf: ['pga','lpga','eur','liv'],
  rugby: [],
  'rugby-league': ['3'],
  cricket: [],
  lacrosse: ['pll','nll','mens-college-lacrosse'],
  volleyball: ['mens-college-volleyball','womens-college-volleyball'],
  'water-polo': ['mens-college-water-polo','womens-college-water-polo'],
  'field-hockey': ['womens-college-field-hockey'],
  'australian-football': ['afl'],
})
const SOURCE_DEFS = Object.freeze([
  {id:'espn',title:'ESPN Site/Core',uses:['scoreboards','events','teams','athletes'],env:'PHOENIX_SPORTS_ESPN_ALLOWED',licensed:false,docs:'https://github.com/pseudo-r/Public-ESPN-API'},
  {id:'mlb',title:'MLB Stats API',uses:['schedule','probable pitchers','venue'],env:'PHOENIX_SPORTS_MLB_ALLOWED',licensed:false,docs:'https://statsapi.mlb.com/'},
  {id:'the-odds-api',title:'The Odds API',uses:['sports discovery','bookmaker odds','player props'],env:'THE_ODDS_API_KEY',licensed:true,docs:'https://the-odds-api.com/liveapi/guides/v4/'},
  {id:'football-data',title:'football-data.org',uses:['football fixtures','standings'],env:'FOOTBALL_DATA_API_KEY',licensed:true,docs:'https://www.football-data.org/documentation/api'},
  {id:'sportradar',title:'Sportradar',uses:['deep game stats','odds','data feeds'],env:'SPORTRADAR_API_KEY',licensed:true,docs:'https://developer.sportradar.com/'},
  {id:'sportsdataio',title:'SportsDataIO',uses:['statistics','betting markets','historical data'],env:'SPORTSDATAIO_API_KEY',licensed:true,docs:'https://sportsdata.io/developers'},
])
const allowedHosts = new Set(['site.api.espn.com','sports.core.api.espn.com','statsapi.mlb.com','api.the-odds-api.com'])
const safeSlug = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,79}$/u.test(value)
const clamp = (n,lo,hi) => Math.max(lo,Math.min(hi,n))
export const SOURCES = SOURCE_DEFS
export function sourceAuthorization(id,env=process.env) {
  const d=SOURCE_DEFS.find(s=>s.id===id)
  if (!d) return false
  if (d.licensed) return typeof env[d.env]==='string' && env[d.env].trim().length>0
  return env[d.env]==='1'
}
/** Reliability score reflects observed responses, never predicted game accuracy. */
export function sourceScore(row,authorized=true,now=Date.now()) {
  if (!authorized || !row || row.quarantined) return {score:0,status:authorized?'quarantined':'not-authorized'}
  const n=row.successes+row.failures
  if (!n) return {score:50,status:'unverified'}
  const reliability=(row.successes+1)/(n+2)
  const age=Math.max(0,now-(row.lastSuccessAt||0))
  const fresh=row.lastSuccessAt ? Math.exp(-age/(12*60*60*1000)) : 0
  const complete=clamp(row.completenessTotal/Math.max(row.successes,1),0,1)
  const agreement=row.comparisonCount?clamp(row.agreementTotal/row.comparisonCount,0,1):0.5
  const score=Math.round(100*(.45*reliability+.25*fresh+.2*complete+.1*agreement))
  return {score,status:row.failures>=3 && row.failures>row.successes?'degraded':score>=75?'preferred':score>=45?'monitor':'degraded'}
}
export function emptySourceRecord(id) {
  return {id,successes:0,failures:0,consecutiveFailures:0,completenessTotal:0,agreementTotal:0,comparisonCount:0,lastSuccessAt:null,lastFailureAt:null,quarantined:false}
}
export function observeSource(record,{ok,completeness=0,agreement=null,at=Date.now()}) {
  if (!Number.isFinite(at)) throw new TypeError('Invalid observation time')
  const row={...record}
  if (ok) {
    row.successes++;row.consecutiveFailures=0
    row.completenessTotal+=clamp(Number(completeness)||0,0,1);row.lastSuccessAt=at
    if (agreement!==null) {row.agreementTotal+=clamp(Number(agreement)||0,0,1);row.comparisonCount++}
  } else {
    row.failures++;row.consecutiveFailures++;row.lastFailureAt=at
    if (row.consecutiveFailures>=5) row.quarantined=true
  }
  return row
}
export function gameDate(date) {
  const d=date||new Date().toISOString().slice(0,10)
  if (typeof d!=='string'|| !/^\d{4}-\d{2}-\d{2}$/u.test(d)||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d) throw new TypeError('Fecha inválida: AAAA-MM-DD')
  return d
}
/** The only supported network destinations are fixed provider domains; redirects are denied. */
export async function getJSON(url,{fetcher=fetch,headers={},timeoutMs=9000}={}) {
  const u=new URL(url)
  if(u.protocol!=='https:'||!allowedHosts.has(u.hostname)||u.username||u.password) throw new Error('Proveedor no autorizado')
  const response=await fetcher(u.toString(),{headers:{accept:'application/json',...headers},redirect:'error',signal:AbortSignal.timeout(timeoutMs)})
  if(!response.ok) throw new Error('Proveedor HTTP '+response.status)
  const length=Number(response.headers?.get?.('content-length')||0)
  if(length>4_000_000) throw new Error('Respuesta superior a 4 MB')
  const raw=await response.text()
  if(raw.length>4_000_000) throw new Error('Respuesta superior a 4 MB')
  return JSON.parse(raw)
}
const competitor=(c={})=>({id:String(c.team?.id||c.id||''),name:c.team?.displayName||c.team?.name||c.displayName||'Sin confirmar',abbrev:c.team?.abbreviation||'',logo:c.team?.logo||c.team?.logos?.[0]?.href||null,score:c.score??null,record:c.records?.[0]?.summary||null})
export function normalizeEspn(data,{sport,league,source='espn'}={}) {
  if(!Array.isArray(data?.events)) throw new Error('ESPN: formato de eventos no válido')
  return data.events.map(e=>{
    const c=e.competitions?.[0]||{},rows=c.competitors||[]
    const home=rows.find(x=>x.homeAway==='home'),away=rows.find(x=>x.homeAway==='away')
    return {id:String(e.id),sport,league,date:e.date||null,name:e.name||null,status:e.status?.type?.description||'Sin confirmar',home:competitor(home),away:competitor(away),venue:c.venue?.fullName||e.venue?.fullName||null,city:c.venue?.address?.city||null,broadcasts:(c.broadcasts||[]).flatMap(x=>x.names||[]),source,sourceUrl:null,pitchers:[],players:[],lastVerifiedAt:new Date().toISOString()}
  })
}
export function normalizeMlb(data,{imageLicensed=false}={}) {
  if(!Array.isArray(data?.dates)) throw new Error('MLB: formato de calendario no válido')
  return data.dates.flatMap(d=>(d.games||[]).map(g=>{
    const p=x=>x?.probablePitcher?{id:String(x.probablePitcher.id||''),name:x.probablePitcher.fullName||'Sin confirmar',headshot:imageLicensed&&x.probablePitcher.id?'https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/'+encodeURIComponent(x.probablePitcher.id)+'/headshot/67/current':null,confirmed:false}:null
    return {id:String(g.gamePk),sport:'baseball',league:'mlb',date:g.gameDate||null,name:g.teams?.away?.team?.name+' vs '+g.teams?.home?.team?.name,status:g.status?.detailedState||'Sin confirmar',home:{id:String(g.teams?.home?.team?.id||''),name:g.teams?.home?.team?.name||'Sin confirmar',score:g.teams?.home?.score??null,logo:null},away:{id:String(g.teams?.away?.team?.id||''),name:g.teams?.away?.team?.name||'Sin confirmar',score:g.teams?.away?.score??null,logo:null},venue:g.venue?.name||null,city:g.venue?.location?.city||null,broadcasts:[],source:'mlb',pitchers:[p(g.teams?.away),p(g.teams?.home)].filter(Boolean),players:[],lastVerifiedAt:new Date().toISOString()}
  }))
}
export async function fetchGames({sport='baseball',league='mlb',date,env=process.env,fetcher=fetch}={}) {
  if(!Object.hasOwn(SPORTS,sport)||!safeSlug(league)) throw new TypeError('Deporte o liga no reconocidos')
  const day=gameDate(date),compact=day.replaceAll('-','')
  if(sport==='baseball'&&league==='mlb'&&sourceAuthorization('mlb',env)){
    const url='https://statsapi.mlb.com/api/v1/schedule?sportId=1&date='+day+'&hydrate=probablePitcher,venue'
    return {source:'mlb',games:normalizeMlb(await getJSON(url,{fetcher}),{imageLicensed:env.PHOENIX_SPORTS_MLB_IMAGES_ALLOWED==='1'})}
  }
  if(!sourceAuthorization('espn',env)) throw new Error('No hay proveedor de resultados habilitado. Confirma licencia/condiciones y configura PHOENIX_SPORTS_ESPN_ALLOWED=1 o PHOENIX_SPORTS_MLB_ALLOWED=1 para MLB.')
  const url='https://site.api.espn.com/apis/site/v2/sports/'+encodeURIComponent(sport)+'/'+encodeURIComponent(league)+'/scoreboard?dates='+compact
  return {source:'espn',games:normalizeEspn(await getJSON(url,{fetcher}),{sport,league})}
}
export async function discoverLeagues(sport,{env=process.env,fetcher=fetch}={}) {
  if(!Object.hasOwn(SPORTS,sport)) throw new TypeError('Deporte no reconocido')
  if(!sourceAuthorization('espn',env)) throw new Error('ESPN no autorizado para descubrimiento')
  const url='https://sports.core.api.espn.com/v2/sports/'+encodeURIComponent(sport)+'/leagues?limit=500'
  const data=await getJSON(url,{fetcher})
  const items=Array.isArray(data.items)?data.items:[]
  const slugs=items.map(x=>x.slug||x.$ref?.match(/\/leagues\/([^/?#]+)/u)?.[1]||x.abbreviation?.toLowerCase()).filter(safeSlug)
  return [...new Set(slugs)].slice(0,500).map(slug=>({sport,league:slug,source:'espn',state:'candidate',verifiedAt:new Date().toISOString()}))
}
export async function discoverOddsSports({env=process.env,fetcher=fetch}={}) {
  if(!sourceAuthorization('the-odds-api',env)) throw new Error('THE_ODDS_API_KEY no configurada')
  const u=new URL('https://api.the-odds-api.com/v4/sports/')
  u.searchParams.set('apiKey',env.THE_ODDS_API_KEY)
  const data=await getJSON(u.toString(),{fetcher})
  if(!Array.isArray(data)) throw new Error('Catálogo de odds inválido')
  return data.filter(x=>safeSlug(x.key)).map(x=>({key:x.key,title:x.title||x.key,active:!!x.active,group:x.group||'',source:'the-odds-api',state:'candidate'}))
}
const decimalPrice=p=>p>1&&Number.isFinite(p)?p:null
export function normalizeOdds(data,{sportKey}={}) {
  if(!Array.isArray(data)) throw new Error('Cuotas: formato inválido')
  return data.flatMap(event=>(event.bookmakers||[]).flatMap(book=>(book.markets||[]).flatMap(market=>(market.outcomes||[]).map(o=>{
    const price=decimalPrice(Number(o.price))
    if(!price) return null
    return {eventId:String(event.id),sportKey:sportKey||event.sport_key,start:event.commence_time,home:event.home_team,away:event.away_team,bookmaker:book.title||book.key,market:market.key,selection:o.name,point:o.point??null,decimalOdds:price,updatedAt:market.last_update||book.last_update||null,source:'the-odds-api'}
  })))).filter(Boolean)
}
export async function fetchOdds(sportKey,{env=process.env,fetcher=fetch,region='us',markets='h2h'}={}) {
  if(!sourceAuthorization('the-odds-api',env)) throw new Error('Cuotas no configuradas (THE_ODDS_API_KEY)')
  if(!safeSlug(sportKey)||!/^[a-z0-9,]{2,20}$/u.test(region)||!/^(h2h|spreads|totals)(,(h2h|spreads|totals))*$/u.test(markets)) throw new TypeError('Filtro de odds inválido')
  const u=new URL('https://api.the-odds-api.com/v4/sports/'+encodeURIComponent(sportKey)+'/odds/')
  for(const [key,value] of Object.entries({apiKey:env.THE_ODDS_API_KEY,regions:region,markets,oddsFormat:'decimal'}))u.searchParams.set(key,value)
  return normalizeOdds(await getJSON(u.toString(),{fetcher}),{sportKey})
}
export function evaluateSelection({decimalOdds,estimatedProbability=null}) {
  const odds=Number(decimalOdds)
  if(!Number.isFinite(odds)||odds<=1||odds>100000) throw new RangeError('Cuota decimal inválida')
  const implied=1/odds
  if(estimatedProbability===null||estimatedProbability===undefined) return {impliedProbability:implied,estimatedProbability:null,edge:null,expectedValue:null}
  const p=Number(estimatedProbability)
  if(!Number.isFinite(p)||p<=0||p>=1) throw new RangeError('Probabilidad estimada inválida')
  return {impliedProbability:implied,estimatedProbability:p,edge:p-implied,expectedValue:p*odds-1}
}
export function quoteTicket(legs,{stake=0}={}) {
  if(!Array.isArray(legs)||legs.length<1||legs.length>12) throw new RangeError('Se requieren entre 1 y 12 selecciones')
  const amount=Number(stake)
  if(!Number.isFinite(amount)||amount<0||amount>1000000) throw new RangeError('Monto inválido')
  const ids=new Set()
  let combined=1
  let correlated=false
  let jointP=1
  for(const leg of legs){
    if(!leg||typeof leg.eventId!=='string'||!leg.eventId||typeof leg.selection!=='string'||!leg.selection)throw new TypeError('Selección incompleta')
    const key=[leg.eventId,leg.market,leg.selection,leg.point].join(':')
    if(ids.has(key))throw new Error('Selección duplicada')
    ids.add(key)
    const e=evaluateSelection(leg);combined*=Number(leg.decimalOdds)
    if(e.estimatedProbability===null) jointP=null
    else if(jointP!==null) jointP*=e.estimatedProbability
  }
  correlated=new Set(legs.map(l=>l.eventId)).size!==legs.length
  if(correlated) jointP=null
  return {legs:legs.length,decimalOdds:Number(combined.toFixed(4)),stake:amount,grossPotential:Number((amount*combined).toFixed(2)),netPotential:Number((amount*(combined-1)).toFixed(2)),jointEstimatedProbability:jointP,expectedValue:jointP===null?null:jointP*combined-1,correlationWarning:correlated?'Selecciones del mismo evento: no se puede multiplicar probabilidades sin un modelo conjunto.':null,status:'simulation-only',placed:false,guaranteed:false}
}
