/** Evidence-first multi-sport pregame ticket research.
 * Stronger than simple win-loss record sorting, but intentionally NOT a calibrated
 * probability model. Event existence and kickoff are re-verified by researchTicket.
 */
import { hasSportsPermission,sportsCatalog, type ChatBlock } from './sports.ts'
import { scoutDailySports } from './daily-sports-scout.ts'
import { buildDailyResearchBoard } from './daily-ticket-research-board.ts'
import { estimateEvidenceForecast } from './sports-forecast.ts'
import { researchSport } from './multi-sport-research.ts'
import { researchTicket, type ResearchTicketLeg } from './research-ticket.ts'
import { investigatePregame } from './pregame-investigation.ts'
import { investigateEventDeep } from './sports-deep-context.ts'
import { diversifiedSportsPicks,diversifiedSportsShortlist } from './sports-diversity.ts'
import { composeTicketLegNarrative } from './sports-ticket-narrative.ts'
import { discoverEditorialResearch } from './sports-editorial-discovery.ts'
import { discoverGdeltTicketNews,type GdeltReport } from './sports-gdelt-editorial.ts'
import { sameEspnTeam } from './sports-exact-espn-winner.ts'
import { ticketSpecialistSupported } from './ticket-specialist-gate.ts'
import type { KeylessQuote } from './keyless-odds.ts'
import type { EspnMarketQuote } from './espn-odds.ts'
export type TicketPreselectCandidate={
  eventId:string
  sport:string
  league:string
  home:string
  away:string
  kickoff:string
  pick:'home'|'away'|'draw'
  rank:number
  level:'strong'|'conditional'
}
export type TicketPreselectVerdict={
  eventId:string
  excluded:boolean
  priority:number
  reason:string
  bilateralEvidence?:boolean
}
/** Distinguish provider-confirmed fixtures from fully ranked research legs. */
export type TicketDiscoveryAudit={
  discoveredEvents:number
  eligibleLeagues:number
  researchedLeagues:number
  candidatesEvaluated:number
  rejectedForEvidence:number
  shortlistedCandidates:number
  leaguesNotResearched:number
  scanCoverage:Array<{ sport:string
    league:string
    status:string
    futureEvents:number
    rawEvents:number
    pregameOnDate:number
    failedPartitions:number
    reason:string }>
  researchErrors:Array<{ sport:string;league:string;reason:string }>
  /** Verified future fixtures are retained even when ranking finds no picks. */
  fixtureSample:Array<{ eventId:string
    sport:string
    league:string
    home:string
    away:string
    kickoff:string }>
}
export type TicketPreselectReviewer=(
  candidates:readonly TicketPreselectCandidate[],
)=>Promise<readonly TicketPreselectVerdict[]>
/** Full-slate sportsbook observations for ranked matches, prior to picking legs. */
export type TicketQuotePreselector=(
  candidates:readonly TicketPreselectCandidate[],
  scoreboardQuotes:readonly EspnMarketQuote[],
)=>Promise<readonly KeylessQuote[]>
/** Validate ESPN published winner quotes against one exact pregame fixture.
 * @param candidate Investigated ESPN fixture and directional pick.
 * @param quote Published bookmaker observation to test.
 * @param now Research observation time.
 * @param allQuotes Observed market sides (draw required in soccer).
 * @returns True only for a fresh, attributable, matching selection.
 */
