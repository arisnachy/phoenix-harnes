import {test} from 'node:test'
import assert from 'node:assert/strict'
import {diagnoseMarketOutcome} from '../src/market-outcome-diagnostics.ts'
const history=(n,forGoals,againstGoals)=>Array.from({length:n},()=>
  ({scored:forGoals,allowed:againstGoals}))
const base={homeName:'Home',awayName:'Away'}
test('NBA total with broad team and rival support counts Over at the exact line',()=>{
  const r=diagnoseMarketOutcome({...base,market:'totals',
    outcome:{selection:'Over',line:223.5,decimalOdds:1.77,noVigShare:.51},
    homeGames:history(10,120,118),awayGames:history(10,117,112)})
  assert.equal(r.status,'aligned')
  assert.equal(r.team.wins,10)
  assert.equal(r.opponent.wins,10)
  assert.equal(r.modelCalibrated,false)
  assert.equal(r.eligibleForEV,false)
})
test('a misleading average total is downgraded when the two teams disagree',()=>{
  // Home games 260 points; away games 190. Means can create an apparent
  // UNDER projection around 225 but do not justify calling UNDER reliable.
  const r=diagnoseMarketOutcome({...base,market:'totals',
    outcome:{selection:'Under',line:235.5,decimalOdds:1.9,noVigShare:.5},
    homeGames:history(10,130,130),awayGames:history(10,95,95)})
  assert.equal(r.status,'mixed')
  assert.equal(r.team.rate,0)
  assert.equal(r.opponent.rate,1)
})
test('NHL away +1.5 grades each team from the correct opposite perspective',()=>{
  const r=diagnoseMarketOutcome({...base,market:'spreads',
    outcome:{selection:'Away',line:1.5,decimalOdds:1.41,noVigShare:.7},
    homeGames:history(10,4,2),awayGames:history(10,2,4)})
  assert.equal(r.status,'adverse')
  assert.equal(r.team.losses,10)
  assert.equal(r.opponent.losses,10)
})
test('integer totals and spreads count pushes separately rather than losses',()=>{
  const a=diagnoseMarketOutcome({...base,market:'totals',
    outcome:{selection:'Over',line:5,decimalOdds:1.95,noVigShare:.5},
    homeGames:history(10,3,2),awayGames:history(10,4,1)})
  assert.equal(a.status,'insufficient')
  assert.equal(a.team.pushes,10)
  assert.equal(a.opponent.pushes,10)
  const b=diagnoseMarketOutcome({...base,market:'spreads',
    outcome:{selection:'Home',line:-1,decimalOdds:1.9,noVigShare:.5},
    homeGames:history(10,3,2),awayGames:history(10,2,3)})
  assert.equal(b.team.pushes,10)
  assert.equal(b.opponent.pushes,10)
})
test('unknown teams, incomplete games and moneyline do not fabricate market estimates',()=>{
  const games=[{scored:NaN,allowed:3},...history(3,5,2)]
  const data={...base,market:'spreads',
    outcome:{selection:'Unknown',line:1.5,decimalOdds:1.8,noVigShare:.5},
    homeGames:games,awayGames:games}
  assert.equal(diagnoseMarketOutcome(data),null)
  assert.equal(diagnoseMarketOutcome({...data,market:'h2h'}),null)
  assert.equal(diagnoseMarketOutcome({...data,market:'spreads',
    outcome:{...data.outcome,selection:'Home'}}).status,'insufficient')
})
