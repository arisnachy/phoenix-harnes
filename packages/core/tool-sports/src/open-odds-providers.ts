/** Optional, authenticated sportsbook quote fallbacks. Never confuse derived fair
 * probabilities (Bet Better) or API directories (API Evangelist) with bookmakers.
 * Documents: therundown.io/blog/sports-betting-odds-api and
 * sportsgameodds.com/docs/endpoints/getEvents. Read only, no wager placement.
 */
import type {MarketOutcome} from './sports.ts'
import {setTimeout as sleep} from 'node:timers/promises'
// TheRundown Free allows 1 request/sec. Serialize production requests from
// parallel sport-league tools; injected test transports remain deterministic.
let rundownPrevious=0
let rundownQueue:Promise<unknown>=Promise.resolve()
function rundownRequest<T>(job:()=>Promise<T>):Promise<T>{
  const running=rundownQueue.then(async()=>{
    const delay=Math.max(0,rundownPrevious+1100-Date.now())
    if(delay)await sleep(delay)
    rundownPrevious=Date.now()
    return job()
  })
  rundownQueue=running.then(()=>undefined,()=>undefined)
  return running
}
const name=(v:unknown,n=120)=>typeof v==='string'?v.trim().slice(0,n):''
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)
  ?v as Record<string,unknown>:{}
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[]
const when=(v:unknown)=>typeof v==='string'?Date.parse(v):NaN
const validTime=(value:unknown,now:number,future=false)=>
  Number.isFinite(when(value))&&(future
    ?when(value)>now&&when(value)<now+3*86_400_000
    :when(value)<=now&&now-when(value)<7*86_400_000)
