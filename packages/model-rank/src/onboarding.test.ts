import { describe, expect, it } from 'vitest';
import { ModelCapabilityRanking } from './index.js';
import { onboardDiscoveredModels } from './onboarding.js';

describe('model discovery onboarding', () => {
  it('deduplicates discovered models and places all of them in provisional ranking with benchmark plans', () => {
    const ranking = new ModelCapabilityRanking();
    const records = onboardDiscoveredModels(ranking, {
      providerId: 'new-provider',
      modelIds: ['zeta', 'alpha', 'zeta'],
    });

    expect(records.map((item) => item.profile.identity.modelId)).toEqual(['alpha', 'zeta']);
    expect(records.every((item) => item.profile.status === 'provisional')).toBe(true);
    expect(records.every((item) => item.benchmarkPlan.length === 12)).toBe(true);
    expect(records.every((item) => !item.profile.eligibleRoles.includes('orchestrator'))).toBe(true);
  });
});
