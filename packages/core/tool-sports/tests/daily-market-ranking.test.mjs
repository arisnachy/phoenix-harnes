import {test} from 'node:test'
import assert from 'node:assert/strict'
import {assessDailyMarketEvidence} from '../src/daily-market-evidence.ts'

const book=(line)=>({
 sport:'basketball',league:'nba',espnEventId:'912',
 bookmakerEventId:'book-912',fixture:'Away vs Home',
 kickoff:'2026-11-07T01:00:00Z',bookmaker:'Book',
 market:'totals',selection:'Over',line,decimalOdds:1.9,
 marketNoVigShare:.5,
 outcomes:[{selection:'Over',line,decimalOdds:1.9,noVigShare:.5},
  {selection:'Under',line,decimalOdds:1.9,noVigShare:.5}],
 bookmakerOverround:.053,quoteUpdatedAt:'2026-11-06T20:00:00Z',
 source:'The Odds API',assessment:'quote-only-research-pending',
})
const evidence=(games)=>({
 sport:'basketball',league:'nba',eventId:'912',checkedAt:'2026-11-06T20:05:00Z',
 home:{name:'Home',form:{games,scoredPerGame:111,allowedPerGame:100},
  lastGames:Array.from({length:games},(_,i)=>({scored:111+i%2,allowed:100}))},
 away:{name:'Away',form:{games,scoredPerGame:96,allowedPerGame:105},
  lastGames:Array.from({length:games},(_,i)=>({scored:96+i%2,allowed:105}))},
 coverage:[{source:'ESPN',status:'verified',records:1}],
 rosterNewsInjuries:{injuries:[],headlines:[]},headToHead:[],
})
test('rank larger independently observed total gap above marginal alternative',()=>{
 const data=evidence(10)
 const wide=assessDailyMarketEvidence(book(245.5),data)
 const narrow=assessDailyMarketEvidence(book(225.5),data)
 assert.equal(wide.status,'descriptive-support')
 assert.equal(narrow.status,'descriptive-support')
 assert.equal(wide.selectedOutcome.selection,'Under')
 assert.ok(wide.descriptiveLineDistance>narrow.descriptiveLineDistance)
 assert.ok(wide.relativeSignal>narrow.relativeSignal)
 assert.ok(wide.rankingScore>narrow.rankingScore)
})
test('two games yield a discounted conditional ranking; one cannot fabricate direction',()=>{
 const x=assessDailyMarketEvidence(book(245.5),evidence(2))
 const full=assessDailyMarketEvidence(book(245.5),evidence(10))
 assert.equal(x.status,'uncertain')
 assert.ok(x.relativeSignal!==null)
 assert.ok(x.descriptiveLineDistance!==null)
 assert.ok(x.rankingScore>0&&x.rankingScore<full.rankingScore)
 const one=assessDailyMarketEvidence(book(245.5),evidence(1))
 assert.equal(one.status,'unavailable')
 assert.equal(one.relativeSignal,null)
 assert.equal(one.descriptiveLineDistance,null)
 assert.equal(one.rankingScore,0)
})
