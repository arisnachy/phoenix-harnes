import {test} from 'node:test'
import assert from 'node:assert/strict'
import {compareBettingMarkets,supportedMarketFamilies} from '../src/sports-market-intelligence.ts'
const now=Date.parse('2026-10-29T14:00:00Z')
const base={eventId:'800',bookmaker:'Book A',market:'totals',sportKey:'basketball_nba',
  home:'Home',away:'Away',time:'2026-10-29T23:00:00Z',timeIso:'2026-10-29T23:00:00Z',
  updatedAt:'2026-10-29T13:55:00Z',source:'The Odds API'}
test('separates bookmaker implied price from model prediction and removes vig only for complete outcomes',()=>{
  const market=[
    {...base,selection:'Over',point:219.5,price:1.90},
    {...base,selection:'Under',point:219.5,price:1.95},
  ]
  const result=compareBettingMarkets(market,now)
  assert.equal(result.markets.length,1)
  assert.equal(result.markets[0].observation,'market-pricing-only')
  assert.equal(result.markets[0].selections[0].impliedFromQuote,0.52632)
  assert.equal(result.markets[0].selections.reduce((a,b)=>a+b.noVigShare,0).toFixed(2),'1.00')
  assert.match(result.warning,/no estimación independiente/)
})
test('never normalizes overlapping double chance or incomplete three-way markets',()=>{
  const dc=['1X','X2'].map((selection,i)=>({...base,market:'double_chance',point:null,
    selection,price:1.35+i*.15}))
  const oneXTwo=[{...base,market:'1x2',selection:'Local',price:2.5,point:null},
    {...base,market:'1x2',selection:'Visita',price:2.8,point:null}]
  const x=compareBettingMarkets([...dc,...oneXTwo],now)
  assert.equal(x.markets.length,1)
  assert.equal(x.markets[0].selections[0].noVigShare,null)
})
test('does not compare stale, started, missing source or nonsensical priced markets',()=>{
  const rows=[
    {...base,selection:'Over',point:219.5,price:1.7,updatedAt:'2026-10-27T18:00:00Z'},
    {...base,selection:'Under',point:219.5,price:1.9,timeIso:'2026-10-29T12:00:00Z'},
    {...base,selection:'Under',point:219.5,price:0.2},
    {...base,selection:'Under',point:219.5,price:1.9,source:''},
  ]
  const result=compareBettingMarkets(rows,now)
  assert.equal(result.markets.length,0)
  assert.equal(result.rejected,4)
  assert.ok(supportedMarketFamilies.some(s=>s.sport==='NHL'))
})

test('pairs opposite spread handicaps without combining unrelated lines',()=>{
  const offers=[
    {...base,market:'spreads',selection:'Home',point:-5.5,price:1.91},
    {...base,market:'spreads',selection:'Away',point:5.5,price:1.93},
    {...base,market:'spreads',selection:'Home',point:-7.5,price:2.10},
  ]
  const result=compareBettingMarkets(offers,now)
  assert.equal(result.markets.length,1)
  assert.equal(result.markets[0].selections.length,2)
  assert.deepEqual(result.markets[0].selections.map(x=>x.point),[-5.5,5.5])
  assert.ok(result.markets[0].selections.every(x=>x.noVigShare!==null))
})
test('does not remove vig from a partial soccer three-way or two same-side totals',()=>{
  const soccer={...base,sportKey:'soccer_usa_mls',market:'h2h',point:null}
  const missingDraw=compareBettingMarkets([
    {...soccer,selection:'Home',price:2.2},
    {...soccer,selection:'Away',price:3.1},
  ],now)
  assert.equal(missingDraw.markets.length,0)
  const duplicateTotals=compareBettingMarkets([
    {...base,selection:'Over',point:220.5,price:1.8},
    {...base,selection:'Over 220.5',point:220.5,price:1.9},
  ],now)
  assert.equal(duplicateTotals.markets.length,1)
  assert.equal(duplicateTotals.markets[0].totalBookOverround,null)
})

test('never derive no-vig percentages from separated quotes or mixed providers',()=>{
  const old={...base,market:'h2h',selection:'Home',point:null,price:2.03,
    updatedAt:'2026-10-29T13:01:00Z'}
  const recent={...base,market:'h2h',selection:'Away',point:null,price:1.85,
    updatedAt:'2026-10-29T13:55:00Z'}
  const stalePair=compareBettingMarkets([old,recent],now)
  assert.equal(stalePair.markets.length,0)
  const mixedBookmaker=compareBettingMarkets([
    {...old,updatedAt:'2026-10-29T13:54:00Z'},
    {...recent,bookmaker:'Different Sportsbook'},
  ],now)
  assert.equal(mixedBookmaker.markets.length,0)
  const coherent=compareBettingMarkets([
    {...old,updatedAt:'2026-10-29T13:54:00Z'},recent
  ],now)
  assert.equal(coherent.markets.length,1)
  assert.equal(coherent.markets[0].selections.length,2)
  assert.ok(coherent.markets[0].selections.every(q=>q.noVigShare!==null))
})


test('ESPN fresh observation is accepted without bookmaker updatedAt',()=>{
  const espn={...base,source:'ESPN Site/Core',market:'h2h',point:null,
    updatedAt:'',observedAt:'2026-10-29T13:59:00Z'}
  const data=compareBettingMarkets([
    {...espn,selection:'Home',price:1.65},
    {...espn,selection:'Away',price:2.3},
  ],now)
  assert.equal(data.markets.length,1)
  assert.equal(data.markets[0].freshnessMinutes,1)
  assert.equal(data.rejected,0)
  assert.ok(data.markets[0].selections.every(x=>x.noVigShare!==null))
  const old=compareBettingMarkets([
    {...espn,observedAt:'2026-10-28T10:00:00Z',selection:'Home',price:1.65},
    {...espn,observedAt:'2026-10-28T10:00:00Z',selection:'Away',price:2.3},
  ],now)
  assert.equal(old.markets.length,0)
  assert.equal(old.rejected,2)
})
