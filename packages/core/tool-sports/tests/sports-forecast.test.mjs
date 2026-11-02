import {test} from 'node:test'
import assert from 'node:assert/strict'
import {estimateEvidenceForecast} from '../src/sports-forecast.ts'

const future=new Date(Date.now()+86_400_000).toISOString()
const game=(scored,allowed,days)=>({
  scored,allowed,date:new Date(Date.parse(future)-days*86_400_000).toISOString(),
})
const row=(sport='soccer',phase='pre')=>({
  sport,phase,eventDate:future,
  home:{name:'Local',lastGames:[game(2,0,1),game(1,1,3),game(3,1,5),
    game(2,1,7),game(1,0,9)]},
  away:{name:'Visitante',lastGames:[game(0,2,2),game(1,2,4),game(1,1,6),
    game(0,2,8),game(0,1,10)]},
})
test('soccer exploratory projection yields distinct three-way probabilities',()=>{
  const result=estimateEvidenceForecast(row())
  assert.equal(result.status,'exploratory')
  assert.equal(result.model,'recent-form-poisson-v1')
  assert.equal(result.calibrated,false)
  assert.equal(result.eligibleForValueBet,false)
  assert.ok(result.probabilityHome>result.probabilityAway)
  assert.ok(result.probabilityDraw>0)
  assert.ok(Math.abs(result.probabilityHome+result.probabilityAway+result.probabilityDraw-1)<0.001)
  assert.match(result.warnings.join(' '),/SIN calibración/)
})
test('NBA-style score model has no draw market and no claimed edge',()=>{
  const result=estimateEvidenceForecast(row('basketball'))
  assert.equal(result.status,'exploratory')
  assert.equal(result.model,'recent-margin-logistic-v1')
  assert.equal(result.probabilityDraw,null)
  assert.equal(result.eligibleForValueBet,false)
  assert.ok(Math.abs(result.probabilityHome+result.probabilityAway-1)<0.001)
})
test('cannot predict if there are fewer than five pre-kickoff results',()=>{
  const input=row()
  input.home.lastGames.length=3
  const result=estimateEvidenceForecast(input)
  assert.equal(result.status,'insufficient')
  assert.equal(result.probabilityHome,null)
  assert.equal(result.eligibleForValueBet,false)
})
test('future-event and historical cutoff blocks leak and late recommendations',()=>{
  const input=row()
  input.away.lastGames.push(game(90,0,-1))
  const result=estimateEvidenceForecast(input)
  assert.equal(result.awaySample,5)
  assert.equal(result.status,'exploratory')
  const finished=estimateEvidenceForecast({...input,phase:'post'})
  assert.equal(finished.status,'not-pregame')
  assert.equal(finished.probabilityHome,null)
  const late=estimateEvidenceForecast(input,Date.parse(future)+10)
  assert.equal(late.status,'not-pregame')
})
test('does not invent forecasts for unsupported sports',()=>{
  const report=estimateEvidenceForecast(row('tennis'))
  assert.equal(report.status,'insufficient')
  assert.equal(report.probabilityHome,null)
})
test('rejects invalid and future game observations from samples',()=>{
  const input=row('football')
  input.home.lastGames[0]={scored:NaN,allowed:10,date:future}
  assert.equal(estimateEvidenceForecast(input).status,'insufficient')
})
