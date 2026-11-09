/**
 * Curated extended ESPN routes. All are unofficial and availability varies
 * across leagues. An entry in this catalog does not prove HTTP reachability.
 * Only enumerated HTTPS JSON endpoints; no arbitrary URLs, private Fantasy
 * credentials, partner credentials or HTML scraping. Each route is provisional.
 */
export const extendedEspnRoutes={
  team_record:{root:'core',path:'/seasons/{season}/types/{seasonType}/teams/{teamId}/record'},
  team_statistics:{root:'core',path:'/seasons/{season}/types/{seasonType}/teams/{teamId}/statistics'},
  team_projection:{root:'core',path:'/seasons/{season}/teams/{teamId}/projection'},
  team_depth_chart:{root:'core',path:'/seasons/{season}/teams/{teamId}/depthcharts'},
  team_athletes:{root:'core',path:'/seasons/{season}/teams/{teamId}/athletes'},
  team_injuries:{root:'core',path:'/teams/{teamId}/injuries'},
  team_roster:{root:'site',path:'/teams/{teamId}/roster'},
  team_schedule:{root:'site',path:'/teams/{teamId}/schedule'},
  athlete_overview:{root:'web',path:'/athletes/{athleteId}/overview'},
  athlete_bio:{root:'web',path:'/athletes/{athleteId}/bio'},
  athlete_stats:{root:'web',path:'/athletes/{athleteId}/stats'},
  athlete_gamelog:{root:'web',path:'/athletes/{athleteId}/gamelog'},
  athlete_splits:{root:'web',path:'/athletes/{athleteId}/splits'},
  athlete_eventlog:{root:'core',path:'/seasons/{season}/athletes/{athleteId}/eventlog'},
  athlete_season_stats:{root:'core',path:'/seasons/{season}/types/{seasonType}/athletes/{athleteId}/statistics'},
  athlete_history:{root:'core',path:'/athletes/{athleteId}/statisticslog'},
  game_plays:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/plays'},
  game_team_linescores:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/competitors/{teamId}/linescores'},
  game_team_statistics:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/competitors/{teamId}/statistics'},
  game_roster:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/competitors/{teamId}/roster'},
  game_officials:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/officials'},
  game_powerindex:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/powerindex/{teamId}'},
  season_teams:{root:'core',path:'/seasons/{season}/teams'},
  season_coaches:{root:'core',path:'/seasons/{season}/coaches'},
  season_weeks:{root:'core',path:'/seasons/{season}/types/{seasonType}/weeks'},
  week_events:{root:'core',path:'/seasons/{season}/types/{seasonType}/weeks/{week}/events'},
  week_talentpicks:{root:'core',path:'/seasons/{season}/types/{seasonType}/weeks/{week}/talentpicks'},
  season_leaders:{root:'core',path:'/seasons/{season}/types/{seasonType}/leaders'},
  standings:{root:'standings',path:'/standings'},
  team_news:{root:'site',path:'/news'},
  league_news:{root:'site',path:'/news'},
  league_injuries:{root:'site',path:'/injuries'},
  venues:{root:'core',path:'/venues'},
  transactions:{root:'core',path:'/transactions'},
  league_events:{root:'core',path:'/events'},
  seasons:{root:'core',path:'/seasons'},
  season_detail:{root:'core',path:'/seasons/{season}'},
  season_type:{root:'core',path:'/seasons/{season}/types/{seasonType}'},
  calendar:{root:'core',path:'/calendar'},
  teams:{root:'core',path:'/teams'},
  active_athletes:{root:'core',path:'/athletes'},
  athlete_profile:{root:'core',path:'/athletes/{athleteId}'},
  game_player_statistics:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/competitors/{teamId}/roster/{athleteId}/statistics/0'},
  season_athlete:{root:'core',path:'/seasons/{season}/athletes/{athleteId}'},
  positions:{root:'core',path:'/positions'},
  franchises:{root:'core',path:'/franchises'},
  free_agents:{root:'core',path:'/seasons/{season}/freeagents'},
  season_draft:{root:'core',path:'/seasons/{season}/draft'},
  season_groups:{root:'core',path:'/seasons/{season}/types/{seasonType}/groups'},
  season_group_events:{root:'core',path:'/seasons/{season}/types/{seasonType}/weeks/{week}/events'},

  // ESPN Site: game, teams, transactions and college rankings.
  site_scoreboard:{root:'site',path:'/scoreboard'},
  site_summary:{root:'site',path:'/summary'},
  site_team:{root:'site',path:'/teams/{teamId}'},
  site_team_depth_chart:{root:'site',path:'/teams/{teamId}/depthcharts'},
  site_transactions:{root:'site',path:'/transactions'},
  site_rankings:{root:'site',path:'/rankings'},
  // Common v3 athletes/team statistical leaderboards.
  web_statistics_by_athlete:{root:'web',path:'/statistics/byathlete'},
  web_statistics_by_team:{root:'web',path:'/statistics/byteam'},
  // Core league and seasons.
  league_info:{root:'core',path:''},
  season_awards:{root:'core',path:'/seasons/{season}/awards'},
  season_powerindex:{root:'core',path:'/seasons/{season}/powerindex'},
  season_powerindex_team:{root:'core',path:'/seasons/{season}/powerindex/{teamId}'},
  season_draft_rounds:{root:'core',path:'/seasons/{season}/draft/rounds'},
  season_draft_athletes:{root:'core',path:'/seasons/{season}/draft/athletes'},
  season_group_standings:{root:'core',path:'/seasons/{season}/types/{seasonType}/groups/{groupId}/standings'},
  season_group_teams:{root:'core',path:'/seasons/{season}/types/{seasonType}/groups/{groupId}/teams'},
  season_futures:{root:'core',path:'/seasons/{season}/futures'},
  season_team_leaders:{root:'core',path:'/seasons/{season}/types/{seasonType}/teams/{teamId}/leaders'},
  season_team_ats:{root:'core',path:'/seasons/{season}/types/{seasonType}/teams/{teamId}/ats'},
  // Core player injuries and verified event components.
  athlete_notes:{root:'core',path:'/athletes/{athleteId}/notes'},
  athlete_injuries:{root:'core',path:'/athletes/{athleteId}/injuries'},
  game_status:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/status'},
  game_situation:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/situation'},
  game_broadcasts:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/broadcasts'},
  game_details:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/details'},
  game_commentary:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/commentary'},
  game_team_leaders:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/competitors/{teamId}/leaders'},
  game_odds:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/odds'},
  game_odds_provider:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/odds/{providerId}'},
  game_prop_bets:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/odds/{providerId}/propBets'},
  game_probabilities:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/probabilities'},
  game_predictor:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/predictor'},
  // Public CDN JSON; format and access differ by league. Never a live price guarantee.
  cdn_scoreboard:{root:'cdn',path:'/scoreboard'},
  cdn_game:{root:'cdn',path:'/game'},
  cdn_boxscore:{root:'cdn',path:'/boxscore'},
  cdn_playbyplay:{root:'cdn',path:'/playbyplay'},
  cdn_matchup:{root:'cdn',path:'/matchup'},
  cdn_schedule:{root:'cdn',path:'/schedule'},
  cdn_standings:{root:'cdn',path:'/standings'},
  // Public Fantasy views only: never attach ESPN authentication cookies.
  fantasy_players:{root:'fantasy',path:'/players'},
  fantasy_player_info:{root:'fantasy',path:'/players'},
  fantasy_pro_team_schedules:{root:'fantasy',path:'/'},
  // Standalone ESPN search, newsroom and videos; no arbitrary URLs.
  search_entities:{root:'search',path:''},
  news_feed:{root:'news',path:''},
  video_feed:{root:'videos',path:''},

} as const
/** Supported, explicitly enumerated modes for safe ESPN route generation. */
export type ExtendedEspnMode=keyof typeof extendedEspnRoutes
/** Validated ESPN extended lookup parameters; identifiers originate in ESPN responses. */
export type ExtendedEspnInput={
  mode:ExtendedEspnMode;sport:string;league:string;eventId?:string|undefined
  competitionId?:string|undefined;teamId?:string|undefined;athleteId?:string|undefined
  season?:number|undefined;seasonType?:number|undefined;week?:number|undefined;limit?:number|undefined
  providerId?:string|undefined;groupId?:string|undefined;date?:string|undefined;query?:string|undefined
}
const digits=(raw:unknown,key:string):string=>{
  const value=String(raw??'')
  if(!/^\d{1,16}$/u.test(value))throw Error('ID ESPN inválido: '+key)
  return value
}
const number=(raw:unknown,key:string,min:number,max:number):string=>{
  if(typeof raw!=='number'||!Number.isSafeInteger(raw)||raw<min||raw>max)
    throw Error('Parámetro ESPN inválido: '+key)
  return String(raw)
}
const slug=(value:string,key:string):string=>{
  if(typeof value!=='string'||!/^[a-z0-9][a-z0-9._-]{0,45}$/u.test(value))
    throw Error('Slug ESPN inválido: '+key)
  return value
}
const roots={
  core:'https://sports.core.api.espn.com/v2/sports/',
  site:'https://site.api.espn.com/apis/site/v2/sports/',
  web:'https://site.web.api.espn.com/apis/common/v3/sports/',
  standings:'https://site.api.espn.com/apis/v2/sports/',
  cdn:'https://cdn.espn.com/core/',
  fantasy:'https://lm-api-reads.fantasy.espn.com/apis/v3/games/',
  search:'https://site.web.api.espn.com/apis/search/v2',
  news:'https://now.core.api.espn.com/v1/sports/news',
  videos:'https://site.web.api.espn.com/apis/v2/videos',
} as const
/**
 * Build a fixed-host ESPN URL with league, season, event and team IDs validated.
 * @param input - ESPN mode and identifiers retrieved from a verified source.
 * @returns Immutable HTTPS endpoint URL with no arbitrary hosts or paths.
 */
