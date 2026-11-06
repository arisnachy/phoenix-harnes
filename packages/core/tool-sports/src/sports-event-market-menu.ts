/** Bounded event-level alternative/period/player markets from an authorized bookmaker provider.
 * API responses are observations only, not calibrated model picks. No bet is placed.
 */
import {getFeed} from './sports.ts'

export type ExtraSportsbookOutcome={
  bookmaker:string;bookmakerKey:string;market:string;family:string;period:string
  selection:string;participant:string|null;point:number|null;decimalOdds:number
  updatedAt:string;source:'The Odds API v4';eventId:string;sportKey:string
}
export type ExtraMarketReport={
  sportKey:string;eventId:string;checkedAt:string;status:'observed'|'empty'|'unconfigured'|'error'
  marketsQueried:string[];marketsObserved:string[];publishedMarkets:string[]
  discoveryStatus:'observed'|'empty'|'unavailable'|'unconfigured'
  quotes:ExtraSportsbookOutcome[]
  bookmakerCount:number;errors:string[];warning:string
}
const SPORT_MENUS:Readonly<Record<string,readonly string[]>>={
  basketball_nba:['alternate_spreads','alternate_totals','team_totals','totals_h1',
    'spreads_h1','totals_q1','spreads_q1','player_points','player_rebounds',
    'player_assists','player_threes','player_points_rebounds_assists'],
  basketball_wnba:['alternate_spreads','alternate_totals','team_totals','totals_h1',
    'spreads_h1','totals_q1','player_points','player_rebounds','player_assists','player_threes'],
  baseball_mlb:['h2h_1st_5_innings','spreads_1st_5_innings','totals_1st_5_innings',
    'totals_1st_3_innings','alternate_totals','team_totals','pitcher_strikeouts',
    'batter_hits','batter_total_bases','batter_home_runs'],
  icehockey_nhl:['alternate_spreads','alternate_totals','team_totals','totals_p1',
    'spreads_p1','player_shots_on_goal','player_points','player_goals','player_assists'],
  americanfootball_nfl:['alternate_spreads','alternate_totals','team_totals','totals_h1',
    'spreads_h1','player_pass_yds','player_rush_yds','player_reception_yds',
    'player_receptions','player_anytime_td'],
}
const SOCCER_MENU=['btts','double_chance','draw_no_bet','alternate_totals',
  'totals_h1','team_totals','spreads_h1'] as const
const validSport=(sport:string)=>/^[a-z0-9_]{3,80}$/u.test(sport)
const validEvent=(event:string)=>/^[a-zA-Z0-9-]{8,100}$/u.test(event)
const period=(market:string):string=>{
  const first=market.match(/_1st_(\d+)_innings$/u)
  if(first)return 'primeras '+first[1]+' entradas'
  const other=market.match(/_(q[1-4]|h[12]|p[1-3])$/u)
  if(other)return other[1]??'completo'
  return 'juego completo o reglas específicas del prop'
}
const family=(market:string):string=>{
  if(/^(player_|pitcher_|batter_)/u.test(market))return'player-prop'
  if(market.startsWith('totals')||market.startsWith('alternate_totals'))return'totals'
  if(market.startsWith('spreads')||market.startsWith('alternate_spreads'))return'handicap'
  if(market.startsWith('team_totals'))return'team-total'
  if(market.startsWith('h2h'))return'winner'
  return'special'
}
/** Return authorized event market menu for a known sports key.
 * @param sportKey - Exact sport key from the provider's current sports catalog.
 * @returns Whitelisted markets suitable for bounded per-event discovery.
 */
