import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeExperiment } from '../src/scientific-intelligence.ts'
test('seeded analysis is reproducible, bounded and noncausal',()=>{
  const input={control:[1,2,3,4,5],intervention:[11,12,13,14,15],seed:42}
  const result=analyzeExperiment(input)
  assert.deepEqual(result,analyzeExperiment(input))
  assert.equal(result.meanDifference,10)
  assert.ok(result.pValue<0.05)
  assert.equal(result.causalProof,false)
  assert.equal(analyzeExperiment({...input,intervention:input.control}).pValue,1)
  assert.throws(()=>analyzeExperiment({...input,control:[1,2]}))
  assert.throws(()=>analyzeExperiment({...input,seed:-1}))
})
