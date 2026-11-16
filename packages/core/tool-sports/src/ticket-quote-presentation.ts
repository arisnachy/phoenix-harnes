/** Preserve REAL per-leg prices on partial, non-parlay research tickets.
 * A 1/5 matched ESPN price must never disappear into the original draft's
 * "Por verificar" placeholder just because four other legs are missing.
 */
import type {KeylessQuote} from './keyless-odds.ts'

type TicketDisplayLeg=Record<string,unknown>
const espn=(source:string)=>/^ESPN(?:\s|\/|$)/iu.test(source)
/** Visible quote, selected by source priority rather than biggest price.
 * @param quotes Matching, validated prices for this exact fixture and pick.
 * @returns Prefer the ESPN observation; otherwise the latest source reading.
 */
export function preferredObservedQuote(quotes:readonly KeylessQuote[]):KeylessQuote|null{
  return quotes.filter(q=>Number.isFinite(q.price)&&q.price>1&&q.price<1000&&
    Boolean(q.bookmaker?.trim())).slice().sort((a,b)=>{
    const first=Number(espn(a.source??'')),second=Number(espn(b.source??''))
    if(first!==second)return second-first
    const at=Date.parse(a.observedAt??a.updatedAt??'')
    const bt=Date.parse(b.observedAt??b.updatedAt??'')
    if(Number.isFinite(at)&&Number.isFinite(bt)&&at!==bt)return bt-at
    return b.price-a.price
  })[0]??null
}
/** Join already-validated prices to individual research legs without
 * inventing a combined quote, bookmaker acceptance or betting approval.
 * @param legs Original evidence-ticket legs (possibly unpriced).
 * @param groups Matching quote groups in EXACT leg order.
 * @returns Each leg preserves its research status and displays a real price.
 */
export function presentObservedTicketLegs(
  legs:readonly unknown[],groups:readonly (readonly KeylessQuote[])[],
):TicketDisplayLeg[]{
  return legs.map((value,index)=>{
    const original=value&&typeof value==='object'&&!Array.isArray(value)
      ?value as TicketDisplayLeg:{}
    const q=preferredObservedQuote(groups[index]??[])
    if(!q)return {...original,quoteStatus:'unpriced',
      price:'Por verificar',bookmaker:'Sin casa confirmada'}
    const observedAt=q.observedAt??null
    const updated=Date.parse(q.updatedAt??'')
    return {...original,
      price:String(q.price),bookmaker:q.bookmaker,
      quoteStatus:espn(q.source??'')?'espn-observed':'provider-observed',
      quoteSource:q.source,quoteSelection:q.selection,quoteMarket:q.market,
      quoteEventId:q.eventId,quoteObservedAt:observedAt,
      bookmakerUpdatedAt:Number.isFinite(updated)?q.updatedAt:null,
      quoteAcceptedByBookmaker:false,
      // Research status remains conditional unless specialist evidence says otherwise.
    }
  })
}