export function eventMarketCatalog(sportKey:string):readonly string[]{
  if(!validSport(sportKey))return []
  if(sportKey.startsWith('soccer_'))return SOCCER_MENU
  return SPORT_MENUS[sportKey]??[]
}
/** Query event-level props and alternative lines with traceable provider timestamp.
 * @param sportKey - Sport key verified by a daily fixture/market adapter.
 * @param eventId - Real event ID returned by The Odds API (not an ESPN game ID).
 * @param env - Credentials from PHOENIX vault, never returned to user.
 * @param fetcher - Injected HTTP adapter for deterministic tests.
 * @param now - Analysis timestamp.
 * @param maxMarkets - Number of catalog markets to attempt, 1–12.
 * @returns Observed, dated bookmaker outcome menu; no fictitious quotes.
 */
export async function readSportsEventMarketMenu(
  sportKey:string,eventId:string,env:NodeJS.ProcessEnv=process.env,
  fetcher:typeof fetch=fetch,now=Date.now(),maxMarkets=8,
):Promise<ExtraMarketReport>{
  const allowed=eventMarketCatalog(sportKey)
  if(!allowed.length||!validEvent(eventId))throw Error('Deporte o ID de evento sin soporte para mercados ampliados')
  if(!Number.isInteger(maxMarkets)||maxMarkets<1||maxMarkets>12)
    throw Error('Se permiten entre 1 y 12 mercados por exploración')
  const base={sportKey,eventId,checkedAt:new Date(now).toISOString(),
    marketsQueried:[] as string[],marketsObserved:[] as string[],
    publishedMarkets:[] as string[],
    discoveryStatus:'unconfigured' as ExtraMarketReport['discoveryStatus'],
    quotes:[] as ExtraSportsbookOutcome[],bookmakerCount:0,errors:[] as string[],
    warning:'Oferta observada, NO pronóstico. Las cuotas de otra casa NO son las de Juancito. Mercados por periodo y props requieren reglas, participantes y modelo específicos. No se colocó ninguna apuesta.'}
  if(!env.THE_ODDS_API_KEY?.trim())
    return {...base,status:'unconfigured' as const,
      errors:['The Odds API v4 no tiene clave autorizada']}

  // The /markets endpoint reports real bookmaker markets for this particular event.
  // Discovering first avoids spending credits on unsupported market guesses.
  const errors:string[]=[]
  let discovered:string[]=[]
  let discoveryStatus:ExtraMarketReport['discoveryStatus']='unavailable'
  try{
    const url=new URL('https://api.the-odds-api.com/v4/sports/'+sportKey+
      '/events/'+encodeURIComponent(eventId)+'/markets')
    url.searchParams.set('apiKey',env.THE_ODDS_API_KEY)
    url.searchParams.set('regions','us')
    const response=await getFeed<{
      id?:string;sport_key?:string;commence_time?:string
      bookmakers?:Array<{markets?:Array<{key?:string;last_update?:string}>}>
    }>(url.toString(),fetcher)
    if(response.id!==eventId||response.sport_key!==sportKey
      ||!Number.isFinite(Date.parse(response.commence_time??''))
      ||Date.parse(response.commence_time??'')<=now)
      throw Error('El catálogo de mercados no corresponde al evento futuro')
    const keys=(response.bookmakers??[]).flatMap(book=>book.markets??[])
      .filter(market=>typeof market.key==='string'&&
        /^[a-z0-9_]{3,80}$/u.test(market.key)&&
        Number.isFinite(Date.parse(market.last_update??''))&&
        Date.parse(market.last_update??'')<=now&&
        now-Date.parse(market.last_update??'')<=60*60_000)
      .map(market=>market.key!)
    discovered=[...new Set(keys)].slice(0,150)
    discoveryStatus=discovered.length?'observed':'empty'
  }catch(error){
    errors.push('Catálogo de mercados no disponible: '+
      String(error instanceof Error?error.message:error).slice(0,130))
  }
  const offered=discoveryStatus==='observed'?
    allowed.filter(key=>discovered.includes(key)):
    discoveryStatus==='empty'?[]:[...allowed]
  // A menu containing many alternate spreads must not starve all player props
  // or period markets when the user asks for all useful market families.
  const diverse=[
    offered.find(key=>/^(player_|pitcher_|batter_)/u.test(key)),
    offered.find(key=>/_1st_5_innings$/u.test(key)),
    offered.find(key=>/_(?:h[12]|q[1-4]|p[1-3])$/u.test(key)),
    offered.find(key=>key.startsWith('alternate_spreads')),
    offered.find(key=>key.startsWith('alternate_totals')),
    offered.find(key=>key.startsWith('team_totals')),
    ...offered,
  ].filter((key):key is string=>typeof key==='string')
  const selected=[...new Set(diverse)].slice(0,maxMarkets)
  if(!selected.length)return {...base,status:'empty' as const,
    discoveryStatus,publishedMarkets:discovered,errors}

  // Requests in small groups reduce single-endpoint failures and API credit exposure.
  const packs:string[][]=[]
  for(let i=0;i<selected.length;i+=4)packs.push(selected.slice(i,i+4))
  const all:ExtraSportsbookOutcome[]=[]
  for(const markets of packs){
    const url=new URL('https://api.the-odds-api.com/v4/sports/'+sportKey+'/events/'+
      encodeURIComponent(eventId)+'/odds')
    for(const [key,value] of Object.entries({
      apiKey:env.THE_ODDS_API_KEY,regions:'us',markets:markets.join(','),
      oddsFormat:'decimal',
    }))url.searchParams.set(key,value)
    try{
      const response=await getFeed<{
        id?:string;commence_time?:string;
        bookmakers?:Array<{key?:string;title?:string;last_update?:string;
          markets?:Array<{key?:string;last_update?:string;
            outcomes?:Array<{name?:string;description?:string;price?:number;point?:number}>}>}>
      }>(url.toString(),fetcher)
      if(String(response.id??'')!==eventId||
        !Number.isFinite(Date.parse(response.commence_time??''))||
        Date.parse(response.commence_time??'')<=now){
        errors.push('Evento devuelto no coincide con ID o ya está iniciado')
        continue
      }
      for(const book of response.bookmakers??[]){
        const bookmaker=book.title?.trim(),bookmakerKey=book.key?.trim()
        if(!bookmaker||!bookmakerKey)continue
        for(const market of book.markets??[]){
          if(!market.key||!markets.includes(market.key))continue
          const updated=market.last_update??book.last_update??'',at=Date.parse(updated)
          if(!Number.isFinite(at)||at>now||now-at>60*60_000)continue
          for(const outcome of market.outcomes??[]){
            if(!outcome.name?.trim()||typeof outcome.price!=='number'||
              !Number.isFinite(outcome.price)||outcome.price<=1||outcome.price>1000||
              (outcome.point!==undefined&&!Number.isFinite(outcome.point)))continue
            all.push({
              bookmaker,bookmakerKey,market:market.key,family:family(market.key),
              period:period(market.key),selection:outcome.name,
              participant:outcome.description?.trim()||null,point:outcome.point??null,
              decimalOdds:outcome.price,updatedAt:updated,source:'The Odds API v4',
              eventId,sportKey,
            })
          }
        }
      }
    }catch(error){errors.push('Mercados '+markets.join(',')+': '+
      String(error instanceof Error?error.message:error).slice(0,170))}
  }
  // Per-player identities and market lines are independent: do not merge outcomes
  // sharing 'Over' when they belong to different athletes.
  const unique=new Map<string,ExtraSportsbookOutcome>()
  for(const q of all){
    const id=[q.bookmakerKey,q.market,q.participant??'',q.selection,q.point??''].join('|')
    unique.set(id,q)
  }
  const quotes=[...unique.values()].slice(0,400)
  const marketsObserved=[...new Set(quotes.map(q=>q.market))]
  return {...base,status:quotes.length?'observed':errors.length?'error':'empty',
    marketsQueried:[...selected],publishedMarkets:discovered,discoveryStatus,
    marketsObserved,quotes,bookmakerCount:new Set(quotes.map(q=>q.bookmakerKey)).size,errors}
}
