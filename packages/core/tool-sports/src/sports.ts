/** Read-only sports information adapters for Kira's conversation tools. */
import { fetchPublicEspnOdds } from './espn-odds.ts'
import { enrichMlbMatch } from './mlb-matchup.ts'
import { researchMlbTrend } from './mlb-research.ts'
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
// League labels are explicit and stable catalog metadata, never fabricated live results.
const leaguePresentation: Record<string,{league:string;country?:string}> = {
  'eng.1':{league:'Premier League',country:'Inglaterra'},
  'esp.1':{league:'LaLiga',country:'España'},
  'mex.1':{league:'Liga MX',country:'México'},
  'usa.1':{league:'MLS',country:'Estados Unidos / Canadá'},
  'uefa.champions':{league:'UEFA Champions League',country:'Europa'},
  'fifa.world':{league:'Copa Mundial',country:'Internacional'},
  'mlb':{league:'MLB'},'nba':{league:'NBA'},'wnba':{league:'WNBA'},
  'nfl':{league:'NFL'},'nhl':{league:'NHL'},
}
const oddsPresentation:Record<string,{sport:string;country?:string;league?:string}> = {
  soccer_epl:{sport:'Fútbol',country:'Inglaterra',league:'Premier League'},
  soccer_spain_la_liga:{sport:'Fútbol',country:'España',league:'LaLiga'},
  soccer_mexico_ligamx:{sport:'Fútbol',country:'México',league:'Liga MX'},
  soccer_usa_mls:{sport:'Fútbol',country:'Estados Unidos / Canadá',league:'MLS'},
  soccer_uefa_champs_league:{sport:'Fútbol',country:'Europa',league:'Champions League'},
  baseball_mlb:{sport:'Béisbol',league:'MLB'},
  basketball_nba:{sport:'Baloncesto',league:'NBA'},
  basketball_wnba:{sport:'Baloncesto',league:'WNBA'},
  americanfootball_nfl:{sport:'Fútbol americano',league:'NFL'},
  icehockey_nhl:{sport:'Hockey',league:'NHL'},
}
const categoryFromSportKey=(sportKey?:string):{sport?:string;country?:string;league?:string}=>{
  if(!sportKey)return {}
  const known=oddsPresentation[sportKey]
  if(known)return known
  const category=sportKey.split('_')[0]??''
  const sport:Record<string,string>={soccer:'Fútbol',baseball:'Béisbol',basketball:'Baloncesto',
    americanfootball:'Fútbol americano',icehockey:'Hockey',tennis:'Tenis',cricket:'Críquet'}
  return sport[category]?{sport:sport[category]}:{}
}
const title=(v:unknown,max=170):string => {
  const value=typeof v==='string'||typeof v==='number'||typeof v==='boolean'?String(v):'Sin confirmar'
  return value.replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,max)||'Sin confirmar'
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
type FeedEvent = { id?:string|number;date?:string;name?:string;status?:{ type?:{ description?:string;state?:string } };competitions?:Array<{ venue?:{ fullName?:string;address?:{ city?:string } };competitors?:Array<{ id?:string;homeAway?:string;score?:string|number;team?:{ displayName?:string;name?:string;id?:string;logo?:string;logos?:Array<{ href?:string }> };records?:Array<{ summary?:string }>;linescores?:Array<{ value?:number|string;displayValue?:string }>;leaders?:Array<{ name?:string;leaders?:Array<{ athlete?:{ displayName?:string;headshot?:{ href?:string } };displayValue?:string }> }> }>;broadcasts?:Array<{ names?:string[] }> }> }
type MlbGame = { gamePk:number;gameDate?:string;venue?:{ name?:string };seriesDescription?:string;seriesGameNumber?:number;status?:{ detailedState?:string;abstractGameState?:string };teams?:Record<'home'|'away',{ team?:{ id?:number;name?:string };score?:number;probablePitcher?:{ id?:number;fullName?:string } }> }
/** Safe, minimal sports UI payload; the client validates it before rendering. */
export type ChatBlock = { component:'sports_game_card'|'sports_schedule_card'|'sports_ticket_card'|'sports_odds_card';version:1;props:Record<string,unknown> }
/** A single bounded chat surface for multiple events, not a replacement for detailed cards. */
export function compactSportsSchedule(games:readonly ChatBlock[],day:string,source:string):ChatBlock|null {
  const cards=games.filter(game=>game.component==='sports_game_card').slice(0,25)
  if(cards.length<2)return null
  const text=(value:unknown,max=180)=>typeof value==='string'?value.slice(0,max):undefined
  const object=(value:unknown):Record<string,unknown>=>
    value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
  const first=cards[0]?.props??{}
  const league=text(first.league,100)
  const sport=text(first.sport,60)
  const sameLeague=cards.every(card=>card.props.league===first.league)
  const sameSport=cards.every(card=>card.props.sport===first.sport)
  const events=cards.map(card=>{
    const p=card.props
    const highlights=Array.isArray(p.highlights)?p.highlights:[]
    const firstHighlight=object(highlights[0])
    const research=object(p.research)
    const featured=text(firstHighlight.value,90)
    const detail=text(firstHighlight.detail,55)
    const favorite=text(research.favorite,170)
    return {
      ...(text(p.eventId,50)?{eventId:text(p.eventId,50)}:{}),
      when:text(p.when,80)??'Hora no confirmada',
      ...(text(p.status,60)?{status:text(p.status,60)}:{}),
      ...(text(p.venue,180)?{venue:text(p.venue,180)}:{}),
      away:p.away,home:p.home,
      ...(featured?{featured:featured+(detail?' · '+detail:'')}:{}),
      ...(favorite&&Array.isArray(research.evidence)&&research.evidence.length>0?{favorite}:{}),
      ...(text(p.askPrompt,400)?{askPrompt:text(p.askPrompt,400)}:{}),
    }
  })
  return {component:'sports_schedule_card',version:1,props:{
    title:'Cartelera deportiva',
    date:day,
    ...(sameSport&&sport?{sport}:{}),
    ...(sameLeague&&league?{league}:{}),
    source,total:games.length,events,
    note:'La cartelera muestra solo datos públicos verificados. Para profundizar, consulta un encuentro individual.',
  }}
}

