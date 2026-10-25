/** Read-only sports information adapters for Kira's conversation tools. */
import { fetchPublicEspnOdds } from './espn-odds.ts'
/** Canonical supported sport identifiers and initial league slugs used for provider discovery. */
export const sportsCatalog: Readonly<Record<string, readonly string[]>> = {
  soccer: ['eng.1','esp.1','mex.1','usa.1','uefa.champions','fifa.world'],
  basketball: ['nba','wnba','mens-college-basketball'],
  baseball: ['mlb','dominican-winter-league','caribbean-series'],
  football: ['nfl','college-football'],
  hockey: ['nhl'],
  tennis: ['atp','wta'],
  mma: ['ufc','pfl'],
  racing: ['f1','nascar-premier'],
  golf: ['pga','lpga'],
  cricket: [],rugby:[],lacrosse:['pll'],volleyball:['womens-college-volleyball'],
  'water-polo':['mens-college-water-polo'],'field-hockey':['womens-college-field-hockey'],
  'rugby-league':['3'],'australian-football':['afl'],
}
const title = (v: unknown, max = 170): string => {
  const safe = typeof v === 'string'
    ? v
    : typeof v === 'number' && Number.isFinite(v) ? String(v) : 'Sin confirmar'
  return safe.replace(/[\u0000-\u001f]/gu, ' ').trim().slice(0, max) || 'Sin confirmar'
}
const date=(v?:string):string => {
  const d=v??new Intl.DateTimeFormat('en-CA',{ timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date())
  if(!/^\d{4}-\d{2}-\d{2}$/u.test(d)||Number.isNaN(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)throw Error('Fecha inválida (AAAA-MM-DD)')
  return d
}
const leagueValid=(s:string):boolean => /^[a-z0-9][a-z0-9._-]{0,79}$/u.test(s)

const knownLeagues=new Map<string,{ checkedAt:number;leagues:string[] }>()
/** Discover league identifiers from ESPN's existing public catalog, without arbitrary-web scanning.
 * @param sport - One of the 17 recognized sport identifiers.
 * @param env - Optional operator opt-out.
 * @param fetcher - Injected HTTP transport for tests.
 * @returns Safe league identifiers actually listed by ESPN, rather than guessed slugs.
 */
export async function discoverEspnLeagues(sport:string,env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch):Promise<string[]>{
  if(!Object.hasOwn(sportsCatalog,sport))throw Error('Disciplina desconocida')
  if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado por configuración del operador')
  const cached=knownLeagues.get(sport)
  if(cached&&Date.now()-cached.checkedAt<3_600_000)return cached.leagues
  let slugs:string[]=[]
  if(sport==='cricket'){
    const response=await getFeed<{ sports?:Array<{ leagues?:Array<{ id?:string|number }> }> }>(
      'https://site.web.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket&region=in&tz=Asia%2FCalcutta',fetcher)
    slugs=(response.sports||[]).flatMap(x=>x.leagues||[]).map(x=>String(x.id||'')).filter(leagueValid)
  }else{
    const response=await getFeed<{ items?:Array<{ slug?:string;$ref?:string;abbreviation?:string }> }>(
      'https://sports.core.api.espn.com/v2/sports/'+sport+'/leagues?limit=500',fetcher)
    slugs=(response.items||[]).map(x=>x.slug||x.$ref?.match(/\/leagues\/([^/?#]+)/u)?.[1]||x.abbreviation?.toLowerCase()||'').filter(leagueValid)
  }
  const leagues=[...new Set([...(sportsCatalog[sport]||[]),...slugs])].slice(0,500)
  knownLeagues.set(sport,{ checkedAt:Date.now(),leagues })
  return leagues
}

/** Check whether public read-only providers are disabled or a commercial key is available.
 * @param provider - The supported data source.
 * @param env - Secret-bearing host environment, never sent to the client.
 * @returns Whether the provider can be queried.
 */
export const hasSportsPermission=(provider:'espn'|'mlb'|'odds',env:NodeJS.ProcessEnv=process.env):boolean =>
  provider==='espn'?env.PHOENIX_SPORTS_ESPN_DISABLED!=='1':
    provider==='mlb'?env.PHOENIX_SPORTS_MLB_DISABLED!=='1':Boolean(env.THE_ODDS_API_KEY)
/** Fetch a bounded HTTPS JSON response from a trusted sports provider.
 * @typeParam T - Expected provider shape, verified by each caller.
 * @param url - Provider URL from the fixed host allowlist.
 * @param fetcher - Optional transport for tests.
 * @returns The parsed JSON payload.
 */
export async function getFeed<T>(url:string, fetcher:typeof fetch=fetch):Promise<T> {
  const u=new URL(url)
  if(u.protocol!=='https:'||u.username||u.password||!['site.api.espn.com','site.web.api.espn.com','sports.core.api.espn.com','statsapi.mlb.com','api.the-odds-api.com'].includes(u.hostname))throw Error('Host no permitido')
  const response=await fetcher(u.toString(),{ headers:{ accept:'application/json' },redirect:'error',signal:AbortSignal.timeout(9000) })
  if(!response.ok)throw Error(`Proveedor HTTP ${response.status}`)
  if(Number(response.headers.get('content-length')||0)>4_000_000)throw Error('Respuesta supera 4 MB')
  const text=await response.text()
  if(text.length>4_000_000)throw Error('Respuesta supera 4 MB')
  return JSON.parse(text) as T
}
type FeedEvent = { id?:string|number;date?:string;name?:string;status?:{ type?:{ description?:string } };competitions?:Array<{ venue?:{ fullName?:string;address?:{ city?:string } };competitors?:Array<{ id?:string;homeAway?:string;score?:string|number;team?:{ displayName?:string;name?:string;id?:string;logo?:string;logos?:Array<{ href?:string }> };records?:Array<{ summary?:string }> }> }> }
type MlbGame = { gamePk:number;gameDate?:string;venue?:{ name?:string };status?:{ detailedState?:string };teams?:Record<'home'|'away',{ team?:{ id?:number;name?:string };score?:number;probablePitcher?:{ id?:number;fullName?:string } }> }
/** Safe, minimal sports UI payload; the client validates it before rendering. */
export type ChatBlock = { component:'sports_game_card'|'sports_ticket_card';version:1;props:Record<string,unknown> }
function localTime(dateString?:string):string {
  if(!dateString)return 'Hora no confirmada'
  const parsed=new Date(dateString)
  if(Number.isNaN(parsed.getTime()))return 'Hora no confirmada'
  return new Intl.DateTimeFormat('es-DO',{ timeZone:'America/Santo_Domingo',dateStyle:'medium',timeStyle:'short' }).format(parsed)
}
function logosEnabled(env:NodeJS.ProcessEnv):boolean{return env.PHOENIX_SPORTS_ESPN_IMAGES_ALLOWED==='1'}
/** Normalize scoreboard results into validated chat renderable cards.
 * @param sport - Requested discipline.
 * @param league - Supported league identifier.
 * @param requestedDate - Optional date in ISO format.
 * @param env - Provider authorization state.
 * @param fetcher - Injectable HTTP client for tests.
 * @returns Attributed game cards, result count and date.
 */
export async function chatGames(sport:string,league:string,requestedDate?:string,env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch):Promise<{ summary:string;items:ChatBlock[];source:string;count:number;date:string }> {
  if(!Object.hasOwn(sportsCatalog,sport)||!leagueValid(league))throw Error('Disciplina o liga inválida')
  if(!sportsCatalog[sport]?.includes(league)&&!(await discoverEspnLeagues(sport,env,fetcher)).includes(league))throw Error('Liga no encontrada en el catálogo público de ESPN')
  const day=date(requestedDate),rows:ChatBlock[]=[]
  const isMlb=sport==='baseball'&&league==='mlb'&&hasSportsPermission('mlb',env)
  const source=isMlb?'MLB Stats API':'ESPN Site API'
  if(isMlb){
    try {
      const api=await getFeed<{ dates?:Array<{ games?:MlbGame[] }> }>('https://statsapi.mlb.com/api/v1/schedule?sportId=1&date='+day+'&hydrate=probablePitcher,venue',fetcher)
      if(!Array.isArray(api.dates))throw Error('MLB devolvió un formato inválido')
      for(const g of api.dates.flatMap(d=>d.games??[]).slice(0,25)){
        const away=g.teams?.away,home=g.teams?.home
        const side=(p:typeof home)=>({ label:title(p?.team?.name),...(p?.score===undefined?{}:{ score:String(p.score) }) })
        const picture=(p:typeof home)=>env.PHOENIX_SPORTS_MLB_IMAGES_ALLOWED==='1'&&p?.probablePitcher?.id
          ? 'https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/'+encodeURIComponent(p.probablePitcher.id)+'/headshot/67/current':undefined
        const highlights=[{ label:'Abridor visitante',value:title(away?.probablePitcher?.fullName,120),...(picture(away)?{ image:picture(away) }:{}) },
          { label:'Abridor local',value:title(home?.probablePitcher?.fullName,120),...(picture(home)?{ image:picture(home) }:{}) },
          { label:'Equipo local',value:title(home?.team?.name)+' · ID '+title(home?.team?.id,20) },
          { label:'Equipo visitante',value:title(away?.team?.name)+' · ID '+title(away?.team?.id,20) }]
        rows.push({ component:'sports_game_card',version:1,props:{
          title:'MLB · '+title(g.gamePk,25),subtitle:'Partido '+day,status:title(g.status?.detailedState,55),
          when:localTime(g.gameDate),venue:title(g.venue?.name),home:side(home),away:side(away),
          source:'MLB Stats API · '+new Date().toISOString(),
          highlights,askPrompt:`Kira, amplía la información verificable del partido MLB ${g.gamePk} incluyendo pitchers probables, rendimiento reciente, bullpen, ausencias y fuente por estadística.`,
          note:'Lanzadores probables pueden cambiar; no se confirmó el roster definitivo.',
        } })
      }
    } catch (error) {
      if(!hasSportsPermission('espn',env))throw error
      // ESPN public scoreboard remains available if the complementary MLB feed fails.
      return chatGames(sport,league,requestedDate,{ ...env,PHOENIX_SPORTS_MLB_DISABLED:'1' },fetcher)
    }
  }else{
    if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado por configuración PHOENIX_SPORTS_ESPN_DISABLED=1.')
    const feed=await getFeed<{ events?:FeedEvent[] }>('https://site.api.espn.com/apis/site/v2/sports/'+sport+'/'+league+'/scoreboard?dates='+day.replaceAll('-',''),fetcher)
    if(!Array.isArray(feed.events))throw Error('Respuesta ESPN no válida')
    for(const e of feed.events.slice(0,25)){
      const comp=e.competitions?.[0],home=comp?.competitors?.find(x=>x.homeAway==='home'),away=comp?.competitors?.find(x=>x.homeAway==='away')
      const side=(c:typeof home)=>{
        const name=title(c?.team?.displayName??c?.team?.name)
        const logo=c?.team?.logo??c?.team?.logos?.[0]?.href
        const allowed=!!logo&&/^https:\/\/a\.espncdn\.com\//u.test(logo)&&logosEnabled(env)
        return { label:name,...(c?.score===undefined?{}:{ score:String(c.score) }),...(allowed?{ logo }:{}) }
      }
      rows.push({ component:'sports_game_card',version:1,props:{
        title:title(league,45)+' · '+title(e.name,95),subtitle:title(sport,45),
        status:title(e.status?.type?.description,55),when:localTime(e.date),
        venue:title(comp?.venue?.fullName),home:side(home),away:side(away),
        source:'ESPN Site API · '+new Date().toISOString(),
        highlights:[{ label:'Ciudad',value:title(comp?.venue?.address?.city) },{ label:'Evento',value:title(e.id) }],
        askPrompt:'Kira, amplía el análisis verificado del evento '+title(e.id,50)+' de '+league+'. Incluye métricas específicas de '+sport+' con sus fuentes.',
      } })
    }
  }
  return { summary:rows.length?'Eventos con fuente y horario, hora de Santo Domingo.':'No hay encuentros reportados para la fecha seleccionada.',items:rows,count:rows.length,source,date:day }
}
/** Unique sportsbook selection identity without an assumed price. */
export type MarketSelection = { eventId:string;bookmaker:string;market:string;selection:string;point?:number|null }
/** Time-stamped sportsbook quote tied to a provider event and market. */
export type MarketOutcome = MarketSelection & { price:number;home:string;away:string;time:string;updatedAt:string;source?:string }
/** Read attributed bookmaker quotes, without purchasing or placing any bet.
 * @param sportKey - Provider sports key.
 * @param markets - Approved market categories.
 * @param env - Secret-bearing environment of the host.
 * @param fetcher - HTTP adapter for isolated tests.
 * @returns Normalized quotes with bookmaker names and update times.
 */
export async function marketOdds(sportKey:string,markets='h2h',env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch):Promise<MarketOutcome[]> {
  if(!/^[a-z0-9_]{3,80}$/u.test(sportKey)||!/^(h2h|totals|spreads)(,(h2h|totals|spreads))*$/u.test(markets))throw Error('Mercado inválido')
  if(!hasSportsPermission('odds',env)){
    if(!hasSportsPermission('espn',env))throw Error('Sin proveedor de cuotas disponible: ESPN deshabilitado y THE_ODDS_API_KEY ausente.')
    const fromEspn=await fetchPublicEspnOdds(sportKey,markets,<T>(url:string)=>getFeed<T>(url,fetcher))
    return fromEspn.map(quote=>({ ...quote,source:'ESPN Site/Core (sin clave)' }))
  }
  const u=new URL('https://api.the-odds-api.com/v4/sports/'+sportKey+'/odds')
  for(const [k,v] of Object.entries({ apiKey:env.THE_ODDS_API_KEY??'',regions:'us',markets,oddsFormat:'decimal' }))u.searchParams.set(k,v)
  const feed=await getFeed<Array<{ id:string;home_team:string;away_team:string;commence_time:string;bookmakers?:Array<{ key:string;title:string;last_update?:string;markets?:Array<{ key:string;last_update?:string;outcomes?:Array<{ name:string;price:number;point?:number }> }> }> }>>(u.toString(),fetcher)
  if(!Array.isArray(feed))throw Error('Respuesta de cuotas inválida')
  return feed.flatMap(event=>(event.bookmakers??[]).flatMap(book=>(book.markets??[]).flatMap(market=>(market.outcomes??[]).filter(o=>o.price>1&&Number.isFinite(o.price)).map(o=>({
    eventId:title(event.id,100),bookmaker:title(book.title||book.key,120),market:title(market.key,60),selection:title(o.name,120),point:o.point??null,
    price:o.price,home:title(event.home_team),away:title(event.away_team),time:localTime(event.commence_time),updatedAt:title(market.last_update??book.last_update),source:'The Odds API',
  }))))).slice(0,500)
}
/** Simulate a ticket only when every leg matches a freshly retrieved quote.
 * @param selections - Requested legs to match exactly.
 * @param quotes - Current sportsbook quotes from the authorized source.
 * @param stake - Non-transactional simulated stake.
 * @returns A rendered ticket and any correlation warnings.
 */
export function pricedTicket(selections:MarketSelection[],quotes:MarketOutcome[],stake=0):{ card:ChatBlock;warning:string } {
  if(!Array.isArray(selections)||!selections.length||selections.length>10)throw Error('El ticket requiere entre 1 y 10 selecciones')
  if(!Number.isFinite(stake)||stake<0||stake>1e6)throw Error('Importe de simulación inválido')
  let combined=1
  const used=new Set<string>(),events=new Set<string>()
  const legs=selections.map((sel)=>{
    const matches=quotes.filter(o=>o.eventId===sel.eventId&&o.bookmaker===sel.bookmaker&&o.market===sel.market&&o.selection===sel.selection&&(o.point??null)===(sel.point??null))
    if(matches.length!==1)throw Error('Selección no verificable en cuotas actuales; no se crea ticket ficticio.')
    const match = matches[0]
    if (!match) throw Error('Selección no verificable en cuotas actuales')
    const identity=[sel.eventId,sel.market,sel.selection,sel.point??''].join('|')
    if(used.has(identity))throw Error('Selección duplicada')
    used.add(identity);events.add(sel.eventId);combined*=match.price
    return { event:match.away+' vs '+match.home,selection:match.point==null?match.selection:`${match.selection} ${match.point}`,bookmaker:match.bookmaker,price:match.price.toFixed(2),when:match.time }
  })
  const correlated=events.size!==legs.length
  const warning=correlated?'Incluye selecciones del mismo encuentro; no asumas independencia ni que todas pueden combinarse.':'No se ha estimado probabilidad conjunta ni ventaja estadística calibrada.'
  return { warning,card:{ component:'sports_ticket_card',version:1,props:{
    title:'PHOENIX · Ticket de análisis',subtitle:'Cuotas consultadas en proveedor real · '+new Date().toISOString(),
    legs,combinedOdds:combined.toFixed(3),stake:stake?stake.toFixed(2):undefined,grossReturn:stake?(stake*combined).toFixed(2):undefined,
    source:legs.length&&quotes.some(q=>q.source?.includes('ESPN'))?'ESPN Site/Core (cuotas públicas cuando ESPN las publique)':'The Odds API · precios de las casas indicadas',note:'SIMULACIÓN, SIN APUESTA REAL. '+warning+' Las cuotas pueden cambiar; no existe garantía de ganar.',
    askPrompt:'Kira, revisa este ticket con datos actuales, riesgos, ausencias y correlaciones antes de recomendar nada.',
  } } }
}
