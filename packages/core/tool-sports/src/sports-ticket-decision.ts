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
}
export type DecisionScenario={count:3|4|5;eventIds:string[];marketProductPct:number|null}
export type TicketDecisionAudit={
  legs:DecisionLeg[];excludedEvents:string[];heldEvents:string[]
  alternativesNeeded:number;scenarios:DecisionScenario[]
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
/** Pure, auditable challenge pass. Abstention is preferable to manufacturing
 * a fifth leg or claiming value when an independent calibrated model is absent.
 */
export function auditTicketDecisions(inputs:readonly DecisionInput[],
  policy:DecisionPolicy):TicketDecisionAudit{
  if(!Number.isFinite(policy.excludeBelow)||!Number.isFinite(policy.cautionBelow)||
    policy.excludeBelow<=0||policy.cautionBelow<policy.excludeBelow||
    policy.cautionBelow>=1)throw Error('Política de filtro de mercado inválida')
  const seen=new Set<string>()
  for(const input of inputs){
    if(!input.eventId||seen.has(input.eventId))
      throw Error('Identificador de evento duplicado o ausente en la auditoría')
    seen.add(input.eventId)
  }
  // Preserve the public DecisionLeg contract for downstream audit consumers.
  // The 55% screening threshold now yields caution, not automatic exclusion.
  const legs:DecisionLeg[]=inputs.map(input=>{
    const share=validShare(input.noVigShare)?input.noVigShare:null
    const price=input.quotedPrice
    const breakEven=typeof price==='number'&&Number.isFinite(price)&&price>1&&price<1000
      ?pct(1/price):null
    const reasons:string[]=[]
    let verdict:DecisionVerdict
    if(input.modelStatus==='contradiction'){
      verdict='hold'
      reasons.push('ESPERAR: un modelo externo discrepa del ganador; investigar la contradicción.')
    }else if(input.specialistStatus!=='researched'||!input.checklistComplete||
      input.criticalPending.length>0){
      verdict='hold'
      reasons.push('ESPERAR: expediente especializado incompleto ('+
        input.criticalPending.length+' pasos críticos pendientes).')
    }else if(share===null||breakEven===null){
      verdict='hold'
      reasons.push('ESPERAR: faltan ambas caras del mercado de la misma casa y cuota vigente.')
    }else if(share<policy.excludeBelow){
      verdict='caution'
      reasons.push('PRECAUCIÓN ALTA: cuota con '+pct(share)+
        '% de participación del mercado sin margen; no equivale a probabilidad '+
        'pronosticada ni justifica por sí sola una exclusión.')
    }else if(share<policy.cautionBelow){
      verdict='caution'
      reasons.push('RIESGO MEDIO: margen competitivo reducido, revisar alternativas antes de incluir.')
    }else{
      verdict='candidate'
      reasons.push('CANDIDATA A COMPARACIÓN: investigación documentada; precio no demuestra valor.')
    }
    if(input.modelStatus==='unavailable')
      reasons.push('Sin segunda opinión de modelo externo verificada.')
    if(input.sport==='hockey'&&input.criticalPending.some(step=>/portero|goalie/iu.test(step)))
      reasons.push('NHL: confirmar ambos porteros titulares antes de decidir.')
    if(breakEven!==null&&share!==null)
      reasons.push('Equilibrio por cuota '+breakEven+'%; mercado sin margen '+pct(share)+
        '%. La diferencia es margen de la casa, NO edge predictivo.')
    return{eventId:input.eventId,selection:input.selection,sport:input.sport,
      verdict,reasons,bookmakerBreakEvenPct:breakEven,
      marketNoVigPct:share===null?null:pct(share),
      modelProbabilityPct:null,expectedValue:null,edgePct:null,
      specialistStatus:input.specialistStatus,
      criticalPending:[...input.criticalPending],modelStatus:input.modelStatus}
  })
  const candidates=legs.filter(l=>l.verdict!=='exclude')
    .filter(l=>l.marketNoVigPct!==null)
    .sort((a,b)=>b.marketNoVigPct!-a.marketNoVigPct!)
  const scenarios:DecisionScenario[]=[3,4,5].map(n=>{
    const count=n as 3|4|5,core=candidates.slice(0,count)
    return{count,eventIds:core.map(x=>x.eventId),
      marketProductPct:core.length===count?Number((core.reduce((p,x)=>
        p*x.marketNoVigPct!/100,1)*100).toFixed(2)):null}
  })
  const excludedEvents=legs.filter(l=>l.verdict==='exclude').map(l=>l.eventId)
  const heldEvents=legs.filter(l=>l.verdict==='hold').map(l=>l.eventId)
  const alternativesNeeded=legs.filter(l=>l.verdict==='exclude'||l.verdict==='hold').length
  const recommendation=excludedEvents.length?
    'Descartar '+excludedEvents.length+' pata(s) frágiles y buscar otras fechas/partidos, '+
      'sin rellenar el objetivo de cinco o seis a cualquier coste.':
    heldEvents.length?'Revisar '+heldEvents.length+
      ' pata(s) condicionadas antes de proponer el boleto final.':
      'Comparar las candidatas con otros partidos; ninguna queda aprobada para apostar.'
  return{legs,excludedEvents,heldEvents,alternativesNeeded,scenarios,
    calibrated:false,approvedForBetting:false,marketOnly:true,
    warning:'Filtro heurístico del mercado (configurable), no modelo predictivo calibrado. '+
      'Productos combinados suponen independencia, no corrigen correlaciones ni demuestran EV. '+
      'Una candidata fuerte puede tener cuota desfavorable. No ejecutar apuestas.',
    recommendation}
}
