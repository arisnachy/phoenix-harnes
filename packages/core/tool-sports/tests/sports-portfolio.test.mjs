import {test} from 'node:test'
import assert from 'node:assert/strict'
import {simulateSportsPortfolio} from '../src/sports-portfolio.ts'

const now=Date.parse('2026-11-22T15:00:00Z')
const offer=(eventId,price,rest={})=>({
  eventId,selection:'Equipo '+eventId,price,bookmaker:'DraftKings',
  source:'ESPN Core',observedAt:'2026-11-22T14:58:00Z',...rest,
})
test('two singles and one double leave 25 percent unbet and expose all outcomes',()=>{
  const x=simulateSportsPortfolio([offer('1',1.52),offer('2',1.46)],['1','2'],1000,0,now)
  assert.equal(x.status,'quoted-simulation')
  assert.deepEqual(x.entries.map(e=>e.stake),[300,300,150])
  assert.equal(x.entries[2].decimalOdds,1.52*1.46)
  assert.equal(x.reserve,250)
  assert.deepEqual(x.scenarios.map(s=>s.netVsBudget),[-750,-294,-312,476.88])
  assert.equal(x.maxLoss,750)
  assert.equal(x.positiveExpectedValueProven,false)
  assert.equal(x.approvedForBetting,false)
})
test('optional full ticket takes at most 10 percent from reserve',()=>{
  const prices=[1.52,1.46,1.2,1.4,1.8]
  const x=simulateSportsPortfolio(prices.map((p,i)=>offer(String(i+1),p)),
    ['1','2'],1000,5,now)
  assert.equal(x.fullTicketAvailable,true)
  assert.deepEqual(x.entries.map(e=>e.stake),[300,300,150,50])
  assert.equal(x.reserve,200)
  assert.equal(x.maxExposureByCoreEvent['1'],500)
  assert.equal(x.scenarios[3].netVsBudget,426.88)
  assert.ok(x.allSelectedWinNet>x.scenarios[3].netVsBudget)
})
test('never converts missing, stale or mixed-bookmaker quotes into a stake',()=>{
  for(const rows of [
    [offer('1',1.52)],
    [offer('1',1.52,{observedAt:'2026-11-22T14:30:00Z'}),offer('2',1.46)],
    [offer('1',1.52),offer('2',1.46,{bookmaker:'Other'})],
    [offer('1',1.52,{source:'unverified'}),offer('2',1.46)],
  ]){
    const x=simulateSportsPortfolio(rows,['1','2'],1000,10,now)
    assert.equal(x.status,'insufficient-quotes')
    assert.equal(x.committed,0)
    assert.equal(x.reserve,1000)
    assert.equal(x.scenarios.length,0)
  }
})
test('no duplicate event or partial five-leg price creates optional long ticket',()=>{
  const x=simulateSportsPortfolio([offer('1',1.52),offer('2',1.46),
    offer('3',1.3),offer('4',1.4),offer('4',1.4)],['1','2'],1000,5,now)
  assert.equal(x.fullTicketAvailable,false)
  assert.equal(x.reserve,250)
  assert.equal(x.entries.length,3)
})
test('rejects nonsensical budgets, cores and full-ticket exposures',()=>{
  assert.throws(()=>simulateSportsPortfolio([],['1','1'],1000,0,now),/dos eventos/)
  assert.throws(()=>simulateSportsPortfolio([],['1','2'],-10,0,now),/Presupuesto/)
  assert.throws(()=>simulateSportsPortfolio([],['1','2'],1000,11,now),/opcional/)
})
