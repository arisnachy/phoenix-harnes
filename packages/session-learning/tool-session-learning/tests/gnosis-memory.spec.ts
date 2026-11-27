import { describe, expect, it } from 'vitest'
import type { CognitiveMemoryHit } from '@phoenix-ai/dsh-session-learning'
import { projectGnosisMemory } from '../src/gnosis-memory.ts'
function hit(id: string, sessionId = 'owner', status = 'active', validUntil?: number): CognitiveMemoryHit {
  return { record: { id, sessionId, status, validUntil, kind:'lesson', eventSeq:5, confidence:.9,
    provenance:{occurredAt:100}, summary:'PRIVATE', content:'PRIVATE',
    entities:[{type:'tool',normalized:'file_read'},{type:'person',normalized:'PRIVATE'}],
    relations:[{type:'mentions',from:id,to:'file_read'},{type:'mentions',from:id,to:'PRIVATE'}],
  }, score:1, reasons:[] } as unknown as CognitiveMemoryHit
}
describe('GNOSIS memory projection', () => {
  it('isolates the owner and excludes forgotten, superseded and expired records', () => {
    const result = projectGnosisMemory([hit('a'),hit('b','other'),hit('c','owner','forgotten'),hit('d','owner','superseded'),hit('e','owner','active',10)],'owner',20)
    expect(result.nodes.map(node=>node.id)).toEqual(['a'])
    expect(result.nodes[0]?.relations).toEqual([{type:'mentions',from:'a',to:'file_read',evidence:'stored-unverified-relation'}])
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })
  it('caps the graph without introducing independent certainty', () => {
    const result=projectGnosisMemory(Array.from({length:20},(_,i)=>hit('m'+i)),'owner',20)
    expect(result.nodes).toHaveLength(8)
    expect(result.nodes[0]?.basis).toBe('stored-memory-not-independent-proof')
  })
})
