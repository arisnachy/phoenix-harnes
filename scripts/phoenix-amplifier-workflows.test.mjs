import test from 'node:test'
import assert from 'node:assert/strict'
import {runAmplifier,executeNumericRecipe,verifyNumericRecipe} from '../packages/core/tool-living/src/amplifier.ts'
import {saveNumericRecipe,runStoredNumericRecipe} from '../packages/core/tool-living/src/amplifier-memory.ts'
import {livingActionSafety} from '../packages/core/tool-living/src/living-action-safety.ts'
const run=(op,x)=>runAmplifier(op,JSON.stringify(x))
const program={inputs:['x'],steps:[{id:'final',dependsOn:['first'],output:'z',expression:{op:'add',args:[{var:'y'},1]}},{id:'first',dependsOn:[],output:'y',expression:{op:'mul',args:[{var:'x'},2]}}]}
const recipe={program,fixtures:[1,2,3].map(x=>({inputs:{x},expected:{y:x*2,z:x*2+1}}))}
test('compiler executes topologically and validates actual numeric references and fixtures',()=>{
  const result=executeNumericRecipe(program,{x:4})
  assert.deepEqual(result.order,['first','final'])
  assert.equal(result.results.z,9)
  assert.throws(()=>executeNumericRecipe({...program,steps:[{...program.steps[0],dependsOn:[]},program.steps[1]]},{x:1}),/UNSATISFIED/)
  assert.throws(()=>executeNumericRecipe(program,{x:1,extra:2}),/INPUTS/)
  assert.equal(verifyNumericRecipe(recipe).passed,3)
  assert.throws(()=>verifyNumericRecipe({...recipe,fixtures:[recipe.fixtures[0],recipe.fixtures[0],recipe.fixtures[1]]}),/DUPLICATE_FIXTURE/)
  assert.throws(()=>verifyNumericRecipe({...recipe,fixtures:[...recipe.fixtures.slice(0,2),{inputs:{x:3},expected:{y:6,z:0}}]}),/FIXTURE_FAILED/)
})
test('saved recipes require human approval, are deduplicated, scope-bound and tamper-checked',async()=>{
  const records=[]
  let approvals=0
  const memory={projectIdForSession:id=>id==='s'||id==='s2'?'p':'other',allCognitiveRecords:()=>records,rememberCognitive:async input=>{const row={...input,status:'active'};records.push(row);return row}}
  const context={memory,sessionId:'s',eventSeq:1,ask:{ask:async()=>{approvals++;return {answers:[{id:'amplifier-save-recipe',selected:['Guardar este procedimiento numérico']}]}}}}
  await assert.rejects(saveNumericRecipe(JSON.stringify(recipe),{...context,ask:undefined}),/APPROVAL_REQUIRED/)
  const saved=await saveNumericRecipe(JSON.stringify(recipe),context)
  assert.equal(records.length,1)
  assert.equal((await saveNumericRecipe(JSON.stringify(recipe),context)).reused,true)
  assert.equal(approvals,1)
  assert.equal(runStoredNumericRecipe(saved.id,{x:5},{...context,sessionId:'s2'}).results.z,11)
  assert.throws(()=>runStoredNumericRecipe(saved.id,{x:5},{...context,sessionId:'outside'}),/NOT_FOUND/)
  records[0].value+=' '
  assert.throws(()=>runStoredNumericRecipe(saved.id,{x:5},context),/NOT_FOUND/)
})
test('expired-only claims remain explicit unknown, not silently supported',()=>{
  const report=run('epistemic',{at:10,evidence:[{id:'e',claim:'claim',source:'src',observed:1,expires:9,stance:'supports'}]})
  assert.equal(report.claims[0].status,'no-current-evidence')
})
test('analogy search selects a directed relation-preserving mapping',()=>{
  const result=run('analogy-find',{source:['a','b'],target:['c','d'],sourceEdges:[{from:'a',to:'b',relation:'flow'}],targetEdges:[{from:'d',to:'c',relation:'flow'}]})
  assert.equal(result.preserved,1)
  assert.deepEqual(result.mapping,[{source:'a',target:'d'},{source:'b',target:'c'}])
})
test('objective exercise scoring and segment checks do not infer verified mastery or meaning',()=>{
  const result=run('mentor-grade',{skills:['math'],exercises:[{id:'a',skill:'math',expected:3,answer:2}]})
  assert.equal(result.attempts[0].correct,false)
  assert.deepEqual(result.practiceNext,['math'])
  const checked=run('babel-segments',{segments:[{id:'a',source:'Hospital {name} {name}',translation:'Hospital {name}'}],glossary:[{source:'Hospital',target:'Hospital'}]})
  assert.equal(checked.valid,false)
  assert.equal(checked.segments[0].placeholdersPreserved,false)
})
test('Sentinel deny-only connector safety rejects protected fields, credentials and URLs',()=>{
  assert.equal(livingActionSafety({count:2,operation:'adjust-stock'}),true)
  assert.equal(livingActionSafety({nested:{patientId:'synthetic'}}),false)
  assert.equal(livingActionSafety({description:'https://external.invalid'}),false)
  assert.equal(livingActionSafety({password:'not-a-real-secret'}),false)
  assert.equal(livingActionSafety(JSON.parse('{"__proto__":{}}')),false)
})
