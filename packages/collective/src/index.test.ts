import { describe, expect, it } from 'vitest';
import {
  ContributionLedger,
  EvolutionAgent,
  EvolutionBudgetGate,
  EvolutionCellCoordinator,
  EvolutionJudgePanel,
  EvolutionMicroTaskBroker,
  createEvolutionCapsule,
  createEvolutionProblem,
  type CandidateImprovement,
  type EvolutionNodeProfile,
  type JudgeVerdict,
} from './index.js';

function node(index: number): EvolutionNodeProfile {
  return {
    nodeId: `node-${index}`,
    phoenixVersion: '0.4.0',
    platform: index % 2 ? 'linux' : 'windows',
    capabilities: index % 3 === 0 ? ['typescript', 'benchmark', 'security'] : ['typescript', 'benchmark'],
    modelTier: index % 5 === 0 ? 'frontier' : index % 2 === 0 ? 'medium' : 'small',
    judgeReliability: 0.75 + (index % 4) * 0.05,
    contributionReliability: 0.7 + (index % 5) * 0.04,
    optIn: true,
    budget: {
      maxAiTokens: 250,
      maxCpuMs: 20_000,
      maxNetworkBytes: 50_000,
      maxSubscriptionCalls: 0,
    },
  };
}

function verdict(candidateId: string, problemId: string, judgeNodeId: string, vote: 'approve' | 'reject' | 'abstain' = 'approve'): JudgeVerdict {
  return {
    candidateId,
    problemId,
    judgeNodeId,
    vote,
    confidence: 0.9,
    reasons: ['reproduced independently'],
    checks: {
      reproduced: true,
      testsPassed: true,
      securityReviewed: true,
      tokenEconomyReviewed: true,
    },
    createdAt: new Date().toISOString(),
  };
}

