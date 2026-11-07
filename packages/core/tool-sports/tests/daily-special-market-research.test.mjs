import {test} from 'node:test'
import assert from 'node:assert/strict'
import {researchDailySpecialMarkets} from '../src/daily-special-market-research.ts'

const now=Date.parse('2026-11-06T17:00:00Z')
const first={
  sport:'basketball',league:'nba',espnEventId:'1234',
  bookmakerEventId:'abcd0123456789ef',bookmaker:'Book A',
  source:'The Odds API',fixture:'Away vs Home',kickoff:'2026-11-07T00:00:00Z',
  market:'totals',selection:'Over',line:226.5,decimalOdds:1.9,
  marketNoVigShare:.5,bookmakerOverround:.052,
  quoteUpdatedAt:'2026-11-06T16:55:00Z',assessment:'quote-only-research-pending',
  outcomes:[],
}
const mock=(book='Book A')=>async(url)=>{
  const u=new URL(url),id=u.pathname.split('/events/')[1].split('/')[0]
  const base={id,sport_key:'basketball_nba',
    commence_time:'2026-11-07T00:00:00Z'}
  if(u.pathname.endsWith('/markets'))return new Response(JSON.stringify({
    ...base,bookmakers:[{key:'booka',markets:[{
      key:'player_points',last_update:'2026-11-06T16:56:00Z',
    }]}],
  }))
  return new Response(JSON.stringify({
    ...base,bookmakers:[{key:'booka',title:book,
      markets:[{key:'player_points',last_update:'2026-11-06T16:57:00Z',
        outcomes:[
          {name:'Over',description:'Player Alpha',point:19.5,price:1.9},
          {name:'Under',description:'Player Alpha',point:19.5,price:1.9},
          {name:'Over',description:'Player Beta',point:16.5,price:1.8},
        ]}]}],
  }))
}
test('automatically discovers dated real player props without labeling them as winning picks',async()=>{
  let calls=0
  const fetcher=async url=>{calls++;return mock()(url)}
  const result=await researchDailySpecialMarkets([first],{
    THE_ODDS_API_KEY:'secret-not-in-output'},fetcher,now,5)
  assert.equal(result.status,'observed')
  assert.equal(result.eventsChecked,1)
  assert.equal(calls,2)
  assert.equal(result.observations[0].status,'observed')
  assert.equal(result.observations[0].offers.length,3)
  assert.equal(result.observations[0].offers[0].participant,'Player Alpha')
  assert.equal(result.observations[0].offers[0].estimatedProbability,null)
  assert.equal(result.observations[0].offers[0].eligibleForTicket,false)
  assert.ok(!JSON.stringify(result).includes('secret-not-in-output'))
})
test('quotes of a different bookmaker never become picks for this ticket',async()=>{
  const result=await researchDailySpecialMarkets([first],{
    THE_ODDS_API_KEY:'secret'},mock('Other Book'),now)
  assert.equal(result.observations[0].status,'empty')
  assert.equal(result.observations[0].offers.length,0)
  assert.match(result.observations[0].warnings.join(' '),/casa exacta/)
})
test('missing key and mismatched odds source do not invent offered special markets',async()=>{
  let called=false
  const fn=async()=>{called=true;throw Error('unexpected request')}
  const missing=await researchDailySpecialMarkets([first],{},fn,now)
  assert.equal(missing.status,'unconfigured')
  assert.equal(missing.eventsChecked,0)
  const other=await researchDailySpecialMarkets([{...first,source:'ESPN'}],
    {THE_ODDS_API_KEY:'test'},fn,now)
  assert.equal(other.status,'empty')
  assert.equal(other.eventsChecked,0)
  assert.equal(called,false)
})
test('keeps one event even if several core markets were observed',async()=>{
  const result=await researchDailySpecialMarkets([first,
    {...first,market:'spreads',selection:'Home'}],
  {THE_ODDS_API_KEY:'test'},mock(),now)
  assert.equal(result.eventsChecked,1)
})
test('invalid event menu is visible and never exports special-market quotes',async()=>{
  const bad=async()=>new Response(JSON.stringify({
    id:'wrong',sport_key:'basketball_nba',commence_time:'2026-11-07T00:00:00Z',
    bookmakers:[],
  }))
  const result=await researchDailySpecialMarkets([first],
    {THE_ODDS_API_KEY:'test'},bad,now)
  assert.equal(result.observations[0].status,'error')
  assert.equal(result.observations[0].offers.length,0)
})

test('provider failure is visible at the aggregate level and does not fabricate offers',async()=>{
  const unavailable=async()=>{throw Error('network down')}
  const result=await researchDailySpecialMarkets([first],
    {THE_ODDS_API_KEY:'test'},unavailable,now)
  assert.equal(result.status,'error')
  assert.equal(result.eventsChecked,1)
  assert.equal(result.observations[0].status,'error')
  assert.deepEqual(result.observations[0].offers,[])
  assert.ok(!JSON.stringify(result).includes('network down'))
})