export function extendedEspnUrl(input:ExtendedEspnInput):string{
  const def=extendedEspnRoutes[input.mode]
  if(!def)throw Error('Modo ESPN extendido desconocido')
  const sport=slug(input.sport,'sport'),league=slug(input.league,'league')
  const vars:Record<string,string>={}
  for(const key of def.path.match(/\{([A-Za-z]+)\}/gu)??[]){
    const name=key.slice(1,-1)
    if(name==='season')vars[name]=number(input.season,name,1900,2100)
    else if(name==='seasonType')vars[name]=number(input.seasonType??2,name,0,4)
    else if(name==='week')vars[name]=number(input.week,name,1,65)
    else vars[name]=digits(input[name as keyof ExtendedEspnInput],name)
  }
  let path:string=def.path
  for(const [key,value] of Object.entries(vars))path=path.replace('{'+key+'}',value)

  // Derive league-to-Fantasy IDs from a fixed mapping, not model suggestions.
  const fantasyGames:Record<string,string>={
    'football/nfl':'ffl','basketball/nba':'fba',
    'baseball/mlb':'flb','hockey/nhl':'fhl',
  }
  let base:string
  if(def.root==='fantasy'){
    const game=fantasyGames[sport+'/'+league]
    if(!game)throw Error('Liga ESPN Fantasy no admitida')
    base=roots.fantasy+game+'/seasons/'+number(input.season,'season',1900,2100)
  }else if(def.root==='cdn'){
    if(!['nfl','nba','mlb','nhl','wnba','college-football','mens-college-basketball'].includes(league))
      throw Error('Liga ESPN CDN no admitida')
    base=roots.cdn+league
  }else if(def.root==='search'||def.root==='news'||def.root==='videos'){
    base=roots[def.root]
  }else base=roots[def.root]+sport+(def.root==='core'?'/leagues/':'/')+league
  const url=new URL(base+path)
  if(input.mode==='site_scoreboard'){
    if(input.date!==undefined){
      if(!/^\d{8}$/u.test(input.date)||Number.isNaN(Date.parse(input.date.slice(0,4)+'-'+input.date.slice(4,6)+'-'+input.date.slice(6,8)+'T00:00:00Z'))||
        new Date(input.date.slice(0,4)+'-'+input.date.slice(4,6)+'-'+input.date.slice(6,8)+'T00:00:00Z').toISOString().slice(0,10).replaceAll('-','')!==input.date)
        throw Error('Fecha ESPN inválida (YYYYMMDD)')
      url.searchParams.set('dates',input.date)
    }
    if(input.week!==undefined)url.searchParams.set('week',number(input.week,'week',1,65))
    if(input.seasonType!==undefined)url.searchParams.set('seasontype',number(input.seasonType,'seasonType',0,4))
  }
  if(input.mode==='site_summary')url.searchParams.set('event',digits(input.eventId,'eventId'))
  if(input.mode==='cdn_game'||input.mode==='cdn_boxscore'||input.mode==='cdn_playbyplay'||input.mode==='cdn_matchup')
    url.searchParams.set('gameId',digits(input.eventId,'eventId'))
  if(def.root==='cdn')url.searchParams.set('xhr','1')
  if(def.root==='fantasy'){
    url.searchParams.set('view',input.mode==='fantasy_players'?'players_wl':
      input.mode==='fantasy_player_info'?'kona_player_info':'proTeamSchedules_wl')
    if(input.mode==='fantasy_players')url.searchParams.set('scoringPeriodId','0')
  }
  if(def.root==='search'){
    if(typeof input.query!=='string'||input.query.trim().length<2||input.query.length>80)
      throw Error('Búsqueda ESPN inválida')
    url.searchParams.set('query',input.query.trim())
  }
  if(def.root==='videos'){
    url.searchParams.set('sport',sport);url.searchParams.set('league',league)
  }
  if(def.root==='news')url.searchParams.set('limit','25')
  if(input.mode==='team_news')url.searchParams.set('team',digits(input.teamId,'teamId'))
  if(input.mode==='team_schedule')url.searchParams.set('season',number(input.season,'season',1900,2100))
  if(input.mode==='athlete_splits')url.searchParams.set('season',number(input.season,'season',1900,2100))
  if(input.mode==='standings'&&input.season!==undefined)url.searchParams.set('season',number(input.season,'season',1900,2100))
  const defaultLimit=input.mode==='game_plays'?100:25
  if(input.limit!==undefined&&def.root!=='fantasy'&&def.root!=='cdn')url.searchParams.set('limit',number(input.limit,'limit',1,200))
  else if(def.root==='core')url.searchParams.set('limit',String(defaultLimit))
  return url.toString()
}
const compact=(raw:unknown,depth=0):unknown=>{
  if(depth>4)return '[truncated depth]'
  if(typeof raw==='string')return raw.slice(0,350)
  if(Array.isArray(raw))return raw.slice(0,6).map(v=>compact(v,depth+1))
  if(raw!==null&&typeof raw==='object'){
    const result:Record<string,unknown>={}
    for(const [key,value] of Object.entries(raw).slice(0,18))
      result[key]=compact(value,depth+1)
    return result
  }
  return raw
}
/** Resolve a bounded number of first-party ESPN references, without leaving
 * the selected sport/league or allowing user-supplied hosts and paths.
 * @param snapshot - One ESPN result which may contain a list of references.
 * @param endpoint - Canonical host + sport + league bound to this request.
 * @param getJSON - Read-only provider transport.
 * @returns Reference values with unavailable flags when the source fails.
 */
