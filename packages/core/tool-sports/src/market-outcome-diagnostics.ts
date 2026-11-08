/** Historical line-specific diagnostics for totals and handicaps in every sport.
 * These are past matchup-agnostic observations, NOT estimated event probabilities,
 * calibrated forecasts or expected value. Never infer EV from these hit rates.
 */
import type {DailyMarketCandidate} from './daily-market-shortlist.ts'

type Outcome=DailyMarketCandidate['outcomes'][number]
type Game={scored:number;allowed:number}
export type MarketOutcomeDiagnostic={
  market:'spreads'|'totals'
  selection:string;line:number
  status:'aligned'|'mixed'|'adverse'|'insufficient'
  team:{wins:number;losses:number;pushes:number;rate:number|null}
  opponent:{wins:number;losses:number;pushes:number;rate:number|null}
  minimumSample:number;modelCalibrated:false;eligibleForEV:false
  caveat:string
}
type Input={
  market:DailyMarketCandidate['market']
  outcome:Outcome|null
  homeName:string;awayName:string
  homeGames:readonly Game[];awayGames:readonly Game[]
}
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const valid=(g:Game)=>Number.isInteger(g.scored)&&Number.isInteger(g.allowed)&&
  g.scored>=0&&g.allowed>=0&&g.scored<=300&&g.allowed<=300
type Tally=MarketOutcomeDiagnostic['team']
const count=(margins:readonly number[]):Tally=>{
  const wins=margins.filter(x=>x>1e-8).length
  const losses=margins.filter(x=>x< -1e-8).length
  const pushes=margins.length-wins-losses
  return {wins,losses,pushes,rate:wins+losses?Number((wins/(wins+losses)).toFixed(3)):null}
}
/** Measure how EACH team's historical matches would have graded at today's exact line.
 * @returns A transparent consistency diagnostic; it cannot validate an edge.
 */
export function diagnoseMarketOutcome(input:Input):MarketOutcomeDiagnostic|null{
  if(input.market==='h2h'||!input.outcome||typeof input.outcome.line!=='number'||
    !Number.isFinite(input.outcome.line))return null
  const {market,outcome}=input
  const line=outcome.line
  const home=input.homeGames.filter(valid),away=input.awayGames.filter(valid)
  let homeMargins:number[],awayMargins:number[]
  if(market==='totals'){
    const side=norm(outcome.selection)
    if(side!=='over'&&side!=='under')return null
    const sign=side==='over'?1:-1
    homeMargins=home.map(g=>sign*(g.scored+g.allowed-line))
    awayMargins=away.map(g=>sign*(g.scored+g.allowed-line))
  }else{
    const label=norm(outcome.selection),isHome=label===norm(input.homeName)
    if(!isHome&&label!==norm(input.awayName))return null
    // The actual fixture's chosen team changes historical perspective.
    // For its own matches the team's margin is (GF-GA). For matches played
    // by its opponent, the chosen team's hypothetical margin is (GA-GF).
    homeMargins=home.map(g=>(isHome?g.scored-g.allowed:g.allowed-g.scored)+line)
    awayMargins=away.map(g=>(isHome?g.allowed-g.scored:g.scored-g.allowed)+line)
  }
  const team=count(input.market==='totals'?homeMargins:
    norm(outcome.selection)===norm(input.homeName)?homeMargins:awayMargins)
  const opponent=count(input.market==='totals'?awayMargins:
    norm(outcome.selection)===norm(input.homeName)?awayMargins:homeMargins)
  const minimumSample=6,n1=team.wins+team.losses,n2=opponent.wins+opponent.losses
  let status:MarketOutcomeDiagnostic['status']='insufficient'
  if(n1>=minimumSample&&n2>=minimumSample&&team.rate!==null&&opponent.rate!==null){
    const pooled=(team.wins+opponent.wins)/(n1+n2)
    status=team.rate<.35&&opponent.rate<.45||
      opponent.rate<.35&&team.rate<.45||
      pooled<.35?'adverse':
      team.rate>=.55&&opponent.rate>=.55&&pooled>=.62?'aligned':'mixed'
  }
  return {
    market,selection:outcome.selection,line,status,team,opponent,minimumSample,
    modelCalibrated:false,eligibleForEV:false,
    caveat:'Frecuencia retrospectiva a la línea actual, sin ajustar oponentes, sedes, titulares, lesiones ni precios históricos. Los dos equipos pueden compartir encuentros. No es probabilidad futura calibrada ni EV.',
  }
}
