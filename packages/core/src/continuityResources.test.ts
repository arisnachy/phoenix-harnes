import { describe, expect, it } from 'vitest';
import type { PhoenixMessage, PhoenixResponse } from '@phoenix/contracts';
import { AgentRunner, compactAgentHistoryGuarded } from './agents.js';
import { HibernatingMcpBroker } from './mcpHibernate.js';
import { ResourceBudgetError, ResourceGovernor } from './resourceGovernor.js';
import { estimateTokens } from './tokenEconomy.js';

function tokenCount(messages: readonly PhoenixMessage[]): number {
  return messages.reduce((sum, message) =>
    sum + estimateTokens(message.content) + estimateTokens(JSON.stringify(message.toolCalls ?? [])) + 4, 0);
}

describe('PHOENIX continuity-guarded compaction', () => {
  it('preserves required goal, constraint and live tool transaction while discarding noise', () => {
    const messages: PhoenixMessage[] = [
      { role: 'system', content: 'Work carefully and verify changes.' },
      { role: 'user', content: 'Never deploy to production without user approval.' },
    ];
    for (let index = 0; index < 36; index += 1) {
      messages.push({ role: 'assistant', content: `Historical chatter ${index}: ${'irrelevant '.repeat(45)}` });
    }
    messages.push({
      role: 'assistant',
      content: 'Inspecting the target.',
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'packages/core/src/parser.ts' } }],
    });
    messages.push({ role: 'tool', toolCallId: 'call-1', content: `parser state ${'large-output '.repeat(200)}` });
    messages.push({ role: 'user', content: 'Fix the parser now while preserving existing behavior.' });

    const result = compactAgentHistoryGuarded(messages, 1_200, {
      continuityTokenBudget: 520,
      minimumScore: 0.72,
    });
    expect(result.compacted).toBe(true);
    expect(result.continuity?.passed).toBe(true);
    expect(result.continuity?.requiredScore).toBe(1);
    expect(tokenCount(result.messages)).toBeLessThanOrEqual(1_208);
    const rendered = result.messages.map((message) => message.content).join('\n');
    expect(rendered).toContain('PHOENIX continuity capsule v1');
    expect(rendered).toContain('Never deploy to production without user approval');
    expect(rendered).toContain('Fix the parser now while preserving existing behavior');
    expect(rendered).toContain('tool=read_file');
    expect(rendered).not.toContain('Historical chatter 4: irrelevant irrelevant irrelevant irrelevant irrelevant irrelevant irrelevant irrelevant');
  });

  it('fails closed instead of dropping required anchors when the capsule cannot fit them', () => {
    const messages: PhoenixMessage[] = [
      { role: 'system', content: 'System.' },
      { role: 'user', content: Array.from({ length: 20 }, (_, index) => `Never violate required constraint number ${index} with ${'detail '.repeat(20)}.`).join(' ') },
      { role: 'assistant', content: 'noise '.repeat(2_000) },
      { role: 'user', content: 'Complete the mission.' },
    ];
    expect(() => compactAgentHistoryGuarded(messages, 600, { continuityTokenBudget: 160 }))
      .toThrow(/cannot preserve required anchors/i);
  });
});

describe('PHOENIX Resource Governor', () => {
  it('fails closed on concurrent MCP and RAM oversubscription', () => {
    const governor = new ResourceGovernor({ maxConcurrentMcpServers: 1, maxEstimatedRamMb: 512 });
    const first = governor.acquire({ kind: 'mcp', resourceId: 'mcp-a', estimatedRamMb: 256 });
    expect(() => governor.acquire({ kind: 'mcp', resourceId: 'mcp-b', estimatedRamMb: 128 }))
      .toThrow(ResourceBudgetError);
    governor.release(first);
    const agent = governor.acquire({ kind: 'agent', resourceId: 'agent-a', estimatedRamMb: 400 });
    expect(() => governor.acquire({ kind: 'process', resourceId: 'process-a', estimatedRamMb: 200 }))
      .toThrow(/RAM budget/i);
    governor.release(agent);
  });

  it('prunes expired leases and enforces output caps', () => {
    const governor = new ResourceGovernor({ maxOutputBytes: 1_000 });
    governor.acquire({ kind: 'process', resourceId: 'short', estimatedRamMb: 10, leaseMs: 1_000 }, 1_000);
    expect(governor.snapshot(1_500).activeLeases).toBe(1);
    expect(governor.snapshot(2_001).activeLeases).toBe(0);
    expect(() => governor.assertOutputBytes(1_001)).toThrow(/Output budget/i);
  });

  it('releases an agent lease even when the run completes through an early return', async () => {
    const governor = new ResourceGovernor({ maxConcurrentAgents: 1, maxEstimatedRamMb: 512 });
    const runtime = {
      generate: async (): Promise<PhoenixResponse> => ({ providerId: 'local', modelId: 'test', content: 'done' }),
    };
    const runner = new AgentRunner(runtime, { resourceGovernor: governor, estimatedAgentRamMb: 256 });
    const result = await runner.run({ id: 'agent-one', instructions: 'Answer.', maxTurns: 1 }, 'hello');
    expect(result.response.content).toBe('done');
    expect(governor.snapshot().activeLeases).toBe(0);
  });

  it('releases an MCP operation lease even when federation execution fails', async () => {
    const governor = new ResourceGovernor({ maxConcurrentMcpServers: 1, maxEstimatedRamMb: 512 });
    const broker = new HibernatingMcpBroker(undefined, { resourceGovernor: governor, estimatedServerRamMb: 128 });
    await expect(broker.call('missing', 'missing', {}, { allowedRisks: ['read'] })).rejects.toThrow(/Unknown MCP server/i);
    expect(governor.snapshot().activeLeases).toBe(0);
  });
});
