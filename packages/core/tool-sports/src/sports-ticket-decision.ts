/** Second-pass ticket critic. Market prices and open forecasts are evidence,
 * not a calibrated advantage or an instruction to place wagers.
 * This screen MUST run after each discipline-specific dossier.
 */
export type DecisionPolicy={
  excludeBelow:number
  cautionBelow:number
}
export type DecisionInput={
  eventId:string
  sport:string
  selection:string
  quotedPrice:number|null
  noVigShare:number|null
  specialistStatus:'researched'|'incomplete'|'unavailable'
  checklistComplete:boolean
  criticalPending:readonly string[]
  modelStatus:'support'|'contradiction'|'unavailable'
  /** Derived from last games, NEVER a calibrated probability or edge. */
  exploratoryProbabilityPercent?:number|null
  /** Factual unknowns requiring the model to investigate, no points or weights. */
  pregameConcerns?:readonly string[]
  pregameReviewRequired?:boolean
}
export type DecisionVerdict='exclude'|'hold'|'caution'|'candidate'
export type DecisionLeg={
  eventId:string;selection:string;sport:string
  verdict:DecisionVerdict;reasons:string[]
  bookmakerBreakEvenPct:number|null
  marketNoVigPct:number|null
  modelProbabilityPct:null;expectedValue:null;edgePct:null
  specialistStatus:DecisionInput['specialistStatus']
  criticalPending:string[];modelStatus:DecisionInput['modelStatus']
  exploratoryProbabilityPct:number|null
  exploratoryVsBreakEvenGapPct:number|null
  alternativeReviewRequired:boolean
}
export type DecisionScenario={count:3|4|5|6;eventIds:string[];marketProductPct:number|null}
export type TicketDecisionAudit={
  legs:DecisionLeg[];excludedEvents:string[];heldEvents:string[]
  alternativesNeeded:number;alternativesToReview:number;scenarios:DecisionScenario[]
  calibrated:false;approvedForBetting:false;marketOnly:true
  warning:string;recommendation:string
}
const pct=(value:number)=>Number((value*100).toFixed(2))
const validShare=(value:number|null):value is number=>
  typeof value==='number'&&Number.isFinite(value)&&value>0&&value<1
/** Deployment-specific screening policy. These are screening choices, NOT
 * scientifically validated confidence cutoffs or predictive probabilities. */
export function readDecisionPolicy(env:NodeJS.ProcessEnv):DecisionPolicy{
  const excludeBelow=Number(env.PHOENIX_SPORTS_SCREEN_EXCLUDE_BELOW??'0.55')
  const cautionBelow=Number(env.PHOENIX_SPORTS_SCREEN_CAUTION_BELOW??'0.65')
  if(!Number.isFinite(excludeBelow)||excludeBelow<0.5||excludeBelow>0.7||
    !Number.isFinite(cautionBelow)||cautionBelow<excludeBelow||cautionBelow>0.9)
    throw Error('Umbrales de auditoría deportiva inválidos: revisar SCREEN_EXCLUDE/CAUTION_BELOW')
  return{excludeBelow,cautionBelow}
}
/** Pure factual screening, not a model, score or market-based winner chooser.
 * @param inputs - Actual event identity, source state, quotes and open questions.
 * @param policy - Validated legacy configuration, not a weighting system.
 * @returns An audit for Kira to reason about; no algorithmic sports ranking.
 */
