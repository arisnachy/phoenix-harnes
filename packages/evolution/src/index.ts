import type { ExecutionObservation } from '@phoenix/contracts';

export interface EvolutionRecommendation {
  id: string;
  kind: 'deprioritize_provider' | 'investigate_provider';
  providerId: string;
  confidence: number;
  evidence: {
    samples: number;
    failureRate: number;
    retryableFailureRate: number;
  };
  requiresApproval: true;
}

export class EvolutionEngine {
  readonly #observations: ExecutionObservation[] = [];

  public observe(observation: ExecutionObservation): void {
    this.#observations.push(observation);
  }

  public recommendations(minimumSamples = 5): EvolutionRecommendation[] {
    const groups = new Map<string, ExecutionObservation[]>();
    for (const item of this.#observations) {
      const current = groups.get(item.providerId) ?? [];
      current.push(item);
      groups.set(item.providerId, current);
    }

    const recommendations: EvolutionRecommendation[] = [];
    for (const [providerId, samples] of groups) {
      if (samples.length < minimumSamples) continue;
      const failures = samples.filter((item) => item.outcome !== 'success').length;
      const retryable = samples.filter((item) => item.outcome === 'retryable_failure').length;
      const failureRate = failures / samples.length;
      const retryableFailureRate = retryable / samples.length;
      if (failureRate < 0.4) continue;
      recommendations.push({
        id: `provider:${providerId}:failure-rate`,
        kind: failureRate >= 0.6 ? 'deprioritize_provider' : 'investigate_provider',
        providerId,
        confidence: Math.min(0.99, 0.5 + samples.length / 100),
        evidence: { samples: samples.length, failureRate, retryableFailureRate },
        requiresApproval: true,
      });
    }
    return recommendations;
  }
}
