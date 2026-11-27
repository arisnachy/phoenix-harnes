import { describe, expect, it } from 'vitest'
import { loadInitiativeFeedback, persistInitiativeFeedback, type InitiativeMemory } from '../src/initiative-feedback.ts'
describe('durable initiative feedback',()=>{
  const now=Date.UTC(2026,10,26,12)
  const make=()=>{
    const rows:ReturnType<InitiativeMemory['allCognitiveRecords']>=[]
    const memory:InitiativeMemory={projectIdForSession:id=>id==='a'||id==='b'?'p':undefined,allCognitiveRecords:()=>rows,rememberCognitive:async input=>{const row={...input,status:'active'};rows.push(row);return row}}
    return {memory,rows}
  }
  it('rejects automatic approval and writes nothing',async()=>{
    const {memory,rows}=make()
    await expect(persistInitiativeFeedback({memory,sessionId:'a',eventSeq:1,candidate:'pending-goal',kind:'dismissed',now,ask:{ask:async()=>({automatic:true,answers:[{id:'initiative-feedback-save',selected:['Guardar mi preferencia']}]})}})).rejects.toThrow('APPROVAL_REQUIRED')
    expect(rows).toHaveLength(0)
  })
  it('reads approved preferences across project sessions but never outside scope',async()=>{
    const {memory}=make()
    const result=await persistInitiativeFeedback({memory,sessionId:'a',eventSeq:1,candidate:'pending-goal',kind:'dismissed',now,ask:{ask:async()=>({answers:[{id:'initiative-feedback-save',selected:['Guardar mi preferencia']}]})}})
    expect(result.persistent).toBe(true)
    expect(loadInitiativeFeedback(memory,'b',now+1)).toEqual([{id:'pending-goal',kind:'dismissed',at:now}])
    expect(loadInitiativeFeedback(memory,'outside',now+1)).toEqual([])
    expect(loadInitiativeFeedback(memory,'a',now+31*86400000)).toEqual([])
  })
})
