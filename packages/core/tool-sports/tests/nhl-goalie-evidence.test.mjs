import {test} from 'node:test'
import assert from 'node:assert/strict'
import {nhlGoalieEvidence} from '../src/nhl-goalie-evidence.ts'
const goalie={
  id:'8471111',idProvider:'NHL',team:'VGK',name:'Sample Goalie',
  role:'goalie',starterConfirmed:false,
  stats:{savePctg:'0.910'},last5:[],
  last20:[
    {eventId:'1',date:'2026-11-09',venue:'away',
      stats:{shotsAgainst:40,saves:36},summary:'36/40'},
    {eventId:'2',date:'2026-11-08',venue:'home',
      stats:{shotsAgainst:30,saves:27},summary:'27/30'},
    {eventId:'3',date:'2026-11-06',venue:'home',
      stats:{shotsAgainst:24,saves:26},summary:'invalid'},
    {eventId:'4',date:'2026-11-18',venue:'home',
      stats:{shotsAgainst:10,saves:10},summary:'future'},
  ],
}
test('shot-weighted goalie form excludes future and impossible appearances',()=>{
  const g=nhlGoalieEvidence([goalie],'2026-11-15T23:00:00Z')[0]
  assert.equal(g.recentGames,3)
  assert.equal(g.shotsAgainst,70)
  assert.equal(g.saves,63)
  assert.equal(g.recentSavePct,0.9)
  assert.equal(g.seasonSavePct,0.91)
  assert.equal(g.confirmedStarter,false)
  assert.equal(g.lastAppearance,'2026-11-09')
  assert.equal(g.source,'NHL game-log')
})
test('ESPN-roster-only goalie remains unknown, never a confirmed starter',()=>{
  const p={...goalie,idProvider:'ESPN',last20:undefined,stats:{}}
  const g=nhlGoalieEvidence([p],'2026-11-15T23:00:00Z')[0]
  assert.equal(g.source,'unavailable')
  assert.equal(g.recentSavePct,null)
  assert.equal(g.confirmedStarter,false)
})
