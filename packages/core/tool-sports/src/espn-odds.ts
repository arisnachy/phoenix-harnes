/**
 * Keyless ESPN betting-market observations.
 * These are informal publicly reachable ESPN JSON fields, not a sportsbook API.
 * Never invent missing bookmaker prices or treat ESPN probabilities as wager odds.
 */
export interface EspnMarketQuote {
  eventId: string
  bookmaker: string
  market: string
  selection: string
  point: number | null
  price: number
  home: string
  away: string
  time: string
  updatedAt: string
}
type OddsSide = { moneyLine?: number | string; moneyline?: number | string; spreadOdds?: number|string }
type EspnOdds = {
  provider?: { name?: string;displayName?: string;id?: string|number }
  details?: string
  homeTeamOdds?: OddsSide;awayTeamOdds?: OddsSide
  overOdds?: number|string;underOdds?: number|string
  overUnder?: number|string
  spread?: number|string
  lastUpdated?: string;lastUpdate?: string;updatedAt?: string
}
type ECompetition={ id?:string|number;competitors?:Array<{ homeAway?:string;team?:{ displayName?:string;name?:string } }>;odds?:EspnOdds[] }
type EEvent={ id?:string|number;date?:string;competitions?:ECompetition[] }
type ESPNBoard={ events?:EEvent[] }
const slugs:Readonly<Record<string,readonly [string,string]>>={
  baseball_mlb:['baseball','mlb'],basketball_nba:['basketball','nba'],
  basketball_wnba:['basketball','wnba'],americanfootball_nfl:['football','nfl'],
  icehockey_nhl:['hockey','nhl'],soccer_epl:['soccer','eng.1'],
  soccer_spain_la_liga:['soccer','esp.1'],soccer_usa_mls:['soccer','usa.1'],
  soccer_mexico_ligamx:['soccer','mex.1'],soccer_uefa_champs_league:['soccer','uefa.champions'],
}
const americanToDecimal=(value:unknown):number|null=>{
  if(typeof value!=='string'&&typeof value!=='number')return null
  const str=String(value).trim().replace(/\u2212/gu,'-')
  if(!/^[+-]?\d{2,6}$/u.test(str))return null
  const n=Number(str)
  if(!Number.isFinite(n)||Math.abs(n)<100||Math.abs(n)>100000)return null
  return Number((n>0?1+n/100:1+100/Math.abs(n)).toFixed(5))
}
const str=(v:unknown)=>typeof v==='string'?v.slice(0,170):String(v??'').slice(0,170)
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const list=(v:unknown):EspnOdds[]=>Array.isArray(v)?v.filter(isRecord):isRecord(v)?[v]:[]
const safeId=(v:unknown)=>/^\d{1,16}$/u.test(String(v??''))?String(v):null
const localTime=(value:string):string=>{
  const time=new Date(value)
  return Number.isFinite(time.getTime())?new Intl.DateTimeFormat('es-DO',{ timeZone:'America/Santo_Domingo',dateStyle:'medium',timeStyle:'short' }).format(time):'Hora no confirmada'
}
/** Parse quoted American moneylines from an ESPN event without filling in missing markets.
 * @param event - Raw ESPN event with a competition.
 * @param oddEntries - Embedded or Core API quotes.
 * @returns Attributed moneyline outcomes with decimal prices.
 */
