/** Match real bookmaker outcomes against independent descriptive pregame evidence.
 * These scores do NOT represent calibrated probabilities or betting EV.
 */
import type {DailyMarketCandidate} from './daily-market-shortlist.ts'
import type {auditUniversalMatchup} from './universal-matchup-factors.ts'

export type MatchupResearch=Awaited<ReturnType<typeof auditUniversalMatchup>>
export type MarketResearchReview={
  candidate:DailyMarketCandidate
  researchedAt:string
  status:'descriptive-support'|'uncertain'|'contraindicated'|'unavailable'
  scoreDifference:number|null
  projectedHome:number|null;projectedAway:number|null;projectedTotal:number|null
  variability:number|null;sampleGames:{home:number;away:number}
  selectedOutcome:DailyMarketCandidate['outcomes'][number]|null
  originalMarketSelection:string;marketDirection:string
  verifiedSources:number;sourceCount:number
  injuries:number;news:number;headToHead:number
  evidenceFor:string[];warnings:string[];rankingScore:number
  descriptiveLineDistance:number|null;relativeSignal:number|null
  /** Diagnostic only; historical margins are not a calibrated NHL cover forecast. */
  nhlPuckLineAudit?:{
    side:string;line:number;impliedBreakEven:number;teamGames:number
    teamMissedLine:number;teamHistoricalCoverRate:number|null
    opponentGames:number;opponentWouldBeatLineRate:number|null
    goalieConfirmed:false;calibrated:false;approved:false
  }
}
const round=(value:number):number=>Number(value.toFixed(2))
const normalize=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const standardDeviation=(data:readonly number[]):number|null=>{
  if(data.length<3)return null
  const mean=data.reduce((a,b)=>a+b,0)/data.length
  return Math.sqrt(data.reduce((sum,n)=>sum+(n-mean)**2,0)/data.length)
}
const opposite=(label:string):'over'|'under'|null=>{
  const value=normalize(label)
  if(value.startsWith('over'))return'over'
  if(value.startsWith('under'))return'under'
  return null
}

/** Evaluate directional alignment of each bookmaker outcome with measured form.
 * @param candidate - A fully paired, dated bookmaker market linked to an ESPN event.
 * @param evidence - The independent verified scoreboard/roster/news investigation.
 * @returns Research classification, source coverage and exact market-side choice.
 */
