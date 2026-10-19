import { describe, expect, it } from 'vitest'
import {
  GeneralizationGate,
  type GeneralizationTrial,
} from '../src/generalization-gate.ts'

const trial = (domain: string, taskId: string, patch: Partial<GeneralizationTrial> = {}): GeneralizationTrial => ({
  id: domain + '-' + taskId,
  proposalId: 'strategy-v2',
  modelRoute: 'openai-codex/model-v2',
  domain,
  taskId,
  split: 'holdout',
  datasetHash: 'sha256:independent-' + domain + '-' + taskId,
  evidenceId: 'host-receipt:' + domain + '-' + taskId,
  verified: true,
  baseline: { quality: 0.70, cost: 10, latencyMs: 1_000 },
  candidate: { quality: 0.78, cost: 8, latencyMs: 900 },
  ...patch,
})

function passingGate(): GeneralizationGate {
  const gate = new GeneralizationGate()
  for (const domain of ['code', 'research', 'browser']) {
    gate.record(trial(domain, 'unseen-1'))
    gate.record(trial(domain, 'unseen-2'))
  }
  return gate
}

describe('HARDNESS General Intelligence Lab', () => {
  it('requires a breadth of independently verified unseen tasks before any review', () => {
    const gate = new GeneralizationGate()
    expect(gate.assess('strategy-v2')).toMatchObject({ status: 'blocked', holdoutTasks: 0 })
    gate.record(trial('code', 'unseen-1'))
    expect(gate.assess('strategy-v2').reasons).toContain('need at least 3 independent holdout domains')
    expect(passingGate().assess('strategy-v2')).toMatchObject({
      status: 'eligible-for-review',
      holdoutTasks: 6,
      domains: ['browser', 'code', 'research'],
      modelRoute: 'openai-codex/model-v2',
    })
  })

  it('rejects mixed routes and unrelated revisions presented as one proposal', () => {
    const gate = passingGate()
    gate.record(trial('math', 'unseen-1', { modelRoute: 'deepseek/model-y' }))
    expect(gate.assess('strategy-v2')).toMatchObject({ status: 'blocked', modelRoute: null })
    expect(gate.assess('strategy-v2').reasons).toContain('proposal mixes model routes or revisions')
  })

  it('rejects duplicated receipts, duplicated tasks, and train/test contamination', () => {
    const gate = passingGate()
    gate.record(trial('code', 'unseen-1', { id: 'extra-id', evidenceId: 'host-receipt:unique' }))
    gate.record(trial('code', 'training', {
      split: 'development',
      taskId: 'unseen-2',
      evidenceId: 'host-receipt:code-unseen-1',
    }))
    const reasons = gate.assess('strategy-v2').reasons.join(' ')
    expect(reasons).toContain('duplicated holdout task')
    expect(reasons).toContain('development/holdout leakage')
    expect(reasons).toContain('reused evidence receipt')
  })

  it('blocks unverified outcome claims and any single-domain quality regression', () => {
    const gate = passingGate()
    gate.record(trial('medicine', 'unseen-1', {
      verified: false,
      candidate: { quality: 1, cost: 0, latencyMs: 0 },
    }))
    expect(gate.assess('strategy-v2').reasons.join(' ')).toContain('unverified independent receipt')
    const regressed = new GeneralizationGate()
    for (const domain of ['code', 'research', 'browser']) {
      regressed.record(trial(domain, 'unseen-1', domain === 'code'
        ? { candidate: { quality: 0.40, cost: 8, latencyMs: 900 } }
        : {}))
      regressed.record(trial(domain, 'unseen-2'))
    }
    expect(regressed.assess('strategy-v2').reasons).toContain('quality regression in domain: code')
  })

  it('rejects slower or costlier strategies even if aggregate quality improves', () => {
    const gate = new GeneralizationGate()
    for (const domain of ['code', 'research', 'browser']) {
      gate.record(trial(domain, 'unseen-1', { candidate: { quality: 0.9, cost: 12, latencyMs: 1_100 } }))
      gate.record(trial(domain, 'unseen-2'))
    }
    expect(gate.assess('strategy-v2').reasons.join(' ')).toContain('cost regression')
    expect(gate.assess('strategy-v2').reasons.join(' ')).toContain('latency regression')
  })

  it('rejects unchanged strategies and allows cost gains without lowering quality', () => {
    const noGain = new GeneralizationGate()
    const cheaper = new GeneralizationGate()
    for (const domain of ['code', 'research', 'browser']) {
      for (const taskId of ['unseen-1', 'unseen-2']) {
        noGain.record(trial(domain, taskId, {
          candidate: { quality: 0.70, cost: 10, latencyMs: 1_000 },
        }))
        cheaper.record(trial(domain, taskId, {
          candidate: { quality: 0.70, cost: 8, latencyMs: 900 },
        }))
      }
    }
    expect(noGain.assess('strategy-v2').reasons).toContain('no material quality or cost improvement over baseline')
    expect(cheaper.assess('strategy-v2').status).toBe('eligible-for-review')
  })

  it('is immutable and preserves rollback-safe snapshot recovery', () => {
    const gate = passingGate()
    const snapshot = gate.snapshot()
    const restored = new GeneralizationGate()
    restored.restore(snapshot)
    expect(restored.assess('strategy-v2')).toEqual(gate.assess('strategy-v2'))
    expect(() => {
      restored.restore({ version: 1, trials: [trial('bad', 'n', {
        baseline: { quality: 99, cost: 0, latencyMs: 0 },
      })] })
    }).toThrow('quality')
    expect(restored.snapshot()).toEqual(snapshot)
    expect(() => {
      gate.record(trial('code', 'unseen-1', { evidenceId: 'other-receipt' }))
    }).toThrow('conflicting trial')
  })

  it('never interprets a review-ready score as an authority to deploy', () => {
    const assessment = passingGate().assess('strategy-v2')
    expect(assessment.status).toBe('eligible-for-review')
    expect(assessment).not.toHaveProperty('approved')
    expect(assessment).not.toHaveProperty('deploy')
    expect(assessment).not.toHaveProperty('promoted')
  })
})
