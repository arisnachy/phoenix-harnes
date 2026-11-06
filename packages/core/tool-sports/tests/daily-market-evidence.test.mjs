import {test} from 'node:test'
import assert from 'node:assert/strict'
import {assessDailyMarketEvidence,unavailableMarketEvidence} from '../src/daily-market-evidence.ts'

const market=(market='totals',selection='Over',line=235.5)=>({
  sport:'basketball',league:'nba',espnEventId:'912',bookmakerEventId:'book-912',
  fixture:'Away vs Home',kickoff:'2026-11-07T01:00:00Z',
  bookmaker:'Book A',market,selection,line,decimalOdds:1.9,
  marketNoVigShare:0.51,
  outcomes:market==='totals'?
    [{selection:'Over',line,decimalOdds:1.9,noVigShare:.51},
      {selection:'Under',line,decimalOdds:1.92,noVigShare:.49}]:
    market==='spreads'?
      [{selection:'Home',line:-2.5,decimalOdds:1.8,noVigShare:.54},
        {selection:'Away',line:2.5,decimalOdds:2,noVigShare:.46}]:
      [{selection:'Home',line:null,decimalOdds:1.4,noVigShare:.7},
        {selection:'Away',line:null,decimalOdds:3.2,noVigShare:.3}],
  bookmakerOverround:.05,quoteUpdatedAt:'2026-11-06T20:00:00Z',
  source:'The Odds API',assessment:'quote-only-research-pending',
})
const evidence=(home=111,away=96,games=10)=>({
  sport:'basketball',league:'nba',eventId:'912',checkedAt:'2026-11-06T20:05:00Z',
  home:{name:'Home',form:{games,scoredPerGame:home,allowedPerGame:100},
    lastGames:Array.from({length:games},(_,i)=>({scored:home+i%2,allowed:100}))},
  away:{name:'Away',form:{games,scoredPerGame:away,allowedPerGame:105},
    lastGames:Array.from({length:games},(_,i)=>({scored:away+i%2,allowed:105}))},
  coverage:[{source:'ESPN: cartelera',status:'verified',records:1},
    {source:'historial',status:'verified',records:10},
    {source:'lesiones',status:'unavailable',records:0}],
  rosterNewsInjuries:{injuries:[{athlete:'Player',status:'questionable'}],headlines:[{headline:'Update'}]},
  headToHead:[{eventId:'1'},{eventId:'2'}],
})
test('research can choose real UNDER despite bookmaker higher-priced OVER favorite',()=>{
  const review=assessDailyMarketEvidence(market(),evidence())
  assert.equal(review.status,'descriptive-support')
  assert.equal(review.selectedOutcome.selection,'Under')
  assert.equal(review.selectedOutcome.decimalOdds,1.92)
  assert.ok(review.projectedTotal<235.5)
  assert.equal(review.sampleGames.home,10)
  assert.equal(review.sampleGames.away,10)
  assert.equal(review.verifiedSources,2)
  assert.equal(review.injuries,1)
  assert.ok(review.warnings.some(x=>x.includes('dirección')))
  assert.match(review.warnings.join(' '),/no demuestra probabilidades/)
})
test('NBA spread can be contradicted by recent points with no invented EV',()=>{
  const review=assessDailyMarketEvidence(market('spreads','Home',-2.5),evidence(96,120))
  assert.equal(review.status,'descriptive-support')
  assert.equal(review.selectedOutcome.selection,'Away')
  assert.equal(review.selectedOutcome.line,2.5)
  assert.ok(review.scoreDifference<0)
  assert.ok(!('expectedValue' in review))
})
test('moneyline is not confused with odds-implied selection',()=>{
  const review=assessDailyMarketEvidence(market('h2h','Home',null),evidence(90,120))
  assert.equal(review.selectedOutcome.selection,'Away')
  assert.equal(review.status,'descriptive-support')
})
test('short histories produce uncertainty rather than an artificial pick',()=>{
  const review=assessDailyMarketEvidence(market(),evidence(111,96,2))
  assert.equal(review.status,'unavailable')
  assert.equal(review.selectedOutcome,null)
  assert.match(review.warnings.join(' '),/Historial insuficiente/)
})
test('wrong fixture cannot reuse another game evidence',()=>{
  assert.throws(()=>assessDailyMarketEvidence(market(),{...evidence(),eventId:'991'}),/no corresponde/)
})
test('independent provider outage does not become a favorite',()=>{
  const review=unavailableMarketEvidence(market(),'HTTP 503')
  assert.equal(review.status,'unavailable')
  assert.equal(review.selectedOutcome,null)
  assert.match(review.warnings.join(' '),/HTTP 503/)
})
