import {test} from 'node:test'
import assert from 'node:assert/strict'
import {settleBasketballPlayerProp} from '../src/basketball-player-market.ts'
const stats={playerId:'1001',eventId:'7001',league:'nba',
  period:'including_ot',participation:'played',source:'official boxscore',
  observedAt:'2026-11-05T23:00:00Z',final:true,
  stats:{points:23,rebounds:7,assists:9,threes:3,steals:2,blocks:0,turnovers:1}}
const m=(kind,line,selection='over')=>({playerId:'1001',eventId:'7001',
  league:'nba',period:'including_ot',kind,line,selection,dnpRule:'unverified'})
test('NBA props points, assists, 3PM and combined PRA settle from the same actual athlete',()=>{
  assert.equal(settleBasketballPlayerProp(stats,m('points',22.5)).status,'win')
  assert.equal(settleBasketballPlayerProp(stats,m('assists',9)).status,'push')
  assert.equal(settleBasketballPlayerProp(stats,m('threes',3.5)).status,'loss')
  assert.equal(settleBasketballPlayerProp(stats,m('PRA',38)).status,'win')
  assert.equal(settleBasketballPlayerProp(stats,m('PR',30)).status,'push')
})
test('DNP does not become an invented zero or a loss without house policy',()=>{
  const dnp={...stats,participation:'dnp',stats:{}}
  assert.equal(settleBasketballPlayerProp(dnp,m('points',10)).status,'pending')
  assert.equal(settleBasketballPlayerProp(dnp,{...m('points',10),dnpRule:'void'}).status,'void')
})
test('props reject league, event, player and OT/regulation mismatches',()=>{
  assert.throws(()=>settleBasketballPlayerProp(stats,{...m('points',20),league:'wnba'}),/no coinciden/)
  assert.throws(()=>settleBasketballPlayerProp(stats,{...m('points',20),playerId:'1002'}),/no coinciden/)
  assert.throws(()=>settleBasketballPlayerProp(stats,{...m('points',20),period:'regulation'}),/no coinciden/)
  assert.throws(()=>settleBasketballPlayerProp(stats,{...m('points',20),line:20.25}),/inválida/)
})
test('missing combo component stays pending, not zero-valued',()=>{
  assert.equal(settleBasketballPlayerProp({...stats,stats:{points:26}},m('PRA',28)).status,'pending')
})
