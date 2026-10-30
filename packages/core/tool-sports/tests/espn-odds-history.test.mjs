import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fetchEspnHistoricalOdds} from '../src/espn-odds-history.ts'
import {espnCoreUrl} from '../src/espn-core-intelligence.ts'
import {espnEndpointGuide,espnWorkflow} from '../src/espn-endpoint-guide.ts'
import {normalizeEspnMarkets} from '../src/espn-odds.ts'

const now=Date.parse('2026-10-29T23:00:00Z')
const date='2025-10-29T22:00:00Z'
const fixture={
 id:'401809303',date,competitions:[{id:'401809303',competitors:[
  {homeAway:'home',team:{displayName:'Blue Jays'}},
  {homeAway:'away',team:{displayName:'Dodgers'}},
 ]}],
}
const quote={
 provider:{id:'58',name:'ESPN BET'},details:'LAD -126',
 awayTeamOdds:{moneyline:-126},
 homeTeamOdds:{moneyLine:{american:'+116'}},
 overUnder:8.5,overOdds:110,underOdds:-130,
}
const event=(odds=[])=>({...fixture,competitions:[{...fixture.competitions[0],odds}]})
const link='https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/401809303/competitions/401809303/odds/58'

test('historical normalization retains past fixture while active normalization still excludes it',()=>{
 assert.equal(normalizeEspnMarkets(event([quote]),[quote]).length,0)
 const historical=normalizeEspnMarkets(event([quote]),[quote],{historical:true})
 assert.equal(historical.length,4)
 assert.equal(historical[0].bookmaker,'ESPN BET')
 assert.equal(historical[0].price,2.16)
 assert.equal(historical[1].price,1.79365)
 assert.equal(historical.filter(x=>x.market==='totals').length,2)
})
test('date-scoped scoreboard/Core history is historical even without updatedAt',async()=>{
 const requested=[]
 const read=async url=>{
  requested.push(url)
  if(url.includes('/scoreboard?dates=20251029'))return {events:[event()]}
  if(url.endsWith('/odds?limit=25'))return {count:1,items:[quote]}
  throw Error('Unexpected URL '+url)
 }
 const r=await fetchEspnHistoricalOdds({sport:'baseball',league:'mlb',date:'2025-10-29'},read,now)
 assert.equal(r.eventCount,1)
 assert.equal(r.eventsWithPrices,1)
 assert.equal(r.rows.length,4)
 assert.equal(r.rawEntries,1)
 assert.equal(r.daysScanned,1)
 assert.ok(r.rows.every(x=>x.historical&&x.priceStatus==='historical_unverified'))
 assert.ok(r.rows.every(x=>!x.quoteTimestampKnown))
 assert.deepEqual(requested.map(x=>new URL(x).hostname),
  ['site.api.espn.com','sports.core.api.espn.com'])
 assert.match(r.warning,/NO son cuotas vigentes/)
})
test('follows at most two same-event ESPN refs and never external/cross-event refs',async()=>{
 const requests=[]
 const read=async url=>{
  requests.push(url)
  if(url.includes('/scoreboard?'))return {events:[event()]}
  if(url.endsWith('/odds?limit=25'))return {items:[
    {$ref:'https://evil.example/odds/90'},
    {$ref:link.replace('/events/401809303/','/events/99999/')},
    {$ref:link.replace('espn.com','espn.pvt')},
    {$ref:link},
  ]}
  if(url.endsWith('/odds/58'))return quote
  throw Error('Unexpected URL '+url)
 }
 const r=await fetchEspnHistoricalOdds({sport:'baseball',league:'mlb',date:'2025-10-29'},read,now)
 assert.equal(r.rows.length,4)
 assert.equal(r.refsResolved,1)
 assert.equal(requests.length,3)
 assert.equal(requests.some(x=>x.includes('evil.example')||x.includes('espn.pvt')),false)
})
test('summary recovers past odds after Core 404 and reports partial error',async()=>{
 const read=async url=>{
  if(url.includes('/scoreboard?'))return {events:[event()]}
  if(url.includes('/odds?'))throw Error('Proveedor HTTP 404')
  if(url.includes('/summary?'))return {pickcenter:[quote]}
  throw Error('unrecognized URL')
 }
 const r=await fetchEspnHistoricalOdds({sport:'baseball',league:'mlb',date:'2025-10-29'},read,now)
 assert.equal(r.rows.length,4)
 assert.equal(r.rows[0].source,'ESPN Summary')
 assert.ok(r.errors.some(x=>x.includes('404')))
})
test('date and limits validate, no arbitrary URL and no future historical games',async()=>{
 const read=async()=>({events:[]})
 for(const value of ['2025-02-29','../evil','2029-10-29']){
  await assert.rejects(()=>fetchEspnHistoricalOdds({
   sport:'baseball',league:'mlb',date:value,
  },read,now),/inválida/)
 }
 await assert.rejects(()=>fetchEspnHistoricalOdds({
  sport:'../x',league:'mlb',date:'2025-10-29',
 },read,now),/inválida/)
 const d=await fetchEspnHistoricalOdds({
  sport:'baseball',league:'mlb',date:'2026-10-29',days:99,eventsPerDay:999,
 },read,now)
 assert.equal(d.daysScanned,1)
 assert.equal(d.eventCount,0)
})
test('movement indices 0/1 and paths are validated without hardcoded sportsbook names',()=>{
 const opts={sport:'football',league:'nfl',mode:'movement',eventId:'401220181',
  competitionId:'401220181',providerId:'58'}
 assert.match(espnCoreUrl({...opts,movementType:0}),/\/history\/0\/movement\?/)
 assert.match(espnCoreUrl({...opts,movementType:1}),/\/history\/1\/movement\?/)
 assert.throws(()=>espnCoreUrl({...opts,movementType:2}),/inválido/)
 assert.equal(espnEndpointGuide.length,14)
 assert.ok(espnEndpointGuide.some(x=>x.id==='past_performances'))
 assert.ok(espnEndpointGuide.some(x=>x.id==='scoreboard'))
 assert.ok(espnWorkflow.historical.some(x=>x.includes('sports_chat_espn_historical_odds')))
})
