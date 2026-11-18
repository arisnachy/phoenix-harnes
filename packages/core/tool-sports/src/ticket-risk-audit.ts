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

/** Pair one book's complete, contemporaneous moneyline before removing margin.
 * Never compute no-vig from a single winning side or a different bookmaker.
 */
export type MarketSideOffer={
  eventId:string;bookmaker:string;market:string;selection:string;price:number
  home:string;away:string;time:string;updatedAt:string;source:string
}
const normal=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
export function quoteSideNoVig(
  offered:MarketSideOffer,quotes:readonly MarketSideOffer[],now:number,
):number|null{
  const outcomes=['h2h','home_away','moneyline','match_winner'].includes(offered.market)?2:
    offered.market==='1x2'?3:0
  if(!outcomes)return null
  const at=Date.parse(offered.updatedAt),kickoff=Date.parse(offered.time)
  if(!Number.isFinite(at)||!Number.isFinite(kickoff)||at>now||kickoff<=now)return null
  const validLabels=[normal(offered.home),normal(offered.away),
    ...(outcomes===3?['draw']:[])]
  const selected=quotes.filter(q=>{
    const stamp=Date.parse(q.updatedAt),start=Date.parse(q.time)
    const selection=normal(q.selection)
    return q.eventId===offered.eventId&&q.bookmaker===offered.bookmaker&&
      q.market===offered.market&&q.source===offered.source&&
      normal(q.home)===normal(offered.home)&&normal(q.away)===normal(offered.away)&&
      Number.isFinite(stamp)&&Math.abs(stamp-at)<=10*60_000&&stamp<=now&&
      Number.isFinite(start)&&Math.abs(start-kickoff)<=10*60_000&&
      Number.isFinite(q.price)&&q.price>1&&q.price<=1000&&
      (validLabels.includes(selection)||(outcomes===3&&/^(tie|empate)$/u.test(selection)))
  })
  const labels=selected.map(q=>/^(tie|empate)$/u.test(normal(q.selection))?
    'draw':normal(q.selection))
  if(selected.length!==outcomes||new Set(labels).size!==outcomes||
    !validLabels.every(label=>labels.includes(label)))return null
  const match=selected.find(q=>normal(q.selection)===normal(offered.selection)&&
    q.price===offered.price)
  if(!match)return null
  const sum=selected.reduce((n,q)=>n+1/q.price,0)
  if(!Number.isFinite(sum)||sum<.9||sum>1.3)return null
  return Number(((1/match.price)/sum).toFixed(5))
}
