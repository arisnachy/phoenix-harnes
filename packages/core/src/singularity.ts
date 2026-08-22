import type { BenchmarkResult } from './arena.js';

export interface EvolutionGate {
  minimumSamples: number;
  minimumSuccessRate: number;
  minimumScoreImprovement: number;
  maximumLatencyRegressionRatio: number;
}

export interface EvolutionProposal {
  id: string;
  baseline: string;
  challenger: string;
  verdict: 'promote_candidate' | 'reject_candidate' | 'insufficient_evidence';
  requiresApproval: true;
  evidence: {
    baselineScore: number;
    challengerScore: number;
    scoreImprovement: number;
    baselineSuccessRate: number;
    challengerSuccessRate: number;
    latencyRegressionRatio: number;
    samples: number;
  };
  rollbackPlan: string;
}

const defaultGate: EvolutionGate = {
  minimumSamples: 3,
  minimumSuccessRate: 0.9,
  minimumScoreImprovement: 0.03,
  maximumLatencyRegressionRatio: 1.5,
};

export class SingularityLab {
  public evaluate(
    baseline: BenchmarkResult,
    challenger: BenchmarkResult,
    gate: Partial<EvolutionGate> = {},
  ): EvolutionProposal {
    const policy = { ...defaultGate, ...gate };
    const samples = Math.min(baseline.samples.length, challenger.samples.length);
    const improvement = challenger.meanScore - baseline.meanScore;
    const latencyRatio = baseline.p50LatencyMs > 0
      ? challenger.p50LatencyMs / baseline.p50LatencyMs
      : challenger.p50LatencyMs > 0 ? Number.POSITIVE_INFINITY : 1;

    let verdict: EvolutionProposal['verdict'] = 'promote_candidate';
    if (samples < policy.minimumSamples) verdict = 'insufficient_evidence';
    else if (challenger.successRate < policy.minimumSuccessRate) verdict = 'reject_candidate';
    else if (improvement < policy.minimumScoreImprovement) verdict = 'reject_candidate';
    else if (latencyRatio > policy.maximumLatencyRegressionRatio) verdict = 'reject_candidate';

    return {
      id: `evolution:${baseline.target.id}->${challenger.target.id}`,
      baseline: baseline.target.id,
      challenger: challenger.target.id,
      verdict,
      requiresApproval: true,
      evidence: {
        baselineScore: baseline.meanScore,
        challengerScore: challenger.meanScore,
        scoreImprovement: improvement,
        baselineSuccessRate: baseline.successRate,
        challengerSuccessRate: challenger.successRate,
        latencyRegressionRatio: latencyRatio,
        samples,
      },
      rollbackPlan: `Restore routing policy to baseline target ${baseline.target.id}`,
    };
  }
}
