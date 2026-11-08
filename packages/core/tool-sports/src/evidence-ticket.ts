/** Evidence-first multi-sport pregame ticket research.
 * Stronger than simple win-loss record sorting, but intentionally NOT a calibrated
 * probability model. Event existence and kickoff are re-verified by researchTicket.
 */
import { getFeed,hasSportsPermission, type ChatBlock } from './sports.ts'
import { researchSport } from './multi-sport-research.ts'
import { researchTicket, type ResearchTicketLeg } from './research-ticket.ts'
import { investigatePregame } from './pregame-investigation.ts'
import { investigateEventDeep } from './sports-deep-context.ts'
import { diversifiedSportsPicks,diversifiedSportsShortlist } from './sports-diversity.ts'
const defaultLeagues = [
  ['basketball','nba'],['hockey','nhl'],['baseball','mlb'],['football','nfl'],
  ['soccer','eng.1'],['soccer','esp.1'],['soccer','usa.1'],['soccer','uefa.champions'],
  ['basketball','wnba'],['tennis','atp'],['tennis','wta'],
  // Keep the ticket scout aligned with the daily world soccer slate.
  ['soccer','mex.1'],['soccer','ger.1'],['soccer','ita.1'],['soccer','fra.1'],
  ['soccer','por.1'],['soccer','ned.1'],['soccer','bra.1'],['soccer','arg.1'],
  ['soccer','uefa.europa'],['soccer','fifa.world'],
] as const
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
export async function evidenceTicket(
  count:number,date=dayNow(),sportFilter?:string,fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,
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
  // A burst of 40+ ESPN scoreboards causes rate-limit/HTTP 400 failures.
  // Scan no more than five leagues (two UTC dates each) concurrently.
  const slate:Array<PromiseSettledResult<{sport:string;league:string;active:number}>>=[]
  for(let offset=0;offset<leagues.length;offset+=5){
    const batch=await Promise.allSettled(leagues.slice(offset,offset+5).map(async([sport,league])=>{
    // Search both ESPN UTC date partitions for the requested local (RD) day.
    const next=new Date(Date.parse(date+'T00:00:00Z')+86_400_000)
      .toISOString().slice(0,10).replaceAll('-','')
    const partitions=await Promise.allSettled([date.replaceAll('-',''),next].map(day=>
      getFeed<{events?:Array<{id?:string|number;date?:string;status?:{type?:{state?:string}}}>}>(
        'https://site.api.espn.com/apis/site/v2/sports/'+sport+'/'+league+
        '/scoreboard?dates='+day,fetcher)))
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
  // Investigate in three-league batches. Do not stop at the first six leagues
  // when their evidence is weak: expand into verified Portugal/Italy/etc slates.
  // Only verified, future ESPN event IDs can become selections.
  const shortlist=sportFilter?eligible:diversifiedSportsShortlist(eligible,eligible.length)
  const reports:Array<PromiseSettledResult<Awaited<ReturnType<typeof researchSport>>>>=[]
  const researchStarted=Date.now()
  let budgetExhausted=false
  for(let offset=0;offset<shortlist.length;offset+=3){
    if(offset>0&&Date.now()-researchStarted>85_000){budgetExhausted=true;break}
    const batch=await Promise.allSettled(shortlist.slice(offset,offset+3).map(({sport,league})=>
      researchSport(sport,league,date,fetcher,now,env,
        sport==='football'?35:sport==='soccer'?56:sport==='tennis'?42:28)))
    reports.push(...batch)
    // Stop costly expansion only after enough independently researched,
    // directionally consistent picks are available; an HTTP error is not a vote.
    const viable=reports.flatMap(x=>x.status==='fulfilled'?x.value.matches:[])
      .filter(x=>descriptiveRank(x)!==null)
    const diversified=sportFilter!==undefined||new Set(viable.map(x=>x.sport)).size>=2
    if(offset+3>=6&&viable.length>=count&&diversified)break
  }
  const candidateLegs:Array<{pick:ResearchTicketLeg;rank:number;home:string;away:string;kickoff:string}>=[]
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
      const rank=descriptiveRank(match)
      if(rank===null){insufficientEvidence++;continue}
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
      candidateLegs.push({rank:Math.abs(rank),home:home.name,away:away.name,kickoff:match.date,pick:{
        sport:match.sport,league:match.league,eventId:match.eventId,
        pick:rank>0?'home':'away',rationale,
      }})
    }
  }
  candidateLegs.sort((a,b)=>b.rank-a.rank||a.pick.eventId.localeCompare(b.pick.eventId))
  const {chosen:selected,diversitySatisfied:multisportSatisfied}=
    diversifiedSportsPicks(candidateLegs,count,!sportFilter)
  const chosen=selected.map(x=>x.pick)
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
  const checks=await investigatePregame(selected.map(x=>({
    sport:x.pick.sport,league:x.pick.league,eventId:x.pick.eventId,
  })),cachedFetcher)
  const contextual=await Promise.allSettled(selected.map(x=>investigateEventDeep(
    x.pick.sport,x.pick.league,x.pick.eventId,cachedFetcher,now,env)))
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
    return {...pick,rationale:(String(pick.rationale??'').slice(0,Math.max(0,477-audit.length))+
      ' · '+sourceSummary+audit).slice(0,480)}
  })
  const ticket=await researchTicket(documented,date,fetcher,now,env,count,true)
  const note=String(ticket.card.props.note??'')+
    ' Investigación ampliada en '+deepContextChecked+'/'+documented.length+
    ' eventos: '+newsMatched+' noticias relacionadas, '+playerStatsChecked+
    ' estadísticas individuales reportadas. Estos recuentos NO prueban bajas ni titulares.'+
    (!multisportSatisfied?' REQUISITO MULTIDEPORTE NO ALCANZADO: las selecciones fundamentadas son de una sola disciplina. ':'')+
    ' Investigación contextual: '+pregameSummariesVerified+'/'+documented.length+
    ' resúmenes de evento ESPN; '+injuryFeedsVerified+'/'+documented.length+
    ' informes de lesiones de liga accesibles. Accesible NO equivale a bajas o titulares verificados.'+
    ' Los archivos GitHub de SportsbookReview y MLB son históricos, nunca cuotas actuales.'
  const card:ChatBlock={...ticket.card,props:{...ticket.card.props,
    subtitle:'Preselección: cinco partidos históricos por equipo (NFL tres) · contexto pendiente',
    note:note.slice(0,1000),
  }}
  return{card,complete:ticket.complete,verifiedEvents:ticket.verifiedEvents,
    candidatesEvaluated:evaluated,researchLeagues:reports.filter(r=>r.status==='fulfilled').length,
    insufficientEvidence,pregameSummariesVerified,injuryFeedsVerified,
    deepContextChecked,newsMatched,playerStatsChecked,
    multisportSatisfied,scannedSports,selectedSports,
    researchStandard:'Preselección basada en 5 eventos históricos por equipo (NFL: 3). Se exploraron '+scannedSports+' deportes; seleccionados: '+(selectedSports.join(', ')||'ninguno')+'. Diversidad '+(multisportSatisfied?'cumplida':'NO cumplida')+'. Lesiones, titulares y cuotas siguen sin verificación específica.'+
      (budgetExhausted?' Búsqueda detenida por presupuesto de tiempo; quedan ligas sin investigar.':''),
    modelProbabilities:false,priced:false,placed:false,selections:documented,
    events:selected.map(x=>({eventId:x.pick.eventId,home:x.home,away:x.away,kickoff:x.kickoff,
      sport:x.pick.sport,league:x.pick.league,pick:x.pick.pick==='home'?'home' as const:'away' as const}))}
}
