import {test} from 'node:test'
import assert from 'node:assert/strict'
import {assessPregamePreselectionRisk} from '../src/ticket-preselection-risk.ts'

const now=Date.parse('2026-11-16T18:00:00Z')
const kickoff='2026-11-17T01:00:00Z'
const fixture=(sport='basketball',pick='away')=>({sport,pick,kickoff})
const report=(athlete,status,reportedAt='2026-11-16T15:00:00Z')=>({
  athlete,status,reportedAt,
})
const check=(override={})=>({
  status:'researched',pendingSteps:[],checklist:{steps:[]},...override,
})
test('give Kira both teams actual player statuses with NO numeric risk priority',()=>{
  const evidence=assessPregamePreselectionRisk(fixture(),check({
    rosterMatchedInjuries:{home:[report('B','Available')],away:[
      report('A','Out'),report('C','Questionable')]},
    injuryAudit:{status:'partial',home:{matched:true},away:{matched:true}},
    restHours:{home:72,away:24},
  }),now)
  assert.deepEqual(evidence.selectedAvailability.map(x=>x.athlete),['A','C'])
  assert.deepEqual(evidence.opposingAvailability.map(x=>x.athlete),['B'])
  assert.equal(evidence.rest.selectedHours,24)
  assert.equal(evidence.rest.opposingHours,72)
  assert.equal('priority' in evidence,false)
  assert.equal('score' in evidence,false)
  assert.match(evidence.observations.join(' '),/descanso documentado/iu)
})
test('newer availability supersedes older Out without adding point values',()=>{
  const evidence=assessPregamePreselectionRisk(fixture(),check({
    rosterMatchedInjuries:{home:[],away:[
      report('A','Out','2026-11-16T13:00:00Z'),
      report('A','Available','2026-11-16T15:00:00Z')]},
  }),now)
  assert.deepEqual(evidence.selectedAvailability.map(x=>x.status),['Available'])
})
test('future and undated reports cannot masquerade as pregame evidence',()=>{
  const evidence=assessPregamePreselectionRisk(fixture(),check({
    rosterMatchedInjuries:{home:[],away:[
      report('A','Out','2026-11-17T02:00:00Z'),
      report('B','Out',null)]},
  }),now)
  assert.deepEqual(evidence.selectedAvailability,[])
})
test('one-sided league injury reports remain contextual without declaring the rival healthy',()=>{
  const evidence=assessPregamePreselectionRisk(fixture(),check({
    injuryAudit:{status:'partial',
      home:{matched:false,injuries:[]},
      away:{matched:true,injuries:[report('A','Out')]}},
  }),now)
  assert.equal(evidence.selectedAvailability[0].source,'league-report-unreconciled')
  assert.ok(evidence.criticalUnknowns.some(x=>/no suponer/iu.test(x)))
  assert.equal(evidence.needsRecheck,true)
})
test('unconfirmed QB and goalie produce factual unknowns, not an invented penalty',()=>{
  const nfl=assessPregamePreselectionRisk(fixture('football'),check({
    checklist:{steps:[{key:'qb',state:'partial'}]},
  }),now)
  assert.ok(nfl.criticalUnknowns.some(x=>/QB/u.test(x)))
  const nhl=assessPregamePreselectionRisk(fixture('hockey'),check({
    checklist:{steps:[{key:'goalies',state:'missing'}]},
  }),now)
  assert.ok(nhl.criticalUnknowns.some(x=>/porteros/iu.test(x)))
  assert.equal('priority' in nhl,false)
})
test('source outage cannot become evidence of healthy rosters',()=>{
  const evidence=assessPregamePreselectionRisk(fixture(),check({
    status:'unavailable',checklist:undefined,
  }),now)
  assert.equal(evidence.needsRecheck,true)
  assert.ok(evidence.criticalUnknowns.some(x=>/Expediente/u.test(x)))
  assert.equal(evidence.selectedAvailability.length,0)
})
