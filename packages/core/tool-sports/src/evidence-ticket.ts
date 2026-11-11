/** Evidence-first multi-sport pregame ticket research.
 * Stronger than simple win-loss record sorting, but intentionally NOT a calibrated
 * probability model. Event existence and kickoff are re-verified by researchTicket.
 */
import { getFeed,hasSportsPermission,sportsCatalog, type ChatBlock } from './sports.ts'
import {fetchEspnScoreboardWithFallback} from './espn-nfl-weekly.ts'
import {estimateEvidenceForecast} from './sports-forecast.ts'
import { researchSport } from './multi-sport-research.ts'
import { researchTicket, type ResearchTicketLeg } from './research-ticket.ts'
import { investigatePregame } from './pregame-investigation.ts'
import { investigateEventDeep } from './sports-deep-context.ts'
import { diversifiedSportsPicks,diversifiedSportsShortlist } from './sports-diversity.ts'
import {composeTicketLegNarrative} from './sports-ticket-narrative.ts'
import {discoverEditorialResearch} from './sports-editorial-discovery.ts'
import {discoverGdeltTicketNews,type GdeltReport} from './sports-gdelt-editorial.ts'
export type TicketPreselectCandidate={
  eventId:string;sport:string;league:string;home:string;away:string;
  kickoff:string;pick:'home'|'away'|'draw';rank:number;level:'strong'|'conditional'
}
export type TicketPreselectVerdict={
  eventId:string;excluded:boolean;priority:number;reason:string
}
export type TicketPreselectReviewer=(
  candidates:readonly TicketPreselectCandidate[],
)=>Promise<readonly TicketPreselectVerdict[]>
// A daily ticket searches only the six requested sport families, including
// all known ESPN soccer leagues, instead of unrelated tennis/campus sports.
const defaultLeagues:ReadonlyArray<readonly [string,string]>=[
  ['basketball','nba'],['basketball','wnba'],['baseball','mlb'],
  ['football','nfl'],['hockey','nhl'],
  ...(sportsCatalog.soccer??[]).map(league=>['soccer',league] as const),
]
export function boundedTicket<T>(task:Promise<T>,ms:number):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined
  const limit=new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>reject(Error('Tiempo de investigación excedido')),ms)
  })
  return Promise.race([task,limit]).finally(()=>{
    if(timer!==undefined)clearTimeout(timer)
  })
}
const dayNow=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const validDate=(day:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(day)
  &&Number.isFinite(Date.parse(day+'T00:00:00Z'))
  &&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day
const percent=(w:number,g:number)=>(w+1)/(g+2)
const localDay=(stamp:number)=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date(stamp))
/** Ranks descriptive agreement only. It is NOT an outcome probability. */
const descriptiveRank=(match:Awaited<ReturnType<typeof researchSport>>['matches'][number]):number|null=>{
  const home=match.home,away=match.away
  const minGames=match.sport==='football'?3:5
  if(match.evidence!=='descriptive'||home.completedGames<minGames||away.completedGames<minGames
    ||home.averageMargin===null||away.averageMargin===null
    ||home.averageScored===null||away.averageScored===null)return null
  const winDiff=percent(home.wins,home.completedGames)-percent(away.wins,away.completedGames)
  const scale=Math.max(1,(home.averageScored+away.averageScored)/2)
  const marginDiff=Math.max(-1,Math.min(1,(home.averageMargin-away.averageMargin)/(2*scale)))
  const restDiff=Math.max(-1,Math.min(1,((home.restHours??0)-(away.restHours??0))/72))
  if(Math.abs(winDiff)<0.08||Math.sign(winDiff)!==Math.sign(marginDiff))return null
  const rank=0.55*winDiff+0.40*marginDiff+0.05*restDiff
  return Math.abs(rank)>=0.16?rank:null
}
/** A lower tier for real fixtures with sufficient historical samples but
 * disagreeing or modest form signals. These are candidates to challenge,
 * NEVER promoted to strong findings or calibrated recommendations.
 */
