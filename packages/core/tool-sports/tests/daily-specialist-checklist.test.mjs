import {test} from 'node:test'
import assert from 'node:assert/strict'
import {auditSportChecklist,supportedChecklistSports}
  from '../src/daily-specialist-checklist.ts'

const now=Date.parse('2026-11-08T16:00:00Z')

test('all six sport disciplines enumerate their own real mandatory research steps',()=>{
  assert.deepEqual(supportedChecklistSports.slice().sort(),
    ['baseball','basketball','football','hockey','soccer','tennis'])
  for(const sport of supportedChecklistSports){
    const review=auditSportChecklist(sport,{},now)
    assert.ok(review.steps.length>=8,sport)
    assert.equal(review.verified,0)
    assert.equal(review.missing,review.steps.length)
    assert.equal(review.complete,false)
    assert.ok(review.criticalPending.length>0)
    assert.ok(review.steps.every(x=>x.detail==='Sin evidencia individual comprobada'))
  }
})

test('candidate goalie is partial, not a verified NHL starter',()=>{
  const review=auditSportChecklist('hockey',{
    fixture:{state:'verified',detail:'NHL fixture id + UTC'},
    goalies:{state:'partial',detail:'Two goalies on roster only'},
    xg:{state:'missing',detail:'No 5v5 xG'},
  },now)
  assert.equal(review.steps.find(x=>x.key==='goalies').state,'partial')
  assert.ok(review.criticalPending.some(x=>x.includes('porteros titulares')))
  assert.equal(review.complete,false)
})

test('one unverified critical step prevents fully verified dossier',()=>{
  const base=auditSportChecklist('baseball',{},now)
  const signals=Object.fromEntries(base.steps.map(s=>[
    s.key,{state:'verified',detail:'fixture-specific sourced evidence'},
  ]))
  const complete=auditSportChecklist('baseball',signals,now)
  assert.equal(complete.complete,true)
  assert.equal(complete.verified,complete.steps.length)
  // Probable starters are valid for MLB and non-critical (standard pre-game state):
  signals.starters={state:'partial',detail:'Probable is standard pregame'}
  const withProbable=auditSportChecklist('baseball',signals,now)
  assert.equal(withProbable.complete,true)
  assert.ok(!withProbable.criticalPending.some(x=>x.includes('pitcher')||x.includes('abridor')))
  // A truly critical step (bullpen) does prevent completion:
  signals.bullpen={state:'missing',detail:'No bullpen usage'}
  const provisional=auditSportChecklist('baseball',signals,now)
  assert.equal(provisional.complete,false)
  assert.ok(provisional.criticalPending.some(x=>x.includes('Bullpen')))
})

test('unsupported sport, invalid clock and invented step cannot become complete',()=>{
  assert.equal(auditSportChecklist('mma',{fixture:{
    state:'verified',detail:'yes'}},now).complete,false)
  assert.throws(()=>auditSportChecklist('tennis',{},NaN),/Fecha/)
  const review=auditSportChecklist('tennis',{imaginary:{
    state:'verified',detail:'made up'}},now)
  assert.equal(review.verified,0)
})
