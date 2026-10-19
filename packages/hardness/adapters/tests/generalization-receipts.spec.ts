import type { SessionEvent } from '@phoenix-ai/dsh-session'
import { GeneralizationGate } from '@phoenix-ai/dsh-hardness'
import { describe, expect, it } from 'vitest'
import {
  GeneralizationReceiptBridge,
  verifyTrustedMissionReceipt,
  type GeneralizationReceiptReader,
  type TrustedEvaluationReceipt,
} from '../src/generalization-receipts.ts'

function receipt(domain: string, task: string, variant: 'baseline' | 'candidate'): TrustedEvaluationReceipt {
  const id = domain + ':' + task + ':' + variant
  return {
    id,
    sessionId: 'session:' + id,
    missionId: 'mission:' + id,
    missionRevision: 1,
    callId: 'call:' + id,
    evidenceId: 'evidence:' + id,
    artifactId: 'artifact:' + id,
    domain,
    taskId: task,
    split: 'holdout',
    datasetHash: 'dataset:2026-10',
    rubricId: 'rubric:1',
    ownerScope: 'workspace:one',
    executorId: 'executor:' + variant,
    evaluatorId: 'independent:judge',
    modelRoute: variant === 'baseline' ? 'codex/old' : 'deepseek/new',
    metrics: variant === 'baseline'
      ? { quality: 0.7, cost: 10, latencyMs: 1000 }
      : { quality: 0.8, cost: 8, latencyMs: 900 },
  }
}

function event<T>(type: string, data: T): SessionEvent {
  return { type, data } as unknown as SessionEvent
}

function missionEvents(row: TrustedEvaluationReceipt, status: 'pass' | 'fail' = 'pass'): readonly SessionEvent[] {
  const judge = {
    verdict: status === 'pass' ? 'pass' : 'needs_changes',
    summary: 'Independent evidence review',
    evidence: [row.evidenceId],
    requiredChanges: [],
    criteria: [],
    quality: { verdict: 'pass', summary: 'Quality passed', evidence: [row.evidenceId], findings: [] },
  }
  return [
    event('hardness/kernel', { kind: 'started', missionId: row.missionId, revision: row.missionRevision,
      status: 'ACTIVE', goal: { objective: 'Verified task', deliverables: [], acceptanceCriteria: [], qualityRequirements: [] } }),
    event('hardness/kernel', { kind: 'judge', missionId: row.missionId, revision: row.missionRevision,
      decision: judge, quality: judge.quality, status: status === 'pass' ? 'DONE' : 'ACTIVE',
      ...status === 'pass' ? { terminalReason: 'verified' } : {} }),
    event('hardness/mission', { callId: row.callId, step: 'verify', outcome: 'completed',
      capabilityKind: 'task', evidenceId: row.evidenceId, artifactId: row.artifactId }),
    event('hardness/mission', { callId: row.callId, step: 'present', outcome: 'completed',
      capabilityKind: 'task', artifactId: row.artifactId }),
    event('hardness/mission', { callId: row.callId, step: 'audit', outcome: 'completed',
      capabilityKind: 'task', evidenceId: row.evidenceId, artifactId: row.artifactId }),
  ]
}

function makeReader() {
  const receipts = new Map<string, TrustedEvaluationReceipt>()
  const sessions = new Map<string, readonly SessionEvent[]>()
  const reader: GeneralizationReceiptReader = {
    async readReceipt(id) { return receipts.get(id) },
    async readSessionEvents(id) { return sessions.get(id) ?? [] },
  }
  const add = (value: TrustedEvaluationReceipt, entries = missionEvents(value)) => {
    receipts.set(value.id, value)
    sessions.set(value.sessionId, entries)
  }
  return { reader, add, receipts, sessions }
}

