/** Audit a dated bookmaker price against independent market-specific estimates.
 * Market-implied shares and descriptive team averages never constitute betting EV.
 */
import type {DailyMarketCandidate} from './daily-market-shortlist.ts'

type Outcome=DailyMarketCandidate['outcomes'][number]
/** A holdout-validated probability for the exact event, period, market and line. */
export type CalibratedMarketEstimate={
  eventId:string;market:DailyMarketCandidate['market']
  selection:string;line:number|null
  probability:number;lowerBound:number;upperBound:number
  trainedThrough:string;holdoutCount:number;status:'validated';source:string
}
export type MarketPriceAudit={
  classification:'unresolved'|'unvalidated'|'negative-value'|'uncertain-value'|'potential-value'
  breakEvenPercent:number|null;marketNoVigPercent:number|null
  bookmakerPremiumPoints:number|null;overroundPercent:number|null
  modelProbabilityPercent:number|null;expectedValuePercent:number|null
  worstCaseValuePercent:number|null;bestCaseValuePercent:number|null
  calibrationSource:string|null;warnings:string[]
}
const pct=(value:number):number=>Number((100*value).toFixed(2))
const normalize=(name:string)=>name.trim().toLowerCase()
/** Calculate the exact break-even price; require a held-out model for EV.
 * @param candidate - Authentic, paired bookmaker market and kickoff.
 * @param outcome - Exact selected bookmaker side or null.
 * @param estimate - Independent, market-specific and pregame calibrated probability.
 * @returns Price thresholds and an explicit validated/unvalidated value decision.
 */
export function auditMarketPrice(candidate:DailyMarketCandidate,outcome:Outcome|null,
  estimate?:CalibratedMarketEstimate|null):MarketPriceAudit{
  const empty:MarketPriceAudit={classification:'unresolved',
    breakEvenPercent:null,marketNoVigPercent:null,bookmakerPremiumPoints:null,
    overroundPercent:null,modelProbabilityPercent:null,expectedValuePercent:null,
    worstCaseValuePercent:null,bestCaseValuePercent:null,calibrationSource:null,
    warnings:['Sin un resultado elegido con cuota exacta no se puede evaluar el mercado.']}
  if(!outcome||!candidate.outcomes.some(x=>x.selection===outcome.selection&&
      x.line===outcome.line&&x.decimalOdds===outcome.decimalOdds)||
    !Number.isFinite(outcome.decimalOdds)||outcome.decimalOdds<=1)return empty
  const implied=1/outcome.decimalOdds,share=outcome.noVigShare
  const price:MarketPriceAudit={...empty,classification:'unvalidated',
    breakEvenPercent:pct(implied),
    marketNoVigPercent:Number.isFinite(share)?pct(share):null,
    bookmakerPremiumPoints:Number.isFinite(share)?pct(implied-share):null,
    overroundPercent:Number.isFinite(candidate.bookmakerOverround)?
      pct(candidate.bookmakerOverround):null,
    warnings:[
      'La cuota exige '+pct(implied)+'% de acierto: es un precio, NO un pronóstico.',
      ...(implied>=.8?['Favorito caro: se necesita más de 80% para equilibrar.']:[]),
      ...(implied>=.7&&candidate.market!=='h2h'?
        ['Hándicap/total caro: +1.5 o más/menos no significa apuesta segura.']:[]),
      ...(candidate.bookmakerOverround>.08?['Margen del operador superior a 8%.']:[]),
      'No existe probabilidad independiente calibrada: valor esperado desconocido.',
    ]}
  if(!estimate)return price
  const kickoff=Date.parse(candidate.kickoff),trained=Date.parse(estimate.trainedThrough)
  const valid=estimate.status==='validated'&&estimate.holdoutCount>=24&&
    estimate.source.trim().length>0&&estimate.eventId===candidate.espnEventId&&
    estimate.market===candidate.market&&
    normalize(estimate.selection)===normalize(outcome.selection)&&
    estimate.line===outcome.line&&Number.isFinite(kickoff)&&
    Number.isFinite(trained)&&trained<kickoff&&
    [estimate.probability,estimate.lowerBound,estimate.upperBound]
      .every(x=>Number.isFinite(x)&&x>=0&&x<=1)&&
    estimate.lowerBound<=estimate.probability&&
    estimate.probability<=estimate.upperBound
  if(!valid)return {...price,warnings:[...price.warnings,
    'Estimación ignorada: línea, evento, muestra o corte temporal sin validar.']}
  const mean=estimate.probability*outcome.decimalOdds-1
  const low=estimate.lowerBound*outcome.decimalOdds-1
  const high=estimate.upperBound*outcome.decimalOdds-1
  const classification:MarketPriceAudit['classification']=high<0?'negative-value':
    low>.02?'potential-value':'uncertain-value'
  return {...price,classification,modelProbabilityPercent:pct(estimate.probability),
    expectedValuePercent:pct(mean),worstCaseValuePercent:pct(low),
    bestCaseValuePercent:pct(high),calibrationSource:estimate.source,
    warnings:classification==='negative-value'?
      ['El límite superior estimado no cubre el precio; descartar.']:
      classification==='potential-value'?
        ['Valor potencial incluso en el intervalo inferior; revisar titulares y reglas.']:
        ['El intervalo no demuestra ventaja suficiente; abstenerse por EV.']}
}