export function auditTicketDecisions(inputs:readonly DecisionInput[],
  policy:DecisionPolicy):TicketDecisionAudit{
  if(!Number.isFinite(policy.excludeBelow)||!Number.isFinite(policy.cautionBelow)||
    policy.excludeBelow<=0||policy.cautionBelow<policy.excludeBelow||
    policy.cautionBelow>=1)throw Error('Política de configuración inválida')
  const seen=new Set<string>()
  for(const input of inputs){
    if(!input.eventId||seen.has(input.eventId))
      throw Error('Identificador de evento duplicado o ausente en la auditoría')
    seen.add(input.eventId)
  }
  const legs:DecisionLeg[]=inputs.map(input=>{
    const share=validShare(input.noVigShare)?input.noVigShare:null
    const price=input.quotedPrice
    // Pricing arithmetic is kept only to label an observed bookmaker market.
    // No threshold or calculation below chooses a team or ranks candidates.
    const breakEven=typeof price==='number'&&Number.isFinite(price)&&price>1&&price<1000
      ?pct(1/price):null
    const exploratory=typeof input.exploratoryProbabilityPercent==='number'&&
      Number.isFinite(input.exploratoryProbabilityPercent)&&
      input.exploratoryProbabilityPercent>=0&&
      input.exploratoryProbabilityPercent<=100?
        input.exploratoryProbabilityPercent:null
    const quarterbackUnconfirmed=input.sport==='football'&&
      input.criticalPending.some(step=>/\bqb\b|quarterback|mariscal/iu.test(step))
    const goalieUnconfirmed=input.sport==='hockey'&&
      input.criticalPending.some(step=>/portero|goalie/iu.test(step))
    const qualitativeReview=input.pregameReviewRequired===true||
      (input.pregameConcerns?.length??0)>0
    const dossierPending=input.specialistStatus!=='researched'||
      !input.checklistComplete||input.criticalPending.length>0
    const alternativeReviewRequired=qualitativeReview||dossierPending||
      input.modelStatus==='contradiction'
    const reasons:string[]=[]
    let verdict:DecisionVerdict
    if(quarterbackUnconfirmed){
      verdict='hold'
      reasons.push('RETENER NFL: confirmar el QB titular en fuentes oficiales antes del análisis final.')
    }else if(input.modelStatus==='contradiction'){
      verdict='hold'
      reasons.push('CONTRADICCIÓN DOCUMENTADA: consultar las fuentes y razonar un reemplazo.')
    }else if(breakEven===null){
      verdict='hold'
      reasons.push('Sin cuota auténtica de esta selección y mercado; no afirmar boleto cotizado.')
    }else if(dossierPending||share===null||qualitativeReview){
      verdict='caution'
      reasons.push('BORRADOR: Kira debe estudiar los dos equipos y completar el expediente '+ 
        'antes de elegir. No se asigna ningún peso deportivo ni puntaje.')
    }else{
      verdict='candidate'
      reasons.push('CANDIDATA A JUICIO DEL MODELO: hechos recopilados, no ganador elegido.')
    }
    if(qualitativeReview)
      reasons.push('PENDIENTES PARA KIRA: '+(
        input.pregameConcerns?.join('; ')||'comparación cualitativa bilateral')+'.')
    if(goalieUnconfirmed)
      reasons.push('NHL: contrastar porteros titulares y rotaciones sin ajustar puntos.')
    if(dossierPending)
      reasons.push('Expediente especializado incompleto: '+
        input.criticalPending.join('; ').slice(0,450))
    if(share===null&&breakEven!==null)
      reasons.push('Falta el lado contrario de la misma casa; precio observado sin cotejo bilateral.')
    if(input.modelStatus==='unavailable')
      reasons.push('No hay segundo modelo externo acreditado; no equivale a ausencia de riesgo.')
    return{eventId:input.eventId,selection:input.selection,sport:input.sport,
      verdict,reasons,bookmakerBreakEvenPct:breakEven,
      marketNoVigPct:share===null?null:pct(share),
      modelProbabilityPct:null,expectedValue:null,edgePct:null,
      specialistStatus:input.specialistStatus,
      criticalPending:[...input.criticalPending],modelStatus:input.modelStatus,
      exploratoryProbabilityPct:exploratory,
      exploratoryVsBreakEvenGapPct:null,
      alternativeReviewRequired}
  })
  // Diagnostic subsets preserve event order. Neither market share nor historical
  // win rate is allowed to select, sort or boost a particular team.
  const candidates=legs.filter(leg=>leg.verdict==='candidate')
    .filter(leg=>leg.bookmakerBreakEvenPct!==null)
  const scenarios:DecisionScenario[]=[3,4,5,6].map(value=>{
    const count=value as DecisionScenario['count']
    return{count,eventIds:candidates.slice(0,count).map(leg=>leg.eventId),
      marketProductPct:null}
  })
  const excludedEvents=legs.filter(x=>x.verdict==='exclude').map(x=>x.eventId)
  const heldEvents=legs.filter(x=>x.verdict==='hold').map(x=>x.eventId)
  const alternativesNeeded=heldEvents.length+excludedEvents.length
  const alternativesToReview=legs.filter(x=>x.alternativeReviewRequired).length
  return{legs,excludedEvents,heldEvents,alternativesNeeded,
    alternativesToReview,scenarios,
    calibrated:false,approvedForBetting:false,marketOnly:true,
    warning:'La comparación deportiva corresponde a Kira tras leer rosters, '+
      'estadísticas y fuentes de ambos equipos. Cuotas y porcentajes implícitos '+
      'son datos comerciales, no selección, probabilidad calibrada ni EV. '+
      'Los escenarios incluyen solo expedientes completos y cotizados; las patas con advertencias siguen visibles fuera de ellos. No son recomendaciones puntuadas.',
    recommendation:heldEvents.length?
      'Reinvestigar las patas retenidas y comparar reemplazos por criterio del modelo.':
      'Kira debe elegir por análisis bilateral razonado; ningún ranking aprueba apuestas.'}
}

/** Only fully researched, priced candidates without unresolved review flags may be reviewed.
 * Warnings on research candidates remain visible; readiness never means bet approval.
 * @param audit - Individual, post-quote ticket decision findings.
 * @returns Whether every shown leg is reviewable, not whether it is safe to wager.
 */
export function ticketIsReadyForReview(audit:TicketDecisionAudit):boolean{
  return audit.legs.length>0&&audit.legs.every(leg=>
    leg.verdict==='candidate'&&leg.criticalPending.length===0&&
    leg.specialistStatus==='researched'&&leg.bookmakerBreakEvenPct!==null&&
    !leg.alternativeReviewRequired)
}
