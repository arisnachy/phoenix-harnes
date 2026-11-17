/** Pregame risk review for the RESEARCH shortlist, not a calibrated win model.
 * Distinguishes roster-reconciled absences from generic ESPN injury listings.
 */
import type {TicketPreselectCandidate} from './evidence-ticket.ts'
import type {SpecialistGate} from './ticket-specialist-gate.ts'

export type PregamePreselectionRisk={
  /** Descriptive ranking adjustment only; not probability, EV or betting edge. */
  priority:number
  reasons:string[]
  needsRecheck:boolean
}
type Injury={athlete:string;status:string;reportedAt:string|null}
const validPregame=(row:Injury,now:number,kickoff:number):boolean=>{
  if(!row.athlete.trim()||!row.status.trim()||!row.reportedAt)return false
  const at=Date.parse(row.reportedAt)
  return Number.isFinite(at)&&at<=now&&at<kickoff&&
    now-at<=10*86_400_000
}
const danger=(status:string):number=>{
  const clean=status.trim().toLowerCase()
  if(/^(?:out|inactive|ruled out|will not play)$/u.test(clean))return 1
  if(/^(?:doubtful|questionable|day.to.day|day-to-day|gtd)$/u.test(clean))return .35
  return 0
}
const weighted=(rows:readonly Injury[],now:number,kickoff:number):number=>{
  // ESPN team and league feeds may repeat the same player. Use only the
  // latest pregame report per athlete, including a later healthy status.
  const latest=new Map<string,{at:number;impact:number}>()
  for(const row of rows){
    if(!validPregame(row,now,kickoff))continue
    const at=Date.parse(row.reportedAt!)
    const key=row.athlete.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
      .trim().toLowerCase()
    const previous=latest.get(key)
    if(previous&&previous.at>at)continue
    const value=danger(row.status)
    latest.set(key,{at,impact:previous?.at===at?Math.max(previous.impact,value):value})
  }
  return [...latest.values()].reduce((sum,row)=>sum+row.impact,0)
}

/** Compare bilateral, current availability and schedule BEFORE selecting a parlay leg.
 * @param candidate - Exact future game and the form-based initial favorite.
 * @param check - Independently retrieved sport dossier; may be incomplete.
 * @param now - Observation instant; future/stale injury records do not score.
 * @returns Bounded sorting penalty and explicit caution reasons; never p(win).
 */
export function assessPregamePreselectionRisk(
  candidate:Pick<TicketPreselectCandidate,'sport'|'pick'|'kickoff'>,
  check:SpecialistGate,now:number,
):PregamePreselectionRisk{
  let priority=0
  let needsRecheck=false
  const reasons:string[]=[]
  const own=candidate.pick==='home'?'home':'away'
  const rival=own==='home'?'away':'home'
  const kickoff=Date.parse(candidate.kickoff)
  // The NBA feed is only an alert: *both* club + athlete ID must be reconciled
  // to today's active ESPN roster by the specialist before scoring an absence.
  if((candidate.sport==='basketball'||candidate.sport==='football')&&
    Number.isFinite(kickoff)&&kickoff>now&&check.rosterMatchedInjuries){
    const home=weighted(check.rosterMatchedInjuries[own],now,kickoff)
    const away=weighted(check.rosterMatchedInjuries[rival],now,kickoff)
    const bothReported=check.injuryAudit===undefined||
      (check.injuryAudit.home.matched&&check.injuryAudit.away.matched)
    if(home>0){
      // Missing opponent group is UNKNOWN, not zero injuries. Use only own
      // observed absences when the feeds cannot compare both clubs.
      const differential=bothReported?Math.max(0,home-away):0
      priority-=Math.min(1.15,.18*home+.22*differential)
      needsRecheck=true
      reasons.push('Bajas del elegido conciliadas con roster y fechadas: '+
        home.toFixed(2)+' ponderadas; rival '+
        (bothReported?away.toFixed(2)+' observadas':'sin parte bilateral')+
        '. Impacto real en eficiencia no calibrado')
    }else if(away>0&&bothReported){
      priority+=Math.min(.15,.05*away)
      reasons.push('Rival con bajas publicadas conciliadas; sin inferir victoria')
    }
  }else if(check.injuryAudit&&
    (check.injuryAudit.status==='verified'||
      check.injuryAudit.status==='partial')){
    // If a full roster cannot be fetched, a cluster of current reported
    // absences is still an ADVERSE ALERT (not a verified active-roster count).
    // One loose injury entry cannot demote an otherwise researched favorite.
    const report=check.injuryAudit[own]
    const reported=Number.isFinite(kickoff)&&kickoff>now&&report.matched?
      weighted(report.injuries,now,kickoff):0
    if(reported>=2){
      priority-=Math.min(.7,.18*reported)
      reasons.push('ALERTA PROVISIONAL: '+reported.toFixed(2)+
        ' bajas recientes del elegido en ESPN sin roster conciliado; '+
        'contrastarlas con fuente oficial antes de aprobar')
    }else reasons.push('Lesiones ESPN sin conciliación completa; '+
      'no se infiere que el equipo esté sano')
    needsRecheck=true
  }
  if(candidate.sport==='basketball'&&check.restHours){
    const selected=check.restHours[own],other=check.restHours[rival]
    if(selected!==null&&other!==null&&
      Number.isFinite(selected)&&Number.isFinite(other)){
      if(selected<32&&other>=40){
        priority-=.28
        reasons.push('Back-to-back del elegido frente a rival más descansado ('+
          selected.toFixed(1)+' h vs '+other.toFixed(1)+' h)')
      }else if(other<32&&selected>=40){
        priority+=.10
        reasons.push('Rival en back-to-back; ventaja descriptiva de descanso')
      }
    }
  }
  if(candidate.sport==='football'){
    const qb=check.checklist?.steps.find(step=>step.key==='qb')
    if(qb&&qb.state!=='verified'){
      priority-=.45
      needsRecheck=true
      reasons.push('QB titular de ambos equipos sin confirmación suficiente; '+
        'requiere contraste de inactivos antes de cerrar')
    }
  }
  if(candidate.sport==='hockey'){
    const goalie=check.checklist?.steps.find(step=>step.key==='goalies')
    if(goalie&&goalie.state!=='verified'){
      priority-=.26
      needsRecheck=true
      reasons.push('Porteros sin confirmación suficiente; reexaminar antes del ticket')
    }
  }
  if(check.status==='unavailable'){
    priority-=.22
    needsRecheck=true
    reasons.push('Especialista no disponible: no premiar ausencia de datos')
  }else if(check.status==='incomplete'){
    priority-=.08
    needsRecheck=true
  }
  return{priority:Number(Math.max(-2,Math.min(.2,priority)).toFixed(3)),
    reasons,needsRecheck}
}
