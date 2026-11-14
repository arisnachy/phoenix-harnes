/** Quote only when independently researched fixtures match fresh, same-bookmaker prices.
 * No combined-odds claims across different bookmakers or historical sources.
 */
import { evidenceTicket,type TicketDiscoveryAudit,type TicketPreselectReviewer } from './evidence-ticket.ts'
import {dailyResearchFetcher} from './sports-daily-preload.ts'
import {auditTicketDecisions,readDecisionPolicy,type TicketDecisionAudit} from './sports-ticket-decision.ts'
import {auditTicketMarketRisk,quoteSideNoVig,type TicketMarketRisk} from './ticket-risk-audit.ts'
import {investigateTicketSpecialists,type SpecialistGate} from './ticket-specialist-gate.ts'
import {summarizeTicketSpecialist,needsSelectedSpecialistRecheck} from './ticket-specialist-summary.ts'
import { keylessEnabled,keylessOdds,type KeylessQuote } from './keyless-odds.ts'
import {lookupExactEspnWinner,sameEspnTeam} from './sports-exact-espn-winner.ts'
import {researchPublicOddsWebsites} from './sports-public-odds-pages.ts'
import { getFeed,marketOddsDetailed,pricedTicket,type ChatBlock,type MarketSelection,type MarketOutcome,type OddsResearchObservation } from './sports.ts'
import {fetchBetBetterModels,findModelOpinion,type ModelForecast} from './betbetter-model-evidence.ts'
import {enrichSpecialistNarrative,type TicketNarrative} from './sports-ticket-narrative.ts'

export type OddsAuditRow={
  source:string
  status:'disabled'|'not-configured'|'attempted'|'empty'|'observed'|'error'|'not-applicable'
  offers:number
  note:string
}
export const boundedPriced=<T>(work:Promise<T>,ms:number):Promise<T>=>{
  let timer:ReturnType<typeof setTimeout>|undefined
  const deadline=new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>reject(Error('Fuente de cuotas: plazo agotado')),ms)
  })
  return Promise.race([work,deadline]).finally(()=>{
    if(timer!==undefined)clearTimeout(timer)
  })
}
const audited=(source:string,status:OddsAuditRow['status'],offers:number,note:string):OddsAuditRow=>
  ({source,status,offers,note})
const normalize=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
/** Known NHL mascot aliases only; no ambiguous city-only team matches. */
const sameTeam=(a:string,b:string,sport:string):boolean=>
  sameEspnTeam(a,b,sport==='hockey'?'icehockey_nhl':'strict')
