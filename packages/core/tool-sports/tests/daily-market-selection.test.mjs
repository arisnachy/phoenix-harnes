import {test} from 'node:test'
import assert from 'node:assert/strict'
import {selectDailyResearchedMarkets} from '../src/daily-market-selection.ts'
const candidate=(event,market='h2h',bookmaker='Book A',sport='basketball')=>({
  sport,league:sport==='basketball'?'nba':'nfl',
  espnEventId:String(event),bookmakerEventId:'provider-'+event,
  fixture:'Away '+event+' vs Home '+event,
  bookmaker,market,selection:'Home '+event,line:null,decimalOdds:1.9,
  marketNoVigShare:.5,bookmakerOverround:.05,
  kickoff:'2026-11-08T03:00:00Z',quoteUpdatedAt:'2026-11-07T19:00:00Z',
  source:'The Odds API',assessment:'quote-only-research-pending',outcomes:[],
})
const review=(event,market='h2h',status='descriptive-support',score=2,book='Book A')=>({
  candidate:candidate(event,market,book),status,rankingScore:score,
  verifiedSources:5,sourceCount:6,
  quoteUpdatedAt:'2026-11-07T19:00:00Z',
})
test('independent evidence overturns favorite and chooses a better total from same game',()=>{
  const list=[review(11,'h2h','uncertain',0),review(11,'totals','descriptive-support',4),
    review(11,'spreads','descriptive-support',2),
    review(12,'h2h','descriptive-support',1),review(13,'h2h','descriptive-support',1),
    review(14,'h2h','descriptive-support',1),review(15,'h2h','descriptive-support',1),
    review(16,'h2h','descriptive-support',1)]
  const result=selectDailyResearchedMarkets(list,5)
  assert.equal(result.eventChoices,6)
  assert.equal(result.marketsReviewed,8)
  assert.equal(result.alternativesCompared,2)
  assert.equal(result.selected.length,5)
  assert.equal(result.supportedLegs,5)
  assert.equal(result.completed,true)
  assert.equal(result.selected.find(x=>x.candidate.espnEventId==='11').candidate.market,'totals')
  assert.equal(new Set(result.selected.map(x=>x.candidate.espnEventId)).size,5)
})
test('no fabricated completeness when only conditional research remains',()=>{
  const choices=[review(11,'h2h','uncertain'),review(12,'h2h','unavailable'),
    review(13,'h2h','descriptive-support'),
    review(14,'h2h','uncertain'),review(15,'h2h','unavailable')]
  const result=selectDailyResearchedMarkets(choices,5)
  assert.equal(result.selected.length,5)
  assert.equal(result.supportedLegs,1)
  assert.equal(result.conditionalLegs,4)
  assert.equal(result.completed,false)
})
test('rejects mixed bookmakers rather than creating a false commercial parlay',()=>{
  assert.throws(()=>selectDailyResearchedMarkets([
    review(11),review(12,'h2h','descriptive-support',2,'Book B')],5),/casas/)
})
test('never invents more games than the actual slate and validates goal',()=>{
  const result=selectDailyResearchedMarkets([review(1),review(1,'spreads'),review(2)],6)
  assert.equal(result.selected.length,2)
  assert.equal(result.completed,false)
  assert.throws(()=>selectDailyResearchedMarkets([],3),/4 a 6/)
  assert.throws(()=>selectDailyResearchedMarkets([],7),/4 a 6/)
})

test('independently positive market beats negative-value descriptive favorite',()=>{
  const overpriced={...review(66,'h2h','descriptive-support',20),
    priceAudit:{classification:'negative-value'}}
  const better={...review(66,'totals','descriptive-support',1),
    priceAudit:{classification:'potential-value'}}
  const result=selectDailyResearchedMarkets([overpriced,better],5)
  assert.equal(result.selected[0].candidate.market,'totals')
})
