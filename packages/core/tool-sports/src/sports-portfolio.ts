/** A conservative, unplaced sports portfolio from already verified bookmaker quotes.
 * Prices define possible payouts, never true win probabilities or positive EV.
 */
export type SportsPortfolioQuote={
  eventId:string;selection:string;price:number;bookmaker:string;
  source:string;observedAt:string
}
export type SportsPortfolioEntry={
  kind:'single'|'double'|'full';eventIds:string[];selections:string[];
  decimalOdds:number;stake:number;grossIfAllWin:number;breakEvenPercent:number
}
export type SportsPortfolioScenario={
  coreWins:[boolean,boolean];grossReturn:number;netVsBudget:number
}
export type SportsPortfolioPlan={
  status:'quoted-simulation'|'insufficient-quotes'
  simulatedOnly:true;placed:false;approvedForBetting:false
  calibrated:false;positiveExpectedValueProven:false
  bookmaker:string|null;budget:number;reserve:number;committed:number
  coreEventIds:string[];missingCoreIds:string[];fullTicketAvailable:boolean
  entries:SportsPortfolioEntry[];scenarios:SportsPortfolioScenario[]
  maxLoss:number;maxExposureByCoreEvent:Record<string,number>
  allSelectedWinNet:number|null;warnings:string[]
}
const cents=(n:number)=>Math.round(n*100)/100
const percent=(n:number)=>Math.round(n*10000)/100
const validQuote=(q:SportsPortfolioQuote,now:number)=>{
  const observed=Date.parse(q.observedAt)
  return /^\d{1,20}$/u.test(q.eventId)&&q.selection.trim().length>0&&
    q.bookmaker.trim().length>0&&q.source.startsWith('ESPN')&&
    Number.isFinite(q.price)&&q.price>1&&q.price<=1000&&
    Number.isFinite(observed)&&observed<=now&&now-observed<=15*60_000
}
/** Simulate the explicitly selected two cores, without automatically choosing favorites.
 * Reserve is real uncommitted budget, not an additional winning ticket.
 * Scenarios assume binary win/loss (no pushes) and that optional full ticket loses,
 * except allSelectedWinNet when every event wins. Bookmaker rules may differ.
 */
export function simulateSportsPortfolio(
  quotes:readonly SportsPortfolioQuote[],coreEventIds:readonly string[],
  budget:number,fullTicketPercent=0,now=Date.now(),
):SportsPortfolioPlan{
  if(coreEventIds.length!==2||coreEventIds[0]===coreEventIds[1]||
    coreEventIds.some(id=>!/^\d{1,20}$/u.test(id)))
    throw Error('Elegir exactamente dos eventos ESPN diferentes como núcleo.')
  if(!Number.isFinite(budget)||budget<=0||budget>1_000_000)
    throw Error('Presupuesto simulado inválido (0 a 1,000,000).')
  if(!Number.isFinite(fullTicketPercent)||fullTicketPercent<0||fullTicketPercent>10)
    throw Error('La combinada opcional solo puede ocupar 0 a 10% del presupuesto.')
  const seen=new Set<string>()
  const valid=quotes.filter(q=>validQuote(q,now)&&!seen.has(q.eventId)&&
    (seen.add(q.eventId),true))
  const a=valid.find(q=>q.eventId===coreEventIds[0])
  const b=valid.find(q=>q.eventId===coreEventIds[1])
  const matched=Boolean(a&&b&&a.bookmaker===b.bookmaker)
  const book=matched?a!.bookmaker:null
  const missingCoreIds=matched?[]:coreEventIds.filter(id=>
    !valid.some(q=>q.eventId===id&&q.bookmaker===(a?.bookmaker??b?.bookmaker)))
  if(!matched&&missingCoreIds.length===0)missingCoreIds.push(...coreEventIds)
  const full=matched&&quotes.length>=5&&quotes.length<=6&&
    valid.length===quotes.length&&valid.every(q=>q.bookmaker===book)
  const fullStake=full?cents(budget*fullTicketPercent/100):0
  const stakeA=matched?cents(budget*.30):0
  const stakeB=matched?cents(budget*.30):0
  const stakeDouble=matched?cents(budget*.15):0
  const committed=cents(stakeA+stakeB+stakeDouble+fullStake)
  const reserve=cents(budget-committed)
  const entries:SportsPortfolioEntry[]=[]
  const add=(kind:SportsPortfolioEntry['kind'],offers:SportsPortfolioQuote[],stake:number)=>{
    if(!stake)return
    const decimalOdds=offers.reduce((p,q)=>p*q.price,1)
    entries.push({kind,eventIds:offers.map(q=>q.eventId),
      selections:offers.map(q=>q.selection),decimalOdds,
      stake,grossIfAllWin:cents(stake*decimalOdds),
      breakEvenPercent:percent(1/decimalOdds)})
  }
  if(matched){
    add('single',[a!],stakeA)
    add('single',[b!],stakeB)
    add('double',[a!,b!],stakeDouble)
    if(full&&fullStake)add('full',valid,fullStake)
  }
  const scenarios:SportsPortfolioScenario[]=[
    [false,false],[true,false],[false,true],[true,true],
  ].map(([aw,bw])=>{
    const grossReturn=cents((aw?stakeA*a!.price:0)+(bw?stakeB*b!.price:0)+
      (aw&&bw?stakeDouble*a!.price*b!.price:0))
    return{coreWins:[aw,bw] as [boolean,boolean],grossReturn,
      netVsBudget:cents(grossReturn+reserve-budget)}
  }).filter(()=>matched)
  const warnings=[
    'Solo simulación: no hay apuesta aceptada, probabilidad calibrada ni ventaja EV demostrada.',
    'Los escenarios de dos partidos no incluyen pagos del boleto largo salvo el caso de todos ganadores.',
    'No considera push, void, impuestos, cambios de cuota ni correlación entre resultados.',
    ...(fullTicketPercent>0&&!full?['Combinada larga sin todas las cuotas verificadas: dinero conservado en reserva.']:[]),
    ...(matched&&[a!,b!].some(q=>q.price<1.12)?['Favorito con pago muy bajo: revisar si compensa el riesgo añadido.']:[]),
  ]
  return{
    status:matched?'quoted-simulation':'insufficient-quotes',simulatedOnly:true,
    placed:false,approvedForBetting:false,calibrated:false,
    positiveExpectedValueProven:false,bookmaker:book,budget,reserve,committed,
    coreEventIds:[...coreEventIds],missingCoreIds,fullTicketAvailable:full,
    entries,scenarios,maxLoss:committed,
    maxExposureByCoreEvent:matched?{
      [a!.eventId]:cents(stakeA+stakeDouble+fullStake),
      [b!.eventId]:cents(stakeB+stakeDouble+fullStake),
    }:{},
    allSelectedWinNet:matched?cents(
      entries.reduce((sum,entry)=>sum+entry.grossIfAllWin,0)+reserve-budget):null,
    warnings,
  }
}