describe('PHOENIX Collective Evolution Mesh', () => {
  it('keeps the user contribution inside a hard daily budget', () => {
    const gate = new EvolutionBudgetGate({
      maxAiTokens: 200,
      maxCpuMs: 1_000,
      maxNetworkBytes: 2_000,
      maxSubscriptionCalls: 0,
    });
    gate.spend({ aiTokens: 120, cpuMs: 300, networkBytes: 500 });
    expect(gate.remaining().aiTokens).toBe(80);
    expect(() => gate.spend({ aiTokens: 81 })).toThrow(/daily budget/);
    expect(() => gate.spend({ subscriptionCalls: 1 })).toThrow(/daily budget/);
  });

  it('gives every opted-in harness an evolution agent that offers only a tiny bounded share', () => {
    const problem = createEvolutionProblem({
      kind: 'efficiency',
      title: 'Repeated tool schemas waste tokens',
      severity: 'medium',
      description: 'MCP schemas are repeatedly injected into context.',
      requiredCapabilities: ['benchmark'],
    });
    const agent = new EvolutionAgent(node(2));
    const offer = agent.offer(problem);
    expect(offer).toBeDefined();
    expect(offer?.maxAiTokens).toBeLessThanOrEqual(250);
    expect(offer?.maxCpuMs).toBeLessThanOrEqual(15_000);
  });

  it('forms temporary problem cells with contributors and completely independent judges', () => {
    const problem = createEvolutionProblem({
      kind: 'bug',
      title: 'Rebirth loses provider session',
      severity: 'high',
      description: 'A provider session id disappears after checkpoint recovery.',
      requiredCapabilities: ['typescript'],
    });
    const coordinator = new EvolutionCellCoordinator();
    const cell = coordinator.formCell(problem, Array.from({ length: 16 }, (_, index) => node(index + 1)), {
      contributorCount: 6,
      judgeCount: 5,
      maxTokensPerContributor: 180,
    });
    const contributors = new Set(cell.contributors.map((item) => item.nodeId));
    expect(cell.contributors).toHaveLength(6);
    expect(cell.judges).toHaveLength(5);
    expect(cell.judges.every((judge) => !contributors.has(judge.nodeId))).toBe(true);
    expect(cell.contributors.every((item) => item.aiTokenBudget <= 180)).toBe(true);
    expect(new EvolutionMicroTaskBroker().tasks(cell)).toHaveLength(6);
  });

  it('deduplicates equivalent contribution evidence and keeps capsules compact/private by contract', () => {
    const problem = createEvolutionProblem({
      kind: 'capability_gap',
      title: 'Need parser',
      severity: 'medium',
      description: 'No parser exists for a deterministic format.',
      requiredCapabilities: ['parser'],
    });
    const capsule = createEvolutionCapsule(problem, '0.4.0', 'Parser capability missing', { failures: 3 });
    expect(capsule.privacy.rawPromptIncluded).toBe(false);
    expect(capsule.privacy.secretsIncluded).toBe(false);

    const ledger = new ContributionLedger();
    const evidence = {
      contributionId: 'a',
      nodeId: 'node-a',
      problemId: problem.id,
      role: 'reproducer' as const,
      summary: 'same reproduction',
      reproducible: true,
      metrics: { failures: 3 },
      spend: { aiTokens: 0, cpuMs: 100, networkBytes: 0, subscriptionCalls: 0 },
      createdAt: new Date().toISOString(),
    };
    expect(ledger.add(evidence)).toBe(true);
    expect(ledger.add({ ...evidence, contributionId: 'b', nodeId: 'node-b' })).toBe(false);
  });

  it('approves only when independent judges reproduce a candidate and all hard gates pass', () => {
    const problem = createEvolutionProblem({
      kind: 'evolution',
      title: 'Reduce context tokens',
      severity: 'medium',
      description: 'Test a challenger context compiler.',
      requiredCapabilities: ['typescript', 'benchmark'],
    });
    const cell = new EvolutionCellCoordinator().formCell(problem, Array.from({ length: 18 }, (_, index) => node(index + 1)), {
      contributorCount: 5,
      judgeCount: 5,
    });
    const candidate: CandidateImprovement = {
      id: 'candidate-1',
      problemId: problem.id,
      baseSha: 'abc',
      artifactHash: 'hash',
      contributionNodeIds: cell.contributors.map((item) => item.nodeId),
      metrics: {
        qualityDelta: 0.01,
        successRateDelta: 0.02,
        freshTokensDeltaPct: -35,
        latencyDeltaPct: -8,
        regressionCount: 0,
        securityPassed: true,
        reproducibleRuns: 8,
      },
      createdAt: new Date().toISOString(),
    };
    const verdicts = cell.judges.slice(0, 4).map((judge) => verdict(candidate.id, problem.id, judge.nodeId));
    const decision = new EvolutionJudgePanel().decide(cell, candidate, verdicts, { minimumJudges: 4 });
    expect(decision.status).toBe('approved');
    expect(decision.eligibleForPullRequest).toBe(true);
    expect(decision.requiresProtectedBranchGate).toBe(true);
  });

  it('rejects a candidate with regressions even if every judge votes approve', () => {
    const problem = createEvolutionProblem({
      kind: 'evolution',
      title: 'Aggressive routing optimization',
      severity: 'high',
      description: 'A fast challenger accidentally breaks one regression test.',
      requiredCapabilities: ['benchmark'],
    });
    const cell = new EvolutionCellCoordinator().formCell(problem, Array.from({ length: 14 }, (_, index) => node(index + 1)), {
      contributorCount: 4,
      judgeCount: 4,
    });
    const candidate: CandidateImprovement = {
      id: 'candidate-bad',
      problemId: problem.id,
      baseSha: 'abc',
      artifactHash: 'bad',
      contributionNodeIds: cell.contributors.map((item) => item.nodeId),
      metrics: {
        qualityDelta: 0.2,
        successRateDelta: 0.1,
        freshTokensDeltaPct: -70,
        latencyDeltaPct: -50,
        regressionCount: 1,
        securityPassed: true,
        reproducibleRuns: 20,
      },
      createdAt: new Date().toISOString(),
    };
    const verdicts = cell.judges.map((judge) => verdict(candidate.id, problem.id, judge.nodeId, 'approve'));
    const decision = new EvolutionJudgePanel().decide(cell, candidate, verdicts, { minimumJudges: 3 });
    expect(decision.status).toBe('rejected');
    expect(decision.eligibleForPullRequest).toBe(false);
    expect(decision.reasons).toContain('candidate_has_regressions');
  });

  it('does not count a contributor pretending to be a judge', () => {
    const problem = createEvolutionProblem({
      kind: 'security',
      title: 'Unsafe MCP promotion',
      severity: 'critical',
      description: 'Ensure builders cannot certify their own generated tools.',
      requiredCapabilities: ['security'],
    });
    const cell = new EvolutionCellCoordinator().formCell(problem, Array.from({ length: 14 }, (_, index) => node(index + 1)), {
      contributorCount: 4,
      judgeCount: 4,
    });
    const candidate: CandidateImprovement = {
      id: 'candidate-sec',
      problemId: problem.id,
      baseSha: 'abc',
      artifactHash: 'sec',
      contributionNodeIds: cell.contributors.map((item) => item.nodeId),
      metrics: {
        qualityDelta: 0.01,
        successRateDelta: 0.01,
        freshTokensDeltaPct: -5,
        latencyDeltaPct: 0,
        regressionCount: 0,
        securityPassed: true,
        reproducibleRuns: 5,
      },
      createdAt: new Date().toISOString(),
    };
    const fakeJudge = cell.contributors[0]?.nodeId ?? 'missing';
    const real = cell.judges.slice(0, 2).map((judge) => verdict(candidate.id, problem.id, judge.nodeId));
    const decision = new EvolutionJudgePanel().decide(
      cell,
      candidate,
      [verdict(candidate.id, problem.id, fakeJudge), ...real],
      { minimumJudges: 3 },
    );
    expect(decision.status).toBe('insufficient_evidence');
    expect(decision.independentJudges).toBe(2);
  });
});