async function resolveExtendedRefs(snapshot:unknown,endpoint:string,
  getJSON:<T>(url:string)=>Promise<T>):Promise<{data:unknown;resolvedRefs:number;refCount:number}>{
  const root=snapshot!==null&&typeof snapshot==='object'&&!Array.isArray(snapshot)?
    snapshot as Record<string,unknown>:{}
  const candidates=Array.isArray(root.items)?root.items:Array.isArray(snapshot)?snapshot:null
  if(!candidates)return {data:snapshot,resolvedRefs:0,refCount:0}
  const parent=new URL(endpoint)
  const base=parent.pathname.match(/^(.+?\/sports\/[^/]+\/(?:leagues\/)?[^/]+)(?:\/|$)/u)?.[1]+'/'
  let resolvedRefs=0,refCount=0
  const allowed=(raw:unknown):string|null=>{
    if(typeof raw!=='string'||raw.length>600)return null
    try{
      const u=new URL(raw)
      return u.protocol==='https:'&&u.hostname===parent.hostname&&
        u.pathname.startsWith(base)&&!u.username&&!u.password?u.toString():null
    }catch{return null}
  }
  const out:unknown[]=[]
  for(const candidate of candidates.slice(0,12)){
    const item=candidate!==null&&typeof candidate==='object'&&!Array.isArray(candidate)?
      candidate as Record<string,unknown>:{}
    if(typeof item.$ref!=='string'){out.push(candidate);continue}
    refCount++
    const ref=allowed(item.$ref)
    if(!ref||resolvedRefs>=6){out.push({$ref:item.$ref,unresolved:true});continue}
    try{
      const read=await getJSON<unknown>(ref)
      out.push(read);resolvedRefs++
    }catch{out.push({$ref:ref,unavailable:true})}
  }
  return {data:out,resolvedRefs,refCount}
}
/**
 * Read an ESPN route with bounded returned JSON and explicit empty/error states.
 * @param input - The validated read-only route request.
 * @param getJSON - Fixed-host transport supplied by the tool layer.
 * @param now - Timestamp used for provenance and deterministic tests.
 * @returns Observed endpoint data or an unavailable status, never guessed values.
 */