const routing:Record<string,{sport:string;market:string;oddsSportKey:string}>={
  soccer:{sport:'football',market:'1x2',oddsSportKey:'soccer_epl'},
  basketball:{sport:'basketball',market:'home_away',oddsSportKey:'basketball_nba'},
  baseball:{sport:'baseball',market:'moneyline',oddsSportKey:'baseball_mlb'},
  football:{sport:'american-football',market:'moneyline',oddsSportKey:'americanfootball_nfl'},
  hockey:{sport:'ice-hockey',market:'home_away',oddsSportKey:'icehockey_nhl'},
  tennis:{sport:'tennis',market:'match_winner',oddsSportKey:'tennis_atp'},
}
const leagueSportKey:Record<string,string>={
  'eng.1':'soccer_epl','esp.1':'soccer_spain_la_liga','usa.1':'soccer_usa_mls',
  'uefa.champions':'soccer_uefa_champs_league',
  'uefa.wchampions':'soccer_uefa_womens_champions_league',
  'por.1':'soccer_portugal_primeira_liga','ita.1':'soccer_italy_serie_a',
  'ger.1':'soccer_germany_bundesliga','ned.1':'soccer_netherlands_eredivisie',
  'fra.1':'soccer_france_ligue_one','mex.1':'soccer_mexico_ligamx',
  'bra.1':'soccer_brazil_serie_a','arg.1':'soccer_argentina_primera_division',
  'uefa.europa':'soccer_uefa_europa_league','nba':'basketball_nba',
  'wnba':'basketball_wnba','mlb':'baseball_mlb','nfl':'americanfootball_nfl','nhl':'icehockey_nhl',
}
export async function evidencePricedTicket(
  count:number,date?:string,sport?:string,stake=0,now=Date.now(),
  env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch,
  quotesProvider?:(sport:string,market:string,day:string,env:NodeJS.ProcessEnv,now:number)=>Promise<KeylessQuote[]>,
  marketPreference:'winner'|'double_chance'='winner',
  specialistResearcher:typeof investigateTicketSpecialists=investigateTicketSpecialists,
):Promise<{card:ChatBlock;priced:boolean;placed:false;complete:boolean;
  verifiedEvents:number;eventsFound:number;quotedLegs:number;missingQuotes:number;
  conditionalLegs:number;approvedForBetting:false;
  sourceAudit:OddsAuditRow[];approvedLegs:number;candidateLegs:number;
  ticketReadyForReview:boolean;multisportSatisfied:boolean;
  specialistChecks:SpecialistGate[];researchedLegs:number;
  discoveredEvents:number;discoveryAudit:TicketDiscoveryAudit;
  modelAudit:Array<{eventId:string;status:'support'|'contradiction'|'unavailable';
    prediction:ModelForecast|null}>;
  conditional:boolean;dossierComplete:boolean;
  explanation:string;reviewedBeforeSelection:number;removedConflicts:number;
  trackingEvents:Array<{eventId:string;sport:string;league:string;date:string;
    pick:'home'|'away';kickoff:string}>;
  marketRisk?:TicketMarketRisk;
  decisionAudit:TicketDecisionAudit}>{
  const pipelineStartedAt=Date.now()
  const researchFetcher=fetcher===fetch?dailyResearchFetcher(fetcher,env):fetcher
  const day=date??new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now))
  const preview=new Map<string,SpecialistGate>()
  let reviewedBeforeSelection=0,removedConflicts=0
  const reviewCandidates:TicketPreselectReviewer=async candidates=>{
    // The historical ranking is a PRE-FILTER only. Challenge more candidates
    // before choosing the final 5/6, and retain the review by exact event ID.
    const games=candidates.map(c=>({
      sport:c.sport,league:c.league,eventId:c.eventId,date:day,
      home:c.home,away:c.away,kickoff:c.kickoff,
    }))
    // A 5s preflight is only candidate screening, never the final NBA dossier.
    // Do not abort the entire ticket if the broad preliminary scan times out.
    const checks=await boundedPriced(specialistResearcher(games,researchFetcher,
      now,env,[],5_000),11_000).catch(()=>[] as SpecialistGate[])
    reviewedBeforeSelection=checks.length
    return checks.map((check,index)=>{
      const fixture=candidates[index]!
      preview.set(fixture.eventId,check)
      const conflicts=check.pendingSteps.some(step=>
        /equipos no coinciden|conflicto de cartelera|identidad contradictoria|identidad u horario|horario.*no coinciden/iu.test(step))
        ||check.sourceChecks?.some(source=>source.status==='conflict')===true
      if(conflicts)removedConflicts++
      const pending=check.checklist?.criticalPending.length??12
      const injury=check.injuryAudit
      const chosen=fixture.pick==='home'?injury?.home:injury?.away
      const absences=(chosen?.injuries??[]).filter(x=>
        /out|doubtful|questionable|day.to.day|inactive/iu.test(x.status))
        .slice(0,3).map(x=>x.athlete+' ('+x.status+')')
      // Failed source acquisition is an instruction to run the backup, NOT
      // evidence that the team is weaker. Only a verified identity conflict
      // excludes a fixture. Do not lower a sports pick merely because an
      // HTTP source returned an incomplete roster or injury report.
      const priority=check.checklist?.complete===true?0.30:
        check.status==='researched'?0.15:0
      const reason='Especialista '+check.status+
        '; críticos sin cerrar '+pending+
        '; lesiones '+(injury?.status??'sin fuente')+
        (absences.length?'; elegido: '+absences.join(', '):'')+
        (conflicts?'; conflicto de identidad':'')
      return{eventId:fixture.eventId,excluded:conflicts,
        priority,reason}
    })
  }
  // Interactive fixture lookup bypasses the persisted research cache.
  const research=await evidenceTicket(count,date,sport,fetcher,now,env,
    reviewCandidates)
  // Never promote the short preflight to a final NBA dossier. Recheck all
  // selected NBA/WNBA cases that were not fully documented; retry only failed
  // preflights for other sports. Small parallel batches avoid a long waterfall.
  const pendingGames=research.events.filter(e=>{
    const existing=preview.get(e.eventId)
    return needsSelectedSpecialistRecheck(e,existing)
  }).map(e=>({sport:e.sport,league:e.league,eventId:e.eventId,
    date:day,home:e.home,away:e.away,kickoff:e.kickoff}))
  const batches=Array.from({length:Math.ceil(pendingGames.length/3)},(_,i)=>
    pendingGames.slice(i*3,i*3+3))
  const attempts=await Promise.allSettled(batches.map(async batch=>{
    const nba=batch.some(game=>game.sport==='basketball')
    // NBA requires multiple team/athlete reads; 7s cannot establish coverage.
    return boundedPriced(specialistResearcher(batch,researchFetcher,now,env,
      [],nba?18_000:9_000),nba?21_000:12_000)
  }))
  const retried=attempts.flatMap(a=>a.status==='fulfilled'?a.value:[])
  const byId=new Map(retried.map(x=>[x.eventId,x]))
  const specialistChecks:SpecialistGate[]=research.events.map(e=>{
    const previous=preview.get(e.eventId),latest=byId.get(e.eventId)
    // A failed retry cannot erase actual evidence from the preliminary read.
    return (latest?.status==='unavailable'&&previous?.status!=='unavailable'?
      previous:latest??previous)??{
    sport:e.sport,league:e.league,eventId:e.eventId,specialist:'unavailable',
    status:'unavailable' as const,verifiedSteps:[],pendingSteps:['Sin expediente verificado'],
    approvedForBetting:false as const,checkedAt:new Date(now).toISOString(),
    }
  })
  const trackingEvents=research.events.map(e=>({
    eventId:e.eventId,sport:e.sport,league:e.league,date:day,
    pick:e.pick,kickoff:e.kickoff,
  }))
  const researchedLegs=specialistChecks.filter(x=>x.status==='researched').length
  const specialistComplete=research.events.length===count&&researchedLegs===count
  // Number of leg dossiers checked is NOT the number of research steps closed.
  // A partial injury report or candidate goalie leaves the ticket conditional.
  let checklistComplete=specialistComplete&&specialistChecks.every(x=>
    x.checklist?.complete===true)
  // A missing injury report or lineup is a conditional research gap, not an
  // automatic refusal to display a priced candidate. Explicit identity
  // conflicts must still prevent matching bookmaker outcomes.
  const identityConflict=specialistChecks.some(x=>x.pendingSteps.some(step=>
    /equipos no coinciden|conflicto de cartelera|identidad contradictoria|identidad u horario|horario.*no coinciden/iu.test(step))
    ||x.sourceChecks?.some(source=>source.status==='conflict'))
  // Independent, openly licensed probabilities are a second opinion only.
  // They are NEVER bookmaker quotations, approval, or calibrated PHOENIX EV.
  const modelKeys=[...new Set(research.events.map(e=>leagueSportKey[e.league]).filter(
    (x):x is string=>Boolean(x)))]
  const modelResults=await Promise.allSettled(modelKeys.map(key=>
    boundedPriced(fetchBetBetterModels(key,fetcher,now),4_000)))
  const forecasts=modelResults.flatMap(x=>x.status==='fulfilled'?x.value:[])
  const modelAudit=research.events.map(e=>({
    eventId:e.eventId,...findModelOpinion(forecasts,e),
  }))
  const modelDisagreements=modelAudit.filter(x=>x.status==='contradiction').length
  const decisionPolicy=readDecisionPolicy(env)
  // Evaluate and expose uncertainty even when prices cannot be found.
  const preliminaryDecisionAudit=auditTicketDecisions(research.events.map((event,index)=>({
    eventId:event.eventId,sport:event.sport,
    selection:event.pick==='home'?event.home:event.away,
    quotedPrice:null,noVigShare:null,
    specialistStatus:specialistChecks[index]?.status??'unavailable',
    checklistComplete:specialistChecks[index]?.checklist?.complete===true,
    criticalPending:specialistChecks[index]?.checklist?.criticalPending??
      ['Expediente especializado no disponible'],
    modelStatus:modelAudit[index]?.status??'unavailable',
  })),decisionPolicy)
  const quoteAccess=[
    keylessEnabled(env)?'OddsHarvester habilitado (sujeto al acceso del sitio)':
      'OddsHarvester inactivo: requiere instalación y habilitación por el operador',
    env.THE_ODDS_API_KEY?.trim()?'The Odds API v4 configurada':'The Odds API v4 sin clave',
    env.THEODDSAPI_API_KEY?.trim()?'TheOddsAPI configurada':'TheOddsAPI sin clave',
    env.THERUNDOWN_API_KEY?.trim()?'TheRundown configurado':'TheRundown sin clave',
    env.SPORTSGAMEODDS_API_KEY?.trim()?'SportsGameOdds configurado':'SportsGameOdds sin clave',
    'ESPN: cuotas solo cuando el proveedor publique mercados con fecha',
  ].join(' · ')
  const preliminaryLegs=Array.isArray(research.card.props.legs)?research.card.props.legs:[]
  const researchCard:ChatBlock={...research.card,props:{...research.card.props,
    discoveryAudit:research.discoveryAudit,
    dataCounts:{eventsFound:research.verifiedEvents,quotedLegs:0,researchedLegs,
      candidateLegs:0,
      conditionalLegs:specialistChecks.filter(x=>x.checklist?.complete!==true).length,
      approvedForBetting:0},
    legs:preliminaryLegs.map((row,index)=>{
      const leg=row!==null&&typeof row==='object'&&!Array.isArray(row)?
        row as Record<string,unknown>:{}
      return {...leg,narrative:enrichSpecialistNarrative(
        leg.narrative as TicketNarrative|null|undefined,specialistChecks[index],
        undefined,modelAudit[index])}
    }),
    chatNarrative:preliminaryLegs.map((row,index)=>{
      const leg=row!==null&&typeof row==='object'&&!Array.isArray(row)?
        row as Record<string,unknown>:{}
      return enrichSpecialistNarrative(
        leg.narrative as TicketNarrative|null|undefined,specialistChecks[index],
        undefined,modelAudit[index])
    }).filter(Boolean),
    note:(String(research.card.props.note??'')+' Especialistas consultados '+researchedLegs+'/'+count+
      '. Contradicciones de modelo independiente: '+modelDisagreements+
      '. Bet Better son probabilidades teóricas, NUNCA cuotas de bookmaker. Estado de fuentes de cuotas: '+quoteAccess+
      '. Los repositorios GitHub SportsbookReview/MLB son solo históricos.').slice(0,1000),
  }}
  const initialSources:OddsAuditRow[]=[
    audited('OddsHarvester',keylessEnabled(env)?'attempted':'disabled',0,
      keylessEnabled(env)?'El scraping local necesita CLI y acceso real al sitio.':
        'Scraping desactivado: PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED no está habilitado.'),
    audited('The Odds API v4',env.THE_ODDS_API_KEY?.trim()?'attempted':'not-configured',0,
      'Clave opcional; configurar no demuestra disponibilidad de precios.'),
    audited('TheOddsAPI',env.THEODDSAPI_API_KEY?.trim()?'attempted':'not-configured',0,
      'Servicio de cuotas opcional independiente.'),
    audited('TheRundown',env.THERUNDOWN_API_KEY?.trim()?'attempted':'not-configured',0,
      'Gratis con clave, cuotas prepartido 5 min retrasadas y límite de datapoints.'),
    audited('SportsGameOdds',env.SPORTSGAMEODDS_API_KEY?.trim()?'attempted':'not-configured',0,
      'Gratis con clave y límites del plan; fuente por bookmaker.'),
    audited('ESPN Site/Core',env.PHOENIX_SPORTS_ESPN_DISABLED==='1'?'disabled':'attempted',0,
      'Se acepta cuota observada por ESPN con casa, mercado, evento y observedAt reciente; no implica aceptación en la casa.'),
    audited('SportsbookReview/MLB GitHub históricos','not-applicable',0,
      'NO se consultan como cuota en vivo ni permiten generar combinadas actuales.'),
  ]
  const base={card:researchCard,priced:false as boolean,placed:false as const,
    complete:research.complete&&specialistComplete,verifiedEvents:research.verifiedEvents,
    quotedLegs:0,missingQuotes:count,eventsFound:research.verifiedEvents,
    conditionalLegs:specialistChecks.filter(x=>x.checklist?.complete!==true).length,
    approvedForBetting:false as const,sourceAudit:initialSources,
    candidateLegs:0,ticketReadyForReview:false,
    discoveredEvents:research.discoveryAudit.discoveredEvents,
    discoveryAudit:research.discoveryAudit,
    specialistChecks,researchedLegs,modelAudit,trackingEvents,
    decisionAudit:preliminaryDecisionAudit,reviewedBeforeSelection,removedConflicts,conditional:!checklistComplete,
    dossierComplete:checklistComplete,
    multisportSatisfied:research.multisportSatisfied,approvedLegs:0,
    explanation:'Preselección ESPN, cuotas todavía NO verificadas: '+quoteAccess+
      '. Los archivos históricos no ofrecen precios para apostar hoy.'}
  // If historical evidence rejects every candidate, still probe a bounded
  // list of verified *fixtures* by their official ESPN IDs. These are market
  // observations, not selections or specialist-backed recommendations.
  if(!research.events.length){
    const fixtures=!quotesProvider&&env.PHOENIX_SPORTS_ESPN_DISABLED!=='1'&&
      removedConflicts===0&&!identityConflict?
      research.discoveryAudit.fixtureSample.slice(0,6):[]
    const scanned=await Promise.allSettled(fixtures.map(async item=>{
      const sportKey=leagueSportKey[item.league]??
        (item.sport==='soccer'?'soccer_espn_dynamic':routing[item.sport]?.oddsSportKey)
      if(!sportKey)return{item,attempted:false,options:[] as Array<{
        bookmaker:string;selection:string;market:string;price:number;
        observedAt:string|null;updatedAt:string|null}>,notes:['Sin adaptador ESPN conocido']}
      const report=await boundedPriced(lookupExactEspnWinner({
        sportKey,eventId:item.eventId,date:day,
        home:item.home,away:item.away,kickoff:item.kickoff,
        ...(sportKey==='soccer_espn_dynamic'?{espnLeague:item.league}:{}),
      },<T>(url:string)=>getFeed<T>(url,fetcher),now),7_000)
      return{item,attempted:report.attempted,
        options:report.quotes.slice(0,6).map(q=>({
          bookmaker:q.bookmaker,selection:q.selection,market:q.market,
          price:q.price,observedAt:q.observedAt??null,updatedAt:q.updatedAt??null,
        })),notes:report.notes.slice(0,3)}
    }))
    const pricePreview=scanned.flatMap((row,index)=>{
      if(row.status==='fulfilled')return [{
        ...row.value.item,attempted:row.value.attempted,
        options:row.value.options,notes:row.value.notes,
      }]
      const item=fixtures[index]
      return item?[{...item,attempted:true,
        options:[] as Array<unknown>,
        notes:[String(row.reason).slice(0,180)]}]:[]
    })
    const pricePreviewOffers=pricePreview.reduce((n,row)=>n+row.options.length,0)
    const priceAttempts=pricePreview.filter(row=>row.attempted).length
    const auditSources=initialSources.map(row=>{
      if(row.source==='ESPN Site/Core'&&priceAttempts){
        return audited(row.source,pricePreviewOffers?'observed':'empty',
          pricePreviewOffers,'Consulta exacta por ID para '+priceAttempts+
          ' partidos reales; '+pricePreviewOffers+
          ' opciones de ESPN observadas, no son picks recomendados.')
      }
      return {...row,
        status:row.status==='attempted'?'not-applicable' as const:row.status,
        note:row.note+' No se consultaron cuotas de esta fuente.'}
    })
    const reportCard:ChatBlock={...researchCard,props:{...researchCard.props,
      pricePreview,pricePreviewOffers,pricePreviewEvents:priceAttempts,
      note:('Partidos verificados: '+research.discoveryAudit.discoveredEvents+
        '. ESPN cotejó '+priceAttempts+' encuentros por ID con '+
        pricePreviewOffers+' opciones de cuotas. No hay pronósticos '+
        'respaldados por el historial disponible. '+
        String(researchCard.props.note??'')).slice(0,1000),
    }}
    return{...base,card:reportCard,sourceAudit:auditSources,conditional:true,
      explanation:removedConflicts>0||identityConflict?
        'Borrador CONFLICTIVO: '+removedConflicts+
        ' identidades contradichas por especialistas; no se atribuyeron cuotas.':
        'ESPN descubrió '+research.discoveryAudit.discoveredEvents+
        ' partidos; el filtro histórico no aprobó ninguna selección. '+
        (priceAttempts?'Se consultaron '+priceAttempts+
          ' eventos reales por ID y se observaron '+pricePreviewOffers+
          ' opciones de mercado. No equivalen a una selección investigada. ':
          'No se consultaron casas ni cuotas: verificar discoveryAudit primero. ')+
        'No se inventó ninguna pata.'}
  }
  // If research already consumed the wall-clock budget, return the actual
  // verified preselection now instead of starting more independent quote scans.
  // In particular, do not make Kira lose a valid draft to the outer watchdog.
  if(Date.now()-pipelineStartedAt>=72_000){
    return {...base,sourceAudit:initialSources.map(row=>({
      ...row,status:row.status==='attempted'?'not-applicable' as const:row.status,
      note:row.note+' Omitido: se alcanzó el presupuesto de tiempo del ticket.',
    })),conditional:true,
      explanation:'Tiempo de investigación agotado: se conserva la preselección '+
        'verificada con '+research.verifiedEvents+' eventos y '+
        researchedLegs+' expedientes especializados. Falta la verificación '+
        'de cuotas actuales. Reintentar solo fuentes pendientes, sin rehacer '+
        'el barrido completo.'}
  }
  // Even an incomplete 4/5 slate must audit the four real events for quotes;
  // otherwise 'no prices available' falsely implies the sources were checked.
  const categories=[...new Set(research.events.map(e=>e.sport))]
  const sources=await Promise.allSettled(categories.map(async category=>{
    const route=routing[category]
    if(!route)return {category,quotes:[] as KeylessQuote[]}
    const market=category==='soccer'&&marketPreference==='double_chance'
      ?'double_chance':route.market
    const quotes=quotesProvider?await quotesProvider(route.sport,market,day,env,now):
      keylessEnabled(env)?await boundedPriced(
        keylessOdds(route.sport,market,day,env,now),6_000):[]
    return {category,quotes}
  }))
  // These prices were fetched during this request: observation time is valid
  // even when the provider omits its last-change timestamp.
  const keyless=sources.flatMap(s=>s.status==='fulfilled'?
    s.value.quotes.map(q=>({...q,observedAt:q.observedAt??new Date(now).toISOString()})):[])
  // Use the existing public ESPN and optional authenticated Odds API adapters
  // as a real second LIVE source, never the two historical GitHub archives.
  // Explicit double-chance selections are only supplied by a verified 1X/X2
  // market; do not relabel a winner moneyline as double chance.
  const leagues=[...new Map(research.events.map(e=>[e.league,e])).values()]
  const fallbackSources:Awaited<ReturnType<typeof marketOddsDetailed>>['sources']=[]
  const espnReferenceOdds:OddsResearchObservation[]=[]
  const additional=quotesProvider?[]:await Promise.allSettled(leagues.map(async event=>{
    if(event.sport==='soccer'&&marketPreference==='double_chance')return [] as KeylessQuote[]
    const sportKey=leagueSportKey[event.league]??
      (event.sport==='soccer'?undefined:routing[event.sport]?.oddsSportKey)
    if(!sportKey)return [] as KeylessQuote[]
    // Wrap the transport to disable the in-process ESPN odds cache for
    // ticket construction: preserve a fresh feed READ, not an old snapshot.
    const directFetcher:typeof fetch=(input,init)=>fetcher(input,init)
    const report=await boundedPriced(marketOddsDetailed(
      sportKey,'h2h',env,directFetcher,now),7_000)
    fallbackSources.push(...report.sources)
    // A newly fetched provider quote may be included without bookmaker updatedAt.
    // Ticket quotation is distinct from sportsbook acceptance.
    espnReferenceOdds.push(...report.observations)
    const lines=report.quotes
    return lines.flatMap(q=>{
      const time=q.timeIso??''
      const updated=Date.parse(q.updatedAt)
      const observedAt=Date.parse(q.observedAt??'')
      const espnObserved=q.source?.startsWith('ESPN ')===true
      const currentSnapshot=Number.isFinite(observedAt)&&observedAt<=now&&
        now-observedAt<=15*60_000
      const validBookTime=Number.isFinite(updated)&&updated<=now&&
        now-updated<=3_600_000
      if(!Number.isFinite(Date.parse(time))||
        !(currentSnapshot||(!espnObserved&&validBookTime)))return []
      // Soccer 3-way victory must demonstrably include DRAW at this book.
      if(event.sport==='soccer'&&!lines.some(draw=>
        draw.eventId===q.eventId&&draw.bookmaker===q.bookmaker
        &&draw.market===q.market&&/^(?:draw|empate|tie)$/iu.test(draw.selection)))return []
      return [{
        eventId:q.eventId,bookmaker:q.bookmaker,
        market:event.sport==='soccer'?'1x2':'h2h',
        selection:q.selection,point:q.point??null,price:q.price,
        home:q.home,away:q.away,time,updatedAt:q.updatedAt,
        ...(currentSnapshot&&q.observedAt?{observedAt:q.observedAt}:{}),
        source:q.source??'Proveedor de cuotas público',sportKey,
      }] satisfies KeylessQuote[]
    })
  }))
  const discovered=[...keyless,...additional.flatMap(s=>s.status==='fulfilled'?s.value:[])]
  // A league-level ESPN scan has an eight-game cap. On short nightly slates
  // that cap can miss the requested event entirely, especially when games are
  // grouped under the following UTC day. Retry only exact still-unpriced ESPN
  // event IDs, with source timestamps and provider names independently checked.
  const exactTargets=quotesProvider||env.PHOENIX_SPORTS_ESPN_DISABLED==='1'?[]:
    research.events.filter(event=>{
      const kickoff=Date.parse(event.kickoff)
      return Number.isFinite(kickoff)&&kickoff>now&&!discovered.some(q=>
        sameTeam(q.home,event.home,event.sport)&&
        sameTeam(q.away,event.away,event.sport)&&
        Math.abs(Date.parse(q.time)-kickoff)<=3_600_000&&
        q.market===(event.sport==='soccer'?'1x2':'h2h'))
    }).slice(0,6)
  const exactReports=await Promise.allSettled(exactTargets.map(async event=>{
    // The exact fixture's league is already verified by ESPN; unlike
    // generic league-wide discovery this does not guess an unsupported slug.
    const sportKey=leagueSportKey[event.league]??
      (event.sport==='soccer'?'soccer_espn_dynamic':routing[event.sport]?.oddsSportKey)
    if(!sportKey)return null
    const deadline=AbortSignal.timeout(9_000)
    const bounded:typeof fetch=(input,init)=>{
      const signal=init?.signal?AbortSignal.any([init.signal,deadline]):deadline
      return fetcher(input,{...init,signal})
    }
    return boundedPriced(lookupExactEspnWinner({
      sportKey,eventId:event.eventId,date:day,
      home:event.home,away:event.away,kickoff:event.kickoff,
      ...(sportKey==='soccer_espn_dynamic'?{espnLeague:event.league}:{}),
    },<T>(url:string)=>getFeed<T>(url,bounded),now),8_000)
  }))
  const specific=exactReports.flatMap(row=>row.status==='fulfilled'&&row.value?
    row.value.quotes:[])
  // Exact event-ID matches also supply ESPN observed quotes without updatedAt.
  // Their status is observed on ESPN, never acceptance at the bookmaker.
  for(const row of exactReports){
    if(row.status!=='fulfilled'||!row.value)continue
    espnReferenceOdds.push(...row.value.referenceOdds.map(q=>({
      ...q,sportKey:'soccer_espn_dynamic',
      source:'ESPN '+(q.endpointSource??'public')+' · referencia oficial observada',
      nonCotizable:true as const,
    })))
  }
  const rawExactReferences=exactReports.reduce((total,row)=>
    total+(row.status==='fulfilled'?row.value?.referenceCount??0:0),0)
  const rawExactCount=specific.length
  if(exactTargets.length){
    fallbackSources.push({provider:'ESPN Site/Core',
      status:rawExactCount?'observed':'empty',count:rawExactCount,
      detail:'Consulta por ID real de '+exactTargets.length+
        ' partidos, incluyendo el siguiente día UTC; '+
        rawExactCount+' moneylines observadas y '+rawExactReferences+
        ' referencias sin nombre de casa o con inconsistencias; ESPN no exige updatedAt.',
    })
  }
  const all=[...discovered,...specific]
  const groups:KeylessQuote[][]=research.events.map(event=>{
    const kickoff=Date.parse(event.kickoff)
    const doubleChance=event.sport==='soccer'&&marketPreference==='double_chance'
    const expectedMarket=doubleChance?'double_chance':event.sport==='soccer'?'1x2':'h2h'
    return all.filter(q=>{
      const updated=Date.parse(q.updatedAt),quoteKickoff=Date.parse(q.time)
      const espnObserved=q.source?.startsWith('ESPN ')===true
      const observedAt=Date.parse(q.observedAt??'')
      const snapshotValid=Number.isFinite(observedAt)&&observedAt<=now&&
        now-observedAt<=15*60_000
      const quoteAge=now-updated
      const acceptableAge=snapshotValid||(!espnObserved&&
        Number.isFinite(updated)&&quoteAge>=0&&quoteAge<=3_600_000)
      return Number.isFinite(kickoff)&&Number.isFinite(quoteKickoff)
        &&Math.abs(kickoff-quoteKickoff)<=3_600_000
        &&acceptableAge
        &&typeof q.bookmaker==='string'&&q.bookmaker.trim().length>0
        &&typeof q.eventId==='string'&&q.eventId.length>0
        &&Number.isFinite(q.price)&&q.price>1&&q.price<1000
        &&sameTeam(q.home,event.home,event.sport)
        &&sameTeam(q.away,event.away,event.sport)
        &&q.market===expectedMarket
        &&(doubleChance?q.selection===(event.pick==='home'?'1X':'X2'):
          sameTeam(q.selection,event.pick==='home'?event.home:event.away,event.sport))
    })
  })
  // Post-quote reassessment: the dossier runs before prices arrive. A matching
  // market observation closes ONLY its market step, not missing lineups or form.
  for(const [index,rows] of groups.entries()){
    const current=specialistChecks[index]
    if(!rows.length||!current?.checklist)continue
    const prior=current.checklist
    if(!prior.steps.some(step=>step.key==='market'))continue
    const quote=rows[0]!
    const validSoccerDraw=research.events[index]?.sport==='soccer'&&
      quote.market==='1x2'&&quoteSideNoVig(quote,all,now)!==null
    const steps=prior.steps.map(step=>step.key==='market'?{
      ...step,state:'verified' as const,
      detail:'Precio publicado observado en '+quote.source+' · '+quote.bookmaker+
        ' · '+quote.market+' · '+quote.selection+' · '+quote.price+
        '. Evento, rivales, inicio y selección cotejados; confirmar aceptación en la casa.',
    }:step.key==='draw'&&validSoccerDraw?{
      ...step,state:'verified' as const,
      detail:'1X2 íntegro con empate, misma casa y ventana temporal; riesgo de empate no desaparece.',
    }:step)
    const criticalPending=steps.filter(step=>step.critical&&step.state!=='verified')
      .map(step=>step.title)
    const pendingSteps=current.pendingSteps.filter(step=>
      !step.startsWith('Pasos obligatorios sin cerrar ('))
    specialistChecks[index]={...current,checklist:{...prior,steps,
      verified:steps.filter(step=>step.state==='verified').length,
      partial:steps.filter(step=>step.state==='partial').length,
      missing:steps.filter(step=>step.state==='missing').length,
      criticalPending,complete:criticalPending.length===0},
      pendingSteps:criticalPending.length?[
        ...pendingSteps,'Pasos obligatorios sin cerrar ('+criticalPending.length+
        '): '+criticalPending.slice(0,3).join('; ')]:pendingSteps}
  }
  checklistComplete=specialistComplete&&specialistChecks.every(x=>x.checklist?.complete===true)
  const quotedLegs=groups.filter(g=>g.length>0).length
  // The first critic runs before quotation. Re-run it even when only 4/5
  // events have prices or no bookmaker is shared by all legs. Never expose
  // pre-quote "no price" findings as the final state after finding quotes.
  const postQuoteAudit=auditTicketDecisions(research.events.map((event,index)=>{
    const selected=groups[index]?.slice().sort((a,b)=>b.price-a.price)[0]
    return{
      eventId:event.eventId,sport:event.sport,
      selection:event.pick==='home'?event.home:event.away,
      quotedPrice:selected?.price??null,
      noVigShare:selected?quoteSideNoVig(selected,all,now):null,
      specialistStatus:specialistChecks[index]?.status??'unavailable',
      checklistComplete:specialistChecks[index]?.checklist?.complete===true,
      criticalPending:specialistChecks[index]?.checklist?.criticalPending??
        ['Expediente especializado no disponible'],
      modelStatus:modelAudit[index]?.status??'unavailable',
    }
  }),decisionPolicy)
  const conditionalLegs=postQuoteAudit.legs.filter(leg=>
    leg.verdict==='hold'||leg.verdict==='caution').length
  const attributed=(source:string)=>source.toLowerCase().includes('oddsharvester')?'OddsHarvester':
    source==='The Odds API'?'The Odds API v4':
    source==='TheOddsAPI'?'TheOddsAPI':
    source.toLowerCase().includes('espn')?'ESPN Site/Core':source
  const observed=new Map<string,number>(),matched=new Map<string,number>()
  for(const q of all)observed.set(attributed(q.source),(observed.get(attributed(q.source))??0)+1)
  for(const group of groups)for(const q of group)
    matched.set(attributed(q.source),(matched.get(attributed(q.source))??0)+1)
  const actualKeyless=categories.length>0&&(keylessEnabled(env)||Boolean(quotesProvider))
  const keylessFailures=sources.filter(s=>s.status==='rejected').length
  const fallbackEligible=!quotesProvider&&leagues.some(e=>
    !(e.sport==='soccer'&&marketPreference==='double_chance'))
  const fallbackFailures=additional.filter(s=>s.status==='rejected').length
  const sourceAudit:OddsAuditRow[]=initialSources.map(row=>{
    const offers=observed.get(row.source)??0
    const evidence=matched.get(row.source)??0
    if(offers)return{...row,status:'observed',offers,
      note:'Se observaron '+offers+' precios publicados; '+evidence+
        ' coinciden con selecciones investigadas (no son garantías).'}
    const providerAttempts=fallbackSources.filter(x=>x.provider===row.source)
    if(providerAttempts.length&&row.source!=='OddsHarvester'){
      const failure=providerAttempts.find(x=>x.status==='error')
      const attempted=providerAttempts.some(x=>x.status==='empty'||x.status==='observed')
      return{...row,status:failure?'error':attempted?'empty':'not-configured',offers:0,
        note:failure?'Error de proveedor: '+failure.detail.slice(0,190):
          attempted?'Consultado, sin precio válido y coincidente.':
          row.note+' Liga no cubierta o clave ausente.'}
    }
    if(row.source==='OddsHarvester'&&actualKeyless)return{...row,
      status:keylessFailures?'error':'empty',offers:0,
      note:keylessFailures?'El scraper no pudo consultar los mercados; revisar CLI y acceso.':
        'Consulta realizada sin precios válidos disponibles.'}
    if(fallbackEligible&&row.source==='The Odds API v4'&&env.THE_ODDS_API_KEY?.trim())
      return{...row,status:fallbackFailures?'error':'empty',note:
        'Ruta de cuotas v4 seleccionada; no se obtuvo precio coincidente y reciente.'}
    if(fallbackEligible&&row.source==='TheOddsAPI'&&!env.THE_ODDS_API_KEY?.trim()
      &&env.THEODDSAPI_API_KEY?.trim())return{...row,
      status:fallbackFailures?'error':'empty',note:'Proveedor secundario sin precios válidos cotejables.'}
    if(fallbackEligible&&row.source==='ESPN Site/Core'&&!env.THE_ODDS_API_KEY?.trim()
      &&!env.THEODDSAPI_API_KEY?.trim()&&!keylessEnabled(env))return{...row,
      status:fallbackFailures?'error':'empty',note:'ESPN consultado para precios; ninguno verificable.'}
    return{...row,status:row.status==='attempted'?'not-applicable':row.status,
      note:row.note+' Sin cotizaciones confirmadas en este flujo.'}
  })
  const referenceRows=research.events.map((event,index)=>{
    const expected=event.pick==='home'?event.home:event.away
    const candidates=espnReferenceOdds.filter(q=>
      q.eventId===event.eventId&&
      sameTeam(q.home,event.home,event.sport)&&sameTeam(q.away,event.away,event.sport)&&
      sameTeam(q.selection,expected,event.sport)&&
      q.market==='h2h'&&q.nonCotizable&&
      Number.isFinite(Date.parse(q.timeIso??''))&&
      Math.abs(Date.parse(q.timeIso??'')-Date.parse(event.kickoff))<=3_600_000 &&
      q.bookmaker.length>0&&!q.bookmaker.startsWith('ESPN proveedor #'))
    return {index,quote:candidates[0]??null}
  }).filter(x=>x.quote!==null)
  const reportedReferences=referenceRows.length
  const referenceMap=new Map(referenceRows.map(x=>[x.index,x.quote!]))
  const researchLegs=Array.isArray(researchCard.props.legs)?researchCard.props.legs:[]
  const referenceLegs=researchLegs.map((value,index)=>{
    const original=value&&typeof value==='object'&&!Array.isArray(value)
      ?value as Record<string,unknown>:{}
    const reference=referenceMap.get(index)
    if(!reference)return original
    const label='Cuota observada en ESPN '+reference.price.toFixed(2)+' ('+
      reference.bookmaker+', '+reference.reason+
      '); referencia excluida por identidad o datos inconsistentes, no por ausencia de updatedAt.'
    return {...original,referenceOdds:{
      bookmaker:reference.bookmaker,price:reference.price,
      reason:reference.reason,source:reference.endpointSource,
      observedAt:new Date(now).toISOString(),origin:'ESPN Site/Core',
      providerUpdatedAt:Number.isFinite(Date.parse(reference.updatedAt))?
        reference.updatedAt:null,
      sourceVerified:true,bookmakerLiveVerified:false,
      nonCotizable:true},
      rationale:(String(original.rationale??'').slice(0,300)+' · '+label).slice(0,480)}
  })
  // Last, bounded public-web reconnaissance for legs still without a *current*
  // bookmaker quote. Unlike ESPN Core, an odds-comparator HTML price has no
  // independently verified bookmaker updatedAt or event identity. Expose it
  // as an attributed REFERENCE with its exact URL, never as a priced leg.
  const unresolved=research.events.flatMap((event,index)=>
    groups[index]?.length?[]:[{event,index}]).slice(0,6)
  const siteResearch=quotedLegs===count||quotesProvider?[]:
    await Promise.allSettled(unresolved.map(async({event,index})=>{
      // For unknown soccer league pages, use league-independent comparison
      // portals without turning any observed HTML into a dated sportsbook quote.
      const sportKey=leagueSportKey[event.league]??
        (event.sport==='soccer'?'soccer_worldwide':routing[event.sport]?.oddsSportKey)
      if(!sportKey)return null
      return{index,report:await boundedPriced(researchPublicOddsWebsites({
        sportKey,date:day,home:event.home,away:event.away,
      },fetcher,now),6_000)}
    }))
  const websiteByIndex=new Map(siteResearch.flatMap(item=>
    item.status==='fulfilled'&&item.value?
      [[item.value.index,item.value.report] as const]:[]))
  const hintedLegs=referenceLegs.map((row,index)=>{
    const report=websiteByIndex.get(index)
    if(!report||!row||typeof row!=='object'||Array.isArray(row))return row
    const leg=row as Record<string,unknown>
    const observations=report.pages.map(page=>({
      provider:page.provider,url:page.url,status:page.status,
      pageObservedAt:page.pageObservedAt,
      quoteUpdatedAt:null,bookmakerVerified:false,
      referenceMoneylines:page.referenceMoneylines,
    }))
    const chosen=research.events[index]?.pick==='home'?
      research.events[index]?.home:research.events[index]?.away
    const visible=report.pages.flatMap(page=>page.referenceMoneylines)
      .find(ref=>normalize(ref.selection)===normalize(chosen??''))
    const reference=visible?'Moneyline visible de comparador '+visible.american+
      ' (decimal '+visible.decimal+'), SIN casa ni fecha de actualización, '+
      'NO cotizable. ':''
    // Show the result in the existing rationale field as well: older clients
    // may not render the new typed webOddsResearch array yet.
    return{...leg,webOddsResearch:observations,
      rationale:(reference+String(leg.rationale??'')).slice(0,480),
      oddsReferenceNote:'Investigadas '+observations.length+
        ' páginas públicas. Precios de comparador solo referenciales '+
        '(sin casa, actualización ni aceptación verificadas).'}
  })
  const webObserved=siteResearch.filter(x=>x.status==='fulfilled'&&
    x.value?.report.pages.some(p=>p.status==='observed-team-mentions')).length
  if(siteResearch.length)sourceAudit.push(audited('ESPN/CuotasAhora/Yahoo/Oddspedia/Oddschecker/ScoresAndOdds WEB',
    webObserved?'observed':'empty',0,
    'Se inspeccionaron '+siteResearch.length+' partidos con '+webObserved+
    ' menciones próximas de equipos; las cifras HTML son referencia sin '+
    'bookmaker ni hora de actualización, NO cuotas elegibles.'))
  const auditSummary=' Cuotas cotejadas: '+quotedLegs+'/'+count+
    ' selecciones; proveedores: '+sourceAudit.map(x=>x.source+' '+x.status+
    ' ('+x.offers+' observaciones)').join('; ')+'.'
  const auditCard:ChatBlock={...researchCard,props:{...researchCard.props,
    legs:hintedLegs,
    decisionAudit:postQuoteAudit,
    dataCounts:{eventsFound:research.verifiedEvents,quotedLegs,
      researchedLegs,candidateLegs:quotedLegs,conditionalLegs,approvedForBetting:0},
    subtitle:quotedLegs!==count?'TICKET DE INVESTIGACIÓN · '+quotedLegs+'/'+count+
      ' cuotas verificadas · '+reportedReferences+' precios ESPN de referencia':
      researchCard.props.subtitle,
    note:(auditSummary+' ESPN aportó '+reportedReferences+
      ' referencias adicionales no incorporadas por identidad o consistencia; falta de updatedAt no bloquea cuotas válidas. '+
      String(researchCard.props.note??'')).slice(0,1000),
  }}
  const checked={...base,card:auditCard,sourceAudit,quotedLegs,
    decisionAudit:postQuoteAudit,conditionalLegs,
    specialistChecks,conditional:!checklistComplete,dossierComplete:checklistComplete,
    missingQuotes:count-quotedLegs,candidateLegs:quotedLegs}
  if(identityConflict)return{...checked,complete:false,
    explanation:'Borrador CONFLICTIVO: los equipos o la localía no coinciden con el '+
      'partido verificado. No se adjudican cuotas a encuentros ambiguos.'}
  if(!research.complete)return{...checked,
    explanation:(removedConflicts>0?
      'Borrador CONFLICTIVO: '+removedConflicts+
      ' identidades contradictorias excluidas antes de elegir. ':'')+
      'Borrador INCOMPLETO: '+research.verifiedEvents+'/'+count+
      ' partidos con tendencia histórica documentada, '+
      quotedLegs+' con precio cotejado. '+
      (research.multisportSatisfied?'':'No cumple diversidad de deportes. ')+
      'No se cotiza una combinada incompleta.'}
  if(quotedLegs!==count)return{...checked,
    explanation:'Fuentes auditadas: '+quotedLegs+'/'+count+
      ' selecciones tienen precios verificables; '+reportedReferences+
      ' referencias ESPN no se incorporaron por identidad o consistencia, no por falta de updatedAt. '+
      'Se muestra la preselección investigada, NO una combinada cotizada ni apostada.'}
  // A realistic combined price requires the SAME bookmaker to offer all legs.
  const common=groups.reduce<Set<string>>((set,rows,index)=>{
    const names=new Set(rows.map(q=>q.bookmaker))
    return index===0?names:new Set([...set].filter(book=>names.has(book)))
  },new Set())
  if(!common.size)return{...checked,quotedLegs,missingQuotes:0,
    explanation:'Los precios corresponden a distintas casas sin un operador común; no se multiplican como si existiera una combinada disponible.'}
  const best=[...common].map(book=>{
    const choices=groups.map(rows=>rows.filter(q=>q.bookmaker===book)
      .sort((a,b)=>b.price-a.price)[0]).filter((q):q is KeylessQuote=>q!==undefined)
    return{book,choices,combined:choices.reduce((acc,q)=>acc*q.price,1)}
  }).filter(x=>x.choices.length===count).sort((a,b)=>b.combined-a.combined)[0]
  if(!best)return checked
  // Compare the winning-side price ONLY against the complete, matching
  // opposite-side bookmaker prices. Single-sided quotes yield null.
  const marketRisk=auditTicketMarketRisk(best.choices.map((q,index)=>({
    eventId:research.events[index]?.eventId??q.eventId,selection:q.selection,
    market:q.market,noVigShare:quoteSideNoVig(q,all,now),
  })))
  // Second-pass critic: a fragile market favorite is not a justified leg.
  // A non-vig market share cannot be substituted for a calibrated model.
  const decisionAudit=auditTicketDecisions(best.choices.map((quote,index)=>({
    eventId:research.events[index]?.eventId??quote.eventId,
    sport:research.events[index]?.sport??'unknown',
    selection:quote.selection,quotedPrice:quote.price,
    noVigShare:marketRisk.legs[index]?.noVigPercent===null||
      marketRisk.legs[index]?.noVigPercent===undefined?null:
      marketRisk.legs[index]!.noVigPercent!/100,
    specialistStatus:specialistChecks[index]?.status??'unavailable',
    checklistComplete:specialistChecks[index]?.checklist?.complete===true,
    criticalPending:specialistChecks[index]?.checklist?.criticalPending??
      ['Expediente especializado no disponible'],
    modelStatus:modelAudit[index]?.status??'unavailable',
  })),decisionPolicy)
  const elevatedMarketRisk=marketRisk.missingQuotes>0||
    marketRisk.legs.some(x=>x.relativeRisk==='elevated')||
    decisionAudit.legs.some(x=>x.verdict==='hold'||x.verdict==='exclude')
  const marketQuotes:MarketOutcome[]=best.choices.map((q,index)=>({
    eventId:q.eventId,bookmaker:q.bookmaker,market:q.market,selection:q.selection,point:q.point,
    price:q.price,home:q.home,away:q.away,time:q.time,updatedAt:q.updatedAt,
    ...(q.observedAt?{observedAt:q.observedAt}:{}),source:q.source,sportKey:leagueSportKey[research.events[index]?.league??'']??routing[research.events[index]?.sport??'']?.oddsSportKey??'sports_keyless',
  }))
  const selections:MarketSelection[]=marketQuotes.map(q=>({
    eventId:q.eventId,bookmaker:q.bookmaker,market:q.market,selection:q.selection,point:q.point??null,
  }))
  const priced=pricedTicket(selections,marketQuotes,stake)
  // Do not discard verified fixture branding, league, or the reasoning in the
  // unpriced evidence ticket when attaching bookmaker prices.
  const original=Array.isArray(research.card.props.legs)?research.card.props.legs:[]
  const pricedRows=Array.isArray(priced.card.props.legs)?priced.card.props.legs:[]
  const legs=pricedRows.map((row,index)=>{
    const estimate=original[index],quote=best.choices[index]
    const prior=estimate&&typeof estimate==='object'&&!Array.isArray(estimate)
      ?estimate as Record<string,unknown>:{}
    const pricedRow=row&&typeof row==='object'&&!Array.isArray(row)
      ?row as Record<string,unknown>:{}
    return {...pricedRow,
      narrative:enrichSpecialistNarrative(
        prior.narrative as TicketNarrative|null|undefined,specialistChecks[index],
        marketRisk.legs[index]?.noVigPercent,modelAudit[index]),
      marketNoVigPercent:marketRisk.legs[index]?.noVigPercent??null,
      // One chance per leg. Prefer a two-sided, same-bookmaker no-vig
      // estimate; otherwise preserve the disclosed exploratory forecast.
      legWinProbabilityPercent:marketRisk.legs[index]?.noVigPercent??
        (quote?.market==='double_chance'?null:
          typeof prior.legWinProbabilityPercent==='number'?
            prior.legWinProbabilityPercent:null),
      legProbabilitySource:marketRisk.legs[index]?.noVigPercent!==null&&
        marketRisk.legs[index]?.noVigPercent!==undefined?
          'bookmaker-market-no-vig':quote?.market==='double_chance'?
            'unavailable':typeof prior.legWinProbabilityPercent==='number'?
              'exploratory-recent-form':'unavailable',
      marketRiskTier:marketRisk.legs[index]?.relativeRisk??'unknown',
      decisionReview:decisionAudit.legs[index]??null,
      specialistResearch:specialistChecks[index]??null,
      researchEvidenceState:summarizeTicketSpecialist(
        specialistChecks[index],research.events[index]?.sport??'').state,
      researchDetail:summarizeTicketSpecialist(
        specialistChecks[index],research.events[index]?.sport??'').detail,
      researchStatus:specialistChecks[index]?.status==='researched'
        &&specialistChecks[index]?.checklist?.complete===true?'documented':'conditional',
      displayStatus:'research-selection',
      riskNotes:specialistChecks[index]?.checklist?.criticalPending.slice(0,5)??[],
      pendingEvidence:[...new Set([
        ...summarizeTicketSpecialist(specialistChecks[index],
          research.events[index]?.sport??'').pendingEvidence,
        ...(specialistChecks[index]?.pendingSteps??[]),
      ])].slice(0,8),
      ...Object.fromEntries(['homeTeam','awayTeam','homeLogo','awayLogo','sport',
        'league','country','rationale','when'].filter(k=>typeof prior[k]==='string')
        .map(k=>[k,prior[k]])),
      rationale:marketRisk.legs[index]?.noVigPercent!==null&&
        marketRisk.legs[index]?.noVigPercent!==undefined?
          ('Probabilidad individual implícita del mercado sin margen: '+
          marketRisk.legs[index]!.noVigPercent+'% (NO pronóstico calibrado). '+
          String(prior.rationale??'').replace(
            /^Probabilidad individual exploratoria[^.]*\.\s*/u,'')).slice(0,480):
          String(prior.rationale??'').slice(0,480),
      ...(quote?{price:String(quote.price),bookmaker:quote.bookmaker,
        ...(quote.market==='double_chance'?{selection:quote.selection==='1X'
          ?'1X · Local o empate':'X2 · Visita o empate',
          market:'Doble oportunidad (1X/X2)',
          rationale:((marketRisk.legs[index]?.noVigPercent!==null&&
            marketRisk.legs[index]?.noVigPercent!==undefined?
              'Probabilidad implícita específica del mercado 1X/X2: '+
              marketRisk.legs[index]!.noVigPercent+'% (NO calibrada). ':
              'Probabilidad específica de doble oportunidad: no estimable. ')+
            String(prior.rationale??'').replace(
              /^Probabilidad individual exploratoria[^.]*\.\s*/u,'').slice(0,340)+
            ' · Cubre empate; verificar precio, riesgo vigente.').slice(0,480)}:{})}:{})}
  })
  const espnOnlyObserved=best.choices.some(q=>q.source?.startsWith('ESPN Site/Core'))
  const observationDisclaimer=espnOnlyObserved?
    ' ESPN: cuotas comerciales consultadas y utilizables en el ticket sin exigir updatedAt. '+
    'El precio definitivo se comprueba al presentar la apuesta en la casa. ':''
  const card:ChatBlock={...priced.card,props:{
    ...priced.card.props,legs,requestedLegs:count,modelAudit,marketRisk,decisionAudit,
    dataCounts:{eventsFound:research.verifiedEvents,quotedLegs:count,
      researchedLegs,candidateLegs:count,
      conditionalLegs:decisionAudit.legs.filter(x=>
        x.verdict==='hold'||x.verdict==='caution').length,approvedForBetting:0},
    chatNarrative:legs.map(x=>x.narrative).filter(Boolean),
    narrativeInstruction:'Kira debe explicar cada selección DEBAJO del ticket con datos favorables, datos contrarios, fecha y enlaces de noticias, sede, clima, árbitro verificado o no y porcentaje con origen; jamás resumir cinco patas en una sola frase.',
    // The research ticket is displayable even with genuine warnings. Its
    // visible title must not imply bookmaker acceptance or betting approval.
    presentationStatus:'final-research',
    subtitle:'TICKET FINAL DE INVESTIGACIÓN · '+count+'/'+count+' selecciones · '+
      (espnOnlyObserved?'precios observados en ESPN':'cuotas cotejadas')+
      ' · '+best.book+' · '+(checklistComplete&&!elevatedMarketRisk?
        'expediente documentado':'advertencias pendientes'),
    note:'BOLETO DE ESTUDIO CON PRECIOS PUBLICADOS. '+
      (checklistComplete&&!elevatedMarketRisk?'Investigación especializada documentada. ':
        'ADVERTENCIAS: hay datos especializados o riesgos de mercado pendientes. ')+
      'NO ES APUESTA APROBADA NI GANADORA. '+observationDisclaimer+
      (marketPreference==='double_chance'
      ?'Fútbol: la doble oportunidad cubre empate (1X/X2), NO asegura ganar. ':'')+
      'Las cuotas consultadas pueden cambiar antes de que la casa acepte la apuesta. '+
      'Riesgos y datos no confirmados detallados individualmente en cada pata. '+
      'Contradicciones de Bet Better: '+modelDisagreements+
      ' (predicción independiente, no cuota). '+
      (marketRisk.weakest?'Pata mas ajustada: '+marketRisk.weakest.selection+
        ' ('+marketRisk.weakest.noVigPercent+'% sin margen). ':'')+
      'Cada porcentaje pertenece únicamente a su pata y su mercado; '+
      'no presentar una probabilidad conjunta del boleto. '+
      'Formas y descanso históricos NO son probabilidades calibradas. El expediente deportivo puede señalar titulares, bajas y estadísticas PENDIENTES; confirmar la casa antes de apostar. '+priced.warning,
    askPrompt:'Kira, razona cada pata de forma individual: estimación con origen, datos favorables y contradicciones, lesionados y titulares. No mostrar probabilidad conjunta del boleto; no inventar valor esperado ni afirmar ticket ganador.',
  }}
  return{card,priced:true,placed:false,complete:true,
    discoveredEvents:research.discoveryAudit.discoveredEvents,
    discoveryAudit:research.discoveryAudit,
    conditional:!checklistComplete||elevatedMarketRisk,dossierComplete:checklistComplete,
    marketRisk,decisionAudit,reviewedBeforeSelection,removedConflicts,
    verifiedEvents:research.verifiedEvents,eventsFound:research.verifiedEvents,
    quotedLegs:count,missingQuotes:0,sourceAudit,approvedLegs:0,
    // Candidate = priced review opportunity; approvedLegs remains 0 because
    // this is not a calibrated betting recommendation or actual placement.
    candidateLegs:count,ticketReadyForReview:true,
    conditionalLegs:decisionAudit.legs.filter(x=>
      x.verdict==='hold'||x.verdict==='caution').length,
    approvedForBetting:false,
    specialistChecks,researchedLegs,modelAudit,trackingEvents,
    multisportSatisfied:research.multisportSatisfied,
    explanation:'Las '+count+' selecciones tienen '+
      (espnOnlyObserved?'precio observado en ESPN, pendiente de confirmación en la casa':
        'cuota cotejada')+' y la misma casa '+best.book+
      '. Evaluación de riesgos individual disponible en decisionAudit. '+
      (elevatedMarketRisk?'. AVISO: pata con participacion de mercado inferior a 60%; considerar reducir el boleto.':'')+
      (checklistComplete?'. Todos los pasos especializados verificados.':
      '. ADVERTENCIA DE INVESTIGACIÓN: '+(count-researchedLegs)+' expedientes parciales o no disponibles; verificar datos pendientes.')+
      ' Es un ticket de investigación cotizado, NO apuesta aprobada ni predicción calibrada.'}
}
