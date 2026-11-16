import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseNhl5v5Game,aggregateNhl5v5} from '../src/nhl-five-on-five.ts'
const cutoff='2026-11-17T01:30:00Z'
const g='2026020201'
const play=(type,owner,code='1551',period='REG')=>({
  typeDescKey:type,situationCode:code,
  periodDescriptor:{periodType:period,number:1},
  details:{eventOwnerTeamId:owner},
})
const packet=(updates={})=>({
  id:Number(g),gameState:'OFF',startTimeUTC:'2026-11-14T23:00:00Z',
  homeTeam:{id:10},awayTeam:{id:20},
  plays:[...Array.from({length:110},()=>play('faceoff',10)),
    ...Array.from({length:8},()=>play('shot-on-goal',10)),
    ...Array.from({length:6},()=>play('missed-shot',20)),
    ...Array.from({length:4},()=>play('shot-on-goal',20)),
    play('goal',10),play('goal',20),
    play('blocked-shot',20), // defender owns blocked shot, intentionally excluded
    play('shot-on-goal',10,'1541'), // 5-on-4 must NOT count
    play('goal',10,'1551','OT'), // overtime not 5v5 regulation sample
    play('goal',999), // foreign event owner
  ],...updates,
})
test('NHL only counts unblocked REG 1551 attempts, by shooting team ID',()=>{
  const x=parseNhl5v5Game(packet(),g,cutoff)
  assert.equal(x.usable,true)
  assert.equal(x.home.fenwick,9)
  assert.equal(x.home.shots,9)
  assert.equal(x.home.goals,1)
  assert.equal(x.away.fenwick,11)
  assert.equal(x.away.shots,5)
  assert.equal(x.away.goals,1)
  const summary=aggregateNhl5v5({home:{teamId:'10',gameIds:[g]},
    away:{teamId:'20',gameIds:[g]},games:[x]})
  assert.equal(summary.requested,1)
  assert.equal(summary.verified,1)
  assert.equal(summary.home.fenwickPct,45)
  assert.equal(summary.away.fenwickPct,55)
  assert.equal(summary.home.goalsAgainst,1)
  assert.match(summary.label,/NOT expected goals/)
})
test('reject score and game ID mismatch, live games, and game after cutoff',()=>{
  for(const snapshot of [
    packet({id:2026020999}),
    packet({gameState:'LIVE'}),
    packet({startTimeUTC:'2026-11-18T00:00:00Z'}),
    packet({plays:[]}),
  ]){
    assert.equal(parseNhl5v5Game(snapshot,g,cutoff).usable,false)
  }
})
test('unavailable game never fabricates a zero-percentage Fenwick sample',()=>{
  const invalid=parseNhl5v5Game(null,g,cutoff)
  const x=aggregateNhl5v5({home:{teamId:'10',gameIds:[g]},
    away:{teamId:'20',gameIds:[g]},games:[invalid]})
  assert.equal(x.verified,0)
  assert.equal(x.home.games,0)
  assert.equal(x.home.fenwickPct,null)
  assert.deepEqual(x.missingGameIds,[g])
})