export function normalizeEspnMoneylines(event:EEvent,oddEntries:EspnOdds[]):EspnMarketQuote[]{
  const competition=event.competitions?.[0]
  const id=safeId(event.id)
  if(!id||!competition)return []
  const home=competition.competitors?.find(c=>c.homeAway==='home')
  const away=competition.competitors?.find(c=>c.homeAway==='away')
  const homeName=home?.team?.displayName||home?.team?.name
  const awayName=away?.team?.displayName||away?.team?.name
  if(!homeName||!awayName)return []
  const kickoff=new Date(event.date||'')
  // Do not present pregame lines as current for matches which have already started.
  if(!Number.isFinite(kickoff.getTime())||kickoff.getTime()<=Date.now())return []
  const result:EspnMarketQuote[]=[]
  for(const odd of oddEntries.slice(0,5)){
    const provider=odd.provider?.name||odd.provider?.displayName
    if(!provider)continue
    const updatedAt=odd.lastUpdated||odd.lastUpdate||odd.updatedAt||'No indicada por ESPN'
    for(const [selection,value] of [[homeName,odd.homeTeamOdds?.moneyLine??odd.homeTeamOdds?.moneyline],[awayName,odd.awayTeamOdds?.moneyLine??odd.awayTeamOdds?.moneyline]] as const){
      const price=americanToDecimal(value)
      if(price!==null)result.push({ eventId:id,bookmaker:str(provider),market:'h2h',selection:str(selection),point:null,price,home:str(homeName),away:str(awayName),time:localTime(event.date||''),updatedAt:str(updatedAt) })
    }
  }
  return result
}
/** Retrieve available, public ESPN pregame moneylines without a paid API key.
 * @param sportKey - ESPN-compatible sport key, mapped to a known league.
 * @param requestedMarkets - Requested market selection, limited to h2h until priced markets are validated.
 * @param getJSON - Validated fixed-host JSON fetcher provided by sports.ts.
 * @returns Actual ESPN odds or an empty list when unavailable.
 */
export async function fetchPublicEspnOdds(
  sportKey:string,requestedMarkets:string,getJSON:<T>(url:string)=>Promise<T>,requestedDate?:string,
):Promise<EspnMarketQuote[]>{
  const route=slugs[sportKey]
  if(!route)return []
  if(!requestedMarkets.split(',').includes('h2h'))return []
  const day=requestedDate??new Intl.DateTimeFormat('en-CA',{
    timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit',
  }).format(new Date())
  if(!/^\\d{4}-\\d{2}-\\d{2}$/u.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))
    ||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)throw Error('Fecha de cuotas inválida')
  const localDate=day.replaceAll('-','')
  const root='https://site.api.espn.com/apis/site/v2/sports/'+route[0]+'/'+route[1]+'/scoreboard?dates='+localDate
  const board=await getJSON<ESPNBoard>(root)
  if(!Array.isArray(board.events))throw new Error('ESPN devolvió un scoreboard sin eventos válidos')
  const quotes:EspnMarketQuote[]=[]
  for(const event of board.events.slice(0,8)){
    const competition=event.competitions?.[0]
    if(!competition)continue
    let odds=list(competition.odds)
    if(!odds.length){
      const eventId=safeId(event.id),competitionId=safeId(competition.id)
      if(!eventId||!competitionId)continue
      const url='https://sports.core.api.espn.com/v2/sports/'+route[0]+'/leagues/'+route[1]+'/events/'+eventId+'/competitions/'+competitionId+'/odds?limit=5'
      try{
        const data=await getJSON<unknown>(url)
        odds=(Array.isArray(data)?list(data):isRecord(data)?list(data.items):[]).filter(x=>x.homeTeamOdds||x.awayTeamOdds)
        if(!odds.length&&isRecord(data)){
          const refs=Array.isArray(data.items)?data.items.filter(isRecord).slice(0,2):[]
          for(const ref of refs){
            const link=ref.$ref
            if(typeof link!=='string')continue
            const parsed=new URL(link)
            if(parsed.protocol!=='https:'||parsed.hostname!=='sports.core.api.espn.com')continue
            try{odds.push(...list(await getJSON<EspnOdds>(link)))}catch{ /* A listed market may be inaccessible. */ }
          }
        }
      }catch{ /* Missing Core odds must not hide the games or invent lines. */ }
    }
    quotes.push(...normalizeEspnMoneylines(event,odds))
  }
  return quotes.slice(0,100)
}