export async function readExtendedEspn(
  input:ExtendedEspnInput,getJSON:<T>(url:string)=>Promise<T>,
  now=Date.now(),
){
  const endpoint=extendedEspnUrl(input)
  const base={mode:input.mode,endpoint,checkedAt:new Date(now).toISOString(),
    source:'ESPN Site/Core/Web (no oficial, disponibilidad variable)',
    warning:'Las rutas del catálogo no están todas verificadas. Datos de pronosticadores, injuries o powerindex no prueban cuotas vigentes ni acierto propio.'}
  try{
    const data:unknown=await getJSON<unknown>(endpoint)
    const obj=data!==null&&typeof data==='object'&&!Array.isArray(data)
      ?data as Record<string,unknown>:{}
    const items=Array.isArray(obj.items)?obj.items:null
    const rows=items?.length??(Array.isArray(data)?data.length:Object.keys(obj).length?1:0)
    const resolved=await resolveExtendedRefs(items??data,endpoint,getJSON)
    const rawRefs=items?.length&&items.every(x=>x!==null&&typeof x==='object'&&
      Object.keys(x as Record<string,unknown>).every(k=>k==='$ref'))
    const status=rows===0||obj.error||obj.errors?'empty':rawRefs&&resolved.resolvedRefs===0?'ref_only':'data'
    return {...base,status,count:typeof obj.count==='number'?obj.count:rows,
      refCount:resolved.refCount,resolvedRefs:resolved.resolvedRefs,
      snapshot:compact(resolved.data)}
  }catch(error){
    return {...base,status:'unavailable',count:0,snapshot:null,
      error:error instanceof Error?error.message.slice(0,200):'Error desconocido'}
  }
}