const conditionalRank=(match:Awaited<ReturnType<typeof researchSport>>['matches'][number])=>{
  const {home,away,sport}=match
  const min=sport==='football'?3:5
  if(match.evidence!=='descriptive'||home.completedGames<min||
    away.completedGames<min||home.averageMargin===null||
    away.averageMargin===null)return null
  const winDiff=percent(home.wins,home.completedGames)-
    percent(away.wins,away.completedGames)
  const marginDiff=home.averageMargin-away.averageMargin
  const direction=Math.abs(winDiff)>0.03?Math.sign(winDiff):Math.sign(marginDiff)
  if(!direction)return null
  // A conditional score stays below every qualifying strong score.
  const raw=0.01+Math.min(0.07,Math.abs(winDiff)*0.1+
    Math.abs(marginDiff)*0.002)
  return direction*raw
}
export async function evidenceTicket(
  count:number,date=dayNow(),sportFilter?:string,fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,
  reviewCandidates?:TicketPreselectReviewer,
):Promise<{card:ChatBlock;complete:boolean;verifiedEvents:number;
  candidatesEvaluated:number;researchLeagues:number;modelProbabilities:false;priced:false;placed:false;
  insufficientEvidence:number;researchStandard:string;
  pregameSummariesVerified:number;injuryFeedsVerified:number;
  deepContextChecked:number;newsMatched:number;playerStatsChecked:number;
  multisportSatisfied:boolean;scannedSports:number;selectedSports:string[];
  selections:ResearchTicketLeg[];events:Array<{eventId:string;home:string;away:string;kickoff:string;sport:string;league:string;pick:'home'|'away'}>}>{
  if(!Number.isInteger(count)||count<1||count>6)throw Error('El ticket requiere entre 1 y 6 patas')
  if(!validDate(date))throw Error('Fecha de ticket inválida')
  if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado por el operador')
  const leagues=defaultLeagues.filter(([sport])=>!sportFilter||sport===sportFilter)
  if(!leagues.length)throw Error('Disciplina sin cobertura para ticket automático')
  // Keep historical screening separate from full specialist investigations.
  // A stalled provider must not block the ticket; failures retain their state.
  const slate:Array<PromiseSettledResult<{sport:string;league:string;active:number}>>=[]
  for(let offset=0;offset<leagues.length;offset+=8){
    const batch=await Promise.allSettled(leagues.slice(offset,offset+8).map(async([sport,league])=>{
    // Search both ESPN UTC date partitions for the requested local (RD) day.
    const next=new Date(Date.parse(date+'T00:00:00Z')+86_400_000)
      .toISOString().slice(0,10).replaceAll('-','')
    const partitions=await Promise.allSettled([date.replaceAll('-',''),next].map(day=>
      boundedTicket(fetchEspnScoreboardWithFallback(sport,league,day,
        uri=>getFeed<{events?:Array<{id?:string|number;date?:string;status?:{type?:{state?:string}}}>}>(
          uri,fetcher)),4_000)))
    const observed=partitions.flatMap(x=>x.status==='fulfilled'&&Array.isArray(x.value.events)
      ?x.value.events:[])
    if(!partitions.some(x=>x.status==='fulfilled'&&Array.isArray(x.value.events)))
      throw Error('Cartelera no verificada')
    const active=new Set(observed.filter(e=>{
      const at=Date.parse(e.date??'')
      return Number.isFinite(at)&&at>now&&localDay(at)===date
        &&(e.status?.type?.state??'pre')==='pre'
    }).map(e=>String(e.id??'')).filter(id=>/^\d{1,20}$/u.test(id))).size
    return{sport,league,active}
    }))
    slate.push(...batch)
  }
  const eligible=slate.flatMap(r=>r.status==='fulfilled'&&r.value.active>0?[r.value]:[])
  eligible.sort((a,b)=>b.active-a.active||a.sport.localeCompare(b.sport))
  // Investigate in four-league batches. Do not stop at the first six leagues
  // when their evidence is weak: expand into verified Portugal/Italy/etc slates.
  // Only verified, future ESPN event IDs can become selections.
  const shortlist=sportFilter?eligible:diversifiedSportsShortlist(eligible,eligible.length)
  const reports:Array<PromiseSettledResult<Awaited<ReturnType<typeof researchSport>>>>=[]
  const researchStarted=Date.now()
  let budgetExhausted=false
  for(let offset=0;offset<shortlist.length;offset+=4){
    if(offset>0&&Date.now()-researchStarted>=34_000){budgetExhausted=true;break}
    const allowance=Math.max(750,34_000-(Date.now()-researchStarted))
    const batch=await Promise.allSettled(shortlist.slice(offset,offset+4).map(({sport,league})=>{
      const deadline=AbortSignal.timeout(Math.min(8_500,allowance))
      const guarded:typeof fetch=(input,init)=>{
        const signal=init?.signal?AbortSignal.any([init.signal,deadline]):deadline
        return fetcher(input,{...init,signal})
      }
      return boundedTicket(researchSport(sport,league,date,guarded,now,env,
        sport==='football'?35:sport==='soccer'?56:sport==='tennis'?42:28),
        Math.min(8_500,allowance))
    }))
    reports.push(...batch)
    // Stop costly expansion only after enough independently researched,
    // directionally consistent picks are available; an HTTP error is not a vote.
    const viable=reports.flatMap(x=>x.status==='fulfilled'?x.value.matches:[])
      .filter(x=>descriptiveRank(x)!==null)
    const diversified=sportFilter!==undefined||new Set(viable.map(x=>x.sport)).size>=2
    // First-pass quality matters: do not end the league scan as soon as
    // exactly five provisional winners appear. Compare a wider rival pool.
    if(offset+4>=8&&viable.length>=Math.max(12,count*3)&&diversified)break
  }
  const candidateLegs:Array<{pick:ResearchTicketLeg;rank:number;home:string;away:string;
    kickoff:string;verifiedEvent:Awaited<ReturnType<typeof researchSport>>['matches'][number]['verifiedEvent'];
    level:'strong'|'conditional';estimatedPct:number|null;
    historicalContext:{opponentGames:number;opponentWins:number;opponentLosses:number;
      venueName:string;venueGames:number;venueWins:number;venueLosses:number;
      scannedRecent:number}}> = []
  let evaluated=0
  let insufficientEvidence=0
  for(const report of reports){
    if(report.status!=='fulfilled')continue
    for(const match of report.value.matches){
      evaluated++
      // Three different fixtures are a lower bound for descriptive research,
      // NOT enough to sell a high-confidence 5/6-leg multi-sport parlay.
      // Only NFL retains 3 because a league schedule has one match per week.
      // Keep the same, testable descriptive filter during expansion and choice.
      const strongest=descriptiveRank(match)
      const provisional=strongest===null?conditionalRank(match):null
      const rank=strongest??provisional
      if(rank===null){insufficientEvidence++;continue}
      const level=strongest===null?'conditional' as const:'strong' as const
      const home=match.home,away=match.away
      const favorite=rank>0?home:away,opponent=rank>0?away:home
      const sportRisks:Record<string,string>={
        soccer:'once/lesiones y xG',basketball:'lesiones y rotaciones',
        baseball:'abridores y bullpen',football:'QB y bajas',
        hockey:'portero titular',tennis:'superficie y molestias físicas',
      }
      const observed=(side:typeof favorite)=>side.lastResults.slice(0,3).map(g=>
        g.date.slice(5,10)+' '+g.scored+'-'+g.allowed+' '+g.opponent.slice(0,14)).join('; ')
      const rationale=('ESPN '+favorite.completedGames+' partidos distintos: '+
        favorite.name+' '+favorite.wins+'V-'+favorite.draws+'E-'+favorite.losses+'D; '+
        opponent.name+' '+opponent.wins+'V-'+opponent.draws+'E-'+opponent.losses+'D. '+
        'Últimos: '+observed(favorite)+'. '+
        'Márgenes '+favorite.averageMargin+'/'+opponent.averageMargin+
        '; descanso '+(favorite.restHours??'?')+'h. '+
        'POR VERIFICAR: '+(sportRisks[match.sport]??'titulares')+
        ' y cuota; sin probabilidad validada.').slice(0,395)
      const forecast=estimateEvidenceForecast({sport:match.sport,phase:'pre',
        eventDate:match.date,
        home:{name:home.name,lastGames:home.lastResults.map(g=>({
          date:g.date,scored:g.scored,allowed:g.allowed}))},
        away:{name:away.name,lastGames:away.lastResults.map(g=>({
          date:g.date,scored:g.scored,allowed:g.allowed}))},
      },now)
      const selectedProbability=rank>0?forecast.probabilityHome:forecast.probabilityAway
      const estimatedPct=forecast.status==='exploratory'&&
        selectedProbability!==null?Number((selectedProbability*100).toFixed(1)):null
      const canonical=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
        .toLowerCase().replace(/[^a-z0-9]/gu,'')
      const previousVsOpponent=favorite.lastResults.filter(g=>
        canonical(g.opponent)===canonical(opponent.name))
      const currentVenue=String(match.verifiedEvent.competitions?.[0]?.venue?.fullName??
        match.verifiedEvent.competitions?.[0]?.venue?.name??'').trim().slice(0,100)
      const previousAtVenue=currentVenue?favorite.lastResults.filter(g=>
        canonical(g.venue??'')===canonical(currentVenue)):[]
      const history={opponentGames:previousVsOpponent.length,
        opponentWins:previousVsOpponent.filter(g=>g.scored>g.allowed).length,
        opponentLosses:previousVsOpponent.filter(g=>g.scored<g.allowed).length,
        venueName:currentVenue,venueGames:previousAtVenue.length,
        venueWins:previousAtVenue.filter(g=>g.scored>g.allowed).length,
        venueLosses:previousAtVenue.filter(g=>g.scored<g.allowed).length,
        scannedRecent:favorite.lastResults.length}
      candidateLegs.push({rank:Math.abs(rank),level,estimatedPct,historicalContext:history,
        verifiedEvent:match.verifiedEvent,
        home:home.name,away:away.name,kickoff:match.date,pick:{
        sport:match.sport,league:match.league,eventId:match.eventId,
        pick:rank>0?'home':'away',
        rationale:((estimatedPct===null?
          'Probabilidad de esta pata: no estimable con los datos disponibles. ':
          'Probabilidad individual exploratoria '+estimatedPct+
            '% (NO calibrada; no garantiza acierto). ')+
          (level==='conditional'?'CANDIDATA CONDICIONAL. ':'')+
          rationale).slice(0,480),
      }})
    }
  }
  candidateLegs.sort((a,b)=>b.rank-a.rank||a.pick.eventId.localeCompare(b.pick.eventId))
  // The expert critic can review MORE than five preliminary candidates.
  // An invalid fixture may be rejected and replaced before the final ticket
  // is rendered. Failures in this optional phase retain honest conditional
  // status rather than declaring an unreviewed favorite approved.
  let reviewedCandidates=0,rejectedCandidates=0
  const reviewNotes=new Map<string,string>()
  if(reviewCandidates&&candidateLegs.length){
    const pool=candidateLegs.slice(0,Math.min(10,Math.max(count+4,7)))
    const input=pool.map(c=>({
      eventId:c.pick.eventId,sport:c.pick.sport,league:c.pick.league,
      home:c.home,away:c.away,kickoff:c.kickoff,pick:c.pick.pick,
      rank:c.rank,level:c.level,
    }))
    try{
      const findings=await boundedTicket(reviewCandidates(input),12_000)
      const known=new Set(input.map(x=>x.eventId))
      const seen=new Set<string>()
      const decisions=new Map<string,TicketPreselectVerdict>()
      for(const finding of findings){
        if(!known.has(finding.eventId)||seen.has(finding.eventId)||
          typeof finding.excluded!=='boolean'||
          !Number.isFinite(finding.priority)||finding.priority< -100||
          finding.priority>100||typeof finding.reason!=='string')continue
        seen.add(finding.eventId)
        decisions.set(finding.eventId,finding)
      }
      reviewedCandidates=decisions.size
      rejectedCandidates=[...decisions.values()].filter(x=>x.excluded).length
      for(let i=candidateLegs.length-1;i>=0;i--){
        const row=candidateLegs[i]!,decision=decisions.get(row.pick.eventId)
        if(!decision)continue
        if(decision.excluded){candidateLegs.splice(i,1);continue}
        // Explicitly reviewed expert evidence dominates marginal differences
        // in historical form; unrated pool candidates stay at descriptive tier.
        row.rank+=decision.priority
        reviewNotes.set(row.pick.eventId,decision.reason.slice(0,180))
      }
      candidateLegs.sort((a,b)=>b.rank-a.rank||a.pick.eventId.localeCompare(b.pick.eventId))
    }catch{
      // Review not performed. Downstream mandatory specialist check still runs.
      reviewedCandidates=0;rejectedCandidates=0
    }
  }
  const {chosen:selected,diversitySatisfied:multisportSatisfied}=
    diversifiedSportsPicks(candidateLegs,count,!sportFilter)
  const chosen=selected.map(x=>({
    ...x.pick,
    rationale:(String(x.pick.rationale??'')+
      (reviewNotes.has(x.pick.eventId)?
        ' · Revisión de alternativas: '+reviewNotes.get(x.pick.eventId):'')).slice(0,480),
  }))
  const candidatesConditional=selected.filter(x=>x.level==='conditional').length
  const scannedSports=new Set(shortlist.map(x=>x.sport)).size
  const selectedSports=[...new Set(selected.map(x=>x.pick.sport))]
  if(!chosen.length){
    // A zero-leg draft is useful and honest: Kira must not say that a 5-leg
    // wager was prepared when every candidate failed evidence requirements.
    const card:ChatBlock={component:'sports_ticket_card',version:1,props:{
      title:'PHOENIX · Investigación insuficiente',
      subtitle:'No hay selecciones respaldadas para completar el ticket',
      requestedLegs:count,legs:[],combinedOdds:'No disponible',
      source:'ESPN Site API · resultados comprobados '+new Date(now).toISOString(),
      note:'TICKET INCOMPLETO: 0 de '+count+' eventos superaron la auditoría de muestra, coherencia y disponibilidad. No se inventan favoritos, precios ni probabilidades. Verificar otra fecha o ampliar ligas antes de apostar.',
    }}
    return{card,complete:false,verifiedEvents:0,candidatesEvaluated:evaluated,
      researchLeagues:reports.filter(r=>r.status==='fulfilled').length,
      insufficientEvidence,pregameSummariesVerified:0,injuryFeedsVerified:0,
      deepContextChecked:0,newsMatched:0,playerStatsChecked:0,
      multisportSatisfied,scannedSports,selectedSports,
      researchStandard:'Sin candidatos con cinco partidos distintos por equipo (NFL tres) y tendencia contrastable. Deportes evaluados: '+scannedSports+'.'+
        (budgetExhausted?' Búsqueda detenida por presupuesto de tiempo; quedan ligas sin investigar.':''),
      modelProbabilities:false,priced:false,placed:false,selections:[],
      events:[]}
  }
  // One bounded memoized HTTP request for a repeated ESPN event summary
  // or league injury feed, even across the two complementary research passes.
  const networkCache=new Map<string,Promise<Response>>()
  const cachedFetcher:typeof fetch=(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url
    const reused=url.includes('/summary?event=')||url.endsWith('/injuries')
    if(!reused)return fetcher(input,init)
    let request=networkCache.get(url)
    if(!request){request=fetcher(input,init);networkCache.set(url,request)}
    return request.then(response=>response.clone())
  }
  const checks=await boundedTicket(investigatePregame(selected.map(x=>({
    sport:x.pick.sport,league:x.pick.league,eventId:x.pick.eventId,
  })),cachedFetcher),6_000).catch(()=>new Map())
  const [contextual,editorial,gdelt]=await Promise.all([
    boundedTicket(Promise.allSettled(selected.map(x=>investigateEventDeep(
      x.pick.sport,x.pick.league,x.pick.eventId,cachedFetcher,now,env))),6_000)
      .catch(()=>[]),
    boundedTicket(Promise.allSettled(selected.map(x=>discoverEditorialResearch(
      x.home+' '+x.away,['covers','vegasinsider'],cachedFetcher,now))),6_000)
      .catch(()=>[]),
    boundedTicket(discoverGdeltTicketNews(selected.map(x=>({
      eventId:x.pick.eventId,home:x.home,away:x.away,
    })),fetcher,now),6_000).catch(():GdeltReport=>({
      status:'unavailable',checkedAt:new Date(now).toISOString(),
      sourceUrl:null,byEvent:{},scanned:0,note:'GDELT agotó el plazo; sin noticias verificadas',
    })),
  ])
  let deepContextChecked=0,newsMatched=0,playerStatsChecked=0
  for(const result of contextual)if(result.status==='fulfilled'){
    deepContextChecked++
    newsMatched+=result.value.headlines.length
    playerStatsChecked+=result.value.playerStats.length
  }
  let pregameSummariesVerified=0,injuryFeedsVerified=0
  const documented=chosen.map((pick,index)=>{
    const state=checks.get(pick.sport+'|'+pick.league+'|'+pick.eventId)
    if(state?.summaryVerified)pregameSummariesVerified++
    if(state?.injuryReportVerified)injuryFeedsVerified++
    const context=contextual[index]
    const deep=context?.status==='fulfilled'?context.value:undefined
    const sourceSummary=' noticias relacionadas '+(deep?.headlines.length??0)+
      '; bajas individualizadas '+(deep?.injuries.length??0)+
      '; estadísticas de jugadores '+(deep?.playerStats.length??0)+'; '
    const audit='Resumen ESPN '+(state?.summaryVerified?'consultado':'no verificado')+
      '; parte médico '+(state?.injuryReportVerified?'feed disponible':'no verificable')+
      '; titulares pendientes'
    // Reserve the whole source suffix, not only the audit. Otherwise long
    // specialist notes erase the actual ESPN summary and injury checks.
    const rationale=String(pick.rationale??'')
    const reviewerMarker=' · Revisión de alternativas:'
    const reviewerAt=rationale.indexOf(reviewerMarker)
    const reviewer=reviewerAt>=0?rationale.slice(reviewerAt):''
    const core=reviewerAt>=0?rationale.slice(0,reviewerAt):rationale
    const suffix=reviewer+' · '+sourceSummary+audit
    return {...pick,rationale:(core.slice(0,Math.max(0,480-suffix.length))+
      suffix).slice(0,480)}
  })
  // Final validation must inspect the SAME provider-recorded fixture IDs as
  // scouting. ESPN re-query can omit a game due scoreboard pagination/rotation.
  // Do not weaken integrity: researchTicket still checks exact IDs, kickoff,
  // local date, future 'pre' status and both opponents on saved ESPN snapshots.
  const verifiedBoards=new Map<string,{events:typeof selected[number]['verifiedEvent'][]}>()
  for(const candidate of selected){
    const key=candidate.pick.sport+'|'+candidate.pick.league
    const board=verifiedBoards.get(key)??{events:[]}
    if(!board.events.some(event=>String(event.id)===candidate.pick.eventId))
      board.events.push(candidate.verifiedEvent)
    verifiedBoards.set(key,board)
  }
  const ticket=await researchTicket(documented,date,fetcher,now,env,count,true,
    verifiedBoards)
  const note=String(ticket.card.props.note??'')+
    ' Investigación ampliada en '+deepContextChecked+'/'+documented.length+
    ' eventos: '+newsMatched+' noticias relacionadas, '+playerStatsChecked+
    ' estadísticas individuales reportadas. Estos recuentos NO prueban bajas ni titulares.'+
    (!multisportSatisfied?' REQUISITO MULTIDEPORTE NO ALCANZADO: las selecciones fundamentadas son de una sola disciplina. ':'')+
    ' Investigación contextual: '+pregameSummariesVerified+'/'+documented.length+
    ' resúmenes de evento ESPN; '+injuryFeedsVerified+'/'+documented.length+
    ' informes de lesiones de liga accesibles. Accesible NO equivale a bajas o titulares verificados.'+
    ' Los archivos GitHub de SportsbookReview y MLB son históricos, nunca cuotas actuales.'
  const priorLegs=Array.isArray(ticket.card.props.legs)?ticket.card.props.legs:[]
  const enrichedLegs=priorLegs.map((raw,index)=>{
    const leg=raw&&typeof raw==='object'&&!Array.isArray(raw)?
      raw as Record<string,unknown>:{}
    const candidate=selected[index]
    const observed=contextual[index]
    const context=observed?.status==='fulfilled'?observed.value:undefined
    const editorialRow=editorial[index]
    const external=editorialRow?.status==='fulfilled'?editorialRow.value.hits:[]
    const narrative=candidate?composeTicketLegNarrative({
      eventId:candidate.pick.eventId,sport:candidate.pick.sport,
      league:candidate.pick.league,home:candidate.home,away:candidate.away,
      kickoff:candidate.kickoff,pick:candidate.pick.pick,
    },{...leg,
      legWinProbabilityPercent:candidate.estimatedPct??null,
      legProbabilitySource:candidate.estimatedPct!==null&&
        candidate.estimatedPct!==undefined?'exploratory-recent-form':'unavailable',
      historicalContext:candidate.historicalContext,
    },context):null
    const augmented=narrative?{...narrative,
      globalNews:(gdelt.byEvent[candidate!.pick.eventId]??[]).map(hit=>({
        publisher:hit.publisher,headline:hit.title,indexedAt:hit.indexedAt,
        articleUrl:hit.articleUrl,status:hit.status,
      })),
      sources:[...narrative.sources,...(gdelt.byEvent[candidate!.pick.eventId]??[]).map(hit=>({
        name:'GDELT · '+hit.publisher,status:'partial' as const,url:hit.articleUrl,
      }))],
      externalOpinions:external.slice(0,6).map(hit=>({
        publisher:hit.publisher,headline:hit.headline,publishedAt:hit.publishedAt,
        discoveryUrl:hit.discoveryUrl,status:hit.status,
      })),
      explanationForChat:narrative.explanationForChat+'\nNoticias globales indexadas por GDELT: '+
        ((gdelt.byEvent[candidate!.pick.eventId]??[]).length?
          (gdelt.byEvent[candidate!.pick.eventId]??[]).slice(0,2).map(hit=>
            hit.title+' · '+hit.articleUrl+' (visto '+(hit.indexedAt??'sin hora')+')').join('; ')+
            '. La fecha indica indexación, no publicación; noticia aún no contrastada.':
            'sin artículos adicionales verificables.')+'\nOpiniones externas: '+
        (external.length?external.slice(0,3).map(hit=>hit.publisher+': '+hit.headline).join('; ')+
          '. Son titulares indexados, NO picks contrastados ni pronósticos de consenso.':
          'sin artículos indexados verificables; no se atribuye consenso a tipsters.'),
    }:null
    return {...leg,narrative:augmented,
      preliminaryEvidenceTier:candidate?.level??'conditional',
      legWinProbabilityPercent:candidate?.estimatedPct??null,
      legProbabilitySource:candidate?.estimatedPct!==null&&
        candidate?.estimatedPct!==undefined?'exploratory-recent-form':'unavailable',
      legProbabilityWarning:'Proyección histórica exploratoria, NO calibrada; '
        +'no contempla lesiones, alineaciones, rivalidad ni precio.',
    }
  })
  const card:ChatBlock={...ticket.card,props:{...ticket.card.props,
    legs:enrichedLegs,
    chatNarrative:enrichedLegs.map(x=>x.narrative).filter(Boolean),
    narrativeInstruction:'Kira debe acompañar cada pata en el chat con su análisis documentado, noticias enlazadas, riesgos, estadio, clima y árbitro si realmente están confirmados. Si algo falta, declararlo sin completar con imaginación. Fotografías de la noticia solo con URL HTTPS y fuente atribuida.',
    subtitle:'Preselección de '+chosen.length+' eventos · '+
      candidatesConditional+' candidatos CONDICIONALES · especialistas después',
    note:(note+' Se evaluaron candidatos adicionales antes de formar el ticket. '+
      'Las probabilidades por pata son exploratorias y NO calibradas. '+
      'Candidatos revisados antes de elegir: '+reviewedCandidates+
      ', descartados por contraindicación: '+rejectedCandidates+'.').slice(0,1250),
  }}
  return{card,complete:ticket.complete,verifiedEvents:ticket.verifiedEvents,
    candidatesEvaluated:evaluated,researchLeagues:reports.filter(r=>r.status==='fulfilled').length,
    insufficientEvidence,pregameSummariesVerified,injuryFeedsVerified,
    deepContextChecked,newsMatched,playerStatsChecked,
    multisportSatisfied,scannedSports,selectedSports,
    researchStandard:'Preselección de '+chosen.length+' partidos reales, incluyendo '+
      candidatesConditional+' candidatos CONDICIONALES; historial mínimo 5 por club (NFL 3). Se exploraron '+scannedSports+' deportes; seleccionados: '+(selectedSports.join(', ')||'ninguno')+'. Diversidad '+(multisportSatisfied?'cumplida':'NO cumplida')+'. Lesiones, titulares y cuotas siguen sin verificación específica.'+
      (budgetExhausted?' Búsqueda detenida por presupuesto de tiempo; quedan ligas sin investigar.':''),
    modelProbabilities:false,priced:false,placed:false,selections:documented,
    events:selected.map(x=>({eventId:x.pick.eventId,home:x.home,away:x.away,kickoff:x.kickoff,
      sport:x.pick.sport,league:x.pick.league,pick:x.pick.pick==='home'?'home' as const:'away' as const}))}
}
