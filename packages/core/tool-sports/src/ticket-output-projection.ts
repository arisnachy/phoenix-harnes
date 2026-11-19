import type { evidencePricedTicket } from './evidence-priced-ticket.ts'
import type { ChatBlock } from './sports.ts'

type PricedTicket = Awaited<ReturnType<typeof evidencePricedTicket>>
type Fields = Record<string, unknown>
type TicketChatProjection = {
  uiBlock: ChatBlock
  researchFixtures: Fields[]
  modelComparisonBriefs: Fields[]
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
  sport:60,league:100,country:100,market:70,rationale:200,
  eventId:20,eventDate:10,providerLeague:80,researchStatus:50,
  displayStatus:40,quoteStatus:40,quoteEventId:24,quoteSource:120,
  quoteSelection:140,quoteMarket:70,quoteObservedAt:55,bookmakerUpdatedAt:55,
}

const snippets=(value:unknown,count:number)=>Array.isArray(value)?
  value.filter((item):item is string=>typeof item==='string'&&item.trim().length>0)
    .slice(0,count).map(item=>item.slice(0,120)):[]

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
    return {
      ...textFields(source,legFields),
      ...(source.quoteAcceptedByBookmaker===false?{ quoteAcceptedByBookmaker:false }:{}),
      pendingEvidence:snippets(source.pendingEvidence,2),
    }
  })
  const selectedIds=new Set(researchFixtures.map(item=>item.eventId))
  const alternatives=(Array.isArray(props.modelComparisonBriefs)?props.modelComparisonBriefs:[])
    .filter(item=>!selectedIds.has(String(record(item).eventId))).slice(0,3)
    .map(item=>({
      ...textFields(item,fixtureFields),
      ...textFields(item,{ provisionalPick:10,specialistStatus:25 }),
    }))
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
