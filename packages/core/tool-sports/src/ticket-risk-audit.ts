/** Market-derived comparisons for multi-leg tickets, never a calibrated forecast. */
export type TicketMarketLeg={
  eventId:string;selection:string|null;market:string;noVigShare:number|null
}
export type TicketMarketRisk={
  legs:Array<{eventId:string;selection:string|null;market:string;
    noVigPercent:number|null;relativeRisk:'elevated'|'moderate'|'lower'|'unknown'}>
  weakest:{eventId:string;selection:string;noVigPercent:number}|null
  fullPercent:number|null;fourLegPercent:number|null;threeLegPercent:number|null
  coreThree:string[];coreFour:string[];missingQuotes:number
  basis:'bookmaker-no-vig-with-independence-assumption'
  calibrated:false;approvedForBetting:false;warning:string
}
const percentage=(n:number)=>Number((100*n).toFixed(2))
/** A lower-leg product only shows price-implied joint risk if events were independent. */
export function auditTicketMarketRisk(inputs:readonly TicketMarketLeg[]):TicketMarketRisk{
  const valid=(p:number|null)=>typeof p==='number'&&
    Number.isFinite(p)&&p>0&&p<1
  const usable=inputs.filter(r=>valid(r.noVigShare)).sort((a,b)=>
    b.noVigShare!-a.noVigShare!)
  const product=(n:number):number|null=>usable.length<n?null:
    percentage(usable.slice(0,n).reduce((p,x)=>p*x.noVigShare!,1))
  const complete=usable.length===inputs.length&&inputs.length>0
  const weak=complete?usable[usable.length-1]:undefined
  return{
    legs:inputs.map(row=>{
      const share=valid(row.noVigShare)?row.noVigShare!:null
      const relativeRisk:TicketMarketRisk['legs'][number]['relativeRisk']=
        share===null?'unknown':share<.6?'elevated':share<.7?'moderate':'lower'
      return{eventId:row.eventId,selection:row.selection,market:row.market,
        noVigPercent:share===null?null:percentage(share),relativeRisk}
    }),
    weakest:weak&&weak.selection?{eventId:weak.eventId,selection:weak.selection,
      noVigPercent:percentage(weak.noVigShare!)}:null,
    fullPercent:complete?product(inputs.length):null,
    threeLegPercent:product(3),fourLegPercent:product(4),
    coreThree:usable.slice(0,3).map(x=>x.eventId),
    coreFour:usable.slice(0,4).map(x=>x.eventId),
    missingQuotes:inputs.length-usable.length,
    basis:'bookmaker-no-vig-with-independence-assumption',
    calibrated:false,approvedForBetting:false,
    warning:'Estos porcentajes son productos de cuotas sin margen de la casa suponiendo independencia; NO son predicciones calibradas, valor esperado ni garantia. La correlacion y bajas actuales requieren verificacion.',
  }
}
