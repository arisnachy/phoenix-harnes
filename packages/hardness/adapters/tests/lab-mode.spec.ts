import { describe, expect, it } from 'vitest'
import { LabMode, SelfImprovementLedger } from '../src/lab-mode.ts'

describe('HARDNESS LabMode', () => {
  it('records experiments and freezes only after holdout validation', () => {
    const lab = new LabMode('phoenix-hardness')
    lab.record({ id: 'exp-1', hypothesis: 'visual route is stable', metric: 'pass-rate', baseline: 0.5, result: 1, datasetHash: 'sha256:x', holdout: false })
    expect(lab.snapshot().frozen).toEqual([])
    expect(() => lab.freeze('exp-1')).toThrow('holdout')
    lab.record({ id: 'exp-1-holdout', hypothesis: 'visual route is stable', metric: 'pass-rate', baseline: 0.5, result: 1, datasetHash: 'sha256:x-holdout', holdout: true })
    expect(lab.freeze('exp-1-holdout')).toBe('exp-1-holdout')
    expect(lab.snapshot().frozen).toEqual(['exp-1-holdout'])
  })

  it('restores lab and ledger state from durable snapshots', () => {
    const source = new LabMode('phoenix-hardness')
    source.record({ id: 'exp-restore', hypothesis: 'x', metric: 'm', baseline: 1, result: 1, datasetHash: 'sha256:y', holdout: true })
    source.freeze('exp-restore')
    const restored = new LabMode('phoenix-hardness')
    restored.restore(source.snapshot())
    expect(restored.snapshot().frozen).toEqual(['exp-restore'])

    const ledger = new SelfImprovementLedger()
    ledger.restore([{ id: 'r', hypothesis: 'h', change: 'c', rollback: 'rb', sideEffects: [] }])
    expect(ledger.snapshot()).toHaveLength(1)
  })

  it('ledger records rollback and side effects without mutating protected surfaces', () => {
    const ledger = new SelfImprovementLedger()
    ledger.record({ id: 'change-1', hypothesis: 'reduce context', change: 'trim skill', rollback: 'restore skill', sideEffects: ['none'] })
    expect(ledger.snapshot()).toEqual([{ id: 'change-1', hypothesis: 'reduce context', change: 'trim skill', rollback: 'restore skill', sideEffects: ['none'] }])
  })
})
