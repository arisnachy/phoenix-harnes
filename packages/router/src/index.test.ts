import { describe, expect, it } from 'vitest';
import type { ProviderDefinition } from '@phoenix/contracts';
import { route } from './index.js';

const baseCapabilities = {
  input: ['text'] as const,
  output: ['text'] as const,
  tools: true,
  json: true,
  reasoning: true,
  streaming: true,
};

const providers: ProviderDefinition[] = [
  {
    id: 'paid',
    displayName: 'Paid',
    baseUrl: 'https://example.invalid/v1',
    protocol: 'openai-chat',
    models: [{ id: 'strong', quality: 1, capabilities: baseCapabilities, economics: { inputPerMillionUsd: 1 } }],
  },
  {
    id: 'free',
    displayName: 'Free',
    baseUrl: 'https://example.invalid/v1',
    protocol: 'openai-chat',
    models: [{ id: 'free-model', quality: 0.5, capabilities: baseCapabilities, economics: { free: true } }],
  },
];

describe('route', () => {
  it('prefers free by default while retaining a paid fallback', () => {
    const result = route({ messages: [{ role: 'user', content: 'hello' }] }, { providers });
    expect(result.candidates.map((candidate) => candidate.provider.id)).toEqual(['free', 'paid']);
  });

  it('rejects a model that cannot satisfy a hard tool requirement', () => {
    const incapable: ProviderDefinition = {
      id: 'incapable',
      displayName: 'Incapable',
      baseUrl: 'https://example.invalid/v1',
      protocol: 'openai-chat',
      models: [{ id: 'plain', capabilities: { ...baseCapabilities, tools: false } }],
    };
    const result = route(
      { messages: [{ role: 'user', content: 'use a tool' }], requirements: { tools: true } },
      { providers: [incapable] },
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe('tools_required');
  });
});
