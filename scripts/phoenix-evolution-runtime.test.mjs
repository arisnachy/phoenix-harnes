import assert from 'node:assert/strict'
import test from 'node:test'
import { IdleEvolutionCache, inferEvolutionIntent, runEvolution, summarizeEvolutionEvents } from '../packages/core/tool-living/src/evolution.ts'

const run = (operation, input) => runEvolution(operation, JSON.stringify(input))
const rows = Array.from({length: 5}, (_, i) => [
  {id: 'base-' + i, fixture: 'f-' + i, strategy: 'base', kind: 'timeout', ok: false, ms: 100},
  {id: 'next-' + i, fixture: 'f-' + i, strategy: 'next', kind: 'timeout', ok: true, ms: 50},
]).flat()
test('deduplicates evidence, summarizes failures and discards raw rows', () => {
  const result = run('dreaming', {observations: [...rows, rows[0]]})
  assert.equal(result.groups[0].n, 10)
  assert.deepEqual(result.repeated, ['timeout'])
  assert.equal(result.rawRowsRetained, 0)
  assert.equal(result.writes, 0)
  assert.equal(run('metrics', {observations: rows}).successRate, 0.5)
})
test('paired lab, causal and skill require comparable evidence and never promote', () => {
  const input = {observations: rows, baseline: 'base', candidate: 'next'}
  for (const op of ['causal', 'lab', 'skill']) {
    const result = run(op, input)
    assert.equal(result.reviewCandidate, true)
    assert.equal(result.causalProof, false)
    assert.equal(result.mayPromote, false)
  }
  assert.equal(run('skill', input).skillCandidate, 'next')
  assert.equal(run('lab', {...input, observations: rows.slice(0, 4)}).reviewCandidate, false)
  assert.equal(run('lab', {...input, observations: [...rows, {...rows[0], id: 'duplicate'}]}).reviewCandidate, false)
})
test('twin is a cycle-safe graph simulation with no filesystem effects', () => {
  const result = run('twin', {nodes: ['a','b','c'], edges: [
    {dependent:'b', dependency:'a'}, {dependent:'c',dependency:'b'}, {dependent:'a',dependency:'c'}], remove:'a'})
  assert.deepEqual(result.potentialAffected, ['b','c'])
  assert.equal(result.functionalReplica, false)
  assert.equal(result.writes, 0)
})
test('handoff only references explicit state and excludes unrelated inputs', () => {
  const result = run('handoff', {missionRef:'mission-1',sourceModel:'a',targetModel:'b',
    pending:['task-1','task-1'],completed:['task-2'],evidenceRefs:['receipt-1'],secret:'NEVER_COPY'})
  assert.deepEqual(result.pending, ['task-1'])
  assert.ok(!JSON.stringify(result).includes('NEVER_COPY'))
  assert.equal(result.switched, false)
})
test('intent is advisory and RAM assessment never grants allocation', () => {
  assert.deepEqual(run('intent',{goal:'debugging'}).suggestions,['metrics','causal','lab'])
  assert.deepEqual(run('intent',{goal:'constructor'}).suggestions,[])
  assert.equal(run('homeostasis',{requestedBytes:Number.MAX_SAFE_INTEGER}).recommendation,'defer-or-reduce-context')
  assert.equal(run('homeostasis',{requestedBytes:0}).reservationGranted,false)
})
test('rejects oversize, contradictory, malformed and unknown inputs', () => {
  assert.throws(()=>run('metrics',{observations:Array(129).fill(rows[0])}),/LIMIT/)
  assert.throws(()=>run('metrics',{observations:[rows[0],{...rows[0],ok:true}]}),/CONFLICTING/)
  assert.throws(()=>run('metrics',{observations:[{...rows[0],ms:-1}]}),/INVALID/)
  assert.throws(()=>run('handoff',{missionRef:'m',sourceModel:'a',targetModel:'b',pending:['t'],completed:['t'],evidenceRefs:[]}),/CONFLICTING/)
  assert.throws(()=>run('nope',{}),/UNKNOWN/)
  assert.throws(()=>runEvolution('metrics',' '.repeat(32769)),/LIMIT/)
})

test('live session projection bounds the scan and returns counters, never event content', () => {
  const events = [
    ...Array.from({length: 130}, () => ({type:'turn/end',data:{reason:{kind:'completed'}}})),
    {type:'llm/retry-started',data:{secret:'DO_NOT_COPY'}},
    {type:'llm/retry-started',data:{}},
    {type:'tool/result',data:{message:{content:[{type:'tool-result',isError:true,text:'DO_NOT_COPY'}]}}},
    {type:'turn/end',data:{reason:{kind:'error'}}},
  ]
  const result = summarizeEvolutionEvents(events)
  assert.equal(result.sampledEvents,128)
  assert.equal(result.truncated,true)
  assert.equal(result.completedTurns,124)
  assert.equal(result.failedTurns,1)
  assert.equal(result.toolErrors,1)
  assert.deepEqual(result.recommendations,['investigate-retry-pattern'])
  assert.equal(result.qualityVerified,false)
  assert.ok(!JSON.stringify(result).includes('DO_NOT_COPY'))
})

test('idle consolidation replaces snapshots and isolates live sessions', () => {
  const cache = new IdleEvolutionCache(), a = {}, b = {}
  const events = [{type:'llm/retry-started',data:{}},{type:'llm/retry-started',data:{}}]
  cache.observe(a, 2, events)
  assert.deepEqual(cache.read(a).recommendations,['investigate-retry-pattern'])
  assert.equal(cache.read(b),undefined)
  cache.read(a).recommendations.length = 0
  assert.equal(cache.read(a).recommendations.length,1)
  cache.observe(a, 3, [{type:'turn/end',data:{reason:{kind:'completed'}}}])
  assert.deepEqual(cache.read(a).recommendations,[])
})
test('intent classification works from actual explicit Spanish and English tasks', () => {
  assert.equal(inferEvolutionIntent('Arreglar el timeout de Gemma'),'debugging')
  assert.equal(inferEvolutionIntent('Cambiar de modelo'),'switching')
  assert.equal(inferEvolutionIntent('Diseñar la arquitectura'),'planning')
  assert.equal(inferEvolutionIntent('Aprender una habilidad'),'learning')
  assert.equal(inferEvolutionIntent('Hola'),'unknown')
})
