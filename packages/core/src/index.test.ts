import { describe, expect, it } from 'vitest';
import type { PhoenixResponse, ProviderAdapter, ProviderDefinition } from '@phoenix/contracts';
import { ProviderTransportError } from '@phoenix/providers';
import { PhoenixRuntime } from './index.js';

const capabilities = {
  input: ['text'] as const,
  output: ['text'] as const,
  tools: true,
  json: true,
  reasoning: true,
  streaming: true,
};

function definition(id: string, free: boolean): ProviderDefinition {
  return {
    id,
    displayName: id,
    baseUrl: 'https://example.invalid/v1',
    protocol: 'openai-chat',
    models: [{ id: `${id}-model`, capabilities, economics: { free } }],
  };
}

class FakeAdapter implements ProviderAdapter {
  public constructor(
    public readonly providerId: string,
    private readonly result: 'fail' | PhoenixResponse,
  ) {}

  public async generate(): Promise<PhoenixResponse> {
    if (this.result === 'fail') throw new ProviderTransportError('rate limited', 429, true);
    return this.result;
  }
}

describe('PhoenixRuntime', () => {
  it('falls back after a retryable free-route failure and preserves an auditable ledger', async () => {
    const runtime = new PhoenixRuntime();
    runtime.registerProvider(definition('free', true), new FakeAdapter('free', 'fail'));
    runtime.registerProvider(
      definition('backup', false),
      new FakeAdapter('backup', {
        providerId: 'backup',
        modelId: 'backup-model',
        content: 'recovered',
      }),
    );

    const result = await runtime.generate({ messages: [{ role: 'user', content: 'hello' }] });
    expect(result.content).toBe('recovered');
    expect(runtime.ledger.verify()).toBe(true);
    expect(runtime.ledger.all().filter((event) => event.type === 'execution.observation')).toHaveLength(2);
  });

  it('opens the circuit after repeated provider failures', async () => {
    const runtime = new PhoenixRuntime();
    runtime.registerProvider(definition('unstable', true), new FakeAdapter('unstable', 'fail'));
    runtime.registerProvider(
      definition('stable', false),
      new FakeAdapter('stable', { providerId: 'stable', modelId: 'stable-model', content: 'ok' }),
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await runtime.generate({
        messages: [{ role: 'user', content: `attempt ${attempt}` }],
        preferences: { preferredProviders: ['unstable'] },
      });
    }

    expect(runtime.health().find((entry) => entry.providerId === 'unstable')?.available).toBe(false);
  });
});
