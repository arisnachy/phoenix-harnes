/** Qualitative pregame dossier: facts for the language model, never a score. */
import type {SpecialistGate} from './ticket-specialist-gate.ts'

export type PregameAvailability={
  athlete:string
  status:string
  reportedAt:string|null
  source:'roster-reconciled'|'league-report-unreconciled'
}
export type PregameQualitativeReview={
  observations:string[]
  selectedAvailability:PregameAvailability[]
  opposingAvailability:PregameAvailability[]
  rest:{selectedHours:number|null;opposingHours:number|null}|null
  needsRecheck:boolean
  /** Only unresolved factual verification, never an invented numeric severity. */
  criticalUnknowns:string[]
}
type Report={athlete:string;status:string;reportedAt:string|null}
const latestPublished=(rows:readonly Report[],now:number,kickoff:number,
  source:PregameAvailability['source']):PregameAvailability[]=>{
  const latest=new Map<string,Report>()
  for(const row of rows){
    const published=Date.parse(row.reportedAt??'')
    if(!row.athlete.trim()||!Number.isFinite(published)||
      published>now||published>=kickoff)continue
    const key=row.athlete.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
      .trim().toLowerCase()
    const old=latest.get(key)
    if(old&&Date.parse(old.reportedAt??'')>published)continue
    latest.set(key,row)
  }
  return [...latest.values()].map(row=>({...row,source}))
}

/** Compare BOTH teams' roster availability, actual schedule and starter status.
 * @param candidate - The sportsbook fixture and provisional picked side.
 * @param check - Specialist's original factual dossier.
 * @param now - When the factual information was observed.
 * @returns Model-readable evidence; no scores, weights, confidence or EV.
 */
export function assessPregamePreselectionRisk(
  candidate:{sport:string;pick:'home'|'away'|'draw';kickoff:string},
  check:SpecialistGate,now:number,
):PregameQualitativeReview{
  const own=candidate.pick==='away'?'away':'home'
  const other=own==='away'?'home':'away'
  const kickoff=Date.parse(candidate.kickoff)
  const future=Number.isFinite(kickoff)&&kickoff>now
  const observations:string[]=[]
  const criticalUnknowns:string[]=[]
  const source=check.rosterMatchedInjuries?'roster-reconciled':
    'league-report-unreconciled'
  const selected=check.rosterMatchedInjuries?.[own]??check.injuryAudit?.[own].injuries??[]
  const opposing=check.rosterMatchedInjuries?.[other]??check.injuryAudit?.[other].injuries??[]
  const selectedAvailability=future?latestPublished(selected,now,kickoff,source):[]
  const opposingAvailability=future?latestPublished(opposing,now,kickoff,source):[]
  const describe=(rows:PregameAvailability[])=>rows.length?
    rows.map(row=>row.athlete+' ('+row.status+'; comunicado '+row.reportedAt+')')
      .join('; '):'ningún registro individual validado; disponibilidad desconocida'
  observations.push('Disponibilidad del equipo propuesto: '+describe(selectedAvailability))
  observations.push('Disponibilidad del rival: '+describe(opposingAvailability))
  if(source==='league-report-unreconciled')
    criticalUnknowns.push('Conciliar bajas reportadas con roster activo e informe oficial')
  if(!check.injuryAudit||check.injuryAudit.status==='unavailable'||
    check.injuryAudit.status==='stale')
    criticalUnknowns.push('Sin parte reciente de lesiones de ambos clubes')
  else if(!check.injuryAudit.home.matched||!check.injuryAudit.away.matched)
    criticalUnknowns.push('El informe ESPN no identifica ambos clubes; no suponer que el ausente está sano')
  const rest=check.restHours?{
    selectedHours:check.restHours[own],opposingHours:check.restHours[other],
  }:null
  if(rest)
    observations.push('Descanso documentado (horas): elegido '+
      String(rest.selectedHours??'no disponible')+', rival '+
      String(rest.opposingHours??'no disponible')+
      '. Examinar back-to-back, viajes y rotaciones sin sumar puntos')
  if(candidate.sport==='football'){
    const qb=check.checklist?.steps.find(step=>step.key==='qb')
    if(qb?.state!=='verified')
      criticalUnknowns.push('NFL: confirmar titular QB de ambos equipos e inactivos oficiales')
  }
  if(candidate.sport==='hockey'){
    const goalie=check.checklist?.steps.find(step=>step.key==='goalies')
    if(goalie?.state!=='verified')
      criticalUnknowns.push('NHL: confirmar ambos porteros titulares y planilla')
  }
  if(check.status!=='researched')
    criticalUnknowns.push('Expediente especializado '+check.status+
      '; conservar evidencia disponible y buscar fuente alternativa')
  const critical=[...new Set(criticalUnknowns)]
  return{observations,selectedAvailability,opposingAvailability,rest,
    needsRecheck:critical.length>0,criticalUnknowns:critical}
}
