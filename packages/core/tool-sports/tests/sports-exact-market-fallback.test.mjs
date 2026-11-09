import {test} from 'node:test'
import assert from 'node:assert/strict'
import {exactAlternativeOdds,exactProviderQuote} from '../src/sports-exact-market-fallback.ts'
const now=Date.parse('2026-11-09T16:00:00Z')
const future='2026-11-09T23:00:00Z'
const match={home:'Boston Celtics',away:'Milwaukee Bucks',kickoff:future}
const valid={eventId:'provider-not-espn-222',bookmaker:'Book A',market:'h2h',
  selection:'Boston Celtics',price:1.82,home:match.home,away:match.away,
  time:future,timeIso:future,updatedAt:'2026-11-09T15:40:00Z',source:'The Odds API'}
test('accepted only for same home away, UTC, bookmaker, timestamp and market',()=>{
  assert.equal(exactProviderQuote(valid,match,'h2h','basketball_nba',now),true)
  assert.equal(exactProviderQuote({...valid,home:'Milwaukee Bucks',away:'Boston Celtics'},match,'h2h','basketball_nba',now),false)
  assert.equal(exactProviderQuote({...valid,away:'Atlanta Hawks'},match,'h2h','basketball_nba',now),false)
  assert.equal(exactProviderQuote({...valid,time:'2026-11-10T01:00:00Z',
    timeIso:'2026-11-10T01:00:00Z'},match,'h2h','basketball_nba',now),false)
  assert.equal(exactProviderQuote({...valid,updatedAt:'2026-11-08T04:00:00Z'},match,'h2h','basketball_nba',now),false)
  assert.equal(exactProviderQuote({...valid,bookmaker:''},match,'h2h','basketball_nba',now),false)
  assert.equal(exactProviderQuote({...valid,source:'ESPN Core'},match,'h2h','basketball_nba',now),false)
  assert.equal(exactProviderQuote({...valid,market:'totals'},match,'h2h','basketball_nba',now),false)
  assert.equal(exactProviderQuote({...valid,price:1},match,'h2h','basketball_nba',now),false)
})
test('never maps soccer 1X2 to a two-way drawless moneyline',()=>{
  assert.equal(exactProviderQuote({...valid,market:'h2h'},match,'h2h','soccer_epl',now),true)
  // A single qualified leg is only preliminary; exactAlternativeOdds
  // additionally requires HOME + DRAW + AWAY from one book/event.
  assert.equal(exactProviderQuote({...valid,market:'1x2',selection:'Draw'},match,'h2h','soccer_epl',now),true)
})
test('queries exact ESPN fixture then matches a distinct provider ID without inventing a quote',async()=>{
  const calls=[]
  const fetcher=async url=>{
    const u=String(url);calls.push(u)
    if(u.includes('api.the-odds-api.com'))return Response.json([{
      id:'external-777',home_team:'Boston Celtics',away_team:'Milwaukee Bucks',
      commence_time:future,
      bookmakers:[{key:'booka',title:'Book A',last_update:'2026-11-09T15:40:00Z',
        markets:[{key:'h2h',outcomes:[
          {name:'Boston Celtics',price:1.82},
          {name:'Milwaukee Bucks',price:2.11},
        ]}]}],
    }])
    if(u.includes('site.api.espn.com')&&u.includes('scoreboard?dates=20261109'))return Response.json({
      events:[{id:'111',date:future,status:{type:{state:'pre'}},
        competitions:[{competitors:[
          {homeAway:'home',team:{displayName:'Boston Celtics'}},
          {homeAway:'away',team:{displayName:'Milwaukee Bucks'}},
        ]}]}],
    })
    return Response.json({events:[]})
  }
  const report=await exactAlternativeOdds('basketball_nba','111','2026-11-09','h2h',
    {THE_ODDS_API_KEY:'redacted-placeholder'},fetcher,now)
  assert.equal(report.status,'matched')
  assert.equal(report.quotes.length,2)
  assert.equal(report.espnEventId,'111')
  assert.ok(report.quotes.every(q=>q.eventId==='external-777'))
  assert.ok(report.quotes.every(q=>q.bookmaker==='Book A'))
  assert.ok(calls.some(x=>x.includes('api.the-odds-api.com')))
})
test('wrong ESPN ID or score already started means no alternative quote can be promoted',async()=>{
  let externalCalls=0
  const fetcher=async url=>{
    const u=String(url)
    if(u.includes('api.the-odds-api.com'))externalCalls++
    if(u.includes('scoreboard?dates='))return Response.json({events:[{
      id:'222',date:future,status:{type:{state:'pre'}},competitions:[{competitors:[]}],
    }]})
    return Response.json({events:[]})
  }
  const r=await exactAlternativeOdds('basketball_nba','111','2026-11-09',
    'h2h',{THE_ODDS_API_KEY:'redacted'},fetcher,now)
  assert.equal(r.status,'fixture-unverified')
  assert.equal(externalCalls,0)
  assert.equal(r.quotes.length,0)
})
