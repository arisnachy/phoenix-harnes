import type { evidencePricedTicket } from './evidence-priced-ticket.ts'
import type { ChatBlock } from './sports.ts'

type PricedTicket = Awaited<ReturnType<typeof evidencePricedTicket>>
type Fields = Record<string, unknown>
type TicketChatProjection = {
  uiBlock: ChatBlock
  researchFixtures: Fields[]
  modelComparisonBriefs: Fields[]
  /** Bounded bilateral evidence for the fixtures the model must actually choose between. */
  selectedResearchBriefs: Fields[]
  specialistChecks: Fields[]
  sourceAudit: Fields[]
}

const record = (value: unknown): Fields =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Fields : {}

const textFields = (value: unknown, limits: Readonly<Record<string,number>>): Fields =>
  Object.fromEntries(Object.entries(limits).flatMap(([key, limit]) => {
    const field=record(value)[key]
    return typeof field==='string'&&field.length>0?[[key,field.slice(0,limit)]]:[]
  }))

const legFields = {
  event:160,selection:140,price:32,bookmaker:100,when:85,
  homeTeam:100,awayTeam:100,homeLogo:300,awayLogo:300,image:300,
  sport:60,league:100,country:100,market:70,rationale:480,
  eventId:20,eventDate:10,providerLeague:80,researchStatus:50,
  displayStatus:40,quoteStatus:40,quoteEventId:24,quoteSource:120,
  quoteSelection:140,quoteMarket:70,quoteObservedAt:55,bookmakerUpdatedAt:55,
}

const snippets=(value:unknown,count:number)=>Array.isArray(value)?
  value.filter((item):item is string=>typeof item==='string'&&item.trim().length>0)
    .slice(0,count).map(item=>item.slice(0,120)):[]

const rows=(value:unknown,count:number,fields:Readonly<Record<string,number>>):Fields[]=>
  Array.isArray(value)?value.slice(0,count).map(item => textFields(item,fields)):[]

const compactNarrative=(value:unknown,eventId:unknown)=>{
  const narrative=record(value)
  if(typeof eventId!=='string'||narrative.eventId!==eventId||
    typeof narrative.selectionWhy!=='string'||!narrative.selectionWhy.trim())return undefined
  // The native card uses structured sections. The long chat explanation
  // repeats those sections and expands the entire research checklist.
  const {researchSteps:_researchSteps,explanationForChat:_explanationForChat,...sections}=narrative
  return {...sections,explanationForChat:narrative.selectionWhy}
}

const boundedAvailability=(value:unknown)=>{
  const review=record(value),rest=record(review.rest)
  const fields={athlete:100,status:60,reportedAt:48,source:35}
  const hours=(value:unknown)=>typeof value==='number'&&
    Number.isFinite(value)&&value>=0?value:null
  return{
    selected:rows(review.selectedAvailability,6,fields),
    opposing:rows(review.opposingAvailability,6,fields),
    rest:{selectedHours:hours(rest.selectedHours),opposingHours:hours(rest.opposingHours)},
    criticalUnknowns:snippets(review.criticalUnknowns,5),
  }
}

const boundedTeamEvidence=(value:unknown):Fields=>{
  const team=record(value)
  // A full roster can contain dozens of athletes and long game logs. Keep
  // only coverage counts here; the complete roster is fetched page-by-page by
  // the visible rosters stage, not copied into the quick draft.
  const players=Array.isArray(team.players)?team.players:[]
  const metricPlayers=players.filter((item) => {
    const player=record(item)
    return [player.stats,player.recent,player.splits].some(value=>
      Array.isArray(value)&&value.length>0)
  }).length
  return {
    ...textFields(team, { name:120 }),
    rosterCount:players.length,
    playersWithMetrics:metricPlayers,
    recentResults:snippets(team.recentResults,2),
    teamStats:rows(team.teamStats,4, { name:100,value:140 }),
    facts:[...snippets(team.recentResults,1),
      ...rows(team.teamStats,1, { name:100,value:140 }).map(item=>
        Object.entries(item).map(([key,value])=>key+': '+String(value)).join(' · '))].slice(0,2),
  }
}

/**
 * Keep the selected event's evidence in the model-facing response. The old
 * projection kept only alternative IDs, so the model saw a price card but no
 * bilateral roster or player facts and had to guess whether a recheck was
 * needed. Full provider payloads stay in the engine; this bounded view keeps
 * roster/metric coverage counts and team-level facts while leaving deep logs
 * through sports_chat_ticket_dossier_recheck.
 */