export function matchesDailyEspnPrice(
  candidate:TicketPreselectCandidate,quote:KeylessQuote,now:number,
  allQuotes:readonly KeylessQuote[],
):boolean{
  const sportKey=candidate.sport==='hockey'?'icehockey_nhl':'strict'
  const same=(a:string,b:string)=>sameEspnTeam(a,b,sportKey)
  const kickoff=Date.parse(candidate.kickoff)
  const quoteTime=Date.parse(quote.time)
  const observedAt=Date.parse(quote.observedAt??'')
  const lastUpdate=Date.parse(quote.updatedAt??'')
  const winner=candidate.pick==='home'?candidate.home:candidate.away
  if(!Number.isFinite(kickoff)||kickoff<=now||
    !Number.isFinite(quoteTime)||Math.abs(quoteTime-kickoff)>90_000||
    !Number.isFinite(observedAt)||observedAt>now||now-observedAt>15*60_000||
    (Number.isFinite(lastUpdate)&&lastUpdate>now+5*60_000)||
    !quote.source?.startsWith('ESPN ')||quote.eventId!==candidate.eventId||
    !quote.bookmaker?.trim()||quote.bookmaker.startsWith('ESPN proveedor #')||
    !Number.isFinite(quote.price)||quote.price<=1||quote.price>=1000||
    quote.point!==null||!same(quote.home,candidate.home)||
    !same(quote.away,candidate.away)||!same(quote.selection,winner)||
    quote.market!==(candidate.sport==='soccer'?'1x2':'h2h'))return false
  if(candidate.sport==='soccer'&&!allQuotes.some(q=>
    q.eventId===quote.eventId&&q.bookmaker===quote.bookmaker&&
    q.market==='1x2'&&/^(draw|empate|tie)$/iu.test(q.selection)&&
    q.price>1&&q.price<1000&&q.source?.startsWith('ESPN ')))return false
  return true
}
// A daily ticket searches only the six requested sport families, including
// all known ESPN soccer leagues, instead of unrelated tennis/campus sports.
const defaultLeagues:ReadonlyArray<readonly [string,string]>=[
  ['basketball','nba'],['basketball','wnba'],
  ['basketball','mens-college-basketball'],
  ['baseball','mlb'],['baseball','dominican-winter-league'],
  ['football','nfl'],['football','college-football'],
  ['hockey','nhl'],['tennis','atp'],['tennis','wta'],
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
type LeagueResearchReport={
  sport:string
  league:string
  attempt:number
  result:PromiseSettledResult<Awaited<ReturnType<typeof researchSport>>>
}
const researchTimeout=(env:NodeJS.ProcessEnv):number=>{
  const configured=Number(env.PHOENIX_SPORTS_RESEARCH_LEAGUE_TIMEOUT_MS)
  return Number.isInteger(configured)&&configured>=10_000&&configured<=45_000?
    configured:15_000
}
const dayNow=()=>new Intl.DateTimeFormat('en-CA',{ timeZone:'America/Santo_Domingo',
  year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date())
const validDate=(day:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(day)
  &&Number.isFinite(Date.parse(day+'T00:00:00Z'))
  &&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day
const percent=(w:number,g:number)=>(w+1)/(g+2)
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
/** Research-stage ranking, never a five-game admission gate.
 * At least two DISTINCT published finishes per rival are needed for a
 * directional form-only pick; one/no game is retained for event/odds research
 * but cannot justify a winner from win-loss form alone.
 * Anything below five games (NFL three) remains explicitly conditional.
 */
const conditionalRank=(match:Awaited<ReturnType<typeof researchSport>>['matches'][number])=>{
  const { home,away,sport }=match
  const min=2
  if(home.completedGames<min||away.completedGames<min||
    home.averageMargin===null||away.averageMargin===null)return null
  const winDiff=percent(home.wins,home.completedGames)-
    percent(away.wins,away.completedGames)
  const marginDiff=home.averageMargin-away.averageMargin
  // A winning-record edge contradicted by scoring margin is a risk signal,
  // not a reason to promote an uninvestigated favorite.
  if(Math.abs(winDiff)>0.03&&Math.sign(winDiff)!==Math.sign(marginDiff))return null
  const direction=Math.abs(winDiff)>0.03?Math.sign(winDiff):Math.sign(marginDiff)
  if(!direction)return null
  // Diminish thin-sample rankings; strong classification still requires
  // complete form and directional agreement. Scores are NOT probabilities.
  const target=sport==='football'?3:5
  const coverage=Math.min(1,Math.min(home.completedGames,away.completedGames)/target)
  const raw=0.01+Math.min(0.07,Math.abs(winDiff)*0.1+
    Math.abs(marginDiff)*0.002)
  return direction*raw*coverage
}
export async function evidenceTicket(
  count:number,date=dayNow(),sportFilter?:string,fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,
  reviewCandidates?:TicketPreselectReviewer,
  quotePreselector?:TicketQuotePreselector,
):Promise<{ card:ChatBlock
  complete:boolean
  verifiedEvents:number
  candidatesEvaluated:number
  researchLeagues:number
  modelProbabilities:false
  priced:false
  placed:false
  insufficientEvidence:number
  researchStandard:string
  pregameSummariesVerified:number
  injuryFeedsVerified:number
  deepContextChecked:number
  newsMatched:number
  playerStatsChecked:number
  multisportSatisfied:boolean
  scannedSports:number
  selectedSports:string[]
  discoveryAudit:TicketDiscoveryAudit
  selections:ResearchTicketLeg[]
  events:Array<{ eventId:string;home:string;away:string;kickoff:string;sport:string;league:string;pick:'home'|'away' }>
  preselectedQuotes:KeylessQuote[]
  quoteScreenedCandidates:number
  quoteObservedCandidates:number }>{
  if(!Number.isInteger(count)||count<1||count>6)throw Error('El ticket requiere entre 1 y 6 patas')
  if(!validDate(date))throw Error('Fecha de ticket inválida')
  if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado por el operador')
  // A bounded comma-separated sport set lets a daily NBA+NHL request use both
  // leagues without scanning unrelated world soccer or crossing bookmakers.
  const sportFilters=sportFilter?.split(',').map(x=>x.trim()).filter(Boolean)
  if(sportFilters&&(sportFilters.length<1||sportFilters.length>6||
    new Set(sportFilters).size!==sportFilters.length||
    sportFilters.some(x=>!defaultLeagues.some(([sport])=>sport===x))))
    throw Error('Filtro de deportes de ticket inválido')
  const singleSport=Boolean(sportFilters?.length===1)
  const leagues=defaultLeagues.filter(([sport])=>
    !sportFilters||sportFilters.includes(sport))
  if(!leagues.length)throw Error('Disciplina sin cobertura para ticket automático')
  // Unified calendar inventory: zero ranked picks never means zero fixtures.
  const scan=await scoutDailySports(date,512,fetcher,now,env,
    sportFilters)
  const eligible=scan.coverage.filter(x=>x.futureEvents>0).map(x=>({
    sport:x.sport,league:x.league,active:x.futureEvents,
  }))
  eligible.sort((a,b)=>b.active-a.active||a.sport.localeCompare(b.sport))
  // Investigate in four-league batches. Do not stop at the first six leagues
  // when their evidence is weak: expand into verified Portugal/Italy/etc slates.
  // Only verified, future ESPN event IDs can become selections.
  const shortlist=singleSport?eligible:diversifiedSportsShortlist(eligible,eligible.length)
  const reports:LeagueResearchReport[]=[]
  const researchStarted=Date.now()
  const budgetInput=Number(env.PHOENIX_SPORTS_FULL_SLATE_BUDGET_MS)
  const researchBudget=Number.isInteger(budgetInput)&&budgetInput>=20_000&&
    budgetInput<=300_000?budgetInput:115_000
  const perLeagueTimeout=researchTimeout(env)
  let budgetExhausted=false
  const runResearch=async(
    item:{ sport:string;league:string },allowance:number,attempt:number,
  ):Promise<LeagueResearchReport>=>{
    const timeout=Math.max(750,Math.min(perLeagueTimeout,allowance))
    const deadline=AbortSignal.timeout(timeout)
    const guarded:typeof fetch=(input,init)=>{
      const signal=init?.signal?AbortSignal.any([init.signal,deadline]):deadline
      return fetcher(input,{ ...init,signal })
    }
    const result=await Promise.allSettled([boundedTicket(
      researchSport(item.sport,item.league,date,guarded,now,env,
        item.sport==='football'?35:item.sport==='soccer'?56:item.sport==='tennis'?42:28),
      timeout)])
    const settled=result[0]
    if(!settled)throw Error('No se obtuvo resultado de investigación de liga')
    return{ ...item,attempt,result:settled }
  }
  for(let offset=0;offset<shortlist.length;offset+=4){
    if(offset>0&&Date.now()-researchStarted>=researchBudget){budgetExhausted=true;break}
    const allowance=Math.max(750,researchBudget-(Date.now()-researchStarted))
    const batch=await Promise.all(shortlist.slice(offset,offset+4).map(item=>
      runResearch(item,allowance,1)))
    reports.push(...batch)
    // Never stop merely because five or twelve historical favorites appeared.
    // Every still-active sport/league must have an opportunity to compete
    // within the explicit research budget; incomplete coverage is reported.
  }
  // A slow or transient ESPN history read must not discard an otherwise
  // verified future league. Retry only rejected leagues, once, with the same
  // exact event/date constraints and the remaining global budget. A successful
  // first pass is never replaced by a retry, and a retry cannot invent a leg.
  const rejected=[...new Map(reports.filter(x=>x.result.status==='rejected')
    .map(x=>[x.sport+'|'+x.league,x])).values()]
  for(let offset=0;offset<rejected.length;offset+=4){
    if(Date.now()-researchStarted>=researchBudget){budgetExhausted=true;break}
    const allowance=Math.max(750,researchBudget-(Date.now()-researchStarted))
    const batch=await Promise.all(rejected.slice(offset,offset+4).map(item=>
      runResearch(item,allowance,2)))
    reports.push(...batch)
  }
  // Keep only the last attempt for each league. This makes retries recover a
  // transient failure without double-counting matches or successful leagues.
  const finalReports=[...new Map(reports.map(report=>[
    report.sport+'|'+report.league,report])).values()]
  const candidateLegs:Array<{ pick:ResearchTicketLeg
    rank:number
    home:string
    away:string
    kickoff:string
    verifiedEvent:Awaited<ReturnType<typeof researchSport>>['matches'][number]['verifiedEvent']
    level:'strong'|'conditional'
    estimatedPct:number|null
    historicalContext:{ opponentGames:number
      opponentWins:number
      opponentLosses:number
      venueName:string
      venueGames:number
      venueWins:number
      venueLosses:number
      scannedRecent:number } }> = []
  let evaluated=0
  let insufficientEvidence=0
  for(const report of finalReports){
    if(report.result.status!=='fulfilled')continue
    for(const match of report.result.value.matches){
      evaluated++
      // Historical thresholds classify strength, not access to research.
      // Two independent completed games per opponent allow a LOW-CONFIDENCE
      // provisional form ranking; no data or a flat signal cannot choose a side.
      const strongest=descriptiveRank(match)
      const provisional=strongest===null?conditionalRank(match):null
      const rank=strongest??provisional
      if(rank===null){insufficientEvidence++;continue}
      const level=strongest===null?'conditional' as const:'strong' as const
      const home=match.home,away=match.away
      const targetGames=match.sport==='football'?3:5
      const limitedHistory=home.completedGames<targetGames||
        away.completedGames<targetGames
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
      const forecast=estimateEvidenceForecast({ sport:match.sport,phase:'pre',
        eventDate:match.date,
        home:{ name:home.name,lastGames:home.lastResults.map(g=>({
          date:g.date,scored:g.scored,allowed:g.allowed })) },
        away:{ name:away.name,lastGames:away.lastResults.map(g=>({
          date:g.date,scored:g.scored,allowed:g.allowed })) },
      },now)
      const selectedProbability=rank>0?forecast.probabilityHome:forecast.probabilityAway
      const estimatedPct=!limitedHistory&&forecast.status==='exploratory'&&
        selectedProbability!==null?Number((selectedProbability*100).toFixed(1)):null
      const canonical=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
        .toLowerCase().replace(/[^a-z0-9]/gu,'')
      const previousVsOpponent=favorite.lastResults.filter(g=>
        canonical(g.opponent)===canonical(opponent.name))
      const currentVenue=String(match.verifiedEvent.competitions?.[0]?.venue?.fullName??
        match.verifiedEvent.competitions?.[0]?.venue?.name??'').trim().slice(0,100)
      const previousAtVenue=currentVenue?favorite.lastResults.filter(g=>
        canonical(g.venue??'')===canonical(currentVenue)):[]
      const history={ opponentGames:previousVsOpponent.length,
        opponentWins:previousVsOpponent.filter(g=>g.scored>g.allowed).length,
        opponentLosses:previousVsOpponent.filter(g=>g.scored<g.allowed).length,
        venueName:currentVenue,venueGames:previousAtVenue.length,
        venueWins:previousAtVenue.filter(g=>g.scored>g.allowed).length,
        venueLosses:previousAtVenue.filter(g=>g.scored<g.allowed).length,
        scannedRecent:favorite.lastResults.length }
      candidateLegs.push({ rank:Math.abs(rank),level,estimatedPct,historicalContext:history,
        verifiedEvent:match.verifiedEvent,
        home:home.name,away:away.name,kickoff:match.date,pick:{
          sport:match.sport,league:match.league,eventId:match.eventId,
          pick:rank>0?'home':'away',
          rationale:((estimatedPct===null?
            'Probabilidad de esta pata: no estimable con los datos disponibles. ':
            'Probabilidad individual exploratoria '+estimatedPct+
            '% (NO calibrada; no garantiza acierto). ')+
          (level==='conditional'?'CANDIDATA CONDICIONAL. ':'')+
          (limitedHistory?'MUESTRA REDUCIDA '+home.completedGames+'/'+
            away.completedGames+' partidos verificados (objetivo '+
            targetGames+'). Incertidumbre elevada. ':'')+
          rationale).slice(0,480),
        } })
    }
  }
  candidateLegs.sort((a,b)=>b.rank-a.rank||a.pick.eventId.localeCompare(b.pick.eventId))
  // Price observations are gathered for the researched slate, but they do not
  // reorder candidates or decide which outcome the sports evidence supports.
  const quotePool=candidateLegs.map(c=>({
    eventId:c.pick.eventId,sport:c.pick.sport,league:c.pick.league,
    home:c.home,away:c.away,kickoff:c.kickoff,pick:c.pick.pick,
    rank:c.rank,level:c.level,
  }))
  const observed=quotePreselector&&quotePool.length?
    await boundedTicket(quotePreselector(quotePool,scan.espnQuotes),85_000)
      .catch(()=>[] as readonly KeylessQuote[]):[]
  const preselectedQuotes:KeylessQuote[]=observed.slice(0,2_400).filter(q=>
    q!==null&&typeof q==='object'&&
    typeof q.source==='string'&&q.source.startsWith('ESPN '))
  const bookmakersByEvent=new Map<string,Set<string>>()
  for(const candidate of quotePool){
    const books=new Set(preselectedQuotes.filter(q=>
      matchesDailyEspnPrice(candidate,q,now,preselectedQuotes))
      .map(q=>q.bookmaker))
    if(books.size)bookmakersByEvent.set(candidate.eventId,books)
  }
  const quotedIds=new Set(bookmakersByEvent.keys())
  const bilateralEvidence=new Set<string>()
  const coverage=(row:typeof candidateLegs[number])=>
    bilateralEvidence.has(row.pick.eventId)?2:
      reviewCandidates&&ticketSpecialistSupported(row.pick)?1:0
  const researchFirst=(a:typeof candidateLegs[number],
    b:typeof candidateLegs[number])=>
    coverage(b)-coverage(a)||b.rank-a.rank||a.pick.eventId.localeCompare(b.pick.eventId)
  candidateLegs.sort(researchFirst)
  // The expert critic can review MORE than five preliminary candidates.
  // An invalid fixture may be rejected and replaced before the final ticket
  // is rendered. Failures in this optional phase retain honest conditional
  // status rather than declaring an unreviewed favorite approved.
  let reviewedCandidates=0,rejectedCandidates=0
  const reviewNotes=new Map<string,string>()
  if(reviewCandidates&&candidateLegs.length){
    // The first ten favorites must not monopolize specialist research when
    // twenty or more lower-ranked teams publish usable ESPN moneylines.
    // Cover quoted candidates first, then an expanding reserve. This budget
    // is configurable but never bypasses provider-specific network safety.
    const reviewInput=Number(env.PHOENIX_SPORTS_REVIEW_CANDIDATES)
    const reviewCap=Number.isInteger(reviewInput)&&reviewInput>=12&&
      reviewInput<=256?reviewInput:Math.min(96,candidateLegs.length)
    const pool=candidateLegs.slice(0,Math.max(count+4,reviewCap))
    const input=pool.map(c=>({
      eventId:c.pick.eventId,sport:c.pick.sport,league:c.pick.league,
      home:c.home,away:c.away,kickoff:c.kickoff,pick:c.pick.pick,
      rank:c.rank,level:c.level,
    }))
    try{
      const findings=await boundedTicket(reviewCandidates(input),65_000)
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
        const row=candidateLegs[i]
        if(!row)continue
        const decision=decisions.get(row.pick.eventId)
        if(!decision)continue
        if(decision.excluded){candidateLegs.splice(i,1);continue}
        if(decision.bilateralEvidence===true)bilateralEvidence.add(row.pick.eventId)
        // Explicitly reviewed expert evidence dominates marginal differences
        // in historical form; unrated pool candidates stay at descriptive tier.
        row.rank+=decision.priority
        reviewNotes.set(row.pick.eventId,decision.reason.slice(0,180))
      }
      candidateLegs.sort(researchFirst)
    }catch{
      // Review not performed. Downstream mandatory specialist check still runs.
      reviewedCandidates=0;rejectedCandidates=0
    }
  }
  // When at least `count` researched events have fresh matching prices, choose
  // only from that eligible set. Within it, evidence rank remains decisive.
  // If prices are insufficient, retain the research-ranked slate as an honest
  // incomplete draft and let the priced-ticket flow report the exact gaps.
  const quoteEligible=candidateLegs.filter(c=>quotedIds.has(c.pick.eventId))
  const sameBookPools=[...new Set([...bookmakersByEvent.values()].flatMap(x=>[...x]))]
    .map(book=>({ book,candidates:candidateLegs.filter(c=>
      bookmakersByEvent.get(c.pick.eventId)?.has(book))
      .sort(researchFirst) }))
    .filter(row=>row.candidates.length>=count)
    .sort((a,b)=>{
      const compareCoverage=(tier:number)=>
        b.candidates.slice(0,count).filter(row=>coverage(row)>=tier).length-
        a.candidates.slice(0,count).filter(row=>coverage(row)>=tier).length
      const score=(rows:typeof a.candidates)=>rows.slice(0,count)
        .reduce((sum,row)=>sum+row.rank,0)
      return compareCoverage(2)||compareCoverage(1)||score(b.candidates)-score(a.candidates)||
        a.book.localeCompare(b.book)
    })
  const selectionPool=sameBookPools[0]?.candidates??
    (quoteEligible.length>=count?quoteEligible:candidateLegs)
  const quoteSports=new Set(candidateLegs.filter(c=>
    quotedIds.has(c.pick.eventId)).map(c=>c.pick.sport))
  // Do not deliberately replace a fifth REAL priced leg with an unquoted
  // sport merely to meet a cosmetic multi-sport requirement. Preserve honest
  // diversity reporting when ESPN prices exist only in one discipline.
  const preferDiversity=!singleSport&&
    (quotedIds.size===0||quoteSports.size>=2)
  const selected=([2,1,0] as const).reduce<typeof candidateLegs>((chosen,tier)=>{
    const remaining=count-chosen.length
    if(remaining===0)return chosen
    const candidates=selectionPool.filter(row=>coverage(row)===tier)
    return [...chosen,...diversifiedSportsPicks(candidates,remaining,preferDiversity).chosen]
  },[])
  const multisportSatisfied=singleSport||count<=1||
    new Set(selected.map(x=>x.pick.sport)).size>=2
  const chosen=selected.map(x=>({
    ...x.pick,
    rationale:(String(x.pick.rationale??'')+
      (reviewNotes.has(x.pick.eventId)?
        ' · Revisión de alternativas: '+reviewNotes.get(x.pick.eventId):'')).slice(0,480),
  }))
  const candidatesConditional=selected.filter(x=>x.level==='conditional').length
  const scannedSports=new Set(shortlist.map(x=>x.sport)).size
  const selectedSports=[...new Set(selected.map(x=>x.pick.sport))]
  // The scout keeps only its first 120 diverse fixtures. A later researched
  // ESPN fixture beyond that cap is still a real, individually verified game;
  // preserve it rather than losing a legitimate selected leg from the board.
  const verifiedForBoard=[...scan.events,...selected.map(x=>({
    sport:x.pick.sport,league:x.pick.league,eventId:x.pick.eventId,
    kickoff:x.kickoff,home:{ name:x.home },away:{ name:x.away },
  }))]
  const dailyResearchBoard=buildDailyResearchBoard(verifiedForBoard,
    selected.filter(x=>x.pick.pick!=='draw').map(x=>({
      sport:x.pick.sport,league:x.pick.league,eventId:x.pick.eventId,
      pick:x.pick.pick as 'home'|'away',
    })),count,now)
  const discoveryAudit:TicketDiscoveryAudit={
    discoveredEvents:scan.totalEligible,eligibleLeagues:eligible.length,
    researchedLeagues:finalReports.filter(x=>x.result.status==='fulfilled').length,
    candidatesEvaluated:evaluated,rejectedForEvidence:insufficientEvidence,
    shortlistedCandidates:candidateLegs.length,
    leaguesNotResearched:Math.max(0,shortlist.length-finalReports.length),
    scanCoverage:scan.coverage.map(x=>({ ...x })),
    fixtureSample:scan.events.slice(0,60).map(x=>({ eventId:x.eventId,
      sport:x.sport,league:x.league,home:x.home.name,
      away:x.away.name,kickoff:x.kickoff })),
    researchErrors:finalReports.flatMap(report=>report.result.status==='rejected'?[{
      sport:report.sport,
      league:report.league,
      reason:String(report.result.reason).slice(0,180),
    }]:[]),
  }
  if(!chosen.length){
    // A zero-leg draft is useful and honest: Kira must not say that a 5-leg
    // wager was prepared when every candidate failed evidence requirements.
    const card:ChatBlock={ component:'sports_ticket_card',version:1,props:{
      title:'PHOENIX · Investigación insuficiente',
      subtitle:'Partidos descubiertos: '+scan.totalEligible+
        ' · candidatos respaldados: 0/'+count,
      requestedLegs:count,legs:[],combinedOdds:'No disponible',
      source:'ESPN Site API · resultados comprobados '+new Date(now).toISOString(),
      discoveryAudit,dailyResearchBoard,
      note:'TICKET INCOMPLETO: '+scan.totalEligible+' partidos encontrados; '+
        evaluated+' expedientes evaluados; '+insufficientEvidence+
        ' rechazados por evidencia; '+discoveryAudit.researchErrors.length+
        ' fallos históricos. Cero picks NO significa cero partidos. '+
        'No se inventan favoritos, precios ni probabilidades. '+
        dailyResearchBoard.note,
    } }
    return{ card,complete:false,verifiedEvents:0,candidatesEvaluated:evaluated,
      researchLeagues:finalReports.filter(r=>r.result.status==='fulfilled').length,
      insufficientEvidence,pregameSummariesVerified:0,injuryFeedsVerified:0,
      deepContextChecked:0,newsMatched:0,playerStatsChecked:0,
      multisportSatisfied,scannedSports,selectedSports,
      preselectedQuotes,quoteScreenedCandidates:quotePool.length,
      quoteObservedCandidates:quotedIds.size,
      researchStandard:'Sin dirección suficientemente documentada con al menos dos partidos distintos por rival; fuentes y partidos permanecen en discoveryAudit. Deportes evaluados: '+scannedSports+'.'+
        (budgetExhausted?' Búsqueda detenida por presupuesto de tiempo; quedan ligas sin investigar.':''),
      modelProbabilities:false,priced:false,placed:false,discoveryAudit,selections:[],
      events:[] }
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
    return { ...pick,rationale:(core.slice(0,Math.max(0,480-suffix.length))+
      suffix).slice(0,480) }
  })
  // Final validation must inspect the SAME provider-recorded fixture IDs as
  // scouting. ESPN re-query can omit a game due scoreboard pagination/rotation.
  // Do not weaken integrity: researchTicket still checks exact IDs, kickoff,
  // local date, future 'pre' status and both opponents on saved ESPN snapshots.
  const verifiedBoards=new Map<string,{ events:typeof selected[number]['verifiedEvent'][] }>()
  for(const candidate of selected){
    const key=candidate.pick.sport+'|'+candidate.pick.league
    const board=verifiedBoards.get(key)??{ events:[] }
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
    },{ ...leg,
      legWinProbabilityPercent:candidate.estimatedPct??null,
      legProbabilitySource:candidate.estimatedPct!==null&&
        candidate.estimatedPct!==undefined?'exploratory-recent-form':'unavailable',
      historicalContext:candidate.historicalContext,
    },context):null
    const augmented=narrative?{ ...narrative,
      globalNews:(gdelt.byEvent[candidate?.pick.eventId??'']??[]).map(hit=>({
        publisher:hit.publisher,headline:hit.title,indexedAt:hit.indexedAt,
        articleUrl:hit.articleUrl,status:hit.status,
      })),
      sources:[...narrative.sources,...(gdelt.byEvent[candidate?.pick.eventId??'']??[]).map(hit=>({
        name:'GDELT · '+hit.publisher,status:'partial' as const,url:hit.articleUrl,
      }))],
      externalOpinions:external.slice(0,6).map(hit=>({
        publisher:hit.publisher,headline:hit.headline,publishedAt:hit.publishedAt,
        discoveryUrl:hit.discoveryUrl,status:hit.status,
      })),
      explanationForChat:narrative.explanationForChat+'\nNoticias globales indexadas por GDELT: '+
        ((gdelt.byEvent[candidate?.pick.eventId??'']??[]).length?
          (gdelt.byEvent[candidate?.pick.eventId??'']??[]).slice(0,2).map(hit=>
            hit.title+' · '+hit.articleUrl+' (visto '+(hit.indexedAt??'sin hora')+')').join('; ')+
            '. La fecha indica indexación, no publicación; noticia aún no contrastada.':
          'sin artículos adicionales verificables.')+'\nOpiniones externas: '+
        (external.length?external.slice(0,3).map(hit=>hit.publisher+': '+hit.headline).join('; ')+
          '. Son titulares indexados, NO picks contrastados ni pronósticos de consenso.':
          'sin artículos indexados verificables; no se atribuye consenso a tipsters.'),
    }:null
    return { ...leg,narrative:augmented,
      preliminaryEvidenceTier:candidate?.level??'conditional',
      legWinProbabilityPercent:candidate?.estimatedPct??null,
      legProbabilitySource:candidate?.estimatedPct!==null&&
        candidate?.estimatedPct!==undefined?'exploratory-recent-form':'unavailable',
      legProbabilityWarning:'Proyección histórica exploratoria, NO calibrada; '
        +'no contempla lesiones, alineaciones, rivalidad ni precio.',
    }
  })
  const card:ChatBlock={ ...ticket.card,props:{ ...ticket.card.props,
    discoveryAudit,dailyResearchBoard,legs:enrichedLegs,
    chatNarrative:enrichedLegs.map(x=>x.narrative).filter(Boolean),
    narrativeInstruction:'Kira debe acompañar cada pata en el chat con su análisis documentado, noticias enlazadas, riesgos, estadio, clima y árbitro si realmente están confirmados. Si algo falta, declararlo sin completar con imaginación. Fotografías de la noticia solo con URL HTTPS y fuente atribuida.',
    subtitle:'Preselección de '+chosen.length+'/'+count+
      ' candidatos · '+dailyResearchBoard.slots.length+'/'+count+
      ' partidos verificados en lista diaria · '+
      candidatesConditional+' condicionales',
    note:('Candidatos revisados antes de elegir: '+reviewedCandidates+
      ', descartados por contraindicación: '+rejectedCandidates+'. '+
      note+' Cartelera explorada: '+scan.events.length+'/'+scan.totalEligible+
      ' futuros; '+quotePool.length+' candidatos con historial; '+quotedIds.size+
      ' con cuota ESPN cotejada antes de elegir. '+
      (scan.truncated?'INVENTARIO TRUNCADO: no declarar cobertura total. ':'')+
      'Se evaluaron candidatos adicionales antes de formar el ticket. '+
      'Las probabilidades por pata son exploratorias y NO calibradas. '+
      dailyResearchBoard.note).slice(0,1250),
  } }
  return{ card,complete:ticket.complete,verifiedEvents:ticket.verifiedEvents,
    candidatesEvaluated:evaluated,researchLeagues:finalReports.filter(r=>r.result.status==='fulfilled').length,
    insufficientEvidence,pregameSummariesVerified,injuryFeedsVerified,
    deepContextChecked,newsMatched,playerStatsChecked,
    multisportSatisfied,scannedSports,selectedSports,
    preselectedQuotes,quoteScreenedCandidates:quotePool.length,
    quoteObservedCandidates:quotedIds.size,
    researchStandard:'Preselección de '+chosen.length+' partidos reales, incluyendo '+
      candidatesConditional+' candidatos CONDICIONALES; muestras desde 2 por rival se investigan con incertidumbre; 5 por club (NFL 3) es objetivo de muestra fuerte, NO una puerta de entrada. Se exploraron '+scannedSports+' deportes; seleccionados: '+(selectedSports.join(', ')||'ninguno')+'. Diversidad '+(multisportSatisfied?'cumplida':'NO cumplida')+'. Lesiones, titulares y cuotas siguen sin verificación específica.'+
      (budgetExhausted?' Búsqueda detenida por presupuesto de tiempo; quedan ligas sin investigar.':''),
    modelProbabilities:false,priced:false,placed:false,discoveryAudit,selections:documented,
    events:selected.map(x=>({ eventId:x.pick.eventId,home:x.home,away:x.away,kickoff:x.kickoff,
      sport:x.pick.sport,league:x.pick.league,pick:x.pick.pick==='home'?'home' as const:'away' as const })) }
}
