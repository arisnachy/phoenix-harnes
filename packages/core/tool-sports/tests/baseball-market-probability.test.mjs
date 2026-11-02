import {test} from 'node:test'
import assert from 'node:assert/strict'
import {evaluateBaseballMarket} from '../src/baseball-market-probability.ts'

const base={family:'total',period:'full_game',pick:'over',line:8,decimalOdds:1.9}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,String(actual)+' ≉ '+String(expected))

test('integer total 8 pushes exactly on 8; 9 projected runs do not guarantee an over',()=>{
  const r=evaluateBaseballMarket(5,4,base)
  const p8=Math.exp(-9)*9**8/40320
  close(r.probabilityPush,p8)
  close(r.probabilityWin+r.probabilityPush+r.probabilityLoss,1)
  close(r.expectedNetReturnPerUnit,r.probabilityWin*0.9-r.probabilityLoss)
  close(r.impliedBreakEvenWinProbability,(1-r.probabilityPush)/1.9)
  assert.equal(r.calibrated,false)
  assert.equal(r.eligibleForTicket,false)
})
test('over 8.5 has no push and same win probability as over 8',()=>{
  const integer=evaluateBaseballMarket(5,4,base)
  const half=evaluateBaseballMarket(5,4,{...base,line:8.5})
  close(half.probabilityPush,0)
  close(half.probabilityWin,integer.probabilityWin)
  assert.ok(half.probabilityLoss>integer.probabilityLoss)
})
test('under 8 mirrors over 8 (except pushes)',()=>{
  const over=evaluateBaseballMarket(5,4,base)
  const under=evaluateBaseballMarket(5,4,{...base,pick:'under'})
  close(over.probabilityWin,under.probabilityLoss)
  close(over.probabilityLoss,under.probabilityWin)
  close(over.probabilityPush,under.probabilityPush)
})
test('run line home -1.5 vs away +1.5 are complementary without pushes',()=>{
  const home=evaluateBaseballMarket(5,4,{family:'run_line',period:'full_game',team:'home',line:-1.5,decimalOdds:2.0})
  const away=evaluateBaseballMarket(5,4,{family:'run_line',period:'full_game',team:'away',line:1.5,decimalOdds:1.8})
  close(home.probabilityWin,away.probabilityLoss)
  close(home.probabilityLoss,away.probabilityWin)
  close(home.probabilityPush,0)
})
test('whole-number run line correctly models push when selected team wins by the line',()=>{
  const result=evaluateBaseballMarket(5,4,{family:'run_line',period:'first_5',team:'home',line:-1,decimalOdds:1.9})
  assert.ok(result.probabilityPush>0)
  assert.equal(result.period,'first_5')
})
test('team total uses only projected runs for selected team',()=>{
  const market={family:'team_total',period:'first_3',team:'home',pick:'over',line:2.5,decimalOdds:2.2}
  const a=evaluateBaseballMarket(3,1,market)
  const b=evaluateBaseballMarket(3,12,market)
  close(a.probabilityWin,b.probabilityWin)
})
test('zero projected runs are deterministic',()=>{
  const r=evaluateBaseballMarket(0,0,{...base,line:0})
  close(r.probabilityWin,0)
  close(r.probabilityPush,1)
  close(r.probabilityLoss,0)
})
test('reject quarter lines, bogus odds and missing forecasts instead of guessing',()=>{
  assert.throws(()=>evaluateBaseballMarket(5,4,{...base,line:8.25}),/medias líneas/)
  assert.throws(()=>evaluateBaseballMarket(5,4,{...base,decimalOdds:1}),/Cuota/)
  assert.throws(()=>evaluateBaseballMarket(NaN,4,base),/Proyección/)
  assert.throws(()=>evaluateBaseballMarket(5,4,{...base,period:'unknown'}),/Período/)
})
