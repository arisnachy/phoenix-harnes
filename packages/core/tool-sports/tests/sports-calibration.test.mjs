import {test} from 'node:test'
import assert from 'node:assert/strict'
import {evaluateSportsCalibration,calibratedSportsForecast,
  auditSportsCalibration,availableSportCalibration}
  from '../src/sports-calibration.ts'
import {estimateEvidenceForecast} from '../src/sports-forecast.ts'

const now=Date.parse('2026-11-01T21:00:00Z')
const make=(count=220)=>{
 const matches=[]
 const start=now-160*86_400_000
 const teams=Array.from({length:16},(_,i)=>String(100+i))
 for(let i=0;i<count;i++){
   const home=teams[(i*3)%teams.length],away=teams[(i*3+1+i%7)%teams.length]
   if(home===away)continue
   matches.push({id:String(90000+i),sport:'basketball',league:'nba',
     date:new Date(start+i*12*3_600_000).toISOString(),homeId:home,awayId:away,
     homeScore:98+i%23,awayScore:95+(i*7)%29,status:'post'})
 }
 return matches
}
test('chronological audit never invents calibration without enough prior games',()=>{
 const report=evaluateSportsCalibration(make(25),'basketball','nba',now)
 assert.equal(report.status,'insufficient')
 assert.equal(report.calibrated,false)
 assert.equal(report.temperature,null)
 assert.equal(report.baselineBrier,null)
})
test('holdout metrics and class baseline are kept separate from fit',()=>{
 const report=evaluateSportsCalibration(make(500),'basketball','nba',now)
 assert.ok(['validated','underperforming','insufficient'].includes(report.status))
 assert.equal(report.events<=500,true)
 assert.ok(report.trainCount+report.holdoutCount===report.samples)
 if(report.status!=='insufficient'){
   assert.ok(report.trainCount>=60)
   assert.ok(report.holdoutCount>=24)
   assert.ok(report.trainedThrough<report.evaluatedFrom)
   assert.ok(Number.isFinite(report.holdoutBrier))
   assert.ok(Number.isFinite(report.baselineBrier))
   assert.ok(Number.isFinite(report.holdoutLogLoss))
 }
})
test('same-day future results cannot enter historical training',()=>{
 const dates=make(80)
 dates.push({...dates[0],id:'999999',date:new Date(now+86_400_000).toISOString()})
 const result=evaluateSportsCalibration(dates,'basketball','nba',now)
 assert.equal(result.events,dates.length-1)
})
test('calibrated output is unavailable unless audit is approved',()=>{
 const date=new Date(now+86_400_000).toISOString()
 const g=(pts,allowed,d)=>({scored:pts,allowed,date:new Date(now-d*86_400_000).toISOString()})
 const forecast=estimateEvidenceForecast({sport:'basketball',phase:'pre',eventDate:date,
   home:{name:'H',lastGames:[g(110,90,1),g(100,80,2),g(99,95,3),g(110,100,4),g(105,90,5)]},
   away:{name:'A',lastGames:[g(80,100,1),g(85,99,2),g(90,95,3),g(95,99,4),g(85,100,5)]}},now)
 const base={status:'validated',calibrated:true,temperature:1.5,sport:'basketball',
   holdoutCount:70,holdoutBrier:0.47,baselineBrier:0.52}
 const adjusted=calibratedSportsForecast(forecast,base)
 assert.ok(adjusted)
 assert.ok(Math.abs(adjusted.probabilityHome+adjusted.probabilityAway-1)<1e-9)
 assert.equal(calibratedSportsForecast(forecast,{...base,calibrated:false}),null)
 assert.equal(availableSportCalibration('basketball','nba',date,now),null)
})
test('calibration reads a complete month rather than sending 28 scoreboard requests',async()=>{
 const calls=[]
 const result=await auditSportsCalibration('basketball','nba',28,async url=>{
   calls.push(url)
   return {events:[]}
 },now)
 assert.equal(calls.length,1)
 assert.match(calls[0],/dates=202610/)
 assert.equal(result.status,'insufficient')
 assert.equal(result.coverage.daysRequested,28)
 assert.equal(result.coverage.monthlySuccesses,1)
 assert.equal(result.coverage.fixturesRead,0)
})
test('valid monthly results enter evaluation, but no future, in-progress or absent score does',async()=>{
 const calls=[]
 const matches=[
   {id:'400001',date:'2026-10-20T20:00:00Z',status:{type:{state:'post'}},
     competitions:[{competitors:[
       {homeAway:'home',team:{id:'1'},score:'111'},
       {homeAway:'away',team:{id:'2'},score:'100'},
     ]}]},
   {id:'400002',date:'2026-10-21T20:00:00Z',status:{type:{state:'post'}},
     competitions:[{competitors:[
       {homeAway:'home',team:{id:'2'},score:'105'},
       {homeAway:'away',team:{id:'1'},score:'108'},
     ]}]},
   {id:'400003',date:'2026-10-22T20:00:00Z',status:{type:{state:'in'}},
     competitions:[{competitors:[
       {homeAway:'home',team:{id:'1'},score:'80'},
       {homeAway:'away',team:{id:'2'},score:'73'},
     ]}]},
   {id:'400004',date:'2026-11-03T20:00:00Z',status:{type:{state:'post'}},
     competitions:[{competitors:[
       {homeAway:'home',team:{id:'1'},score:'999'},
       {homeAway:'away',team:{id:'2'},score:'0'},
     ]}]},
   {id:'400005',date:'2026-10-23T20:00:00Z',status:{type:{state:'post'}},
     competitions:[{competitors:[
       {homeAway:'home',team:{id:'1'},score:'90'},
       {homeAway:'away',team:{id:'2'}},
     ]}]},
 ]
 const r=await auditSportsCalibration('basketball','nba',28,async url=>{
   calls.push(url)
   return {events:matches}
 },now)
 assert.equal(calls.length,1)
 assert.equal(r.events,2)
 assert.equal(r.coverage.fixturesRead,2)
 assert.equal(r.status,'insufficient')
 assert.equal(r.calibrated,false)
})
test('monthly outage falls back to real daily observations and never authorizes calibration',async()=>{
 const calls=[]
 const r=await auditSportsCalibration('basketball','nba',28,async url=>{
   calls.push(url)
   if(url.includes('dates=202610&'))throw Error('ESPN month unavailable')
   if(url.includes('dates=20261004'))return {events:[]}
   return {events:[]}
 },now)
 assert.equal(r.calibrated,false)
 assert.ok(r.coverage.dailyQueries>0)
 assert.equal(r.coverage.monthlySuccesses,0)
 assert.ok(calls.length<28)
})