function localTime(dateString?:string):string {
  if(!dateString)return 'Hora no confirmada'
  const parsed=new Date(dateString)
  if(Number.isNaN(parsed.getTime()))return 'Hora no confirmada'
  return new Intl.DateTimeFormat('es-DO',{ timeZone:'America/Santo_Domingo',dateStyle:'medium',timeStyle:'short' }).format(parsed)
}
function logosEnabled(env:NodeJS.ProcessEnv):boolean{return env.PHOENIX_SPORTS_IMAGES_DISABLED!=='1'}
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
  const leagueInfo=leaguePresentation[league]
  const isMlb=sport==='baseball'&&league==='mlb'&&hasSportsPermission('mlb',env)
  const source=isMlb?'MLB Stats API':'ESPN Site API'
  if(isMlb){
    try {
      const api=await getFeed<{ dates?:Array<{ games?:MlbGame[] }> }>('https://statsapi.mlb.com/api/v1/schedule?sportId=1&date='+day+'&hydrate=probablePitcher,venue',fetcher)
      if(!Array.isArray(api.dates))throw Error('MLB devolvió un formato inválido')
      const games=api.dates.flatMap(d=>d.games??[]).slice(0,25)
      const cards=await Promise.all(games.map(async(g,index)=>{
        const away=g.teams?.away,home=g.teams?.home
        const homeName=title(home?.team?.name),awayName=title(away?.team?.name)
        const showScores=['Live','Final','Completed'].includes(g.status?.abstractGameState??'')
        const side=(p:typeof home)=>({
          label:title(p?.team?.name),
          ...(showScores&&p?.score!==undefined?{ score:String(p.score) }:{}),
          ...(p?.team?.id&&logosEnabled(env)?{ logo:`https://www.mlbstatic.com/team-logos/${p.team.id}.svg` }:{}),
        })
        // Limit deep MLB requests on large game days; the user can drill down any remaining matchup.
        const details=index<3?await enrichMlbMatch(
          g.gamePk,home?.team?.id??0,away?.team?.id??0,homeName,awayName,
          { ...(home?.probablePitcher?{ home:home.probablePitcher }:{}),...(away?.probablePitcher?{ away:away.probablePitcher }:{}) },Number(day.slice(0,4)),env,fetcher,
        ):null
        const research=index<3?await researchMlbTrend(
          home?.team?.id??0,away?.team?.id??0,Number(day.slice(0,4)),homeName,awayName,fetcher,
        ):undefined
        const highlights=details?.pitchers.length
          ? details.pitchers.map(p=>({ label:'Abridor probable · '+p.team,value:p.name,...(p.image?{ image:p.image }:{}),...(p.stats?{ detail:p.stats }:{}) }))
          : ([['away',away],['home',home]] as const).filter(([,t])=>t?.probablePitcher?.fullName)
            .map(([side,t])=>({ label:`Abridor probable · ${side==='home'?homeName:awayName}`,value:title(t?.probablePitcher?.fullName) }))
        return { component:'sports_game_card' as const,version:1 as const,props:{
          title:homeName+' vs '+awayName,
          subtitle:g.seriesDescription?(g.seriesDescription+' · Juego '+(g.seriesGameNumber??'por confirmar')):'MLB · '+day,
          status:title(g.status?.detailedState,55),when:localTime(g.gameDate),venue:title(g.venue?.name),
          home:side(home),away:side(away),source:'MLB Stats API · '+new Date().toISOString(),
          highlights,pitchers:details?.pitchers??[],lineups:details?.lineups??[],
          bullpen:details?.bullpen??[],sport:'baseball',league:'MLB',eventId:String(g.gamePk),...(research?{ research }:{}) ,
          note:details?.notes.join(' · ')||'Los abridores y las alineaciones están sujetos a confirmación.',
          askPrompt:`Kira, investiga el partido MLB ${g.gamePk} con pitchers probables, bullpen, alineaciones y cuotas verificables. Si hay estimaciones de favoritos, distingue tus cálculos de ESPN.`,
        } }
      }))
      rows.push(...cards)
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
        return { label:name,...(c?.score===undefined||e.status?.type?.state==='pre'?{}:{ score:String(c.score) }),...(allowed?{ logo }:{}) ,...(c?.records?.[0]?.summary?{ meta:c.records[0].summary }:{}) }
      }
      const competitionTeams=comp?.competitors||[]
      const visiting=competitionTeams.find(c=>c.homeAway==='away'),hosting=competitionTeams.find(c=>c.homeAway==='home')
      const homePeriods=hosting?.linescores??[],awayPeriods=visiting?.linescores??[]
      const periods=awayPeriods.length>0&&awayPeriods.length===homePeriods.length
        ?awayPeriods.slice(0,9).map((v,i)=>({ label:String(i+1),
          away:String(v.displayValue??v.value??'—'),home:String(homePeriods[i]?.displayValue??homePeriods[i]?.value??'—') })):[]
      const sportNames:Record<string,string>={ soccer:'Fútbol',basketball:'Baloncesto',football:'Fútbol americano',hockey:'Hockey',
        tennis:'Tenis',mma:'MMA',racing:'Automovilismo',golf:'Golf',baseball:'Béisbol' }; const sportLabel=sportNames[sport]||sport
      const highlights = (comp?.competitors ?? []).flatMap(team =>
        (team.leaders ?? []).slice(0, 2).flatMap(group =>
          (group.leaders ?? []).slice(0, 1).map((leader) => {
            const headshot = leader.athlete?.headshot?.href
            return {
              label: title(group.name),
              value: title(leader.athlete?.displayName),
              ...(leader.displayValue ? { detail: title(leader.displayValue) } : {}),
              ...(logosEnabled(env) && headshot && /^https:\/\/a\.espncdn\.com\//u.test(headshot)
                ? { image: headshot }
                : {}),
            }
          }),
        ),
      )
      rows.push({ component:'sports_game_card',version:1,props:{
        title:title(e.name,95),subtitle:(leagueInfo?.league??title(league,45))+' · '+sportLabel,
        league:leagueInfo?.league??title(league,45),
        ...(leagueInfo?.country?{country:leagueInfo.country}:{}),
        status:title(e.status?.type?.description,55),when:localTime(e.date),
        venue:title(comp?.venue?.fullName),home:side(home),away:side(away),
        source:'ESPN Site API · '+new Date().toISOString(),
        sport,
        ...(e.id !== undefined && String(e.id).trim() !== '' ? { eventId: String(e.id) } : {}),
        periods, highlights,
        ...(comp?.broadcasts?.length?{ broadcast:comp.broadcasts.flatMap(x=>x.names??[]).slice(0,3).join(', ') }:{}),
        askPrompt:'Kira, amplía el análisis verificado del evento '+title(e.id,50)+' de '+league+'. Incluye métricas específicas de '+sport+' con sus fuentes.',
      } })
    }
  }
  return { summary:rows.length?'Eventos con fuente y horario, hora de Santo Domingo.':'No hay encuentros reportados para la fecha seleccionada.',items:rows,count:rows.length,source,date:day }
}
/** Unique sportsbook selection identity without an assumed price. */
export type MarketSelection = { eventId:string;bookmaker:string;market:string;selection:string;point?:number|null }
/** Time-stamped sportsbook quote tied to a provider event and market. */
export type MarketOutcome = MarketSelection & { price:number;home:string;away:string;time:string;updatedAt:string;source?:string;sportKey?:string }
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
    return fromEspn.map(quote=>({ ...quote,sportKey,source:'ESPN Site/Core (sin clave)' }))
  }
  const u=new URL('https://api.the-odds-api.com/v4/sports/'+sportKey+'/odds')
  for(const [k,v] of Object.entries({ apiKey:env.THE_ODDS_API_KEY??'',regions:'us',markets,oddsFormat:'decimal' }))u.searchParams.set(k,v)
  const feed=await getFeed<Array<{ id:string;home_team:string;away_team:string;commence_time:string;bookmakers?:Array<{ key:string;title:string;last_update?:string;markets?:Array<{ key:string;last_update?:string;outcomes?:Array<{ name:string;price:number;point?:number }> }> }> }>>(u.toString(),fetcher)
  if(!Array.isArray(feed))throw Error('Respuesta de cuotas inválida')
  return feed.flatMap(event=>(event.bookmakers??[]).flatMap(book=>(book.markets??[]).flatMap(market=>(market.outcomes??[]).filter(o=>o.price>1&&Number.isFinite(o.price)).map(o=>({
    eventId:title(event.id,100),bookmaker:title(book.title||book.key,120),market:title(market.key,60),selection:title(o.name,120),point:o.point??null,sportKey,
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
    const match=matches[0]
    if(matches.length!==1||!match)throw Error('Selección no verificable en cuotas actuales; no se crea ticket ficticio.')
    const identity=[match.sportKey??'',sel.eventId,sel.market,sel.selection,sel.point??''].join('|')
    if(used.has(identity))throw Error('Selección duplicada')
    used.add(identity);events.add([match.sportKey??'',sel.eventId].join('|'));combined*=match.price
    const taxonomy=categoryFromSportKey(match.sportKey)
    return { event:match.away+' vs '+match.home,selection:match.selection+(match.point==null?'':' '+match.point),
      bookmaker:match.bookmaker,price:match.price.toFixed(2),when:match.time,market:match.market,...taxonomy }
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
