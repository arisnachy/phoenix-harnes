import {test} from 'node:test'
import assert from 'node:assert/strict'
import {auditTicketDecisions,readDecisionPolicy,ticketIsReadyForReview} from '../src/sports-ticket-decision.ts'

const policy=readDecisionPolicy({})
const sample=(eventId,share,overrides={})=>({
  eventId,sport:'hockey',selection:eventId,quotedPrice:1.9,
  noVigShare:share,specialistStatus:'researched',
  checklistComplete:true,criticalPending:[],modelStatus:'unavailable',
  ...overrides,
})
test('52% market side is cautioned but not automatically excluded',()=>{
  const audit=auditTicketDecisions([
    sample('Boston',.85,{sport:'basketball'}),
    sample('Minnesota',.82,{sport:'basketball'}),
    sample('New Jersey',.58),
    sample('Tampa Bay',.57,{checklistComplete:false,
      criticalPending:['Dos porteros titulares CONFIRMADOS']}),
    sample('Anaheim',.52),
  ],policy)
  assert.equal(audit.legs[4].verdict,'caution')
  assert.ok(audit.legs[4].reasons.join(' ').includes('52'))
  assert.equal(audit.legs[3].verdict,'caution')
  assert.match(audit.legs[3].reasons.join(' '),/porteros/)
  assert.equal(audit.legs[2].verdict,'caution')
  assert.equal(audit.legs[0].verdict,'candidate')
  assert.deepEqual(audit.excludedEvents,[])
  assert.equal(audit.scenarios[0].marketProductPct,40.43)
  assert.equal(audit.scenarios[1].marketProductPct,23.04)
  assert.equal(audit.scenarios[2].marketProductPct,11.98)
  assert.equal(audit.legs[4].modelProbabilityPct,null)
  assert.ok(audit.legs[3].reasons.join(' ').includes('PRECAUCIÓN'))
  assert.equal(audit.legs[4].expectedValue,null)
  assert.equal(audit.approvedForBetting,false)
})
test('quoted research candidates survive missing specialist or other-side price',()=>{
  const audit=auditTicketDecisions([
    sample('A',null),sample('B',.78,{specialistStatus:'unavailable'}),
    sample('C',.77,{modelStatus:'contradiction'}),
    sample('D',null,{quotedPrice:null}),
  ],policy)
  assert.equal(audit.legs[0].verdict,'caution','single-side priced quote is researchable')
  assert.equal(audit.legs[1].verdict,'caution','unavailable specialist is a warning')
  assert.equal(audit.legs[2].verdict,'hold','independent contradiction remains explicit')
  assert.equal(audit.legs[3].verdict,'hold','missing actual price is still blocked')
  assert.equal(audit.scenarios[0].marketProductPct,null)
  assert.equal(audit.legs[0].marketNoVigPct,null)
  assert.equal(audit.alternativesNeeded,2)
})
test('a quote is break-even arithmetic, not a model forecast or EV',()=>{
  const result=auditTicketDecisions([sample('T',.65,{quotedPrice:1.5})],policy)
  assert.equal(result.legs[0].bookmakerBreakEvenPct,66.67)
  assert.equal(result.legs[0].marketNoVigPct,65)
  assert.equal(result.legs[0].edgePct,null)
  assert.match(result.warning,/independencia/)
})
test('policy validates deployment thresholds and duplicate event IDs',()=>{
  assert.throws(()=>readDecisionPolicy({
    PHOENIX_SPORTS_SCREEN_EXCLUDE_BELOW:'0.99',
  }),/inválidos/)
  assert.throws(()=>auditTicketDecisions([sample('A',.7),sample('A',.8)],policy),
    /duplicado/)
})


test('held selections are not added to three/four/five-leg recommendation scenarios',()=>{
  const result=auditTicketDecisions([
    sample('A',.8),sample('B',.79),sample('C',.78),
    sample('D',.77,{modelStatus:'contradiction'}),
    sample('E',.76),
  ],policy)
  assert.equal(result.legs.find(x=>x.eventId==='D').verdict,'hold')
  assert.deepEqual(result.scenarios[0].eventIds,['A','B','C'])
  assert.deepEqual(result.scenarios[1].eventIds,['A','B','C','E'])
  assert.equal(result.scenarios[2].marketProductPct,null)
  assert.ok(!result.scenarios.some(s=>s.eventIds.includes('D')))
})

