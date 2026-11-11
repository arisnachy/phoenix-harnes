import {test} from 'node:test'
import assert from 'node:assert/strict'
import {auditTicketDecisions,readDecisionPolicy} from '../src/sports-ticket-decision.ts'

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
