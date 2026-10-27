/** Optional verification layer for bookmaker favorites: evidence, not prediction. */
import {getFeed} from './sports.ts'
import {compareStandings,type StandingsTeam,type StandingsSignal} from './standings-research.ts'

const ESPN_ROUTES:Readonly<Record<string,readonly [string,string]>>={
  basketball_nba:['basketball','nba'],basketball_wnba:['basketball','wnba'],
  americanfootball_nfl:['football','nfl'],icehockey_nhl:['hockey','nhl'],
  baseball_mlb:['baseball','mlb'],soccer_epl:['soccer','eng.1'],
  soccer_spain_la_liga:['soccer','esp.1'],soccer_uefa_champs_league:['soccer','uefa.champions'],
}
type ESPNCompetitor=StandingsTeam&{
  homeAway?:string
  team?:{displayName?:string;name?:string;logo?:string;logos?:Array<{href?:string}>}
}
type ESPNEvent={
  id?:string|number
  date?:string
  status?:{type?:{state?:string}}
  competitions?:Array<{competitors?:ESPNCompetitor[]}>
}
type ESPNBoard={events?:ESPNEvent[]}
export type MarketMatchup={
  home:string;away:string;eventId:string
  homeLogo?:string;awayLogo?:string
  signal:StandingsSignal
}
const safeLogo=(url?:string):string|undefined=>
  url&&/^https:\/\/a\.espncdn\.com\//u.test(url)?url:undefined
const name=(side:ESPNCompetitor):string=>
  (side.team?.displayName??side.team?.name??'').trim().slice(0,120)
const normal=(value:string):string=>value.normalize('NFKD')
  .replace(/[\u0300-\u036f]/gu,'').toLocaleLowerCase('en-US')
  .replace(/\s+/gu,' ').trim()
/**
 * Only attach team imagery/standings after an EXACT two-team match.
 * This avoids accidentally matching different fixtures or renamed teams.
 */
export function findVerifiedMatchup(
  matches:readonly MarketMatchup[],home:string,away:string,
):MarketMatchup|undefined {
  return matches.find(m=>normal(m.home)===normal(home)&&normal(m.away)===normal(away))
}
/** Bounded single-league scoreboard lookup; unsupported provider keys are not guessed. */
export async function loadMarketMatchups(
  sportKey:string,date:string,fetcher:typeof fetch=fetch,now=Date.now(),
):Promise<MarketMatchup[]>{
  const route=ESPN_ROUTES[sportKey]
  if(!route||!/^\d{4}-\d{2}-\d{2}$/u.test(date))return []
  const board=await getFeed<ESPNBoard>(
    'https://site.api.espn.com/apis/site/v2/sports/'+route[0]+'/'+route[1]+
    '/scoreboard?dates='+date.replaceAll('-',''),fetcher)
  if(!Array.isArray(board.events))return []
  return board.events.slice(0,40).flatMap(event=>{
    const dt=Date.parse(event.date??'')
    if(!Number.isFinite(dt)||dt<=now||event.status?.type?.state==='post'
      ||event.status?.type?.state==='in')return []
    const competitors=event.competitions?.[0]?.competitors
    const home=competitors?.find(x=>x.homeAway==='home')
    const away=competitors?.find(x=>x.homeAway==='away')
    if(!home||!away||!name(home)||!name(away)||!event.id)return []
    const homeLogo=safeLogo(home.team?.logo??home.team?.logos?.[0]?.href)
    const awayLogo=safeLogo(away.team?.logo??away.team?.logos?.[0]?.href)
    return [{
      home:name(home),away:name(away),eventId:String(event.id),
      ...(homeLogo?{homeLogo}:{}),...(awayLogo?{awayLogo}:{}),
      signal:compareStandings(home,away),
    }]
  })
}
