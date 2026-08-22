import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderDefinition } from '@phoenix/contracts';
import { OpenAICompatibleAdapter } from './index.js';

const provider: ProviderDefinition = {
  id: 'test',
  displayName: 'Test',
  baseUrl: 'https://example.invalid/v1',
  protocol: 'openai-chat',
  models: [{
    id: 'model',
    capabilities: { input: ['text'], output: ['text'], tools: true, json: true, reasoning: true, streaming: true },
  }],
};

afterEach(() => vi.unstubAllGlobals());

describe('OpenAICompatibleAdapter', () => {
  it('serializes prior assistant tool calls and matching tool results', async () => {
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', async (_input: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const adapter = new OpenAICompatibleAdapter('test');
    await adapter.generate(provider, provider.models[0]!, {
      messages: [
        { role: 'user', content: 'use echo' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'echo', arguments: { value: 7 } }] },
        { role: 'tool', content: '{"value":7}', toolCallId: 'c1' },
      ],
    });

    const messages = body?.messages as Array<Record<string, unknown>>;
    const assistant = messages[1] as Record<string, unknown>;
    const toolCalls = assistant.tool_calls as Array<Record<string, unknown>>;
    expect(toolCalls[0]?.id).toBe('c1');
    expect(messages[2]?.tool_call_id).toBe('c1');
  });
});
