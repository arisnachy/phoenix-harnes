import { describe, expect, it } from 'vitest'
import {
  assessUniversalEvolution,
  verifyEvolutionBaseline,
  verifyEvolutionCheckpoint,
  verifyEvolutionTransfer,
  verifyEvolutionProbe,
  type EvolutionBaseline,
  type EvolutionCheckpoint,
  type EvolutionTransfer,
  type EvolutionProbe,
} from '../src/universal-evolution.ts'
import { GeneralizationGate } from '../src/generalization-gate.ts'

const baseline: EvolutionBaseline = {
  workspaceId: 'workspace-1', datasetHash: 'sha256:held-out-v1',
  rubricId: 'rubric-v1', locked: true,
  domains: ['code', 'research', 'browser', 'visual', 'game', 'document', 'business'],
}
const checkpoint: EvolutionCheckpoint = {
  missionId: 'mission-1', revision: 1, modelRoute: 'codex/default',
  objective: 'Create verified user artifact', status: 'DONE',
  verified: true, evidence: ['judge:pass'],
}
const transfer: EvolutionTransfer = {
  sourceScope: 'workspace-1', targetScope: 'workspace-1',
  sourceVerified: true, evidenceIds: ['mission:verified'], relevant: true,
  reviewedForTarget: false, permissionCompatible: true, expired: false,
}
const probe: EvolutionProbe = {
  action: 'sandbox', risk: 'medium', sandboxed: true,
  rollbackId: 'checkpoint:one', observationId: 'observation:one', attempt: 1,
}
function passingGeneralization() {
  const gate = new GeneralizationGate()
  for (const domain of baseline.domains) {
    for (const task of ['novel-one', 'novel-two']) {
      gate.record({
        id: domain + ':' + task,
        proposalId: 'strategy-v2',
        modelRoute: 'deepseek/v4',
        domain,
        taskId: task,
        split: 'holdout',
        datasetHash: baseline.datasetHash,
        evidenceId: 'judge:' + domain + ':' + task,
        verified: true,
        baseline: { quality: 0.72, cost: 10, latencyMs: 1000 },
        candidate: { quality: 0.81, cost: 7, latencyMs: 900 },
      })
    }
  }
  return gate.assess('strategy-v2')
}

describe('six-phase provider-neutral evolution policy', () => {
  it('phase 1 freezes scoped multi-domain baseline before results count', () => {
    expect(verifyEvolutionBaseline(baseline).allowed).toBe(true)
    expect(verifyEvolutionBaseline({ ...baseline, locked: false }).allowed).toBe(false)
    expect(verifyEvolutionBaseline({ ...baseline, domains: ['code', 'code'] }).allowed).toBe(false)
    expect(verifyEvolutionBaseline({ ...baseline, datasetHash: '' }).allowed).toBe(false)
  })

  it('phase 2 distinguishes a real verified durable mission from an unchecked completion', () => {
    expect(verifyEvolutionCheckpoint(checkpoint).allowed).toBe(true)
    expect(verifyEvolutionCheckpoint({ ...checkpoint, verified: false }).allowed).toBe(false)
    expect(verifyEvolutionCheckpoint({ ...checkpoint, evidence: [] }).allowed).toBe(false)
    expect(verifyEvolutionCheckpoint({ ...checkpoint, status: 'WAITING_EXTERNAL', verified: false }).allowed).toBe(true)
    expect(verifyEvolutionCheckpoint({ ...checkpoint, revision: -1 }).allowed).toBe(false)
  })

  it('phase 3 will not propagate stale or unproven knowledge across providers or owners', () => {
    expect(verifyEvolutionTransfer(transfer).allowed).toBe(true)
    expect(verifyEvolutionTransfer({ ...transfer, sourceVerified: false }).allowed).toBe(false)
    expect(verifyEvolutionTransfer({ ...transfer, expired: true }).allowed).toBe(false)
    expect(verifyEvolutionTransfer({ ...transfer, relevant: false }).allowed).toBe(false)
    expect(verifyEvolutionTransfer({ ...transfer, permissionCompatible: false }).allowed).toBe(false)
    expect(verifyEvolutionTransfer({ ...transfer, targetScope: 'workspace-other' }).allowed).toBe(false)
    expect(verifyEvolutionTransfer({ ...transfer, targetScope: 'workspace-other', reviewedForTarget: true }).allowed).toBe(true)
  })

  it('phase 4 confines environment exploration to reversible bounded experiments', () => {
    expect(verifyEvolutionProbe(probe).allowed).toBe(true)
    expect(verifyEvolutionProbe({ ...probe, rollbackId: undefined }).allowed).toBe(false)
    expect(verifyEvolutionProbe({ ...probe, sandboxed: false }).allowed).toBe(false)
    expect(verifyEvolutionProbe({ ...probe, attempt: 4 }).allowed).toBe(false)
    expect(verifyEvolutionProbe({ ...probe, action: 'external-write' }).allowed).toBe(false)
    expect(verifyEvolutionProbe({ ...probe, risk: 'high' }).allowed).toBe(false)
    expect(verifyEvolutionProbe({ ...probe, action: 'read', risk: 'high' }).allowed).toBe(true)
  })

  it('phases 5 and 6 require independent improvement and a full seven-domain transfer suite', () => {
    const outcome = assessUniversalEvolution(baseline, checkpoint, transfer, probe, passingGeneralization())
    expect(outcome.phases.map(phase => phase.state)).toEqual([
      'verified', 'verified', 'verified', 'verified', 'verified', 'verified',
    ])
    expect(outcome.readyForIndependentReview).toBe(true)
    expect(outcome.generalIntelligenceCertified).toBe(false)
    expect(outcome.deploymentAuthorized).toBe(false)
  })

  it('blocks full review when a candidate was only verified on some domains', () => {
    const gate = new GeneralizationGate()
    for (const domain of ['code', 'research', 'browser']) {
      for (const task of ['a', 'b']) {
        gate.record({
          id: domain + task,
          proposalId: 'narrow-route',
          modelRoute: 'codex',
          domain, taskId: task, split: 'holdout',
          datasetHash: baseline.datasetHash,
          evidenceId: 'receipt:' + domain + task,
          verified: true,
          baseline: { quality: 0.5, cost: 10, latencyMs: 1000 },
          candidate: { quality: 0.8, cost: 8, latencyMs: 900 },
        })
      }
    }
    const readiness = assessUniversalEvolution(baseline, checkpoint, transfer, probe, gate.assess('narrow-route'))
    expect(readiness.phases[4]?.state).toBe('verified')
    expect(readiness.phases[5]?.state).toBe('blocked')
    expect(readiness.readyForIndependentReview).toBe(false)
  })

  it('blocks review if any prior phase is unverified despite benchmark wins', () => {
    const result = assessUniversalEvolution(
      baseline,
      { ...checkpoint, verified: false },
      { ...transfer, sourceScope: 'another-project', expired: true },
      { ...probe, action: 'external-write' },
      passingGeneralization(),
    )
    expect(result.phases.map(phase => phase.state)).toEqual([
      'verified', 'blocked', 'blocked', 'blocked', 'verified', 'verified',
    ])
    expect(result.readyForIndependentReview).toBe(false)
  })
})
