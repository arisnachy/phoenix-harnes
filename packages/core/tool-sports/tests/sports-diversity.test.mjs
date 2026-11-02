import {test} from 'node:test'
import assert from 'node:assert/strict'
import {diversifiedSportsShortlist,diversifiedSportsPicks} from '../src/sports-diversity.ts'

test('a league-rich sport cannot monopolize all six scouting slots',()=>{
  const eligible=[
    {sport:'soccer',league:'eng.1',active:9},
    {sport:'soccer',league:'esp.1',active:8},
    {sport:'soccer',league:'usa.1',active:7},
    {sport:'soccer',league:'mex.1',active:6},
    {sport:'soccer',league:'uefa.champions',active:5},
    {sport:'soccer',league:'fifa.world',active:4},
    {sport:'nba',league:'nba',active:3},
    {sport:'nhl',league:'nhl',active:2},
  ]
  const shortlist=diversifiedSportsShortlist(eligible,6)
  assert.equal(shortlist.length,6)
  assert.equal(new Set(shortlist.map(x=>x.sport)).size,3)
  assert.ok(shortlist.some(x=>x.league==='nba'))
  assert.ok(shortlist.some(x=>x.league==='nhl'))
})
test('selects two qualified sports ahead of redundant same-sport candidates',()=>{
  const rows=[
    {rank:0.9,pick:{sport:'hockey',league:'nhl',eventId:'1'}},
    {rank:0.8,pick:{sport:'hockey',league:'nhl',eventId:'2'}},
    {rank:0.7,pick:{sport:'hockey',league:'nhl',eventId:'3'}},
    {rank:0.6,pick:{sport:'soccer',league:'eng.1',eventId:'4'}},
    {rank:0.5,pick:{sport:'hockey',league:'nhl',eventId:'5'}},
  ]
  const result=diversifiedSportsPicks(rows,5,true)
  assert.equal(result.chosen.length,5)
  assert.equal(result.diversitySatisfied,true)
  assert.equal(result.chosen[1].pick.sport,'soccer')
})
test('all-hockey cannot be mislabeled complete for multi-sport request',()=>{
  const rows=Array.from({length:5},(_,i)=>({
    rank:1-i/10,pick:{sport:'hockey',league:'nhl',eventId:String(i)},
  }))
  const mixed=diversifiedSportsPicks(rows,5,true)
  assert.equal(mixed.diversitySatisfied,false)
  assert.equal(mixed.chosen.length,4)
  const hockey=diversifiedSportsPicks(rows,5,false)
  assert.equal(hockey.diversitySatisfied,true)
  assert.equal(hockey.chosen.length,5)
})
