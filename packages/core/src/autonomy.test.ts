import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { PhoenixRequest, PhoenixResponse, ProviderAdapter, ProviderDefinition } from '@phoenix/contracts';
import { AgentRunner } from './agents.js';
import type { BenchmarkResult } from './arena.js';
import { bootstrapProviderManifest } from './bootstrap.js';
import { LocalMemoryStore } from './memory.js';
import { LocalScheduler } from './scheduler.js';
import { AdaptiveRoutingPolicy, SingularityLab } from './singularity.js';
import { ToolPolicyError, ToolRegistry } from './tools.js';

class ScriptedRuntime {
  public readonly calls: PhoenixRequest[] = [];
  public readonly events: Array<{ type: string; payload: unknown }> = [];
  public readonly ledger = {
    append: (type: string, payload: unknown) => this.events.push({ type, payload }),
  };

  public async generate(request: PhoenixRequest): Promise<PhoenixResponse> {
    this.calls.push(request);
    if (this.calls.length === 1) {
      return {
        providerId: 'local',
        modelId: 'local-model',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'echo', arguments: { value: 'phoenix' } }],
      };
    }
    return { providerId: 'local', modelId: 'local-model', content: 'tool result accepted' };
  }
}

function benchmark(id: string, score: number, successRate: number, latency: number, samples = 4): BenchmarkResult {
  return {
    target: { id, providerId: id },
    samples: Array.from({ length: samples }, (_, index) => ({
      scenarioId: `s${index}`,
      targetId: id,
      score,
      latencyMs: latency,
      success: index / samples < successRate,
    })),
    meanScore: score,
    successRate,
    p50LatencyMs: latency,
  };
}

describe('PHOENIX local autonomy', () => {
  it('runs a tool loop and preserves assistant tool-call history for the next model turn', async () => {
    const runtime = new ScriptedRuntime();
    const tools = new ToolRegistry();
    tools.register({
      name: 'echo',
      risk: 'read',
      inputSchema: { type: 'object' },
      execute: async (input) => ({ echoed: input.value }),
    });

    const runner = new AgentRunner(runtime, { tools, toolPolicy: { allowedRisks: ['read'] } });
    const result = await runner.run({ id: 'worker', instructions: 'Use tools when useful.', toolNames: ['echo'] }, 'go');

    expect(result.response.content).toBe('tool result accepted');
    expect(result.toolExecutions).toBe(1);
    const second = runtime.calls[1];
    expect(second?.messages.some((message) => message.role === 'assistant' && message.toolCalls?.[0]?.id === 'call-1')).toBe(true);
    expect(second?.messages.some((message) => message.role === 'tool' && message.toolCallId === 'call-1')).toBe(true);
  });

  it('persists and retrieves local memory without a cloud dependency', async () => {
    const memory = new LocalMemoryStore(join(tmpdir(), `phoenix-${randomUUID()}.jsonl`));
    await memory.remember({ namespace: 'lab', kind: 'semantic', content: 'OrcaRouter is a bootstrap route', tags: ['routing'] });
    await memory.remember({ namespace: 'lab', content: 'Unrelated observation' });
    const found = await memory.search('bootstrap routing', { namespace: 'lab' });
    expect(found[0]?.content).toContain('OrcaRouter');
  });

  it('enforces deterministic tool-risk approval gates', async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 'shell', risk: 'exec', inputSchema: {}, execute: async () => 'ran' });
    await expect(tools.execute('shell', {}, { allowedRisks: ['read'] })).rejects.toBeInstanceOf(ToolPolicyError);
  });

  it('executes due local missions and reschedules recurring missions', async () => {
    const scheduler = new LocalScheduler();
    const seen: string[] = [];
    scheduler.registerHandler('bench', async (mission) => { seen.push(mission.id); });
    scheduler.schedule({ id: 'daily', handler: 'bench', payload: {}, runAt: '2026-01-01T00:00:00.000Z', intervalMs: 1000 });
    await scheduler.tick(new Date('2026-01-01T00:00:01.000Z'));
    expect(seen).toEqual(['daily']);
    expect(scheduler.missions()[0]?.runAt).toBe('2026-01-01T00:00:02.000Z');
  });

  it('promotes only evidence-backed improvements, applies them after approval, and rolls back', () => {
    const proposal = new SingularityLab().evaluate(
      benchmark('baseline', 0.70, 1, 100),
      benchmark('challenger', 0.82, 1, 110),
    );
    const policy = new AdaptiveRoutingPolicy();
    expect(proposal.verdict).toBe('promote_candidate');
    expect(proposal.requiresApproval).toBe(true);

    policy.approve(proposal);
    const evolved = policy.apply({ messages: [{ role: 'user', content: 'test' }] });
    expect(evolved.preferences?.preferredProviders).toEqual(['challenger']);
    expect(evolved.metadata?.adaptivePolicyProposal).toBe(proposal.id);

    policy.rollback();
    const rolledBack = policy.apply({ messages: [{ role: 'user', content: 'test' }] });
    expect(rolledBack.preferences?.preferredProviders).toEqual(['baseline']);
  });

  it('bootstraps a declared provider without hard-coding the vendor in core', async () => {
    const registered: Array<{ definition: ProviderDefinition; adapter: ProviderAdapter }> = [];
    await bootstrapProviderManifest({
      registerProvider(definition, adapter) { registered.push({ definition, adapter }); },
    }, {
      providers: [{
        id: 'custom-local',
        baseUrl: 'http://127.0.0.1:9999/v1',
        local: true,
        discover: false,
        models: ['m1'],
        capabilityPreset: 'agentic-text',
      }],
    });

    expect(registered[0]?.definition.id).toBe('custom-local');
    expect(registered[0]?.definition.models[0]?.capabilities.tools).toBe(true);
    expect(registered[0]?.adapter.providerId).toBe('custom-local');
  });
});
