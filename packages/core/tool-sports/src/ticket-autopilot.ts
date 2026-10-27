/**
 * Resilient sportsbook ticket research: real single-bookmaker market lines first,
 * attributed unpriced research otherwise. This never transacts or guarantees returns.
 */
import {autoResearchTicket} from './research-ticket.ts'
import {marketOdds,pricedTicket,type ChatBlock,type MarketOutcome,type MarketSelection} from './sports.ts'

const DEFAULT_SPORTS=['basketball_nba','americanfootball_nfl','soccer_epl','baseball_mlb'] as const
const bookmakerIdentity=(value:string):string=>value.trim().toLocaleLowerCase('en-US')
const validDay=(value:string):boolean=>/^\d{4}-\d{2}-\d{2}$/u.test(value)
  &&Number.isFinite(Date.parse(value+'T00:00:00Z'))
  &&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value
const dateInDominicanRepublic=():string=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date())
const validQuote=(quote:MarketOutcome,now:number):boolean=>{
  if(quote.market!=='h2h'||typeof quote.bookmaker!=='string'||!quote.bookmaker.trim()
    ||!quote.eventId||!quote.selection||!Number.isFinite(quote.price)
    ||quote.price<=1.01||quote.price>10)return false
  const timestamp=Date.parse(quote.updatedAt)
  // Unknown provider timestamps are disclosed; stale or future timestamps are rejected.
  return !Number.isFinite(timestamp)||(timestamp<=now+120_000&&now-timestamp<=45*60_000)
}
type Candidate={quote:MarketOutcome;selection:MarketSelection}
type BookCandidate={bookmaker:string;legs:Candidate[];unknownFreshness:number}
export type AutomaticSportsTicket={
  card:ChatBlock
  mode:'priced'|'research'
  verifiedEvents:number
  requestedLegs:number
  complete:boolean
  priced:boolean
  placed:false
  dataGaps:string[]
  providerErrors:string[]
}
type ResearchFallback=(count:number,date:string)=>Promise<{
  card:ChatBlock;verifiedEvents:number;complete:boolean
}>
type OddsLookup=(sportKey:string,date:string)=>Promise<MarketOutcome[]>
/** Choose only one favorite for each real event/bookmaker; never mix bookmakers. */
export function rankMarketFavorites(quotes:readonly MarketOutcome[],count:number,now=Date.now()):BookCandidate[]{
  const books=new Map<string,Map<string,Candidate>>()
  for(const quote of quotes){
    if(!validQuote(quote,now))continue
    const house=bookmakerIdentity(quote.bookmaker)
    const event=(quote.sportKey??'')+'|'+quote.eventId
    const book=books.get(house)??new Map<string,Candidate>()
    const previous=book.get(event)
    if(!previous||quote.price<previous.quote.price){
      book.set(event,{
        quote,
        selection:{eventId:quote.eventId,bookmaker:quote.bookmaker,market:'h2h',
          selection:quote.selection,point:quote.point??null},
      })
    }
    books.set(house,book)
  }
  const ranked=[...books].map(([,events])=>{
    const legs=[...events.values()].sort((a,b)=>a.quote.price-b.quote.price)
      .slice(0,count)
    return {
      bookmaker:legs[0]?.quote.bookmaker??'',
      legs,
      unknownFreshness:legs.filter(x=>!Number.isFinite(Date.parse(x.quote.updatedAt))).length,
    }
  }).filter(x=>x.legs.length>0)
  return ranked.sort((a,b)=>b.legs.length-a.legs.length
    ||a.unknownFreshness-b.unknownFreshness
    ||a.legs.reduce((v,x)=>v+x.quote.price,0)-b.legs.reduce((v,x)=>v+x.quote.price,0)
    ||a.bookmaker.localeCompare(b.bookmaker))
}
/**
 * Always return the best attainable verified ticket card. Never claim a bet was placed.
 * Default odds requests are bounded to four sports and then fall back to eight
 * free ESPN schedules instead of stopping when a commercial feed is unavailable.
 */
