/** Pregame soccer draw-risk dossier from real, completed earlier games.
 * Rates are OBSERVED historical frequencies, never calibrated win/draw chances.
 * An ESPN three-way market does not make this analytical step complete.
 */
export type SoccerResultForDraw={
  date:string;homeAway:'home'|'away';scored:number;allowed:number
}
export type SoccerDrawInput={
  home:{name:string;recent:readonly SoccerResultForDraw[]}
  away:{name:string;recent:readonly SoccerResultForDraw[]}
  kickoff:string
  statistics?:readonly {label:string;value:string}[]
}
export type SoccerDrawSide={
  team:string;sample:'venue'|'all-recent';games:number;draws:number;
  drawsPct:number;concededPct:number;bttsPct:number;closePct:number;
  cleanSheetsPct:number;goalsAllowedPerGame:number
}
export type SoccerDrawAudit={
  status:'assessed'|'partial'|'unavailable'
  tier:'elevated'|'moderate'|'lower'|'unknown'
  /** Empirical sample share, NOT probability for this match. */
  averageHistoricalDrawPct:number|null
  selectedSamples:{home:SoccerDrawSide;away:SoccerDrawSide}
  xgStatus:'both-teams'|'partial'|'unavailable'
  indicators:string[];unverified:string[]
  requiresAlternativeReview:boolean
  calibrated:false
  marketThreeWayVerified:false
}
const pct=(n:number)=>Number((n*100).toFixed(1))
const fixed=(n:number)=>Number(n.toFixed(2))
const cutoffSafe=(game:SoccerResultForDraw,kickoff:number)=>Number.isFinite(Date.parse(game.date))
  &&Date.parse(game.date)<kickoff&&Number.isInteger(game.scored)&&game.scored>=0
  &&Number.isInteger(game.allowed)&&game.allowed>=0&&game.scored<=40&&game.allowed<=40
function aggregate(team:string,games:readonly SoccerResultForDraw[],home:boolean):SoccerDrawSide{
  const venue=games.filter(g=>g.homeAway===(home?'home':'away'))
  const useVenue=venue.length>=3,selected=useVenue?venue:games
  const total=selected.length||1
  const draw=selected.filter(g=>g.scored===g.allowed).length
  return{team,sample:useVenue?'venue':'all-recent',games:selected.length,
    draws:draw,drawsPct:pct(draw/total),
    concededPct:pct(selected.filter(g=>g.allowed>0).length/total),
    bttsPct:pct(selected.filter(g=>g.allowed>0&&g.scored>0).length/total),
    closePct:pct(selected.filter(g=>Math.abs(g.scored-g.allowed)<=1).length/total),
    cleanSheetsPct:pct(selected.filter(g=>g.allowed===0).length/total),
    goalsAllowedPerGame:fixed(selected.reduce((n,g)=>n+g.allowed,0)/total)}
}
const key=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
/** Check only metrics explicitly attributed to the correct team, do not
 * identify an xG number from a full boxscore played after kickoff.
 */
function xgCoverage(stats:SoccerDrawInput['statistics'],home:string,away:string){
  const obs=(stats??[]).filter(s=>Number.isFinite(Number(s.value))&&Number(s.value)>=0)
  const coverage=(team:string)=>{
    const names=obs.filter(s=>key(s.label).startsWith(key(team)))
      .map(s=>key(s.label.slice(team.length)))
    return names.some(s=>['xg','expectedgoals','expectedgoalsscored'].includes(s))&&
      names.some(s=>['xga','expectedgoalsagainst','expectedgoalsallowed'].includes(s))
  }
  const count=Number(coverage(home))+Number(coverage(away))
  return count===2?'both-teams' as const:count?'partial' as const:'unavailable' as const
}
export function assessSoccerDrawRisk(input:SoccerDrawInput):SoccerDrawAudit{
  const kickoff=Date.parse(input.kickoff)
  if(!Number.isFinite(kickoff))throw Error('Kickoff inválido: no evaluar empate con fecha desconocida')
  const h=input.home.recent.filter(g=>cutoffSafe(g,kickoff)).slice(0,10)
  const a=input.away.recent.filter(g=>cutoffSafe(g,kickoff)).slice(0,10)
  const home=aggregate(input.home.name,h,true),away=aggregate(input.away.name,a,false)
  const status:SoccerDrawAudit['status']=!h.length||!a.length?'unavailable':
    h.length>=5&&a.length>=5&&home.sample==='venue'&&away.sample==='venue'?
      'assessed':'partial'
  const xgStatus=xgCoverage(input.statistics,input.home.name,input.away.name)
  const drawPct=h.length&&a.length?
    fixed((home.drawsPct+away.drawsPct)/2):null
  // Descriptive triage only; evaluate/fit these cutoffs on a separate
  // chronological training split before treating them as predictions.
  const avg=(v:'concededPct'|'bttsPct'|'closePct')=>
    (home[v]+away[v])/2
  const bothLeak=home.concededPct>=50&&away.concededPct>=50
  const fragile=(drawPct??0)>=30||(bothLeak&&avg('closePct')>=70)||
    (bothLeak&&avg('bttsPct')>=60&&avg('closePct')>=55)
  const medium=(drawPct??0)>=17||avg('closePct')>=55||
    (bothLeak&&avg('bttsPct')>=45)
  const tier:SoccerDrawAudit['tier']=status==='unavailable'?'unknown':
    fragile?'elevated':medium?'moderate':'lower'
  const indicators=[
    'Empates históricos observados '+(drawPct===null?'sin muestra':drawPct+'% (promedio simple de muestras, NO pronóstico)'),
    input.home.name+': '+home.games+' partidos '+home.sample+
      ', empates '+home.draws+', concedió en '+home.concededPct+
      '%, BTTS '+home.bttsPct+'%, diferencia de goles <=1 en '+home.closePct+'%',
    input.away.name+': '+away.games+' partidos '+away.sample+
      ', empates '+away.draws+', concedió en '+away.concededPct+
      '%, BTTS '+away.bttsPct+'%, diferencia de goles <=1 en '+away.closePct+'%',
  ]
  const unverified=[
    ...(status!=='assessed'?['Muestra local/visitante insuficiente para auditoría completa']:[]),
    ...(xgStatus!=='both-teams'?['xG/xGA de ambos clubes sin verificación comparable']:[]),
    'No se deriva probabilidad 1X2, ventaja de cuota ni valor esperado de estas frecuencias',
  ]
  return{status,tier,averageHistoricalDrawPct:drawPct,
    selectedSamples:{home,away},xgStatus,indicators,unverified,
    requiresAlternativeReview:tier==='elevated'&&status==='assessed',
    calibrated:false,marketThreeWayVerified:false}
}
