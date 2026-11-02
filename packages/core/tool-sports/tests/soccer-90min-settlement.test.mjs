import {test} from 'node:test'
import assert from 'node:assert/strict'
import {settleSoccer90} from '../src/soccer-90min-settlement.ts'

test('1X2 respects the draw; classification markets are not regular-time winners',()=>{
  assert.equal(settleSoccer90(1,1,{kind:'1x2',selection:'draw'}).status,'win')
  assert.equal(settleSoccer90(1,1,{kind:'1x2',selection:'home'}).status,'loss')
  assert.equal(settleSoccer90(2,1,{kind:'1x2',selection:'away'}).status,'loss')
})
test('double chance: 1X, X2 and 12 are distinct',()=>{
  assert.equal(settleSoccer90(0,0,{kind:'double_chance',selection:'1X'}).status,'win')
  assert.equal(settleSoccer90(0,0,{kind:'double_chance',selection:'X2'}).status,'win')
  assert.equal(settleSoccer90(0,0,{kind:'double_chance',selection:'12'}).status,'loss')
})
test('draw no bet returns stake on 90-minute draw',()=>{
  const d=settleSoccer90(0,0,{kind:'draw_no_bet',selection:'away'})
  assert.equal(d.status,'push')
  assert.equal(d.pushFraction,1)
})
test('both teams score cannot be conflated with over goals',()=>{
  assert.equal(settleSoccer90(3,0,{kind:'both_score',selection:'no'}).status,'win')
  assert.equal(settleSoccer90(3,0,{kind:'both_score',selection:'yes'}).status,'loss')
})
test('integer total over 2 returns stake on exactly 2 goals',()=>{
  assert.equal(settleSoccer90(1,1,{kind:'total',selection:'over',line:2}).status,'push')
  assert.equal(settleSoccer90(2,0,{kind:'total',selection:'over',line:2.5}).status,'loss')
  assert.equal(settleSoccer90(2,1,{kind:'total',selection:'over',line:2.5}).status,'win')
})
test('Asian quarter total over 2.25 is half-loss at exactly 2',()=>{
  const r=settleSoccer90(1,1,{kind:'total',selection:'over',line:2.25})
  assert.equal(r.status,'half_loss')
  assert.equal(r.pushFraction,0.5)
  assert.equal(r.lossFraction,0.5)
})
test('Asian quarter total over 2.75 is half-win at exactly 3',()=>{
  const r=settleSoccer90(2,1,{kind:'total',selection:'over',line:2.75})
  assert.equal(r.status,'half_win')
  assert.equal(r.winFraction,0.5)
  assert.equal(r.pushFraction,0.5)
})
test('Asian handicap -0.25 home is half-loss on draw',()=>{
  const r=settleSoccer90(1,1,{kind:'asian_handicap',selection:'home',line:-0.25})
  assert.equal(r.status,'half_loss')
  assert.equal(r.pushFraction,0.5)
})
test('Asian handicap +0.75 away is half-win when away loses by one',()=>{
  const r=settleSoccer90(2,1,{kind:'asian_handicap',selection:'away',line:0.75})
  assert.equal(r.status,'half_loss')
  assert.equal(r.lossFraction,0.5)
  assert.equal(r.pushFraction,0.5)
})
test('unknown quarter-free lines, scores and selections reject instead of guessing',()=>{
  assert.throws(()=>settleSoccer90(-1,0,{kind:'1x2',selection:'home'}),/Marcador/)
  assert.throws(()=>settleSoccer90(1,0,{kind:'total',selection:'over',line:2.125}),/asiática/)
  assert.throws(()=>settleSoccer90(1,0,{kind:'total',selection:'over',line:NaN}),/asiática/)
})
