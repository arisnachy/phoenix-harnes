/** Multi-market bookmaker lens. Prices are observations, not model estimates.
 * Includes only coherent, time-stamped, complete markets so a single low
 * quote does not become a fabricated "highest chance" recommendation.
 */
import type {MarketOutcome} from './sports.ts'
export type MarketComparison={
  event:string;market:string;bookmaker:string;source:string
  selections:Array<{name:string;price:number;point:number|null;
    impliedFromQuote:number;noVigShare:number|null}>
  totalBookOverround:number|null
  freshnessMinutes:number
  observation:'market-pricing-only'
}
const MARKET_SET=new Set(['h2h','1x2','double_chance','totals','spreads','btts','moneyline',
  'home_away','match_winner'])
const key=(row:MarketOutcome)=>[row.sportKey??'',row.eventId,row.bookmaker,row.market,
  row.point??''].join('|')
export function compareBettingMarkets(
  source:readonly MarketOutcome[],now=Date.now(),maxAgeMs=60*60*1000,
):{markets:MarketComparison[];rejected:number;warning:string}{
  const groups=new Map<string,MarketOutcome[]>()
  let rejected=0
  for(const row of source.slice(0,1500)){
    const market=row.market.toLowerCase()
    const at=Date.parse(row.updatedAt),kickoff=Date.parse(row.timeIso??row.time)
    if(!MARKET_SET.has(market)||!Number.isFinite(row.price)
      ||row.price<=1||row.price>1000||!row.bookmaker.trim()||!row.selection.trim()
      ||!Number.isFinite(at)||at>now||now-at>maxAgeMs
      ||!Number.isFinite(kickoff)||kickoff<=now
      ||!row.source?.trim()){rejected++;continue}
    const group=groups.get(key(row))??[]
    if(!group.some(x=>x.selection===row.selection&&x.point===row.point))
      group.push(row)
    groups.set(key(row),group)
  }
  const comparisons:MarketComparison[]=[]
  for(const rows of groups.values()){
    const initial=rows[0]
    if(!initial)continue
    const labels=new Set(rows.map(r=>r.selection.toLowerCase()))
    const market=initial.market.toLowerCase()
    // Most 2-way and totals require both sides; soccer 3-way requires DRAW.
    const needsDraw=market==='1x2'
    const hasDraw=[...labels].some(x=>/^(draw|empate|tie|x)$/u.test(x))
    if(rows.length<2||(needsDraw&&(!hasDraw||rows.length<3)))continue
    const inverse=rows.map(row=>1/row.price)
    const sum=inverse.reduce((a,b)=>a+b,0)
    // Only the full, mutually exclusive 2-way or 3-way menu permits
    // no-vig normalization. Double-chance legs overlap: never normalize them.
    const complete=(market==='1x2'&&rows.length===3&&hasDraw)
      ||(['h2h','moneyline','home_away','match_winner','btts','totals','spreads']
        .includes(market)&&rows.length===2)
    const shares=rows.map((q,i)=>({
      name:q.selection,price:q.price,point:q.point??null,
      impliedFromQuote:Number((inverse[i]??0).toFixed(5)),
      noVigShare:complete?Number(((inverse[i]??0)/sum).toFixed(5)):null,
    }))
    comparisons.push({
      event:initial.away+' vs '+initial.home,market:initial.market,
      bookmaker:initial.bookmaker,source:initial.source??'',
      selections:shares,totalBookOverround:complete?Number((sum-1).toFixed(5)):null,
      freshnessMinutes:Number(((now-Date.parse(initial.updatedAt))/60000).toFixed(1)),
      observation:'market-pricing-only',
    })
  }
  comparisons.sort((a,b)=>b.selections.length-a.selections.length||
    a.freshnessMinutes-b.freshnessMinutes)
  return{markets:comparisons.slice(0,40),rejected,
    warning:'1/cuota es probabilidad implícita del PRECIO, no estimación independiente de victoria. Doble oportunidad, mercados de jugador y apuestas relacionadas pueden solaparse. Sin probabilidades calibradas, lesiones y titulares confirmados NO se puede afirmar ventaja esperada ni que la opción más barata ganará.'}
}
export const supportedMarketFamilies=[
  {sport:'Fútbol',markets:['1X2','1X/X2','Ambos marcan','Totales','Hándicap asiático']},
  {sport:'NBA/WNBA',markets:['Moneyline','Hándicap','Total de puntos','Jugador: puntos/rebotes/asistencias si el proveedor lo publica']},
  {sport:'NHL',markets:['Moneyline','Puck line','Totales de goles','Tiros/portero si el proveedor lo publica']},
  {sport:'MLB',markets:['Moneyline','Run line','Totales de carreras','Ponches del abridor si se verifican']},
  {sport:'NFL',markets:['Moneyline','Spread','Total de puntos','Recepciones/yarda del jugador si se publican']},
  {sport:'Tenis',markets:['Ganador','Hándicap de juegos','Total de juegos/sets']},
] as const
