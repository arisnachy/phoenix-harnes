import {test} from 'node:test'
import assert from 'node:assert/strict'
import {auditTicketDecisions,readDecisionPolicy,ticketIsReadyForReview} from '../src/sports-ticket-decision.ts'

const policy=readDecisionPolicy({})
const sample=(eventId,share,overrides={})=>({
  eventId,sport:'basketball',selection:eventId,quotedPrice:1.9,
  noVigShare:share,specialistStatus:'researched',
  checklistComplete:true,criticalPending:[],modelStatus:'unavailable',
  ...overrides,
})
test('a cheap favorite and an underdog remain candidates: market price cannot rank winners',()=>{
  const audit=auditTicketDecisions([
    sample('Underdog',.35),sample('Favorite',.87),sample('Middle',.64),
  ],policy)
  assert.deepEqual(audit.legs.map(x=>x.verdict),
    ['candidate','candidate','candidate'])
  assert.deepEqual(audit.scenarios[0].eventIds,
    ['Underdog','Favorite','Middle'],'original input order, not bookmaker ranking')
  assert.equal(audit.scenarios[0].marketProductPct,null)
  assert.match(audit.warning,/no selección/u)
})
test('real bookmaker prices remain visible facts without a computed expected value',()=>{
  const audit=auditTicketDecisions([sample('A',.65,{quotedPrice:1.5})],policy)
  assert.equal(audit.legs[0].bookmakerBreakEvenPct,66.67)
  assert.equal(audit.legs[0].marketNoVigPct,65)
  assert.equal(audit.legs[0].modelProbabilityPct,null)
  assert.equal(audit.legs[0].expectedValue,null)
  assert.equal(audit.legs[0].edgePct,null)
  assert.equal(audit.legs[0].exploratoryVsBreakEvenGapPct,null)
})
test('a missing quote or contradictory independent report remains held',()=>{
  const audit=auditTicketDecisions([
    sample('A',null,{quotedPrice:null}),
    sample('B',.73,{modelStatus:'contradiction'}),
    sample('C',.62),
  ],policy)
  assert.deepEqual(audit.heldEvents,['A','B'])
  assert.equal(audit.legs[2].verdict,'candidate')
  assert.deepEqual(audit.scenarios[0].eventIds,['C'])
  assert.equal(ticketIsReadyForReview(audit),false)
  assert.equal(audit.approvedForBetting,false)
})
test('individual unavailable roster and uncertain injury lists demand model research, not points',()=>{
  const audit=auditTicketDecisions([sample('NBA',null,{
    specialistStatus:'incomplete',checklistComplete:false,
    criticalPending:['Titulares no confirmados'],
    pregameReviewRequired:true,
    pregameConcerns:['Falta parte bilateral de lesiones'],
  })],policy)
  assert.equal(audit.legs[0].verdict,'caution')
  assert.equal(audit.legs[0].alternativeReviewRequired,true)
  assert.match(audit.legs[0].reasons.join(' '),/PENDIENTES PARA KIRA/u)
  assert.doesNotMatch(audit.legs[0].reasons.join(' '),/penalización de \d/u)
})
test('NFL QB without verified starter is held, never accepted through a favorable price',()=>{
  const audit=auditTicketDecisions([sample('Ravens',.86,{
    sport:'football',criticalPending:['QB titular sin confirmar'],
    checklistComplete:false,
  })],policy)
  assert.equal(audit.legs[0].verdict,'hold')
  assert.equal(audit.legs[0].alternativeReviewRequired,true)
  assert.equal(ticketIsReadyForReview(audit),false)
  assert.match(audit.legs[0].reasons.join(' '),/QB titular/u)
})
test('unconfirmed NHL goalie is a documented concern, not synthetic loss probability',()=>{
  const audit=auditTicketDecisions([sample('NHL',.82,{
    sport:'hockey',checklistComplete:false,
    criticalPending:['Ambos porteros titulares por verificar'],
  })],policy)
  assert.equal(audit.legs[0].verdict,'caution')
  assert.ok(audit.legs[0].alternativeReviewRequired)
  assert.match(audit.legs[0].reasons.join(' '),/porteros/u)
})
test('exploratory probabilities do not score, veto or choose any side',()=>{
  const audit=auditTicketDecisions([
    sample('High',.5,{exploratoryProbabilityPercent:90}),
    sample('Low',.5,{exploratoryProbabilityPercent:20}),
  ],policy)
  assert.deepEqual(audit.legs.map(x=>x.verdict),['candidate','candidate'])
  assert.deepEqual(audit.legs.map(x=>x.exploratoryVsBreakEvenGapPct),[null,null])
})
test('invalid config or repeated event IDs still fails validation',()=>{
  assert.throws(()=>readDecisionPolicy({
    PHOENIX_SPORTS_SCREEN_EXCLUDE_BELOW:'0.99',
  }),/inválidos/)
  assert.throws(()=>auditTicketDecisions([sample('A',.7),sample('A',.8)],policy),
    /duplicado/)
})