export async function buildAutomaticSportsTicket(
  count:number,
  requestedDate=dateInDominicanRepublic(),
  sportKeys:readonly string[]=DEFAULT_SPORTS,
  stake=0,
  lookup:OddsLookup=(key,date)=>marketOdds(key,'h2h',process.env,fetch,date),
  fallback:ResearchFallback=(legs,date)=>autoResearchTicket(legs,date),
  now=Date.now(),
):Promise<AutomaticSportsTicket>{
  if(!Number.isInteger(count)||count<1||count>6)throw Error('Número de patas inválido (1 a 6)')
  if(!validDay(requestedDate))throw Error('Fecha inválida')
  if(!Array.isArray(sportKeys)||sportKeys.length<1||sportKeys.length>4
    ||sportKeys.some(key=>typeof key!=='string'||!/^[a-z0-9_]{3,80}$/u.test(key)))
    throw Error('Indica entre una y cuatro ligas compatibles con el proveedor')
  if(!Number.isFinite(stake)||stake<0||stake>1e6)throw Error('Importe inválido')
  const results=await Promise.allSettled([...new Set(sportKeys)].map(key=>lookup(key,requestedDate)))
  const quotes:MarketOutcome[]=[],providerErrors:string[]=[]
  results.forEach((result,i)=>{
    if(result.status==='fulfilled')quotes.push(...result.value.slice(0,250))
    else providerErrors.push(sportKeys[i]+': fuente no disponible')
  })
  const group=rankMarketFavorites(quotes,count,now)[0]
  if(group&&group.legs.length===count){
    // All legs must be observed in one sportsbook. Moneylines are descriptive
    // market favorites and do not imply positive expected value.
    const picks=group.legs.map(x=>x.selection)
    const {card,warning}=pricedTicket(picks,quotes,stake)
    const props=card.props
    const current=Array.isArray(props.legs)?props.legs as Array<Record<string,unknown>>:[]
    props.legs=current.map((leg,index)=>({
      ...leg,
      rationale:'Favorito observado en '+group.bookmaker+' (cuota '+group.legs[index]?.quote.price.toFixed(2)+
        '). El precio refleja el mercado; no es una probabilidad calibrada ni garantiza valor esperado.',
    }))
    props.title='PHOENIX · Ticket cotizado de '+count+' selecciones'
    props.subtitle='Favoritos de mercado · Una sola casa · Apuesta NO colocada'
    props.requestedLegs=count
    props.note='BOLETO PREPARADO, NO ENVIADO. '+warning+
      ' Favorito del mercado no significa pronóstico validado; faltan lesiones, rendimiento avanzado y aprobación de la banca.'+
      (group.unknownFreshness?' Algunas cuotas no indican hora de actualización.':'')
    props.askPrompt='Kira, revisa lesiones, métricas avanzadas, condiciones y elegibilidad en '+
      group.bookmaker+' antes de preparar la colocación de este boleto. No ejecutes sin mi confirmación.'
    return {card,mode:'priced',verifiedEvents:count,requestedLegs:count,complete:true,
      priced:true,placed:false,providerErrors,dataGaps:[
        'No hay modelo probabilístico calibrado ni valor esperado positivo demostrado.',
        ...(group.unknownFreshness?['Hay cuotas sin hora de actualización publicada.']:[]),
        'Confirmación de mercados y disponibilidad en la banca pendiente.',
      ]}
  }
  const researched=await fallback(count,requestedDate)
  if(!researched.card||researched.card.component!=='sports_ticket_card')
    throw Error('Fuente de pronósticos no generó un ticket deportivo verificable')
  return {
    card:researched.card,mode:'research',verifiedEvents:researched.verifiedEvents,
    requestedLegs:count,complete:researched.complete,priced:false,placed:false,
    providerErrors,
    dataGaps:[
      'No existe una combinada completa cotizada en una misma casa con las fuentes consultadas.',
      'Se conservan las selecciones de investigación sin inventar precios.',
      'Quedan pendientes verificación contextual y autorización de la banca.',
    ],
  }
}
