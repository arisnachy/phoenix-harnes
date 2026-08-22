import { ModelCapabilityRanking, type BenchmarkTask, type ModelRankProfile } from './index.js';

export interface DiscoveredModelBatch {
  providerId: string;
  modelIds: readonly string[];
}

export interface ModelOnboardingRecord {
  profile: ModelRankProfile;
  benchmarkPlan: readonly BenchmarkTask[];
}

export function onboardDiscoveredModels(
  ranking: ModelCapabilityRanking,
  batch: DiscoveredModelBatch,
): readonly ModelOnboardingRecord[] {
  return [...new Set(batch.modelIds)]
    .sort()
    .map((modelId) => {
      const profile = ranking.registerDiscovered(batch.providerId, modelId);
      return {
        profile,
        benchmarkPlan: ranking.onboardingPlan(batch.providerId, modelId),
      };
    });
}
