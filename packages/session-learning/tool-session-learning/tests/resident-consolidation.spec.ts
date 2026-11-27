import { describe, expect, it } from 'vitest'
import type { CognitiveMemoryRecord } from '@phoenix-ai/dsh-session-learning'
import { consolidateScope, ResidentConsolidation, explicitInteractionSignals, interactionGuidance } from '../src/resident-consolidation.ts'

function row(owner: string, status: CognitiveMemoryRecord['status'] = 'active', projectId = 'p'): CognitiveMemoryRecord {
  return { sessionId: owner, projectId, status, kind: 'pending', layers: ['autobiographical', 'prospective'], lastObservedAt: 10 } as unknown as CognitiveMemoryRecord
}

describe('resident consolidation', () => {
  it('isolates owners and projects and ignores forgotten records', () => {
    const result = consolidateScope([row('a'), row('b'), row('a', 'forgotten'), row('a', 'active', 'q')], 'a', 'p', 20)
    expect(result.sampledRecords).toBe(1)
    expect(result.prospective).toBe(1)
    expect(result.curiosity).toBe('review-existing-missions')
    expect(result.autonomousExternalActions).toBe(false)
  })
  it('records real resident cycles but reads current ledger after forgetting', () => {
    let records = [row('a')]
    const resident = new ResidentConsolidation(() => records)
    resident.observe('a', 'p')
    resident.cycle(20)
    expect(resident.inspect('a', 'p', 21).lastCycleAt).toBe(20)
    records = []
    expect(resident.inspect('a', 'p', 22).sampledRecords).toBe(0)
    resident.clear()
    expect(resident.inspect('a', 'p', 23).lastCycleAt).toBeNull()
  })
  it('uses explicit correction, execution and frustration signals without inferring emotion', () => {
    expect(explicitInteractionSignals('Estoy frustrado').explicitFrustration).toBe(true)
    expect(explicitInteractionSignals('La aplicación falla').explicitFrustration).toBe(false)
    expect(explicitInteractionSignals('Estoy frustrado').inferredEmotion).toBe(false)
    expect(interactionGuidance('Completa el trabajo')).toContain('concrete work')
    expect(interactionGuidance('Eso está mal')).toContain('Recheck')
  })
})
