import {test} from 'node:test'
import assert from 'node:assert/strict'
import {auditTicketMarketRisk,quoteSideNoVig} from '../src/ticket-risk-audit.ts'

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

test('no-vig market share requires BOTH live sides at same book and event',()=>{
  const now=Date.parse('2026-11-08T21:00:00Z')
  const home={eventId:'100',bookmaker:'Book',market:'h2h',
    selection:'Home',price:1.8,home:'Home',away:'Away',
    time:'2026-11-08T23:00:00Z',updatedAt:'2026-11-08T20:50:00Z',
    source:'Provider'}
  const away={...home,selection:'Away',price:2.05}
  assert.equal(quoteSideNoVig(home,[home,away],now),
    Number(((1/1.8)/(1/1.8+1/2.05)).toFixed(5)))
  assert.equal(quoteSideNoVig(home,[home],now),null)
  assert.equal(quoteSideNoVig(home,[home,{...away,bookmaker:'Other'}],now),null)
  assert.equal(quoteSideNoVig(home,[home,{...away,eventId:'101'}],now),null)
  assert.equal(quoteSideNoVig(home,[home,{...away,updatedAt:'2026-11-08T18:50:00Z'}],now),null)
})
test('soccer three way pricing requires a DRAW rather than normalizing a two-way result',()=>{
  const now=Date.parse('2026-11-08T21:00:00Z')
  const base={eventId:'20',bookmaker:'Book',market:'1x2',selection:'Home',
    price:1.7,home:'Home',away:'Away',time:'2026-11-08T23:00:00Z',
    updatedAt:'2026-11-08T20:55:00Z',source:'Provider'}
  const away={...base,selection:'Away',price:4}
  const draw={...base,selection:'Draw',price:3.5}
  assert.equal(quoteSideNoVig(base,[base,away],now),null)
  assert.ok(quoteSideNoVig(base,[base,away,draw],now)!==null)
})
