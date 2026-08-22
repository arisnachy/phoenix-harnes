import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderAdapter, ProviderDefinition } from '@phoenix/contracts';
import { ModelCapabilityRanking } from '@phoenix/model-rank';
import { bootstrapProviderManifest } from './bootstrap.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider discovery -> model ranking autowire', () => {
  it('automatically places API-discovered models into provisional ranking', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'model-new-2' }, { id: 'model-new-1' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const registered: Array<{ definition: ProviderDefinition; adapter: ProviderAdapter }> = [];
    const ranking = new ModelCapabilityRanking();
    await bootstrapProviderManifest({
      registerProvider(definition, adapter) { registered.push({ definition, adapter }); },
    }, {
      providers: [{ id: 'future-provider', baseUrl: 'https://provider.example/v1', discover: true }],
    }, { ranking });

    expect(registered[0]?.definition.models.map((model) => model.id)).toEqual(['model-new-1', 'model-new-2']);
    expect(ranking.profile('future-provider', 'model-new-1')?.status).toBe('provisional');
    expect(ranking.profile('future-provider', 'model-new-2')?.eligibleRoles).not.toContain('orchestrator');
    expect(ranking.onboardingPlan('future-provider', 'model-new-1')).toHaveLength(12);
  });

  it('also ranks subscription-lane models without consuming subscription calls', async () => {
    const ranking = new ModelCapabilityRanking();
    await bootstrapProviderManifest({ registerProvider() {} }, {
      providers: [
        { id: 'codex-cli', kind: 'codex-cli', models: ['codex-a', 'codex-b'] },
        { id: 'claude-code-cli', kind: 'claude-code-cli', models: ['claude-a'] },
      ],
    }, { ranking });

    expect(ranking.profile('codex-cli', 'codex-a')?.status).toBe('provisional');
    expect(ranking.profile('codex-cli', 'codex-b')?.status).toBe('provisional');
    expect(ranking.profile('claude-code-cli', 'claude-a')?.status).toBe('provisional');
  });
});
