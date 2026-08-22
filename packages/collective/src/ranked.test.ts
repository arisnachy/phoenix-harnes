import { describe, expect, it } from 'vitest';
import { ModelCapabilityRanking, type ModelDimension } from '@phoenix/model-rank';
import { RankedEvolutionCellCoordinator, type RankedNodeProfile } from './ranked.js';
import type { EvolutionProblem } from './index.js';

const allDimensions: readonly ModelDimension[] = [
  'planning', 'orchestration', 'reasoning', 'coding', 'debugging', 'research',
  'toolUse', 'critique', 'judging', 'security', 'reliability', 'efficiency',
];

function seedModel(ranking: ModelCapabilityRanking, modelId: string, base: number, overrides: Partial<Record<ModelDimension, number>> = {}): void {
  ranking.registerDiscovered('provider', modelId);
  for (const dimension of allDimensions) {
    ranking.observe({
      id: `${modelId}:${dimension}`,
      providerId: 'provider',
      modelId,
      dimension,
      score: overrides[dimension] ?? base,
      successRate: 0.99,
      reproducibility: 0.99,
      samples: 70,
      observedAt: new Date().toISOString(),
      source: 'collective',
    });
  }
}

function node(modelId: string, index: number): RankedNodeProfile {
  return {
    nodeId: `node-${index}`,
    phoenixVersion: '0.0.1',
    platform: 'linux',
    capabilities: ['typescript', 'benchmark'],
    modelTier: 'frontier',
    judgeReliability: 0.95,
    contributionReliability: 0.95,
    optIn: true,
    budget: { maxAiTokens: 500, maxCpuMs: 20_000, maxNetworkBytes: 100_000, maxSubscriptionCalls: 0 },
    model: { providerId: 'provider', modelId },
  };
}

const problem: EvolutionProblem = {
  id: 'problem-1',
  kind: 'evolution',
  title: 'Improve PHOENIX routing',
  fingerprint: 'fingerprint',
  severity: 'high',
  description: 'Find a better routing policy.',
  requiredCapabilities: ['typescript'],
  createdAt: new Date().toISOString(),
};

describe('ranked collective evolution cells', () => {
  it('puts the strongest qualified orchestrator in command and keeps judges model-independent', () => {
    const ranking = new ModelCapabilityRanking();
    seedModel(ranking, 'commander', 93, { orchestration: 99, planning: 98, reasoning: 97, reliability: 97 });
    seedModel(ranking, 'worker-a', 88, { judging: 84 });
    seedModel(ranking, 'worker-b', 87, { judging: 84 });
    seedModel(ranking, 'judge-a', 90, { judging: 98, critique: 97, reliability: 97 });
    seedModel(ranking, 'judge-b', 89, { judging: 97, critique: 96, reliability: 96 });
    seedModel(ranking, 'judge-c', 88, { judging: 96, critique: 95, reliability: 95 });

    const nodes = ['commander', 'worker-a', 'worker-b', 'judge-a', 'judge-b', 'judge-c'].map(node);
    const cell = new RankedEvolutionCellCoordinator(ranking).formCell(problem, nodes, { contributorCount: 2, judgeCount: 3 });

    expect(cell.orchestrator.modelId).toBe('commander');
    expect(cell.contributors).toHaveLength(2);
    expect(cell.judges).toHaveLength(3);
    expect(cell.judges.some((judge) => judge.nodeId === cell.orchestrator.nodeId)).toBe(false);
    const contributorIds = new Set(cell.contributors.map((item) => item.nodeId));
    expect(cell.judges.every((judge) => !contributorIds.has(judge.nodeId))).toBe(true);
  });

  it('refuses to create a commanded cell when all available models are weak orchestrators', () => {
    const ranking = new ModelCapabilityRanking();
    const models = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const modelId of models) {
      seedModel(ranking, modelId, 86, { orchestration: 60, planning: 64, reasoning: 75, reliability: 88 });
    }
    expect(() => new RankedEvolutionCellCoordinator(ranking).formCell(problem, models.map(node), { contributorCount: 2, judgeCount: 3 }))
      .toThrow(/refusing to assign a weak orchestrator/);
  });
});
