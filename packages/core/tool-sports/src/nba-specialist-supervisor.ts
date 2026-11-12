/** NBA investigation orchestration: form + actual bilateral specialist evidence.
 * The 22-point audit is reported even when some sources are unavailable.
 * A completed tool call is never equivalent to a verified betting selection.
 */
import {researchNbaSlate,type NbaMatchResearch} from './nba-research.ts'
import {investigateTicketSpecialists,type SpecialistGate} from './ticket-specialist-gate.ts'
import {auditSportChecklist,type SportChecklist,type StepObservation} from './daily-specialist-checklist.ts'

export type NbaSupervisedMatch=NbaMatchResearch & {
  specialistResearch:SpecialistGate & {checklist:SportChecklist}
}
const evidenceOnly=(match:NbaMatchResearch,now:number):SportChecklist=>{
  const sample=match.home.gamesObserved>=5&&match.away.gamesObserved>=5
  const observation:Record<string,StepObservation>={
    fixture:{state:'verified',detail:'ESPN '+match.eventId+': '+match.matchup+
      ', inicio '+match.kickoff},
    B01:{state:'partial',detail:'Identidad y hora ESPN; sede sin comprobar en este informe'},
    form:{state:sample?'partial':'missing',detail:
      match.home.team+' '+match.home.gamesObserved+' resultados; '+
      match.away.team+' '+match.away.gamesObserved+' resultados. Muestra y calendario por cotejar'},
    B02:{state:sample?'partial':'missing',detail:'Historial disponible: local '+
      match.home.gamesObserved+', visitante '+match.away.gamesObserved+
      '; no se acreditan automáticamente 5/10/20 completos'},
    B03:{state:sample?'partial':'missing',detail:'Forma histórica; rival ajustado y local/visita no verificados'},
  }
  return auditSportChecklist('basketball',observation,now)
}
/** Build one chronological checklist for every discovered NBA fixture.
 * The specialist uses ESPN summary, 5/10/20, rosters, player statistics and
 * injury backups, plus independent fixture checks (NBA official CDN / TheSportsDB).
 * Failures remain explicit; no fabricated advanced metrics or official starters.
 */
export async function researchNbaWithSpecialists(
  date?:string,eventId?:string,fetcher:typeof fetch=fetch,now=Date.now(),
  env:NodeJS.ProcessEnv=process.env,lookbackDays=14,
){
  const form=await researchNbaSlate(date,eventId,fetcher,now,env,lookbackDays)
  const fixtures=form.matches.map(match=>({
    sport:'basketball',league:'nba',eventId:match.eventId,date:form.date,
    home:match.home.team,away:match.away.team,kickoff:match.kickoff,
  }))
  // The existing gate performs real provider reads and produces the full
  // original basketball protocol. Timeouts are per event, not a global hold.
  const audits=await investigateTicketSpecialists(fixtures,fetcher,now,env,[],20_000)
  const matches:NbaSupervisedMatch[]=form.matches.map((match,index)=>{
    const audit=audits[index]
    const checklist=audit?.checklist??evidenceOnly(match,now)
    const specialistResearch: NbaSupervisedMatch['specialistResearch']={
      ...(audit??{
        sport:'basketball',league:'nba',eventId:match.eventId,
        specialist:'NBA: expediente especializado no disponible',
        status:'unavailable' as const,verifiedSteps:[],
        pendingSteps:['No fue posible completar las consultas especializadas'],
        approvedForBetting:false as const,checkedAt:new Date(now).toISOString(),
      }),checklist,
    }
    return {...match,specialistResearch}
  })
  return {...form,matches,
    researchCoverage:{
      expectedStepsPerMatch:22,
      auditedMatches:matches.length,
      fullComplete:matches.filter(m=>m.specialistResearch.checklist.fullComplete).length,
      totalVerified:matches.reduce((n,m)=>n+m.specialistResearch.checklist.fullVerified,0),
      totalPartial:matches.reduce((n,m)=>n+m.specialistResearch.checklist.fullPartial,0),
      totalMissing:matches.reduce((n,m)=>n+m.specialistResearch.checklist.fullMissing,0),
      note:'Cada partido tiene 10 controles generales y 12 controles NBA. '+
        'Una fuente consultada no implica métrica observada. La ausencia de '+
        'evidencia no bloquea la tarjeta de investigación ni aprueba la apuesta.',
    },
    note:form.note+' Los especialistas registran checklist, fallos, '+
      'lesiones ESPN y fuentes independientes para cada partido. '+
      'Cuotas observadas requieren sports_chat_odds por evento y casa exactos.',
  }
}
