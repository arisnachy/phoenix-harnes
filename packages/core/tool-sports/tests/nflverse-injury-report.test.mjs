import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseNflverseCsv,nflverseInjuryReport} from '../src/nflverse-injury-report.ts'

const fixture={home:'Denver Broncos',away:'Carolina Panthers',
  kickoff:'2026-11-08T18:00:00Z',date:'2026-11-08'}
const now=Date.parse('2026-11-08T16:00:00Z')
const header='season,team,week,full_name,position,report_status,report_primary_injury,date_modified'
const row=(team,player,status,modified='2026-11-07T12:00:00Z',week=9)=>
  ['2026',team,week,player,'QB',status,'Ankle',modified].join(',')
const response=(csv,status=200)=>new Response(csv,{status})
test('CSV parser supports quotes with commas and newlines',()=>{
  const records=parseNflverseCsv(header+'\n'+
    '2026,DEN,9,"Doe, Jane",QB,Questionable,Ankle,2026-11-07T12:00:00Z\n')
  assert.equal(records[0].full_name,'Doe, Jane')
})
test('both-team recent injury report is attributed, not a confirmed inactive list',async()=>{
  const csv=[header,row('DEN','Quarterback A','Questionable'),
    row('CAR','Player B','Out')].join('\n')
  const x=await nflverseInjuryReport(fixture,async()=>response(csv),now,{})
  assert.equal(x.status,'verified')
  assert.deepEqual(x.teamsCovered,['DEN','CAR'])
  assert.deepEqual(x.injuries.map(y=>y.status).sort(),['Out','Questionable'])
  assert.match(x.warning,/no sustituye inactivos/)
  assert.match(x.source,/injuries_2026\.csv/)
})
test('wrong-season and stale records are never current injury information',async()=>{
  const csv=[header,row('DEN','Former A','Out','2025-11-07T12:00:00Z'),
    row('CAR','Former B','Out','2025-11-07T12:00:00Z')].join('\n')
  const x=await nflverseInjuryReport(fixture,async()=>response(csv),now,{})
  assert.equal(x.status,'stale')
  assert.deepEqual(x.injuries,[])
})
test('one team reporting is partial, never verified',async()=>{
  const x=await nflverseInjuryReport(fixture,async()=>response(
    [header,row('DEN','A','Out')].join('\n')),now,{})
  assert.equal(x.status,'partial')
  assert.deepEqual(x.teamsCovered,['DEN'])
})
test('empty, malformed or unavailable reports fail closed',async()=>{
  const x=await nflverseInjuryReport(fixture,async()=>response('not csv'),now,{})
  assert.equal(x.status,'unavailable')
  const y=await nflverseInjuryReport(fixture,async()=>response('blocked',429),now,{})
  assert.equal(y.status,'unavailable')
  assert.equal(y.injuries.length,0)
})
test('January playoff report uses prior fall NFL season',async()=>{
  const x=await nflverseInjuryReport({...fixture,date:'2027-01-17',
    kickoff:'2027-01-17T18:00:00Z'},
    async url=>{assert.match(String(url),/injuries_2026\.csv/);return response('bad')},
    Date.parse('2027-01-16T16:00:00Z'),{})
  assert.equal(x.status,'unavailable')
})
