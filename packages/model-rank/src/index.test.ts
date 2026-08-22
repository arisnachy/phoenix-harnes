import { describe, expect, it } from 'vitest';
import { ModelCapabilityRanking, type ModelDimension, type ModelEvidence } from './index.js';

function addDimension(
  ranking: ModelCapabilityRanking,
  modelId: string,
  dimension: ModelDimension,
  score: number,
  samples = 60,
  providerId = 'provider',
): void {
  const evidence: ModelEvidence = {
    id: `${modelId}:${dimension}`,
    providerId,
    modelId,
    dimension,
    score,
    successRate: 0.98,
    reproducibility: 0.98,
    samples,
    observedAt: new Date().toISOString(),
    source: 'collective',
  };
  ranking.observe(evidence);
}

function seed(ranking: ModelCapabilityRanking, modelId: string, scores: Partial<Record<ModelDimension, number>>): void {
  ranking.registerDiscovered('provider', modelId);
  for (const [dimension, score] of Object.entries(scores) as [ModelDimension, number][]) addDimension(ranking, modelId, dimension, score);
}

describe('PHOENIX Model Capability Ladder', () => {
  it('keeps newly discovered models provisional and out of command roles until benchmarked', () => {
    const ranking = new ModelCapabilityRanking();
    const profile = ranking.registerDiscovered('new-provider', 'brand-new-model');
    expect(profile.status).toBe('provisional');
    expect(profile.eligibleRoles).not.toContain('orchestrator');
    expect(ranking.onboardingPlan('new-provider', 'brand-new-model')).toHaveLength(12);
  });

  it('allows a coding specialist to build without allowing it to orchestrate', () => {
    const ranking = new ModelCapabilityRanking();
    seed(ranking, 'coder', {
      coding: 95, debugging: 92, toolUse: 89, reasoning: 78, reliability: 88, efficiency: 85,
      orchestration: 55, planning: 61, critique: 70,
    });
    expect(ranking.evaluateRole('provider', 'coder', 'builder')?.eligible).toBe(true);
    expect(ranking.evaluateRole('provider', 'coder', 'orchestrator')?.eligible).toBe(false);
  });

  it('ranks models by the requested role rather than a single global score', () => {
    const ranking = new ModelCapabilityRanking();
    seed(ranking, 'architect', {
      orchestration: 96, planning: 95, reasoning: 92, reliability: 93, critique: 90, efficiency: 75,
      coding: 76, debugging: 74, toolUse: 72,
    });
    seed(ranking, 'coder', {
      orchestration: 70, planning: 72, reasoning: 84, reliability: 90, critique: 78, efficiency: 88,
      coding: 98, debugging: 96, toolUse: 94,
    });
    expect(ranking.rank('orchestrator')[0]?.modelId).toBe('architect');
    expect(ranking.rank('builder')[0]?.modelId).toBe('coder');
  });

  it('refuses to fill command when no model clears authority gates', () => {
    const ranking = new ModelCapabilityRanking();
    seed(ranking, 'weak-a', { orchestration: 68, planning: 70, reasoning: 72, reliability: 75 });
    seed(ranking, 'weak-b', { orchestration: 72, planning: 68, reasoning: 70, reliability: 74 });
    const assignment = ranking.assign(['orchestrator']);
    expect(assignment[0]?.status).toBe('unfilled');
    expect(assignment[0]?.reason).toContain('do not downgrade');
  });

  it('uses different qualified models for orchestrator and judge when possible', () => {
    const ranking = new ModelCapabilityRanking();
    seed(ranking, 'commander', {
      orchestration: 97, planning: 95, reasoning: 93, reliability: 94, critique: 88, efficiency: 78,
      judging: 84, security: 84, research: 85,
    });
    seed(ranking, 'judge', {
      judging: 97, critique: 96, reasoning: 94, reliability: 96, security: 94, research: 90,
      orchestration: 84, planning: 82, efficiency: 76,
    });
    const assignments = ranking.assign(['orchestrator', 'judge']);
    expect(assignments.every((item) => item.status === 'assigned')).toBe(true);
    expect(assignments[0]?.model?.modelId).not.toBe(assignments[1]?.model?.modelId);
  });

  it('lets stronger recent collective evidence move a model up the ladder', () => {
    const ranking = new ModelCapabilityRanking();
    ranking.registerDiscovered('provider', 'rising');
    for (const dimension of ['coding', 'debugging', 'toolUse', 'reasoning', 'reliability', 'efficiency'] as ModelDimension[]) {
      addDimension(ranking, 'rising', dimension, 60, 20);
      ranking.observe({
        id: `rising:${dimension}:new`,
        providerId: 'provider',
        modelId: 'rising',
        dimension,
        score: 94,
        successRate: 0.99,
        reproducibility: 0.99,
        samples: 100,
        observedAt: new Date().toISOString(),
        source: 'collective',
      });
    }
    expect(ranking.evaluateRole('provider', 'rising', 'builder')?.eligible).toBe(true);
    expect(ranking.rank('builder')[0]?.modelId).toBe('rising');
  });
});
