import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildDailyResearchBoard} from '../src/daily-ticket-research-board.ts'
const now=Date.parse('2026-11-14T14:00:00Z')
const fixture=(i,sport='soccer',kickoff='2026-11-14T23:00:00Z')=>({
  sport,league:sport==='soccer'?'uru.1':sport==='hockey'?'nhl':'nba',
  eventId:String(10000+i),kickoff,home:{name:'Home '+i},away:{name:'Away '+i},
})
test('5 matches visible daily even if only two have a researched selection',()=>{
  const games=[fixture(1,'soccer'),fixture(2,'basketball'),
    fixture(3,'hockey'),fixture(4),fixture(5),fixture(6)]
  const choices=[{sport:'soccer',league:'uru.1',eventId:'10001',pick:'home'},
    {sport:'basketball',league:'nba',eventId:'10002',pick:'away'}]
  const result=buildDailyResearchBoard(games,choices,5,now)
  assert.equal(result.coverageComplete,true)
  assert.equal(result.slots.length,5)
  assert.equal(result.selectedCandidates,2)
  assert.equal(result.researchOnly,3)
  assert.equal(result.slots[0].selection,'Home 1')
  assert.equal(result.slots[1].selection,'Away 2')
  assert.ok(result.slots.slice(2).every(x=>x.choice===null&&x.selection===null))
  assert.ok(result.slots.every(x=>x.verifiedFixture&&!x.approvedForBetting&&!x.quoted))
  assert.equal(new Set(result.slots.map(x=>x.eventId)).size,5)
})
test('no evidence still yields a five-event watchlist, not five fictional bets',()=>{
  const result=buildDailyResearchBoard(Array.from({length:6},(_,i)=>fixture(i)),[],5,now)
  assert.equal(result.slots.length,5)
  assert.equal(result.selectedCandidates,0)
  assert.equal(result.researchOnly,5)
  assert.ok(result.slots.every(x=>x.state==='investigate'&&x.selection===null))
  assert.match(result.note,/NO es un boleto/)
})
test('a score already played cannot be recycled to fill an unpriced position',()=>{
  const result=buildDailyResearchBoard([fixture(1),fixture(2,'hockey',
    '2026-11-14T12:00:00Z'),fixture(3)],[],5,now)
  assert.equal(result.slots.length,2)
  assert.equal(result.missingFixtures,3)
  assert.equal(result.coverageComplete,false)
  assert.match(result.note,/No inventar/)
})
test('same event ID in separate verified leagues is never conflated',()=>{
  const games=[fixture(1,'soccer'),fixture(1,'hockey'),fixture(2)]
  const choices=[{sport:'hockey',league:'nhl',eventId:'10001',pick:'away'}]
  const result=buildDailyResearchBoard(games,choices,5,now)
  assert.equal(result.slots.length,3)
  assert.equal(result.slots[0].sport,'hockey')
  assert.equal(result.slots[0].selection,'Away 1')
  assert.equal(result.slots[1].sport,'soccer')
  assert.equal(result.slots[1].selection,null)
})
test('six-leg request never duplicates games or invents sixth leg if only five exist',()=>{
  const result=buildDailyResearchBoard(Array.from({length:5},(_,i)=>fixture(i)),[],6,now)
  assert.equal(result.slots.length,5)
  assert.equal(result.missingFixtures,1)
  assert.equal(result.requestedLegs,6)
})
