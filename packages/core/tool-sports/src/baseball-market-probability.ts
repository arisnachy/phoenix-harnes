/**
 * Baseline market arithmetic for baseball. Inputs must be independent,
 * pregame expected run totals fitted elsewhere for the EXACT settlement period.
 * This Poisson baseline is NOT calibrated, is NOT a wagering recommendation,
 * and does not model correlated scoring, pitchers, extra innings or house rules.
 */
export type BaseballPeriod='first_3'|'first_5'|'full_game'
export type BaseballMarket=
  |{family:'total';period:BaseballPeriod;pick:'over'|'under';line:number;decimalOdds:number}
  |{family:'team_total';period:BaseballPeriod;team:'home'|'away';pick:'over'|'under';line:number;decimalOdds:number}
  |{family:'run_line';period:BaseballPeriod;team:'home'|'away';line:number;decimalOdds:number}
export type BaseballMarketEvaluation={
  model:'independent-poisson-baseline-v1'
  period:BaseballPeriod
  probabilityWin:number
  probabilityPush:number
  probabilityLoss:number
  impliedBreakEvenWinProbability:number
  expectedNetReturnPerUnit:number
  expectedNetReturnPercent:number
  eligibleForTicket:false
  calibrated:false
  caveats:readonly string[]
}
/** Precomputed Poisson probability mass, including negligible far tails. */
function poisson(lambda:number):number[]{
  const result:number[]=[]
  let term=Math.exp(-lambda)
  let total=0
  for(let n=0;n<=300;n++){
    result.push(term)
    total+=term
    if(n>lambda+15&&1-total<1e-13)break
    term*=lambda/(n+1)
  }
  if(total<=0||!Number.isFinite(total))throw Error('Distribución de carreras inválida')
  return result.map(p=>p/total)
}
function validate(expectedHomeRuns:number,expectedAwayRuns:number,market:BaseballMarket):void{
  if(!Number.isFinite(expectedHomeRuns)||!Number.isFinite(expectedAwayRuns)
    ||expectedHomeRuns<0||expectedAwayRuns<0||expectedHomeRuns>50||expectedAwayRuns>50)
    throw Error('Proyección de carreras inválida para el período solicitado')
  if(!Number.isFinite(market.line)||market.line< -50||market.line>100
    ||Math.abs(market.line*2-Math.round(market.line*2))>1e-8)
    throw Error('Solo se admiten líneas enteras o medias líneas; los cuartos requieren reglas específicas')
  if(!Number.isFinite(market.decimalOdds)||market.decimalOdds<=1||market.decimalOdds>1000)
    throw Error('Cuota decimal no válida')
  if(!['first_3','first_5','full_game'].includes(market.period))throw Error('Período desconocido')
  if(market.family==='total'||market.family==='team_total'){
    if(market.line<0)throw Error('El total no puede ser negativo')
    if(market.pick!=='over'&&market.pick!=='under')throw Error('Selección de total desconocida')
    if(market.family==='team_total'&&market.team!=='home'&&market.team!=='away')
      throw Error('Equipo de total desconocido')
  }else if(market.family==='run_line'){
    if(market.team!=='home'&&market.team!=='away')throw Error('Equipo de run line desconocido')
  }else throw Error('Mercado de béisbol no implementado')
}
function classification(value:number):'win'|'push'|'loss'{
  return value>1e-9?'win':value< -1e-9?'loss':'push'
}
/**
 * Evaluate the offered market and its push rule, NOT simply "forecast > line".
 * Expected runs must already include venue, weather, pitchers, lineup and bullpen
 * for the market's exact first_3 / first_5 / full_game settlement period.
 * @param expectedHomeRuns - Pregame mean for the home team in market.period.
 * @param expectedAwayRuns - Pregame mean for the away team in market.period.
 * @param market - Verified line, selection, period and decimal odds.
 * @returns Uncalibrated descriptive market probabilities and arithmetic.
 */
export function evaluateBaseballMarket(
  expectedHomeRuns:number,expectedAwayRuns:number,market:BaseballMarket,
):BaseballMarketEvaluation{
  validate(expectedHomeRuns,expectedAwayRuns,market)
  let win=0,push=0,loss=0
  const register=(difference:number,probability:number)=>{
    switch(classification(difference)){
      case 'win':win+=probability;break
      case 'push':push+=probability;break
      case 'loss':loss+=probability;break
    }
  }
  if(market.family==='total'||market.family==='team_total'){
    const lambda=market.family==='total'?expectedHomeRuns+expectedAwayRuns:
      market.team==='home'?expectedHomeRuns:expectedAwayRuns
    for(const [runs,p] of poisson(lambda).entries())
      register(market.pick==='over'?runs-market.line:market.line-runs,p)
  }else{
    const home=poisson(expectedHomeRuns),away=poisson(expectedAwayRuns)
    for(let h=0;h<home.length;h++)for(let a=0;a<away.length;a++){
      const diff=market.team==='home'?h-a+market.line:a-h+market.line
      register(diff,home[h]!*away[a]!)
    }
  }
  const sum=win+push+loss
  if(!Number.isFinite(sum)||sum<=0)throw Error('No se pudo calcular el mercado')
  const probabilityWin=win/sum,probabilityPush=push/sum,probabilityLoss=loss/sum
  const expectedNetReturnPerUnit=probabilityWin*(market.decimalOdds-1)-probabilityLoss
  return{
    model:'independent-poisson-baseline-v1',period:market.period,
    probabilityWin,probabilityPush,probabilityLoss,
    impliedBreakEvenWinProbability:(1-probabilityPush)/market.decimalOdds,
    expectedNetReturnPerUnit,expectedNetReturnPercent:100*expectedNetReturnPerUnit,
    eligibleForTicket:false,calibrated:false,
    caveats:[
      'Modelo exploratorio, sin validación cronológica ni calibración por liga/mercado.',
      'La distribución de Poisson supone anotación independiente; no modela sobredispersión ni correlaciones.',
      'No ajusta entradas extra, reglas de liquidación, cambios de lanzador, alineaciones ni clima.',
      'Una diferencia entre proyección media y línea comercial no demuestra valor apostable.',
    ],
  }
}
