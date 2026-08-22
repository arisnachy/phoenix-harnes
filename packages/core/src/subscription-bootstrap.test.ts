import { describe, expect, it } from 'vitest';
import type { ProviderAdapter, ProviderDefinition } from '@phoenix/contracts';
import { bootstrapProviderManifest } from './bootstrap.js';

describe('subscription manifest bootstrap', () => {
  it('registers Codex and Claude Code lanes without API keys or base URLs', async () => {
    const registered: Array<{ definition: ProviderDefinition; adapter: ProviderAdapter }> = [];
    await bootstrapProviderManifest({
      registerProvider(definition, adapter) { registered.push({ definition, adapter }); },
    }, {
      providers: [
        { id: 'codex-cli', kind: 'codex-cli' },
        { id: 'claude-code-cli', kind: 'claude-code-cli' },
      ],
    });

    expect(registered.map((item) => item.definition.id)).toEqual(['codex-cli', 'claude-code-cli']);
    expect(registered.every((item) => item.definition.apiKeyEnv === undefined)).toBe(true);
    expect(registered.every((item) => item.definition.models[0]?.economics?.billingMode === 'subscription')).toBe(true);
    expect(registered[0]?.adapter.providerId).toBe('codex-cli');
    expect(registered[1]?.adapter.providerId).toBe('claude-code-cli');
  });
});
