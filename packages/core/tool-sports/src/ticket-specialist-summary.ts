/** Describe evidence acquisition, not bet approval or unverified starter certainty. */
import type {SpecialistGate} from './ticket-specialist-gate.ts'

export type TicketSpecialistSummary={
  state:'documented'|'partial'|'unavailable'
  detail:string
  pendingEvidence:string[]
  verified:number
  partial:number
  missing:number
}

/** A short candidate preflight is not definitive for selected NBA/WNBA games. */
export function needsSelectedSpecialistRecheck(
  game:Pick<SpecialistGate,'sport'>,previous?:SpecialistGate,
):boolean{
  return !previous||previous.status==='unavailable'||
    (game.sport==='basketball'&&previous.checklist?.complete!==true)
}

/** Separate partial NBA research from a genuinely unavailable specialist dossier. */
export function summarizeTicketSpecialist(
  check:SpecialistGate|undefined,
  sport:string,
):TicketSpecialistSummary{
  const steps=check?.checklist?.steps??[]
  const verified=steps.filter(x=>x.state==='verified').length
  const partial=steps.filter(x=>x.state==='partial').length
  const missing=steps.filter(x=>x.state==='missing').length
  const hasEvidence=verified>0||partial>0||
    (check?.verifiedSteps.length??0)>0||
    check?.sourceChecks?.some(x=>x.status==='verified')===true
  const state:TicketSpecialistSummary['state']=
    check?.status==='researched'&&check.checklist?.complete===true?
      'documented':hasEvidence?'partial':'unavailable'
  const pendingEvidence:string[]=[]
  if(sport==='basketball'){
    const starters=steps.find(x=>x.key==='starters')
    const injuries=steps.find(x=>x.key==='injuries')
    pendingEvidence.push(starters?.state==='verified'?
      'Quintetos: ambos confirmados por identificadores de titulares':
      'Quintetos: titulares de ambos equipos sin confirmación definitiva')
    const injury=check?.injuryAudit
    pendingEvidence.push(injuries?.state==='verified'?
      'Lesiones: informe de disponibilidad verificado':
      injury&&['verified','partial'].includes(injury.status)?
        'Lesiones: ESPN consultado ('+injury.status+'); parte oficial definitivo pendiente':
        'Lesiones: parte bilateral sin verificación suficiente')
  }
  pendingEvidence.push(...(check?.checklist?.criticalPending??[]).slice(0,4))
  if(state==='unavailable'){
    const reason=check?.pendingSteps.find(x=>
      /límite|timeout|abort|failed|error|partido comenzado|no disponible|sin expediente/iu.test(x))
    if(reason)pendingEvidence.unshift(reason.slice(0,180))
  }
  const unique=[...new Set(pendingEvidence)]
  const detail=state==='documented'?
    'Expediente especializado documentado: '+verified+' controles verificados':
    state==='partial'?
      'Expediente '+(sport==='basketball'?'NBA/WNBA ':'')+'parcial: '+
        verified+' controles verificados, '+partial+' parciales y '+missing+
        ' sin acreditar; '+unique.slice(0,2).join('; '):
      'Investigación especializada no completada'+
        (unique.length?': '+unique.slice(0,2).join('; '):'; sin fuentes acreditadas')
  return{state,detail,pendingEvidence:unique,verified,partial,missing}
}