describe('HARDNESS trusted generalization receipt bridge', () => {
  it('ingests independently verified real mission evidence across domains, with no deployment authority', async () => {
    const { reader, add } = makeReader()
    const gate = new GeneralizationGate()
    const bridge = new GeneralizationReceiptBridge(gate, reader)
    for (const domain of ['code', 'research', 'browser']) {
      for (const task of ['novel-1', 'novel-2']) {
        const baseline = receipt(domain, task, 'baseline')
        const candidate = receipt(domain, task, 'candidate')
        add(baseline)
        add(candidate)
        await bridge.ingest({
          id: 'comparison:' + domain + ':' + task,
          proposalId: 'candidate-strategy-v2',
          baselineReceiptId: baseline.id,
          candidateReceiptId: candidate.id,
        })
      }
    }
    expect(bridge.assess('candidate-strategy-v2')).toMatchObject({
      status: 'eligible-for-review',
      holdoutTasks: 6,
      modelRoute: 'deepseek/new',
    })
    expect(bridge.assess('candidate-strategy-v2')).not.toHaveProperty('deployed')
    expect(gate.snapshot().trials).toHaveLength(6)
  })

  it('does not promote the preliminary audit that occurs before an independent judge', () => {
    const row = receipt('code', 'novel', 'candidate')
    expect(verifyTrustedMissionReceipt(row, missionEvents(row, 'fail'))).toBe(false)
    const log = missionEvents(row, 'pass')
    expect(verifyTrustedMissionReceipt(row, log)).toBe(true)
    expect(verifyTrustedMissionReceipt(row, log.slice(2))).toBe(false)
    expect(verifyTrustedMissionReceipt(row, [...log, event('hardness/mission', {
      callId: row.callId, step: 'audit', outcome: 'blocked', capabilityKind: 'task',
      evidenceId: row.evidenceId, reasonCode: 'judge-needs_changes',
    })])).toBe(false)
  })

  it('rejects a forged artifact or call even if a model claims completion', async () => {
    const { reader, add, sessions } = makeReader()
    const base = receipt('research', 'unseen', 'baseline')
    const cand = receipt('research', 'unseen', 'candidate')
    add(base)
    add(cand)
    sessions.set(cand.sessionId, missionEvents(cand).map(value =>
      value.type === 'hardness/mission' && value.data.step === 'verify'
        ? event('hardness/mission', { ...value.data, artifactId: 'forged-artifact' })
        : value))
    const bridge = new GeneralizationReceiptBridge(new GeneralizationGate(), reader)
    await expect(bridge.ingest({
      id: 'forgery', proposalId: 'v2', baselineReceiptId: base.id, candidateReceiptId: cand.id,
    })).rejects.toThrow('canonical evidence')
  })

  it('rejects comparisons across unrelated workspaces, test splits, tasks or rubrics', async () => {
    const { reader, add } = makeReader()
    const base = receipt('code', 'unseen', 'baseline')
    const cand = { ...receipt('code', 'unseen', 'candidate'), ownerScope: 'workspace:other' }
    add(base)
    add(cand)
    const bridge = new GeneralizationReceiptBridge(new GeneralizationGate(), reader)
    await expect(bridge.ingest({
      id: 'cross-scope', proposalId: 'v2', baselineReceiptId: base.id, candidateReceiptId: cand.id,
    })).rejects.toThrow('not comparable')
  })

  it('rejects agent self-evaluation and missing durable receipt identities', async () => {
    const { reader, add } = makeReader()
    const base = receipt('code', 'novel', 'baseline')
    const cand = receipt('code', 'novel', 'candidate')
    add(base)
    add({ ...cand, evaluatorId: cand.executorId })
    const bridge = new GeneralizationReceiptBridge(new GeneralizationGate(), reader)
    await expect(bridge.ingest({
      id: 'self', proposalId: 'v2', baselineReceiptId: base.id, candidateReceiptId: cand.id,
    })).rejects.toThrow('canonical evidence')
    await expect(bridge.ingest({
      id: 'missing', proposalId: 'v2', baselineReceiptId: 'missing', candidateReceiptId: cand.id,
    })).rejects.toThrow('missing authenticated')
  })

  it('is idempotent and leaves the gate unchanged after a rejected comparison', async () => {
    const { reader, add } = makeReader()
    const base = receipt('code', 'novel', 'baseline')
    const cand = receipt('code', 'novel', 'candidate')
    add(base)
    add(cand)
    const gate = new GeneralizationGate()
    const bridge = new GeneralizationReceiptBridge(gate, reader)
    const pair = { id: 'pair-one', proposalId: 'v2', baselineReceiptId: base.id, candidateReceiptId: cand.id }
    await bridge.ingest(pair)
    await bridge.ingest(pair)
    expect(gate.snapshot().trials).toHaveLength(1)
    await expect(bridge.ingest({ ...pair, id: 'invalid', baselineReceiptId: 'unknown' })).rejects.toThrow()
    expect(gate.snapshot().trials).toHaveLength(1)
  })
})
