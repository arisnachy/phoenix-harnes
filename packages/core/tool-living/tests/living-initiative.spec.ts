import { describe, expect, it } from 'vitest'
import { goalSummary, initiativeCandidates, LivingInitiative } from '../src/living-initiative.ts'
describe('living initiative',()=>{
  const now=new Date(2026,10,26,14).getTime()
  const events=[{type:'llm/retry-started',data:{}},{type:'llm/retry-started',data:{}}]
  it('ranks actual operational evidence and does not grant action authority',()=>{
    const result=initiativeCandidates({events,registered:['phoenix_self_assess','system_environment_inspect'],now,free:5,total:100})
    expect(result.candidates.map(x=>x.id)).toEqual(['repeated-failure','memory-pressure'])
    expect(result.externalActions).toBe(false)
    expect(result.voiceDelivered).toBe(false)
  })
  it('uses only active consent-independent cognitive metadata, never contents',()=>{
    const record={id:'a',status:'active',kind:'mission',confidence:0.9,content:'secret'}
    expect(goalSummary({focus:{record},active:[{record}]})).toMatchObject({goals:1,pending:0,rawContentExposed:false})
    expect(JSON.stringify(goalSummary({focus:{record}}))).not.toContain('secret')
  })
  it('honors scoped feedback and expires snooze',()=>{
    let clock=now
    const subject=new LivingInitiative(()=>clock,()=>({free:50,total:100}))
    const tools=['phoenix_self_assess']
    expect(subject.inspect('a',events,tools).candidates).toHaveLength(1)
    subject.feedback('a','repeated-failure','later')
    expect(subject.inspect('a',events,tools).candidates).toHaveLength(0)
    expect(subject.inspect('b',events,tools).candidates).toHaveLength(1)
    clock+=3600001
    expect(subject.inspect('a',events,tools).candidates).toHaveLength(1)
  })
  it('does not invent candidates for missing tools or empty evidence',()=>{
    expect(initiativeCandidates({events:[],registered:[],now,free:80,total:100}).candidates).toEqual([])
  })
})

  // Persistent receipts are detached and applied before ranking.
  it('applies scoped persisted feedback without inferring permission',()=>{
    const now=Date.now(),subject=new LivingInitiative(()=>now,()=>({free:50,total:100}))
    const events=[{type:'llm/retry-started',data:{}},{type:'llm/retry-started',data:{}}]
    expect(subject.inspect('s',events,['phoenix_self_assess'],undefined,[{id:'repeated-failure',kind:'dismissed',at:now}]).candidates).toEqual([])
  })
