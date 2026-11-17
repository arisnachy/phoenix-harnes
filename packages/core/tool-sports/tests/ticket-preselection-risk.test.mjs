import {test} from 'node:test'
import assert from 'node:assert/strict'
import {assessPregamePreselectionRisk} from '../src/ticket-preselection-risk.ts'

const now=Date.parse('2026-11-16T18:00:00Z')
const kickoff='2026-11-17T01:00:00Z'
const fixture=(sport='basketball',pick='away')=>({sport,pick,kickoff})
const row=(athlete,status,reportedAt='2026-11-16T15:00:00Z')=>
  ({athlete,status,reportedAt})
const check=(override={})=>({
  status:'researched',pendingSteps:[],checklist:{steps:[]},
  ...override,
})
test('four roster-reconciled NBA reported outs and back-to-back rerank favorite below healthier alternatives',()=>{
  const risk=assessPregamePreselectionRisk(fixture(),check({
    rosterMatchedInjuries:{home:[],away:[
      row('A','Out'),row('B','out'),row('C','Out'),row('D','Out'),
    ]},restHours:{home:72,away:24},
  }),now)
  assert.ok(risk.priority<=-1.3)
  assert.equal(risk.needsRecheck,true)
  assert.match(risk.reasons.join(' '),/Back-to-back/u)
  assert.match(risk.reasons.join(' '),/conciliadas con roster/u)
})
test('same injuries on both sides dampens penalty; opponent absences are not invented as sure wins',()=>{
  const risk=assessPregamePreselectionRisk(fixture(),check({
    rosterMatchedInjuries:{home:[row('H','Out'),row('I','Out')],
      away:[row('A','Out'),row('B','Out')]},
  }),now)
  assert.ok(risk.priority<0)
  assert.ok(risk.priority>-.5)
})
test('future, old and undated statuses never count as present-day confirmed outs',()=>{
  const risk=assessPregamePreselectionRisk(fixture(),check({
    rosterMatchedInjuries:{home:[],away:[
      row('A','Out','2026-11-17T02:00:00Z'),
      row('B','Out','2026-10-01T10:00:00Z'),
      row('C','Out',null),
    ]},
  }),now)
  assert.equal(risk.priority,0)
  assert.equal(risk.needsRecheck,false)
})
test('ESPN league-feed rows without roster reconciliation do not fabricate availability',()=>{
  const risk=assessPregamePreselectionRisk(fixture(),check({
    injuryAudit:{status:'partial',away:{injuries:[row('A','Out')]}},
  }),now)
  assert.equal(risk.priority,0)
  assert.equal(risk.needsRecheck,true)
  assert.match(risk.reasons.join(' '),/sin conciliación/u)
})
test('unconfirmed NFL QB and NHL goalie are downgraded without deleting event identity',()=>{
  const nfl=assessPregamePreselectionRisk(fixture('football'),check({
    checklist:{steps:[{key:'qb',state:'partial'}]},
  }),now)
  assert.ok(nfl.priority<=-.45)
  assert.equal(nfl.needsRecheck,true)
  assert.match(nfl.reasons.join(' '),/QB titular/u)
  const nhl=assessPregamePreselectionRisk(fixture('hockey'),check({
    checklist:{steps:[{key:'goalies',state:'missing'}]},
  }),now)
  assert.ok(nhl.priority<=-.26)
  assert.equal(nhl.needsRecheck,true)
})
test('a source outage cannot become false proof of health or calibration',()=>{
  const risk=assessPregamePreselectionRisk(fixture(),check({
    status:'unavailable',checklist:undefined,
  }),now)
  assert.ok(risk.priority<0)
  assert.match(risk.reasons.join(' '),/Especialista no disponible/u)
  assert.equal('winProbability' in risk,false)
})

test('a team-only NBA injury report still lowers risk without claiming opponent health',()=>{
  const risk=assessPregamePreselectionRisk(fixture(),check({
    injuryAudit:{home:{matched:false},away:{matched:true}},
    rosterMatchedInjuries:{home:[],away:[
      row('A','Out'),row('B','Out'),row('C','Out'),row('D','Out')]},
    restHours:{home:72,away:24},
  }),now)
  assert.ok(risk.priority<=-1)
  assert.match(risk.reasons.join(' '),/sin parte bilateral/u)
  assert.equal(risk.needsRecheck,true)
})

test('four fresh ESPN injury alerts still trigger review when roster endpoint times out',()=>{
  const risk=assessPregamePreselectionRisk(fixture(),check({
    status:'incomplete',
    injuryAudit:{status:'partial',
      home:{matched:false,injuries:[]},
      away:{matched:true,injuries:[
        row('A','Out'),row('B','Out'),row('C','Out'),row('D','Out')]}},
    restHours:{home:72,away:24},
  }),now)
  assert.ok(risk.priority<=-.95)
  assert.equal(risk.needsRecheck,true)
  assert.match(risk.reasons.join(' '),/ALERTA PROVISIONAL/u)
})

test('duplicate reports for one athlete are counted once; later available update supersedes out',()=>{
  const risk=assessPregamePreselectionRisk(fixture(),check({
    rosterMatchedInjuries:{home:[],away:[
      row('A','Out','2026-11-16T14:00:00Z'),
      row('A','Out','2026-11-16T14:30:00Z'),
      row('A','Available','2026-11-16T15:00:00Z'),
      row('B','Out','2026-11-16T14:00:00Z'),
    ]},
  }),now)
  assert.ok(risk.priority>-.5)
  assert.ok(risk.priority<0)
})
