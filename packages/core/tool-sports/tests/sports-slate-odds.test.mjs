import {test} from 'node:test'
import assert from 'node:assert/strict'
import {espnSlateMarketPreview} from '../src/sports-slate-odds.ts'
const now=Date.parse('2026-10-30T18:00:00Z')
const event={id:'401900001',date:'2026-10-30T23:00:00Z',competitions:[{
  competitors:[{homeAway:'home',team:{displayName:'Boston Celtics'}},
    {homeAway:'away',team:{displayName:'Chicago Bulls'}}],
  odds:[{provider:{name:'DraftKings'},homeTeamOdds:{moneyLine:'-145'},
    awayTeamOdds:{moneyLine:'+125'},overUnder:223.5,overOdds:'-110',underOdds:'-110'}],
}]}
test('same-book ESPN undated odds render as REFERENCES with market favorite, not valid wager',()=>{
  const preview=espnSlateMarketPreview(event,now)
  assert.equal(preview?.bookmaker,'DraftKings')
  assert.equal(preview?.status,'sin_fecha')
  assert.equal(preview?.updatedAt,undefined)
  assert.equal(preview?.favorite,'Boston Celtics')
  assert.deepEqual(preview?.prices.slice(0,2).map(x=>x.market),['h2h','h2h'])
  assert.deepEqual(preview?.prices.slice(0,2).map(x=>x.price),['1.69','2.25'])
  assert.equal(preview?.prices.filter(x=>x.market==='totals').length,2)
})
test('no fabricated market favorite from one side, a started event, or cross-book prices',()=>{
  assert.equal(espnSlateMarketPreview({...event,date:'2026-10-30T17:00:00Z'},now),null)
  assert.equal(espnSlateMarketPreview({...event,competitions:[{...event.competitions[0],
    odds:[{provider:{name:'Book A'},homeTeamOdds:{moneyLine:'-115'}},
      {provider:{name:'Book B'},awayTeamOdds:{moneyLine:'+125'}}]}]},now),null)
  assert.equal(espnSlateMarketPreview({...event,competitions:[{...event.competitions[0],odds:[
    {provider:{name:'Book A'},homeTeamOdds:{moneyLine:'-110'},awayTeamOdds:{moneyLine:'-110'}},
  ]}]},now)?.favorite,undefined)
})
test('source timestamp differentiates recent observation from expired and missing updates',()=>{
  const withTime={...event,competitions:[{...event.competitions[0],odds:[{
    ...event.competitions[0].odds[0],lastUpdated:'2026-10-30T17:30:00Z',
  }]}]}
  assert.equal(espnSlateMarketPreview(withTime,now)?.status,'observada')
  assert.equal(espnSlateMarketPreview({...event,competitions:[{...event.competitions[0],
    odds:[{...event.competitions[0].odds[0],lastUpdated:'2026-10-27T17:00:00Z'}],
  }]},now)?.status,'antigua')
  assert.equal(espnSlateMarketPreview(withTime,now)?.updatedAt,'2026-10-30T17:30:00.000Z')
})

test('a complete total market can be displayed without a fabricated moneyline favorite',()=>{
  const onlyTotals={...event,competitions:[{...event.competitions[0],odds:[
    {provider:{name:'Caesars'},overUnder:222.5,overOdds:'-105',underOdds:'-110'},
  ]}]}
  const preview=espnSlateMarketPreview(onlyTotals,now)
  assert.equal(preview?.bookmaker,'Caesars')
  assert.equal(preview?.favorite,undefined)
  assert.equal(preview?.prices.length,2)
  assert.ok(preview?.prices.every(q=>q.market==='totals'&&q.point==='222.5'))
})