// A sportsbook price may remain unchanged for hours even though a current
// API snapshot proves it is still OPEN. Keep source-observed time separate
// from bookmaker last-modified time, never invent an updatedAt value.
const observed=(now:number)=>new Date(now).toISOString()
const decimal=(value:unknown):number|null=>{
  if(typeof value!=='string'&&typeof value!=='number')return null
  const number=Number(value)
  if(!Number.isFinite(number)||number===0||number===0.0001)return null
  // Both providers publish American odds; never mislabel 150 as decimal 150.
  if(Math.abs(number)<100)return null
  const price=number>0?1+number/100:1+100/Math.abs(number)
  return price>1&&price<1000?Math.round(price*1e5)/1e5:null
}
const day=(now:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now))
const filters=(key:string,markets:string)=>{
  if(!/^[a-z0-9_]{3,80}$/u.test(key)||! /^(h2h|spreads|totals)(,(h2h|spreads|totals))*$/u.test(markets))
    throw Error('Liga o mercado de odds inválido')
}
async function requestJson(url:string,token:string,header:string,fetcher:typeof fetch){
  const response=await fetcher(url,{headers:{accept:'application/json',[header]:token},
    cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12_000)})
  if(!response.ok)throw Error('Fuente de cuotas HTTP '+response.status)
  // Do not call a stale CDN snapshot a freshly confirmed OPEN sportsbook line.
  // A successful no-store response with Age above the validity window is
  // unusable even when its embedded updated_at looks plausible.
  const age=response.headers.get('age')
  if(age!==null&&/^[0-9]+$/u.test(age)&&Number(age)>900)
    throw Error('Fuente de cuotas: snapshot de caché demasiado antiguo')
  if(Number(response.headers.get('content-length')||0)>4_000_000)
    throw Error('Respuesta de cuotas demasiado grande')
  const body=await response.text()
  if(body.length>4_000_000)throw Error('Respuesta de cuotas demasiado grande')
  return JSON.parse(body) as unknown
}
const rundownSports:Readonly<Record<string,number>>={
  americanfootball_nfl:2,baseball_mlb:3,basketball_nba:4,
  basketball_wnba:8,icehockey_nhl:6,
  soccer_usa_mls:10,soccer_epl:11,soccer_england_premier_league:11,
  soccer_france_ligue_one:12,soccer_germany_bundesliga:13,
  soccer_spain_la_liga:14,soccer_italy_serie_a:15,
  soccer_uefa_champs_league:16,soccer_uefa_champions_league:16,
  soccer_mexico_ligamx:34,
}
const rundownBooks:Readonly<Record<string,string>>={
  '19':'DraftKings','22':'BetMGM','23':'FanDuel',
}
export const rundownSupports=(sportKey:string)=>Object.hasOwn(rundownSports,sportKey)
export async function fetchTheRundownOdds(
  sportKey:string,markets:string,key:string,fetcher:typeof fetch=fetch,now=Date.now(),
):Promise<MarketOutcome[]>{
  filters(sportKey,markets)
  if(!key.trim())throw Error('THERUNDOWN_API_KEY no configurada')
  const sport=rundownSports[sportKey]
  if(!sport)return []
  const marketIds=markets.split(',').map(m=>m==='h2h'?1:m==='spreads'?2:3).join(',')
  const url=new URL('https://therundown.io/api/v2/sports/'+sport+'/events/'+day(now))
  // TheRundown can group events by UTC day; offset=240 keeps the fixed
  // Dominican Republic (UTC-4) calendar date including late-night games.
  url.searchParams.set('offset','240')
  url.searchParams.set('market_ids',marketIds)
  url.searchParams.set('affiliate_ids','19,22,23')
  url.searchParams.set('main_line','true')
  url.searchParams.set('hide_closed','true')
  const load=()=>requestJson(url.toString(),key,'X-TheRundown-Key',fetcher)
  const raw=obj(await (fetcher===fetch?rundownRequest(load):load()))
  if(!Array.isArray(raw.events))throw Error('TheRundown: respuesta sin events')
  const quotes:MarketOutcome[]=[]
  for(const val of arr(raw.events).slice(0,60)){
    const event=obj(val),teams=arr(event.teams).map(obj)
    const away=teams.find(t=>t.is_away===true),home=teams.find(t=>t.is_away===false)
    const awayName=name(away?.name),homeName=name(home?.name)
    const start=name(event.event_date??event.start_time??event.scheduled_at??event.commence_time,80)
    const eventId=name(event.event_id,100)
    if(!eventId||!homeName||!awayName||!validTime(start,now,true))continue
    for(const value of arr(event.markets).slice(0,15)){
      const market=obj(value),id=Number(market.market_id)
      // Main-line market IDs 1/2/3 represent full-game outcomes in V2.
      // TheRundown's own response examples OMIT period_id entirely, so
      // rejecting that optional field silently drops every valid moneyline.
      // An explicit non-game period is always excluded.
      const period=market.period_id
      if(![1,2,3].includes(id)||
        (period!==undefined&&period!==null&&period!==0&&period!=='0'))continue
      const type=id===1?'h2h':id===2?'spreads':'totals'
      if(!markets.split(',').includes(type))continue
      for(const rawParticipant of arr(market.participants).slice(0,5)){
        const participant=obj(rawParticipant),selection=name(participant.name)
        if(!selection)continue
        if(id===1&&selection!==homeName&&selection!==awayName
          &&! /^(draw|tie|empate)$/iu.test(selection))continue
        if(id===3&&!/^(over|under)$/iu.test(selection))continue
        for(const rawLine of arr(participant.lines).slice(0,8)){
          const line=obj(rawLine),point=id===1?null:Number(line.value)
          if(id!==1&&!Number.isFinite(point))continue
          for(const [affiliate,rawPrice] of Object.entries(obj(line.prices))){
            const bookmaker=rundownBooks[affiliate]
            if(!bookmaker)continue
            const priceRow=obj(rawPrice)
            if(priceRow.closed_at||priceRow.is_main_line===false)continue
            const price=decimal(priceRow.price),updatedAt=name(priceRow.updated_at,80)
            if(price===null||!validTime(updatedAt,now))continue
            quotes.push({sportKey,eventId,home:homeName,away:awayName,
              bookmaker,market:type,selection,point,price,observedAt:observed(now),
              time:start,timeIso:start,updatedAt,source:'TheRundown'})
            if(quotes.length>=500)return quotes
          }
        }
      }
    }
  }
  return quotes
}
const sportsGameLeagues:Readonly<Record<string,string>>={
  americanfootball_nfl:'NFL',baseball_mlb:'MLB',basketball_nba:'NBA',
  basketball_wnba:'WNBA',icehockey_nhl:'NHL',
  soccer_epl:'EPL',soccer_spain_la_liga:'LA_LIGA',
  soccer_usa_mls:'MLS',soccer_germany_bundesliga:'BUNDESLIGA',
  soccer_italy_serie_a:'IT_SERIE_A',soccer_france_ligue_one:'FR_LIGUE_1',
}
export const sportsGameSupports=(sportKey:string)=>Object.hasOwn(sportsGameLeagues,sportKey)
export async function fetchSportsGameOdds(
  sportKey:string,markets:string,key:string,fetcher:typeof fetch=fetch,now=Date.now(),
):Promise<MarketOutcome[]>{
  filters(sportKey,markets)
  if(!key.trim())throw Error('SPORTSGAMEODDS_API_KEY no configurada')
  const league=sportsGameLeagues[sportKey]
  if(!league)return []
  const url=new URL('https://api.sportsgameodds.com/v2/events')
  url.searchParams.set('leagueID',league)
  url.searchParams.set('started','false')
  url.searchParams.set('oddsAvailable','true')
  url.searchParams.set('startsAfter',new Date(now).toISOString())
  url.searchParams.set('startsBefore',new Date(now+36*3_600_000).toISOString())
  url.searchParams.set('limit','35')
  const raw=obj(await requestJson(url.toString(),key,'x-api-key',fetcher))
  if(raw.success!==true||!Array.isArray(raw.data))
    throw Error('SportsGameOdds: respuesta inválida')
  const quotes:MarketOutcome[]=[]
  const soccer=sportKey.startsWith('soccer_')
  for(const value of arr(raw.data).slice(0,35)){
    const event=obj(value),status=obj(event.status),teams=obj(event.teams)
    if(status.started!==false||status.cancelled===true)continue
    const home=name(obj(obj(teams.home).names).long),away=name(obj(obj(teams.away).names).long)
    const start=name(status.startsAt,80),eventId=name(event.eventID,100)
    if(!home||!away||!eventId||!validTime(start,now,true))continue
    for(const value of Object.values(obj(event.odds)).slice(0,140)){
      const odd=obj(value),type=name(odd.betTypeID),period=name(odd.periodID)
      const side=name(odd.sideID),entity=name(odd.statEntityID)
      if(odd.started===true||odd.ended===true||odd.cancelled===true)continue
      const market=type==='sp'?'spreads':type==='ou'?'totals':
        ((soccer&&type==='ml3way'&&period==='reg')||
          (!soccer&&type==='ml'&&period==='game'))?'h2h':null
      if(!market||!markets.split(',').includes(market))continue
      if(market!=='h2h'&&period!==(soccer?'reg':'game'))continue
      const selection=market==='totals'
        ?side==='over'?'Over':side==='under'?'Under':''
        :side==='home'?home:side==='away'?away:
          soccer&&side==='draw'?'Draw':''
      if(!selection||market!=='totals'&&entity!=='home'&&entity!=='away'
        &&selection!=='Draw')continue
      for(const [book,rawBook] of Object.entries(obj(odd.byBookmaker))){
        const item=obj(rawBook)
        if(item.available!==true||book==='unknown'||! /^[a-z0-9_-]{2,60}$/u.test(book))continue
        const price=decimal(item.odds),updatedAt=name(item.lastUpdatedAt,80)
        const point=market==='spreads'?Number(item.spread):
          market==='totals'?Number(item.overUnder):null
        if(price===null||!validTime(updatedAt,now)||
          point!==null&&!Number.isFinite(point))continue
        const bookmaker=({draftkings:'DraftKings',fanduel:'FanDuel',
          betmgm:'BetMGM',betus:'BetUS'} as Record<string,string>)[book]??book
        quotes.push({sportKey,eventId,home,away,bookmaker,market,selection,point,
          price,observedAt:observed(now),time:start,timeIso:start,updatedAt,
          source:'SportsGameOdds'})
        if(quotes.length>=500)return quotes
      }
    }
  }
  return quotes
}