export function assessDailyMarketEvidence(
  candidate:DailyMarketCandidate,evidence:MatchupResearch,
):MarketResearchReview{
  if(candidate.sport!==evidence.sport||candidate.league!==evidence.league
    ||candidate.espnEventId!==evidence.eventId)
    throw Error('La investigación no corresponde al partido y liga del mercado')
  const h=evidence.home.form,a=evidence.away.form
  const minGames=candidate.sport==='football'?3:5
  const missing:string[]=[]
  const verified=evidence.coverage.filter(c=>c.status==='verified').length
  if(h.games<minGames||a.games<minGames)
    missing.push('Historial insuficiente: se requieren '+minGames+' resultados finalizados de cada equipo')
  if(evidence.rosterNewsInjuries===null)
    missing.push('Noticias, plantillas y lesiones sin confirmación')
  else missing.push('Las bajas ESPN no sustituyen el último informe oficial ni confirman el once')
  const core=[h.scoredPerGame,h.allowedPerGame,a.scoredPerGame,a.allowedPerGame]
  const valid=core.every(v=>v!==null&&Number.isFinite(v))
    &&h.games>=minGames&&a.games>=minGames
  let home:number|null=null,away:number|null=null,total:number|null=null,diff:number|null=null
  let variability:number|null=null
  let side:DailyMarketCandidate['outcomes'][number]|null=null
  let direction=''
  let status:MarketResearchReview['status']='unavailable'
  if(valid){
    home=(h.scoredPerGame!+a.allowedPerGame!)/2
    away=(a.scoredPerGame!+h.allowedPerGame!)/2
    total=round(home+away);diff=round(home-away)
    home=round(home);away=round(away)
    const points=[...evidence.home.lastGames.map(g=>g.scored),
      ...evidence.away.lastGames.map(g=>g.scored)]
    variability=standardDeviation(points)
    // A large difference against a bookmaker line is descriptive support only:
    // sampling uncertainty, roster changes and pricing costs remain unresolved.
    const slack=Math.max(candidate.sport==='basketball'?3:0.35,
      (variability??1)*0.35)
    const homeName=normalize(evidence.home.name),awayName=normalize(evidence.away.name)
    const options=candidate.outcomes
    if(candidate.market==='totals'&&candidate.line!==null){
      const label=total-candidate.line>slack?'over':
        candidate.line-total>slack?'under':null
      direction=label??'total cerca de la línea: sin dirección robusta'
      side=options.find(x=>opposite(x.selection)===label)??null
    }
    if(candidate.market==='spreads'){
      const choices=options.filter(x=>typeof x.line==='number')
      const preferred=choices.filter(x=>{
        const name=normalize(x.selection),signed=name===homeName?diff!+x.line!:
          name===awayName?-diff!+x.line!:0
        return (name===homeName||name===awayName)&&signed>slack
      }).sort((x,y)=>y.noVigShare-x.noVigShare)
      side=preferred[0]??null
      direction=side?side.selection+' cubre una línea descriptiva':'spread sin margen estadístico suficiente'
    }
    if(candidate.market==='h2h'){
      const label=diff>slack?homeName:diff< -slack?awayName:null
      side=options.find(x=>normalize(x.selection)===label)??null
      direction=side?side.selection+' favorecido por producción reciente':'ganador no resuelto por forma reciente'
    }
    status=side?'descriptive-support':'uncertain'
  }else missing.push('No hay medias de ataque/defensa suficientemente verificadas para este mercado')
  const old=normalize(candidate.selection)
  if(status==='descriptive-support'&&side&&normalize(side.selection)!==old)
    missing.push('La dirección de la investigación difiere del favorito inicial por precio; selección corregida')
  // NHL puck lines need the distribution of two-goal results, not merely an
  // average margin. Neither ESPN's roster nor this sample confirms the starter.
  // Do not promote a +1.5 favorite-by-price into a supported parlay leg.
  let nhlPuckLineAudit:MarketResearchReview['nhlPuckLineAudit']
  if(candidate.sport==='hockey'&&candidate.market==='spreads'&&side&&
    typeof side.line==='number'){
    const betHome=normalize(side.selection)===normalize(evidence.home.name)
    const team=betHome?evidence.home:evidence.away
    const opponent=betHome?evidence.away:evidence.home
    const finite=(g:{scored:number;allowed:number})=>
      Number.isFinite(g.scored)&&Number.isFinite(g.allowed)
    const games=team.lastGames.filter(finite),other=opponent.lastGames.filter(finite)
    const missed=games.filter(g=>g.scored-g.allowed+side!.line! < 0).length
    const opposing=other.filter(g=>g.scored-g.allowed>side!.line!).length
    const implied=1/side.decimalOdds
    const historicalRate=games.length? (games.length-missed)/games.length:null
    const opposingRate=other.length?opposing/other.length:null
    nhlPuckLineAudit={
      side:side.selection,line:side.line,impliedBreakEven:round(implied),
      teamGames:games.length,teamMissedLine:missed,
      teamHistoricalCoverRate:historicalRate===null?null:round(historicalRate),
      opponentGames:other.length,
      opponentWouldBeatLineRate:opposingRate===null?null:round(opposingRate),
      goalieConfirmed:false,calibrated:false,approved:false,
    }
    const contradictory=(games.length>=6&&historicalRate!==null&&
      historicalRate<implied-0.04)||(other.length>=6&&opposingRate!==null&&
      opposingRate>1-implied+0.04)
    status=contradictory?'contraindicated':'uncertain'
    missing.push('NHL puck line '+side.selection+' '+side.line+
      ': cobertura histórica '+(historicalRate===null?'sin muestra':
        missed+' fallos / '+games.length+' partidos')+
      '; rival supera la línea en '+opposing+' / '+other.length+
      '. Cuota exige '+round(implied*100)+'%; no es probabilidad calibrada.')
    if(contradictory)missing.push(
      'Señales contrarias al hándicap: resultado de dos o más goles posible; no aprobar.')
    missing.push('BLOQUEO NHL: portero titular de ambos clubes, 5v5 xG/GSAx, bajas, descanso y reglas de OT/empty-net sin validar; no recomendar este hándicap.')
    direction='Hándicap NHL en revisión: tendencia de goles y precio no bastan para aprobar'
  }
  if(candidate.sport==='hockey')missing.push('Portero titular debe confirmarse; SV% y xG no incluidos en esta señal')
  if(candidate.sport==='baseball')missing.push('Revisar abridores, bullpen, techo y alineaciones oficiales')
  if(candidate.sport==='football')missing.push('QB, inactivos, snap counts y clima requieren verificación final')
  if(candidate.sport==='soccer')missing.push('Once inicial, xG y reglas de 90 minutos pendientes de cotejo')
  if(candidate.sport==='basketball')missing.push('Informe oficial de lesiones y quintetos/minutos por confirmar')
  if(candidate.market==='totals'||candidate.market==='spreads')
    missing.push('La media descriptiva no demuestra probabilidades de cubrir este mercado ni EV')
  let lineDistance:number|null=null
  if(valid&&side&&diff!==null&&total!==null){
    if(candidate.market==='totals'&&side.line!==null)
      lineDistance=Math.abs(total-side.line)
    else if(candidate.market==='spreads'&&side.line!==null){
      const selectedHome=normalize(side.selection)===normalize(evidence.home.name)
      lineDistance=Math.abs((selectedHome?diff:-diff)+side.line)
    }else if(candidate.market==='h2h')lineDistance=Math.abs(diff)
  }
  // Distinguish a marginal line lean from a genuinely wide descriptive gap.
  // This statistic only sorts candidates for review; it is NOT p(win), EV or
  // a market-specific probability distribution.
  const relativeSignal=lineDistance!==null&&variability!==null?
    round(lineDistance/Math.max(1,variability)):null
  const rankingScore=side&&valid?round(
    4*Math.min(3,relativeSignal??0)+Math.min(verified,8)/10+
    Math.min(h.games+a.games,20)/100):0
  const report:MarketResearchReview={
    candidate,researchedAt:evidence.checkedAt,status,
    scoreDifference:diff,projectedHome:home,projectedAway:away,projectedTotal:total,
    variability:variability===null?null:round(variability),
    sampleGames:{home:h.games,away:a.games},selectedOutcome:side,
    originalMarketSelection:candidate.selection,marketDirection:direction,
    verifiedSources:verified,sourceCount:evidence.coverage.length,
    injuries:evidence.rosterNewsInjuries?.injuries.length??0,
    news:evidence.rosterNewsInjuries?.headlines.length??0,
    headToHead:evidence.headToHead.length,
    evidenceFor:[
      ...(valid?['Media reciente local '+home+' vs visitante '+away+'; total '+total]:[]),
      ...(evidence.headToHead.length?['H2H con '+evidence.headToHead.length+' partidos observados']:[]),
      ...(side?['El mercado '+candidate.market+' ofrece '+side.selection+
        (side.line===null?'':' '+side.line)+' a cuota observada '+side.decimalOdds]:[]),
    ],warnings:missing,rankingScore,
    descriptiveLineDistance:lineDistance===null?null:round(lineDistance),
    relativeSignal,nhlPuckLineAudit,
  }
  return report
}

/** Describe provider or investigation failure without creating a favored market.
 * @param candidate - Real market candidate still linked to an event.
 * @param reason - The specific investigation failure.
 * @returns Visible, non-predictive failure result.
 */
export function unavailableMarketEvidence(
  candidate:DailyMarketCandidate,reason:string,
):MarketResearchReview{
  return {candidate,researchedAt:new Date().toISOString(),status:'unavailable',
    scoreDifference:null,projectedHome:null,projectedAway:null,projectedTotal:null,
    variability:null,sampleGames:{home:0,away:0},selectedOutcome:null,
    originalMarketSelection:candidate.selection,marketDirection:'Sin dirección verificada',
    verifiedSources:0,sourceCount:0,injuries:0,news:0,headToHead:0,evidenceFor:[],
    warnings:['Investigación no disponible: '+reason.slice(0,180)],rankingScore:0,
    descriptiveLineDistance:null,relativeSignal:null}
}
