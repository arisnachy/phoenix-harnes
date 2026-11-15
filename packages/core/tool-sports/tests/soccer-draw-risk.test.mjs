import {test} from 'node:test'
import assert from 'node:assert/strict'
import {assessSoccerDrawRisk} from '../src/soccer-draw-risk.ts'

const kick='2026-11-14T23:00:00Z'
const make=(homeAway,results,dateStart=1)=>results.map(([scored,allowed],i)=>({
  date:'2026-11-'+String(dateStart+i).padStart(2,'0')+'T22:00:00Z',
  homeAway,scored,allowed,
}))
const risky={
  home:{name:'Nacional',recent:[
    ...make('home',[[1,1],[2,1],[2,2],[1,0],[0,1]]),
    ...make('away',[[2,2],[3,2]])]},
  away:{name:'Albion FC',recent:[
    ...make('away',[[1,1],[2,2],[1,2],[2,1],[1,1]]),
    ...make('home',[[2,1],[2,2]])]},
  kickoff:kick,
}
test('empate: split local/visitante, BTTS, porterías a cero y goles concedidos por separado',()=>{
  const result=assessSoccerDrawRisk(risky)
  assert.equal(result.status,'assessed')
  assert.equal(result.tier,'elevated')
  assert.equal(result.requiresAlternativeReview,true)
  assert.equal(result.selectedSamples.home.sample,'venue')
  assert.equal(result.selectedSamples.away.sample,'venue')
  assert.equal(result.selectedSamples.home.draws,2)
  assert.equal(result.selectedSamples.away.draws,3)
  assert.equal(result.averageHistoricalDrawPct,50)
  assert.equal(result.calibrated,false)
  assert.equal(result.marketThreeWayVerified,false)
  assert.equal(result.xgStatus,'unavailable')
  assert.ok(result.indicators.some(x=>/BTTS/u.test(x)))
  assert.ok(result.unverified.some(x=>/xG/u.test(x)))
})
test('Nacional 6-0-1 vs Albion 4-1-2 is not automatically flagged from form alone',()=>{
  const home=make('home',[[3,0],[2,0],[4,0],[2,0],[3,0],[3,0],[0,2]])
  const away=make('away',[[3,0],[2,0],[0,2],[4,0],[1,1],[3,0],[0,3]])
  const result=assessSoccerDrawRisk({home:{name:'Nacional',recent:home},
    away:{name:'Albion FC',recent:away},kickoff:kick})
  assert.equal(result.status,'assessed')
  assert.equal(result.requiresAlternativeReview,false)
  assert.equal(result.calibrated,false)
  assert.equal(result.averageHistoricalDrawPct,7.15)
})
test('no lookahead: historical scores on/after kickoff are excluded',()=>{
  const home=make('home',[[1,1],[2,2],[0,0]])
  home.push({date:'2026-11-14T23:00:00Z',homeAway:'home',scored:0,allowed:0})
  const result=assessSoccerDrawRisk({
    home:{name:'Home',recent:home},
    away:{name:'Away',recent:make('away',[[1,1],[2,2],[0,0]])},
    kickoff:kick})
  assert.equal(result.status,'partial')
  assert.equal(result.selectedSamples.home.games,3)
  assert.equal(result.averageHistoricalDrawPct,100)
  assert.equal(result.requiresAlternativeReview,false)
  assert.equal(result.marketThreeWayVerified,false)
})
test('xG/xGA are identified only for both teams, never derived from goals',()=>{
  const stats=[{label:'Nacional · xG',value:'1.47'},
    {label:'Nacional · xGA',value:'0.91'},
    {label:'Albion FC · xG',value:'1.2'},
    {label:'Albion FC · xGA',value:'1.9'}]
  const result=assessSoccerDrawRisk({...risky,statistics:stats})
  assert.equal(result.xgStatus,'both-teams')
  assert.ok(!result.unverified.some(x=>/xG\/xGA/u.test(x)))
  const incomplete=assessSoccerDrawRisk({...risky,
    statistics:[{label:'Nacional · xG',value:'1.47'}]})
  assert.equal(incomplete.xgStatus,'unavailable')
})
test('two matches do not support a fully reviewed winner or historical probability',()=>{
  const result=assessSoccerDrawRisk({home:{name:'Home',recent:make('home',[[0,0],[1,1]])},
    away:{name:'Away',recent:make('away',[[1,1],[0,0]])},kickoff:kick})
  assert.equal(result.status,'partial')
  assert.equal(result.tier,'elevated')
  assert.equal(result.requiresAlternativeReview,false)
})
