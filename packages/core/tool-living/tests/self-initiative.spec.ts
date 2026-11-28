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

describe('whole PHOENIX evolution capability discovery',()=>{
  it('reports real registered lifecycle tools without requiring an ORION route',()=>{
    const r=assessSelfInitiative('adapt',[],['system_runtime_inspect','cordis_inspect_self','cordis_define','cordis_run','cordis_stop','cordis_undefine','read'])
    expect(r.evolution).toMatchObject({scope:'whole-phoenix',providerIndependent:true,coordinator:'Kira',registrationIsNotPermission:true})
    expect(r.evolution.domains.tools).toMatchObject({inspect:['system_runtime_inspect','cordis_inspect_self'],completeLifecycle:true})
    expect(r.evolution.domains.source.tools).toEqual(['read'])
    expect(r.evolution.domains.interface.state).toBe('requires-live-browser-receipt')
    expect(r.evolution.coreActivation).toBe('independent-review-required')
    expect(r.autoWrites).toBe(false)
  })
  it('never treats a partial extension lifecycle as ready or claims settings authority',()=>{
    const r=assessSelfInitiative('capability',[],['cordis_define','cordis_run'])
    expect(r.evolution.domains.tools.completeLifecycle).toBe(false)
    expect(r.evolution.domains.tools.extensionTools).toEqual(['cordis_define','cordis_run'])
    expect(r.evolution.domains.configuration.state).toBe('inspect-owner-before-proposal')
    expect(r.evolution.verificationTools).toEqual([])
    expect(r.verifiedOutcome).toBe(false)
  })
})
