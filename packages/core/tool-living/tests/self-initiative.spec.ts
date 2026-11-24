import { describe,it,expect } from 'vitest'
import { assessSelfInitiative } from '../src/self-initiative.ts'
describe('self initiative assessment',()=>{
  it('detects repeated observed retries and only offers registered tools',()=>{
    const r=assessSelfInitiative('auto',[{type:'llm/retry-started',data:{}},{type:'llm/retry-started',data:{}}],['system_runtime_inspect'])
    expect(r.goal).toBe('diagnose')
    expect(r.observedRepeatedFailure).toBe(true)
    expect(r.candidateReadTools).toEqual(['system_runtime_inspect'])
    expect(r.next).toBe('diagnose-before-retry')
    expect(r.autoWrites).toBe(false)
  })
  it('does not invent failures, tool availability or background execution',()=>{
    const r=assessSelfInitiative('adapt',[],[])
    expect(r.observedRepeatedFailure).toBe(false)
    expect(r.candidateReadTools).toEqual([])
    expect(r.next).toBe('inspect-then-propose-reversible-change')
    expect(r.backgroundScheduled).toBe(false)
    expect(r.verifiedOutcome).toBe(false)
  })
})
