import {test} from 'node:test'
import assert from 'node:assert/strict'
import {auditDeepProtocol,deepProtocolCounts}
  from '../src/sports-original-deep-protocol.ts'
import {auditSportChecklist} from '../src/daily-specialist-checklist.ts'

test('restores the original 74 specialist steps plus 10 universal per sport',()=>{
  assert.deepEqual(deepProtocolCounts,{
    basketball:12,hockey:12,baseball:13,football:12,soccer:13,tennis:12,
  })
  assert.equal(Object.values(deepProtocolCounts).reduce((a,b)=>a+b,0),74)
  for(const [sport,n] of Object.entries(deepProtocolCounts)){
    const steps=auditDeepProtocol(sport,{})
    assert.equal(steps.length,n+10,sport)
    assert.equal(steps.filter(x=>x.group==='universal').length,10)
    assert.equal(steps.filter(x=>x.group==='specialist').length,n)
    assert.equal(new Set(steps.map(x=>x.key)).size,steps.length)
    assert.ok(steps.every(x=>x.state==='missing'),sport)
    assert.ok(steps.every(x=>x.sources.length>=2 || x.key==='U08'
      || x.key==='U10' || x.key==='T09'))
  }
})

test('a basic fetch is not proof of 12 NBA specialist metrics',()=>{
  const report=auditSportChecklist('basketball',{
    fixture:{state:'verified',detail:'ESPN event ID and teams'},
    form:{state:'verified',detail:'Last 5 results, margins by team'},
    efficiency:{state:'verified',detail:'OffRtg 112.8, no pace or TOV%'},
    injuries:{state:'verified',detail:'ESPN league-level injury feed checked'},
  },Date.parse('2026-11-10T10:00:00Z'))
  assert.equal(report.fullSteps.length,22)
  assert.equal(report.fullVerified,0)
  assert.equal(report.fullComplete,false)
  const ortg=report.fullSteps.find(x=>x.key==='B04')
  assert.equal(ortg.state,'partial','efficiency aggregate does not prove Net Rating and pace')
  assert.match(ortg.detail,/Falta verificar este subindicador/)
  assert.equal(report.fullSteps.find(x=>x.key==='B07').state,'missing')
  assert.equal(report.fullSteps.find(x=>x.key==='B08').state,'partial')
})

test('specialist step only becomes verified on its exact evidence key',()=>{
  const report=auditDeepProtocol('baseball',{
    M04:{state:'verified',detail:'both probable starters, WHIP and K/BB by date'},
    starters:{state:'verified',detail:'ESPN probable pitchers only'},
  })
  assert.equal(report.find(x=>x.key==='M04').state,'verified')
  assert.equal(report.find(x=>x.key==='M07').state,'missing',
    'pitcher confirmation does not validate batter versus pitcher')
  assert.equal(report.find(x=>x.key==='M09').state,'missing')
})

test('unverified source never penalizes a side or manufactures injury',()=>{
  const data=auditDeepProtocol('hockey',{
    goalies:{state:'partial',detail:'candidate found; no confirmed goalie'},
    H07:{state:'partial',detail:'Likely, not Confirmed'},
    U07:{state:'verified',detail:'NHL official and ESPN verified identity'},
  })
  assert.equal(data.find(x=>x.key==='H07').state,'partial')
  assert.equal(data.find(x=>x.key==='H06').state,'partial')
  assert.equal(data.find(x=>x.key==='U07').state,'verified')
  assert.ok(data.find(x=>x.key==='H07').sources.some(x=>x.includes('Daily Faceoff')))
})

test('obsolete and contradictory findings persist rather than becoming verified or empty',()=>{
  const steps=auditDeepProtocol('basketball',{
    B08:{state:'stale',detail:'injury status from past week'},
    U05:{state:'conflict',detail:'official says Out; ESPN says Available'},
  })
  assert.equal(steps.find(x=>x.key==='B08').state,'stale')
  assert.equal(steps.find(x=>x.key==='U05').state,'conflict')
  assert.ok(steps.some(x=>x.state==='missing'))
})