const selectedDossierBrief=(value:unknown):Fields=>{
  const dossier=record(value)
  const selectedSide=dossier.selectedSide
  const [source]=rows(dossier.endpointAudit,1, { url:400 })
  return {
    ...textFields(dossier,fixtureFields),
    ...(selectedSide==='home'||selectedSide==='away'?{ selectedSide } : {}),
    fullDossierAvailable:true,
    teamComparison:{
      home:boundedTeamEvidence(record(dossier.teamComparison).home),
      away:boundedTeamEvidence(record(dossier.teamComparison).away),
    },
    verifiedFacts:snippets(dossier.verifiedFacts,4),
    unresolvedFacts:snippets(dossier.unresolvedFacts,4),
    newsFindings:rows(dossier.newsFindings,3,
      { title:160,publisher:80,publishedAt:40,status:30 }),
    availability:boundedAvailability(dossier.qualitativeAvailability),
    ...(source?.url?{ sourceUrl:source.url }:{}),
    recheckTool:'sports_chat_ticket_dossier_recheck',
    recheckInstruction:'Si falta una estadística, lesión, titular o noticia decisiva, reabre el expediente de este eventId antes de elegir; no completes el hueco con una inferencia.',
  }
}

const fixtureFields={
  eventId:20,sport:25,league:65,date:10,home:100,away:100,kickoff:55,
}

/**
 * Keep the native card and a short model-facing evidence summary. The selected
 * fixtures and alternative IDs can be passed to the existing dossier tool.
 * @param result - The complete research result, retained by the engine.
 * @returns Compact, serializable chat data.
 */
export function projectPricedTicketForModel(result: PricedTicket): TicketChatProjection {
  const { card, researchFixtures, specialistChecks }=result
  const props=card.props
  const legs=(Array.isArray(props.legs)?props.legs:[]).slice(0,6).map((item)=>{
    const source=record(item)
    const review=record(source.decisionReview)
    const threshold=review.bookmakerBreakEvenPct
    const narrative=compactNarrative(source.narrative,source.eventId)
    return {
      ...textFields(source,legFields),
      ...(source.quoteAcceptedByBookmaker===false?{ quoteAcceptedByBookmaker:false }:{}),
      ...(typeof threshold==='number'&&Number.isFinite(threshold)&&threshold>0&&threshold<=100?
        {bookmakerBreakEvenPct:threshold}:{}),
      ...(['hold','exclude','caution','candidate'].includes(String(review.verdict))?
        {decisionVerdict:review.verdict}:{}),
      ...(narrative?{narrative}:{}),
      pendingEvidence:snippets(source.pendingEvidence,5),
    }
  })
  const selectedIds=new Set(researchFixtures.map(item=>item.eventId))
  const alternatives=(Array.isArray(props.modelComparisonBriefs)?props.modelComparisonBriefs:[])
    .filter(item=>!selectedIds.has(String(record(item).eventId))).slice(0,3)
    .map(item=>({
      ...textFields(item,fixtureFields),
      ...textFields(item,{ provisionalPick:10,specialistStatus:25 }),
    }))
  const selectedIdsForBrief=new Set(researchFixtures.map(item=>String(record(item).eventId)))
  const selectedResearchBriefs=(Array.isArray(props.selectedBilateralDossiers)?
    props.selectedBilateralDossiers:[])
    .filter(item=>selectedIdsForBrief.has(String(record(item).eventId)))
    .slice(0,6).map(selectedDossierBrief)
  return {
    uiBlock:{
      ...card,
      props:{
        ...textFields(props,{ title:220,subtitle:240,source:250,combinedOdds:40,
          stake:50,grossReturn:50,note:480,presentationStatus:25 }),
        requestedLegs:props.requestedLegs,legs,dataCounts:props.dataCounts,
      },
    },
    researchFixtures:researchFixtures.slice(0,6).map(item=>textFields(item,fixtureFields)),
    modelComparisonBriefs:alternatives,
    selectedResearchBriefs,
    specialistChecks:specialistChecks.slice(0,6).map(check=>({
      eventId:check.eventId,status:check.status,
      verifiedSteps:snippets(check.verifiedSteps,2),
      pendingSteps:snippets(check.pendingSteps,2),
      checklistComplete:check.checklist?.complete===true,
      sourceChecks:check.sourceChecks?.slice(0,2).map(source=>
        textFields(source,{ provider:45,status:20,url:400 }))??[],
    })),
    sourceAudit:result.sourceAudit.slice(0,8).map(source=>
      textFields(source,{ source:75,status:35 })),
  }
}
