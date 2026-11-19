import test from 'node:test'
import assert from 'node:assert/strict'
import { projectPricedTicketForModel } from '../src/ticket-output-projection.ts'

test('six-leg model output preserves verified prices, evidence, and alternatives without full dossiers',()=>{
  const huge='Información extensa '.repeat(2000)
  const fixtures=Array.from({length:7},(_,index)=>({
    eventId:String(401234+index),sport:'basketball',league:'nba',
    home:'Local '+index,away:'Visitante '+index,kickoff:'2026-11-20T01:00:00Z',date:'2026-11-19',
  }))
  const chosen=fixtures.slice(0,6)
  const source='ESPN Site/Core'
  const dataCounts={eventsFound:6,quotedLegs:6,researchedLegs:5,approvedForBetting:0}
  const report=projectPricedTicketForModel({
    card:{component:'sports_ticket_card',version:1,props:{
      title:'Ticket de investigación',source,requestedLegs:6,combinedOdds:'18.5',note:huge,dataCounts,
      legs:chosen.map(({eventId,home,away})=>({
        eventId,event:away+' vs '+home,selection:home,price:'1.6',bookmaker:'DraftKings',
        quoteSource:source,quoteEventId:eventId,quoteAcceptedByBookmaker:false,
        rationale:huge,pendingEvidence:[huge],specialistResearch:huge,
      })),
      modelComparisonBriefs:fixtures.map(fixture=>({...fixture,teamComparison:huge})),
      selectedBilateralDossiers:huge,chatNarrative:huge,
    }},
    researchFixtures:chosen,
    specialistChecks:chosen.map(({eventId})=>({
      eventId,status:'researched',verifiedSteps:[huge],pendingSteps:[huge],
      sourceChecks:[{provider:'NBA',status:'verified',url:'https://www.nba.com/news/report',detail:huge}],
    })),
    sourceAudit:[{source,status:'ok',error:huge}],
  })
  assert.ok(Buffer.byteLength(JSON.stringify(report))<25_000)
  assert.deepEqual(report.uiBlock.props.dataCounts,dataCounts)
  assert.deepEqual(report.uiBlock.props.legs.map(leg=>leg.eventId),chosen.map(fixture=>fixture.eventId))
  assert.ok(report.uiBlock.props.legs.every(leg=>leg.quoteSource===source&&leg.quoteAcceptedByBookmaker===false))
  assert.ok(report.uiBlock.props.legs.every(leg=>!('specialistResearch' in leg)))
  assert.deepEqual(report.researchFixtures,chosen)
  assert.equal(report.modelComparisonBriefs[0].eventId,fixtures[6].eventId)
  assert.equal(report.specialistChecks[0].sourceChecks[0].url,'https://www.nba.com/news/report')
})
