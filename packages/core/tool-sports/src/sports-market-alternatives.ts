/** Read-only market alternatives for a future, verified sports fixture.
 * Compare actual bookmaker markets against an EXPLORATORY projected score
 * without fabricating probabilities of covering spreads or prop outcomes.
 */
import type {MarketComparison} from './sports-market-intelligence.ts'

export type SportMarketAlternative={
  family:'winner'|'run-line'|'spread'|'total'|'other'
  event:string;bookmaker:string;market:string;source:string
  freshnessMinutes:number;point:number|null
  quotes:Array<{selection:string;decimalPrice:number;noVigShare:number|null;point:number|null}>
  provisionalLean:string|null;reason:string;calibratedEdge:false
}
const text=(value:unknown,max=150)=>typeof value==='string'?value.trim().slice(0,max):''
/** Translate complete, current moneyline, run line, spread and total offers
 * into inspectable options for Kira and the existing ticket tool.
 * @param sport - ESPN sport; required to distinguish MLB run line.
 * @param markets - Only prevalidated complete bookmaker markets.
 * @param projectedHome - Exploratory projected home score or null.
 * @param projectedAway - Exploratory projected away score or null.
 * @returns Attributed alternatives, never an automatic bet or claimed edge.
 */
export function sportsMarketAlternatives(sport:string,markets:readonly MarketComparison[],
 projectedHome:number|null,projectedAway:number|null):{
  alternatives:SportMarketAlternative[];unavailable:string[];warning:string
 }{
  const projected=projectedHome!==null&&projectedAway!==null&&
    Number.isFinite(projectedHome)&&Number.isFinite(projectedAway)
  const projectedDiff=projected?projectedHome-projectedAway:null
  const projectedTotal=projected?projectedHome+projectedAway:null
  const candidates:SportMarketAlternative[]=[]
  for(const market of markets.slice(0,24)){
    const name=market.market.toLowerCase()
    const selections=market.selections
    if(!['h2h','moneyline','home_away','match_winner','1x2','spreads','totals'].includes(name)
      ||selections.length<2||selections.length>3||selections.some(x=>
        !Number.isFinite(x.price)||x.price<=1||x.noVigShare===null)
      ||!Number.isFinite(market.freshnessMinutes)||market.freshnessMinutes<0
      ||market.freshnessMinutes>60||!text(market.bookmaker))continue
    const isTotals=name==='totals',isSpread=name==='spreads'
    const family:isSportsMarketFamily=sport==='baseball'&&isSpread?'run-line':
      isSpread?'spread':isTotals?'total':'winner'
    let lean:string|null=null
    let reason='Mercado completo observado; requiere análisis de valor independiente.'
    if(projectedDiff!==null&&projectedTotal!==null){
      if(isTotals){
        const target=selections[0]?.point
        const over=selections.find(x=>x.name.toLowerCase()==='over')
        const under=selections.find(x=>x.name.toLowerCase()==='under')
        if(target!==null&&target!==undefined&&over&&under&&
          Math.abs(projectedTotal-target)>=0.6){
          lean=projectedTotal>target?over.name:under.name
          reason='Comparación exploratoria: total proyectado '+
            projectedTotal.toFixed(1)+' frente a línea '+target+'. Sin probabilidad calibrada de superar la línea.'
        }
      }else if(isSpread){
        const home=selections.find(x=>x.point!==null&&x.point!==undefined&&
          Math.abs(x.point)<100)
        if(home&&Math.abs(projectedDiff)>=1){
          // A point spread outcome requires knowing which quoted selection is
          // the actual home team. Without team-ID matching no pick is safe.
          reason='Diferencia de marcador exploratoria '+
            projectedDiff.toFixed(1)+'; falta conciliar el signo del hándicap con ID local/visitante.'
        }
      }else{
        reason='Probabilidades del precio depuradas solo del margen; no son predicciones de victoria.'
      }
    }
    candidates.push({family,event:text(market.event),bookmaker:text(market.bookmaker,95),
      market:name,source:text(market.source,120),
      freshnessMinutes:market.freshnessMinutes,
      point:selections[0]?.point??null,
      quotes:selections.map(x=>({selection:text(x.name,90),decimalPrice:x.price,
        noVigShare:x.noVigShare,point:x.point})),
      provisionalLean:lean,reason,calibratedEdge:false})
  }
  return {alternatives:candidates.slice(0,12),
    unavailable:[
      'Props de jugador: se requiere una oferta de casa con ID del atleta, línea, período y marca de actualización; las estadísticas ESPN solas no generan una cuota comercial.',
      'EV y probabilidad de cubrir run line/spread: requieren un modelo calibrado para ese mercado; no extrapolar desde moneyline.'
    ],
    warning:'Alternativas observadas y comparaciones exploratorias, NO un boleto aprobado, ventaja apostable ni garantía de ganancia.'}
}
type isSportsMarketFamily=SportMarketAlternative['family']
