import { describe, expect, it } from 'vitest';
import { discoverOpenAICompatible } from './discovery.js';

const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
  data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }],
}), { status: 200, headers: { 'content-type': 'application/json' } });

describe('provider discovery', () => {
  it('discovers and de-duplicates OpenAI-compatible model catalogs conservatively', async () => {
    const report = await discoverOpenAICompatible({
      id: 'local-gateway',
      baseUrl: 'http://127.0.0.1:9000/v1/',
      local: true,
      fetchImpl: fakeFetch,
    });

    expect(report.modelIds).toEqual(['model-a', 'model-b']);
    expect(report.provider.baseUrl).toBe('http://127.0.0.1:9000/v1');
    expect(report.provider.local).toBe(true);
    expect(report.provider.models[0]?.capabilities.tools).toBe(false);
    expect(report.warnings).toContain('capabilities_default_to_conservative');
  });

  it('can attach experimentally verified capabilities without hard-coding a vendor', async () => {
    const report = await discoverOpenAICompatible({
      id: 'custom',
      baseUrl: 'https://example.invalid/v1',
      fetchImpl: fakeFetch,
      capabilitiesForModel: () => ({
        input: ['text'], output: ['text'], tools: true, json: true, reasoning: true, streaming: true,
      }),
    });

    expect(report.provider.models.every((model) => model.capabilities.tools)).toBe(true);
    expect(report.warnings).not.toContain('capabilities_default_to_conservative');
  });
});
