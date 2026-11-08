import {test} from 'node:test'
import assert from 'node:assert/strict'
import {auditTicketMarketRisk} from '../src/ticket-risk-audit.ts'

const leg=(id,p)=>({eventId:String(id),selection:'Team '+id,market:'h2h',noVigShare:p})
test('ticket audit highlights a 52 percent weak leg and the 3/4/5 tradeoff',()=>{
  const a=auditTicketMarketRisk([leg(1,.85),leg(2,.82),leg(3,.59),leg(4,.58),leg(5,.52)])
  assert.equal(a.weakest.eventId,'5')
  assert.equal(a.fullPercent,12.4)
  assert.equal(a.fourLegPercent,23.85)
  assert.equal(a.threeLegPercent,41.12)
  assert.deepEqual(a.coreThree,['1','2','3'])
  assert.equal(a.calibrated,false)
  assert.equal(a.approvedForBetting,false)
})
test('missing market side does not synthesize a price-based full ticket figure',()=>{
  const a=auditTicketMarketRisk([leg(1,.85),leg(2,null),leg(3,.58)])
  assert.equal(a.fullPercent,null)
  assert.equal(a.weakest,null)
  assert.equal(a.missingQuotes,1)
  assert.equal(a.threeLegPercent,null)
})
test('invalid and out-of-range market shares never become forecasts',()=>{
  const a=auditTicketMarketRisk([leg(1,0),leg(2,1),leg(3,NaN)])
  assert.equal(a.fullPercent,null)
  assert.ok(a.legs.every(x=>x.relativeRisk==='unknown'))
})
