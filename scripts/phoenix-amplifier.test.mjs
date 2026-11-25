import test from 'node:test'
import assert from 'node:assert/strict'
import { runAmplifier } from '../packages/core/tool-living/src/amplifier.ts'
const run=(op,input)=>runAmplifier(op,JSON.stringify(input))
const add=(a,b)=>({op:'add',args:[a,b]})
test('Logos evaluates typed constraints and rejects unsafe arithmetic',()=>{
  assert.deepEqual(run('logos',{variables:{a:2},expression:add({var:'a'},3),constraints:[{op:'eq',value:5},{op:'lt',value:4}]}).checks,[true,false])
  assert.throws(()=>run('logos',{variables:{},expression:{op:'div',args:[1,0]}}),/DIV_ZERO/)
  assert.throws(()=>run('logos',{variables:{},expression:{op:'eval',args:[1,2]}}),/OPERATOR/)
  assert.throws(()=>run('logos',{variables:{},expression:{var:'missing'}}),/UNKNOWN_VARIABLE/)
})
test('Compression executes bounded deterministic recipes with declared outputs',()=>{
  const input={variables:{x:3},steps:[{output:'a',expression:add({var:'x'},2)},{output:'b',expression:add({var:'a'},1)}]}
  assert.equal(run('compression',input).results.b,6)
  assert.deepEqual(run('compression',input),run('compression',input))
  assert.throws(()=>run('compression',{...input,steps:[{output:'x',expression:2}]}),/DUPLICATE_OUTPUT/)
})
test('Compiler detects cycles and missing data dependencies',()=>{
  const steps=[{id:'b',dependsOn:['a'],requires:['data']},{id:'a',dependsOn:[],produces:['data']}]
  assert.deepEqual(run('compile',{steps}).order,['a','b'])
  assert.throws(()=>run('compile',{steps:[{id:'a',dependsOn:['b']},{id:'b',dependsOn:['a']}]}),/CYCLE/)
  assert.throws(()=>run('compile',{steps:[{id:'a',dependsOn:[],requires:['data']}]}),/UNSATISFIED/)
})
test('Epistemic detects contradictions, deduplicates sources and excludes future/expired evidence',()=>{
  const at=1700000000000
  const e=(id,source,stance,observed=at-1,expires=at+1)=>({id,source,stance,observed,expires,claim:'x'})
  const result=run('epistemic',{at,evidence:[e('a','s','supports'),e('b','s','supports'),e('c','t','opposes'),e('d','u','supports',at-2,at),e('e','u','supports',at+1,at+2)]})
  assert.equal(result.claims[0].status,'contradicted')
  assert.equal(result.claims[0].supports,1)
  assert.deepEqual(result.expired,['d'])
  assert.deepEqual(result.future,['e'])
  assert.equal(result.verifiedSources,false)
})
test('Counterfactual evaluates declared equations and never claims causality',()=>{
  const result=run('counterfactual',{baseline:{x:2},interventions:{x:4},equations:[{output:'y',expression:{op:'mul',args:[{var:'x'},3]}}],outcome:'y'})
  assert.equal(result.difference,6)
  assert.equal(result.causalProof,false)
})
test('Analogy checks mapped directed relations',()=>{
  const result=run('analogy',{source:['a','b'],target:['c','d'],mapping:[{source:'a',target:'c'},{source:'b',target:'d'}],sourceEdges:[{from:'a',to:'b',relation:'flow'}],targetEdges:[{from:'d',to:'c',relation:'flow'}]})
  assert.equal(result.matched[0].preserved,false)
})
test('Mentor does not count repeated exercises as independent mastery',()=>{
  const result=run('mentor',{skills:['math'],attempts:Array(3).fill({skill:'math',exercise:'e',correct:true})})
  assert.equal(result.skills[0].status,'insufficient-evidence')
  assert.equal(result.masteryCertified,false)
})
test('Babel detects dropped glossary terms and duplicated placeholders',()=>{
  const result=run('babel',{translation:'Hola {name} {name}',glossary:[{target:'hospital'}],placeholders:['{name}']})
  assert.equal(result.valid,false)
  assert.deepEqual(result.missingTerms,['hospital'])
  assert.equal(result.placeholderCounts[0].count,2)
})
test('Sentinel never confers authority; migration requires tests',()=>{
  assert.equal(run('sentinel',{origin:'external',effect:'write',revisionVerified:true}).status,'review-required')
  assert.equal(run('sentinel',{origin:'user',effect:'read'}).executionAuthorized,false)
  assert.equal(run('morphogenesis',{before:['a','b'],after:['a','c'],preserved:['a']}).requiresBackup,true)
  assert.throws(()=>run('morphogenesis',{before:['a'],after:['b'],preserved:['a']}),/MIGRATION/)
})
test('Input size and unsupported operations fail closed',()=>{
  assert.throws(()=>runAmplifier('logos',' '.repeat(32769)),/LIMIT/)
  assert.throws(()=>run('unknown',{}),/OPERATION/)
})
