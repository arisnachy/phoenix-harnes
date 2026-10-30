/** Read-only ESPN scoreboard market PREVIEW for native sports cards.
 * Observed sportsbook lines are never promoted to guaranteed live/executable offers.
 */
import {normalizeEspnMarkets} from './espn-odds.ts'

export type SportsSlatePrice={market:'h2h'|'totals'|'spreads';selection:string;price:string;point?:string}
export type SportsSlateMarketPreview={
  bookmaker:string;source:'ESPN Scoreboard';status:'sin_fecha'|'antigua'|'observada'
  updatedAt?:string;favorite?:string;prices:SportsSlatePrice[]
}
type EventShape={id?:unknown;date?:unknown;competitions?:Array<{odds?:unknown;competitors?:unknown}>}
const safeText=(value:unknown,max=90)=>typeof value==='string'
  ?value.replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,max):''
const strId=(v:unknown)=>typeof v==='string'||typeof v==='number'?String(v):''

/** Extract one bookmaker's genuine lines from this EXACT ESPN pregame event.
 * @param value - ESPN Site scoreboard event.
 * @param now - Observation clock used to classify freshness, not to forge quote timestamps.
 * @returns Limited 2-way moneyline and optional total/spread reference, or null.
 */
export function espnSlateMarketPreview(value:unknown,now=Date.now()):SportsSlateMarketPreview|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null
  const event=value as EventShape
  if(!/^\d{1,16}$/u.test(strId(event.id))||typeof event.date!=='string'
    ||!Number.isFinite(Date.parse(event.date))||Date.parse(event.date)<=now)return null
  const competition=event.competitions?.[0]
  if(!competition||!Array.isArray(competition.odds))return null
  const quotes=normalizeEspnMarkets(
    event as Parameters<typeof normalizeEspnMarkets>[0],
    competition.odds as Parameters<typeof normalizeEspnMarkets>[1],{now},
  ).filter(q=>['h2h','spreads','totals'].includes(q.market)&&Number.isFinite(q.price)
    &&q.price>1&&q.price<1000&&!q.bookmaker.includes('nombre no verificado'))
  // Require BOTH opponent prices from the SAME bookmaker for any favorite.
  const groups=new Map<string,typeof quotes>()
  for(const quote of quotes){
    const key=quote.bookmaker
    const group=groups.get(key)??[]
    group.push(quote)
    groups.set(key,group)
  }
  const complete=[...groups.entries()].map(([bookmaker,rows])=>{
    const first=rows[0]
    const sides=rows.filter(q=>q.market==='h2h'&&(q.selection===first?.home||q.selection===first?.away))
    const twoWay=sides.length===2&&sides[0]?.selection!==sides[1]?.selection
    const totals=rows.filter(q=>q.market==='totals')
    const hasTotals=totals.some(q=>q.selection==='Over'&&totals.some(other=>
      other.selection==='Under'&&other.point===q.point))
    const spreads=rows.filter(q=>q.market==='spreads')
    const hasSpreads=spreads.some(q=>spreads.some(other=>
      other.selection!==q.selection&&q.point!==null&&other.point===-Number(q.point)))
    return {bookmaker,rows,sides,twoWay,hasTotals,hasSpreads}
  }).filter(g=>g.twoWay||g.hasTotals||g.hasSpreads)
  // Prefer full moneyline pairs, then supported two-sided alternative markets.
  // Never mix bookmakers or infer a favorite from spreads/totals alone.
  complete.sort((a,b)=>Number(b.twoWay)-Number(a.twoWay)
    ||b.rows.length-a.rows.length||a.bookmaker.localeCompare(b.bookmaker))
  const selected=complete[0]
  if(!selected)return null
  const one=selected.twoWay?selected.sides[0]:undefined
  const two=selected.twoWay?selected.sides[1]:undefined
  const favored=one&&two&&one.price!==two.price?(one.price<two.price?one:two).selection:undefined
  const timestamp=Date.parse(selected.rows[0]?.updatedAt??'')
  const fresh=Number.isFinite(timestamp)&&timestamp<=now&&now-timestamp<=3_600_000
  const status=Number.isFinite(timestamp)?fresh?'observada':'antigua':'sin_fecha'
  const priority=['h2h','spreads','totals']
  const prices=selected.rows.filter(q=>{
    if(q.market==='h2h')return selected.twoWay&&(q.selection===one?.selection||q.selection===two?.selection)
    if(q.market==='spreads')return q.point!==null&&q.point!==undefined
    return q.market==='totals'&&q.point!==null&&q.point!==undefined
  }).sort((a,b)=>priority.indexOf(a.market)-priority.indexOf(b.market))
    .slice(0,6).map(q=>({
      market:q.market as SportsSlatePrice['market'],selection:safeText(q.selection,75),
      price:q.price.toFixed(2),
      ...(q.point===null||q.point===undefined?{}:{point:String(q.point)}),
    }))
  if(prices.length<2)return null
  return {bookmaker:safeText(selected.bookmaker,100),source:'ESPN Scoreboard',
    status,...(Number.isFinite(timestamp)?{updatedAt:new Date(timestamp).toISOString()}:{}),
    ...(favored?{favorite:safeText(favored,95)}:{}),prices}
}
