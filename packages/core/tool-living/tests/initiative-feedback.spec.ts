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

describe('initiative ledger readback',()=>{
  const now=Date.UTC(2026,10,26,12)
  it('rejects a write receipt not present in the durable ledger',async()=>{
    const memory:InitiativeMemory={projectIdForSession:()=>undefined,allCognitiveRecords:()=>[],rememberCognitive:async input=>({...input,status:'active'})}
    await expect(persistInitiativeFeedback({memory,sessionId:'a',eventSeq:1,candidate:'pending-goal',kind:'dismissed',now,ask:{ask:async()=>({answers:[{id:'initiative-feedback-save',selected:['Guardar mi preferencia']}]})}})).rejects.toThrow('READBACK_FAILED')
  })
  it('ignores future timestamps and reads the legacy format only within scope',()=>{
    const memory:InitiativeMemory={projectIdForSession:()=>undefined,allCognitiveRecords:()=>[
      {sessionId:'a',status:'active',subject:'phoenix.initiative.feedback.pending-goal',value:'later',lastObservedAt:now-1},
      {sessionId:'a',status:'active',subject:'phoenix.initiative.feedback.pending-goal',value:JSON.stringify({kind:'dismissed',at:now+1})},
      {sessionId:'b',status:'active',subject:'phoenix.initiative.feedback.standing-goal',value:'useful',lastObservedAt:now-1},
    ],rememberCognitive:async input=>({...input,status:'active'})}
    expect(loadInitiativeFeedback(memory,'a',now)).toEqual([{id:'pending-goal',kind:'later',at:now-1}])
  })
})
