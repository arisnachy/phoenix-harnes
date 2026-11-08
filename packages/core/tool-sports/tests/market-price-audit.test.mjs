import {test} from 'node:test'
import assert from 'node:assert/strict'
import {auditMarketPrice} from '../src/market-price-audit.ts'

const candidate=(price=1+100/460)=>({
  sport:'hockey',league:'nhl',espnEventId:'123',market:'h2h',
  kickoff:'2026-11-08T01:00:00Z',bookmakerOverround:.05,
  outcomes:[{selection:'Carolina',line:null,decimalOdds:price,noVigShare:.79}],
})
const estimate=(p,lo,hi)=>({
  eventId:'123',market:'h2h',selection:'Carolina',line:null,
  probability:p,lowerBound:lo,upperBound:hi,
  trainedThrough:'2026-11-06T20:00:00Z',holdoutCount:100,
  status:'validated',source:'independent holdout',
})
test('Carolina -460 has 82.14% break-even, not the 79% no-vig bookmaker share',()=>{
  const c=candidate(),audit=auditMarketPrice(c,c.outcomes[0])
  assert.equal(audit.classification,'unvalidated')
  assert.equal(audit.breakEvenPercent,82.14)
  assert.equal(audit.marketNoVigPercent,79)
  assert.equal(audit.expectedValuePercent,null)
  assert.match(audit.warnings.join(' '),/Favorito caro/)
})
test('validated 75% forecast rejects Carolina -460, without treating no-vig as forecast',()=>{
  const c=candidate(),audit=auditMarketPrice(c,c.outcomes[0],estimate(.75,.7,.8))
  assert.equal(audit.classification,'negative-value')
  assert.equal(audit.expectedValuePercent,-8.7)
  assert.ok(audit.bestCaseValuePercent<0)
})
test('Houston over 223.5 -130 at validated 49% is negative value',()=>{
  const c={...candidate(1+100/130),sport:'basketball',league:'nba',
    market:'totals',espnEventId:'456',outcomes:[
      {selection:'Over',line:223.5,decimalOdds:1+100/130,noVigShare:.51}]}
  const p={...estimate(.49,.45,.53),eventId:'456',market:'totals',
    selection:'Over',line:223.5}
  const audit=auditMarketPrice(c,c.outcomes[0],p)
  assert.equal(audit.breakEvenPercent,56.52)
  assert.equal(audit.classification,'negative-value')
  assert.ok(audit.expectedValuePercent<0)
})
test('late calibration, small holdout and mismatched market lines cannot assert EV',()=>{
  const c=candidate()
  const bad=[{...estimate(.9,.86,.95),line:1.5},
    {...estimate(.9,.86,.95),trainedThrough:'2026-11-08T02:00:00Z'},
    {...estimate(.9,.86,.95),holdoutCount:10}]
  for(const p of bad){
    const audit=auditMarketPrice(c,c.outcomes[0],p)
    assert.equal(audit.classification,'unvalidated')
    assert.equal(audit.modelProbabilityPercent,null)
  }
})
test('positive model only suggests potential value if even lower bound exceeds price',()=>{
  const c=candidate(2.1),audit=auditMarketPrice(c,c.outcomes[0],estimate(.64,.55,.72))
  assert.equal(audit.classification,'potential-value')
  assert.ok(audit.worstCaseValuePercent>2)
})
test('missing selected outcome cannot yield an implied model probability',()=>{
  const c=candidate()
  assert.equal(auditMarketPrice(c,null).classification,'unresolved')
})
