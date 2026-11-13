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
test('a comparable NBA candidate displaces the fourth hockey leg, but weak alternatives do not',()=>{
  const rows=[
    ...[0.95,0.94,0.93,0.92,0.91].map((rank,i)=>({
      rank,pick:{sport:'hockey',league:'nhl',eventId:'h'+i},
    })),
    {rank:0.86,pick:{sport:'basketball',league:'nba',eventId:'n1'}},
    {rank:0.84,pick:{sport:'football',league:'nfl',eventId:'f1'}},
  ]
  const mixed=diversifiedSportsPicks(rows,5,true)
  assert.equal(mixed.chosen.length,5)
  assert.ok(mixed.chosen.filter(x=>x.pick.sport==='hockey').length<=3)
  assert.ok(mixed.chosen.some(x=>x.pick.eventId==='f1'))
  const weak=diversifiedSportsPicks(rows.map(x=>x.pick.sport==='football'?{
    ...x,rank:0.01}:x),5,true)
  assert.equal(weak.chosen.length,5)
})
test('all-hockey cannot be mislabeled complete for multi-sport request',()=>{
  const rows=Array.from({length:5},(_,i)=>({
    rank:1-i/10,pick:{sport:'hockey',league:'nhl',eventId:String(i)},
  }))
  const mixed=diversifiedSportsPicks(rows,5,true)
  assert.equal(mixed.diversitySatisfied,false)
  assert.equal(mixed.chosen.length,5)
  assert.equal(new Set(mixed.chosen.map(x=>x.pick.eventId)).size,5)
  const hockey=diversifiedSportsPicks(rows,5,false)
  assert.equal(hockey.diversitySatisfied,true)
  assert.equal(hockey.chosen.length,5)
})