test('Nov 15 forensic: exploratory 59/62.5/65.1 cannot justify quoted break-even prices',()=>{
  const entries=[
    {eventId:'BOS',price:1.10309,exploratory:59,sport:'basketball'},
    {eventId:'HOU',price:1.28986,exploratory:62.5,sport:'basketball'},
    {eventId:'EDM',price:1.67568,exploratory:60,sport:'hockey'},
    {eventId:'NSH',price:1.58824,exploratory:68.6,sport:'hockey'},
    {eventId:'VGK',price:1.24390,exploratory:65.1,sport:'hockey'},
  ]
  const inputs=entries.map(x=>sample(x.eventId,.7,{
    sport:x.sport,quotedPrice:x.price,
    exploratoryProbabilityPercent:x.exploratory,
  }))
  const audit=auditTicketDecisions(inputs,policy)
  assert.deepEqual(audit.legs.map(x=>x.alternativeReviewRequired),
    [true,true,false,false,true])
  assert.equal(audit.alternativesToReview,3)
  assert.equal(audit.legs[0].bookmakerBreakEvenPct,90.65)
  assert.equal(audit.legs[0].exploratoryVsBreakEvenGapPct,31.65)
  assert.equal(audit.legs[1].bookmakerBreakEvenPct,77.53)
  assert.equal(audit.legs[4].bookmakerBreakEvenPct,80.39)
  for(const index of [0,1,4]){
    const leg=audit.legs[index]
    assert.equal(leg.verdict,'caution')
    assert.match(leg.reasons.join(' '),/ALERTA DE PRECIO/)
    assert.equal(leg.modelProbabilityPct,null)
    assert.equal(leg.expectedValue,null)
  }
  assert.equal(audit.approvedForBetting,false)
})
test('missing exploratory model cannot be treated as evidence of a cheap favorite',()=>{
  const audit=auditTicketDecisions([sample('Vegas',.83,{
    quotedPrice:1.2,exploratoryProbabilityPercent:null,
  })],policy)
  assert.equal(audit.legs[0].alternativeReviewRequired,true)
  assert.equal(audit.legs[0].verdict,'caution')
  assert.match(audit.legs[0].reasons.join(' '),/FAVORITO DE CUOTA EXIGENTE/)
  assert.equal(audit.legs[0].exploratoryVsBreakEvenGapPct,null)
})

test('Nov 16 Ravens regression: missing starting QB blocks a definitive NFL leg',()=>{
  const audit=auditTicketDecisions([
    sample('LAC-BAL',.78,{sport:'football',selection:'Baltimore Ravens',
      quotedPrice:1.30,specialistStatus:'researched',checklistComplete:false,
      criticalPending:['QB titular no confirmado en lista de inactivos']}),
    sample('PHI-BKN',.70,{sport:'basketball'}),
  ],policy)
  const ravens=audit.legs[0]
  assert.equal(ravens.verdict,'hold')
  assert.equal(ravens.alternativeReviewRequired,true)
  assert.match(ravens.reasons.join(' '),/quarterback titular sin confirmación/u)
  assert.deepEqual(audit.heldEvents,['LAC-BAL'])
  assert.ok(audit.scenarios.every(s=>!s.eventIds.includes('LAC-BAL')))
  assert.equal(audit.approvedForBetting,false)
})

test('held quoted picks keep their research record but are not a final reviewable ticket',()=>{
  const caution=auditTicketDecisions([sample('NBA',.72,{
    sport:'basketball',checklistComplete:false,
    criticalPending:['Quintetos pendientes']})],policy)
  assert.equal(ticketIsReadyForReview(caution),true)
  const hold=auditTicketDecisions([sample('NFL',.75,{
    sport:'football',criticalPending:['QB titular sin confirmar']})],policy)
  assert.equal(ticketIsReadyForReview(hold),false)
  assert.equal(hold.legs[0].verdict,'hold')
})

test('multiple current injuries and back-to-back hold a previously priced NBA favorite',()=>{
  const audit=auditTicketDecisions([
    sample('Warriors',.71,{sport:'basketball',quotedPrice:1.62,
      pregameRiskPriority:-1.36}),
    sample('76ers',.68,{sport:'basketball',quotedPrice:1.45,
      pregameRiskPriority:-.15}),
  ],policy)
  assert.equal(audit.legs[0].verdict,'hold')
  assert.equal(audit.legs[0].alternativeReviewRequired,true)
  assert.ok(audit.heldEvents.includes('Warriors'))
  assert.equal(ticketIsReadyForReview(audit),false)
  assert.match(audit.legs[0].reasons.join(' '),/múltiples alertas prepartido/u)
  assert.notEqual(audit.legs[1].verdict,'hold')
  assert.ok(audit.scenarios.every(s=>!s.eventIds.includes('Warriors')))
})
test('unobserved risk never becomes a fabricated predictive probability',()=>{
  const audit=auditTicketDecisions([
    sample('Denver',.65,{pregameRiskPriority:null}),
  ],policy)
  assert.notEqual(audit.legs[0].verdict,'hold')
  assert.equal(audit.legs[0].modelProbabilityPct,null)
  assert.equal(audit.legs[0].expectedValue,null)
})
