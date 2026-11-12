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
  assert.equal(result.selected.length,3)
  assert.equal(result.supportedLegs,1)
  assert.equal(result.conditionalLegs,2)
  assert.equal(result.completed,false)
})
test('mixed provider books stay isolated instead of aborting a valid ESPN research draft',()=>{
  const result=selectDailyResearchedMarkets([
    review(11),review(12,'h2h','descriptive-support',2,'Book B')],5)
  assert.equal(result.selected.length,1)
  assert.equal(new Set(result.selected.map(x=>x.candidate.bookmaker)).size,1)
  assert.equal(result.completed,false)
})
test('never invents more games than the actual slate and validates goal',()=>{
  const result=selectDailyResearchedMarkets([review(1),review(1,'spreads'),review(2)],6)
  assert.equal(result.selected.length,2)
  assert.equal(result.completed,false)
  assert.throws(()=>selectDailyResearchedMarkets([],3),/5 a 6/)
  assert.throws(()=>selectDailyResearchedMarkets([],4),/5 a 6/)
  assert.throws(()=>selectDailyResearchedMarkets([],7),/5 a 6/)
})

test('independently positive market beats negative-value descriptive favorite',()=>{
  const overpriced={...review(66,'h2h','descriptive-support',20),
    priceAudit:{classification:'negative-value'}}
  const better={...review(66,'totals','descriptive-support',1),
    priceAudit:{classification:'potential-value'}}
  const result=selectDailyResearchedMarkets([overpriced,better],5)
  assert.equal(result.selected[0].candidate.market,'totals')
})

test('equally researched moneyline prioritizes stronger market favorite over raw ranking',()=>{
  const low={...review(21,'h2h','descriptive-support',99),
    selectedOutcome:{selection:'Home 21',line:null,decimalOdds:1.91,noVigShare:.52}}
  const high={...review(22,'h2h','descriptive-support',1),
    selectedOutcome:{selection:'Home 22',line:null,decimalOdds:1.19,noVigShare:.84}}
  const r=selectDailyResearchedMarkets([low,high],5)
  assert.equal(r.selected[0].candidate.espnEventId,'22')
})

test('daily selection excludes unavailable, contraindicated and negative-value legs before ranking',()=>{
  const bad={...review(31,'h2h','descriptive-support',100),
    priceAudit:{classification:'negative-value'}}
  const choices=[
    review(30,'h2h','unavailable',99),
    review(32,'h2h','contraindicated',90),
    bad,
    review(33,'h2h','uncertain',3),
    review(34,'h2h','descriptive-support',5),
  ]
  const result=selectDailyResearchedMarkets(choices,5)
  assert.deepEqual(new Set(result.selected.map(x=>x.candidate.espnEventId)),
    new Set(['33','34']))
  assert.equal(result.completed,false)
  assert.equal(result.conditionalLegs,1)
  assert.equal(result.supportedLegs,1)
})

test('disqualified quotes from unrelated bookmakers cannot invalidate an otherwise clean draft',()=>{
  const invalid={...review(3,'h2h','contraindicated',88,'Other Book')}
  const chosen=selectDailyResearchedMarkets([review(1),review(2),invalid],5)
  assert.equal(chosen.selected.length,2)
})

test('automatically replenishes a disqualified leg with the next researched game',()=>{
  const rejected={...review(1,'h2h','contraindicated',99)}
  const candidates=[rejected,...[2,3,4,5,6,7].map(n=>review(n))]
  const result=selectDailyResearchedMarkets(candidates,5)
  assert.equal(result.selected.length,5)
  assert.equal(result.supportedLegs,5)
  assert.equal(result.selectedBookmaker,'Book A')
  assert.equal(result.completed,true)
  assert.ok(result.selected.every(x=>x.candidate.espnEventId!=='1'))
  assert.ok(result.selected.some(x=>x.candidate.espnEventId==='6'))
})
test('five verified selections from one provider survive two opposing auxiliary houses',()=>{
  const five=[1,2,3,4,5].map(n=>review(n,'h2h','descriptive-support',2,'ESPN · DraftKings'))
  const other=[review(11,'h2h','descriptive-support',4,'Bet B'),
    review(12,'h2h','descriptive-support',5,'Bet C')]
  const result=selectDailyResearchedMarkets([...five,...other],5)
  assert.equal(result.selectedBookmaker,'ESPN · DraftKings')
  assert.equal(result.selected.length,5)
  assert.equal(result.completed,true)
})

test('older ESPN quote can be investigated but not complete final supported ticket',()=>{
  const reviews=[1,2,3,4,5].map(n=>({
    ...review(n),candidate:{...candidate(n),requiresRecheck:n===1},
  }))
  const result=selectDailyResearchedMarkets(reviews,5)
  assert.equal(result.selected.length,5)
  assert.equal(result.supportedLegs,4)
  assert.equal(result.completed,false)
})
