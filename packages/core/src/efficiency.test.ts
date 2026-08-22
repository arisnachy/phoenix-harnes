import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PhoenixResponse, ProviderAdapter, ProviderDefinition } from '@phoenix/contracts';
import { compactAgentHistory } from './agents.js';
import type { BenchmarkResult } from './arena.js';
import { compareEfficiency } from './arena.js';
import { ExperienceCompiler, SkillLibrary } from './experience.js';
import { PhoenixRuntime } from './index.js';
import { RebirthStore } from './rebirth.js';
import {
  ContextCompiler,
  ExactResultCache,
  fingerprintText,
  TokenGovernor,
} from './tokenEconomy.js';

const capabilities = {
  input: ['text'] as const,
  output: ['text'] as const,
  tools: false,
  json: false,
  reasoning: true,
  streaming: false,
};

class CountingAdapter implements ProviderAdapter {
  public calls = 0;
  public constructor(public readonly providerId: string) {}
  public async generate(): Promise<PhoenixResponse> {
    this.calls += 1;
    return {
      providerId: this.providerId,
      modelId: 'm',
      content: 'stable result',
      usage: { inputTokens: 100, outputTokens: 12 },
    };
  }
}

function provider(id: string): ProviderDefinition {
  return {
    id,
    displayName: id,
    baseUrl: 'local://test',
    protocol: 'custom',
    local: true,
    models: [{ id: 'm', capabilities, economics: { billingMode: 'local', free: true } }],
  };
}

function result(id: string, score: number, freshInputTokens: number): BenchmarkResult {
  return {
    target: { id, providerId: id },
    samples: [],
    meanScore: score,
    successRate: 1,
    p50LatencyMs: 100,
    tokenEfficiency: {
      knownUsageSamples: 1,
      inputTokens: freshInputTokens,
      cachedInputTokens: 0,
      freshInputTokens,
      outputTokens: 100,
      estimatedCostUsd: 0,
    },
  };
}

describe('PHOENIX efficiency runtime', () => {
  it('compiles only relevant context inside a hard budget and reuses unchanged session context', () => {
    const stable = 'Repository policy: run tests before merge.';
    const compiler = new ContextCompiler();
    const compiled = compiler.compile('fix failing router test', [
      { id: 'policy', kind: 'instruction', content: stable, priority: 8 },
      { id: 'router.diff', kind: 'diff', content: 'router failing test retry fallback '.repeat(80), changed: true, priority: 5 },
      { id: 'marketing.md', kind: 'file', content: 'brand colors and logos '.repeat(100) },
    ], {
      budgetTokens: 180,
      knownFingerprints: new Set([fingerprintText(stable)]),
      allowSessionDelta: true,
    });

    expect(compiled.estimatedTokens).toBeLessThanOrEqual(180);
    expect(compiled.reused.map((item) => item.id)).toContain('policy');
    expect(compiled.included.map((item) => item.id)).toContain('router.diff');
    expect(compiled.text).not.toContain('brand colors');
  });

  it('escalates complex work away from small local lanes toward an authenticated subscription lane', () => {
    const governor = new TokenGovernor({
      lanes: [
        { id: 'tiny-local', kind: 'local', providerId: 'ollama', maxComplexity: 'routine' },
        { id: 'codex-plan', kind: 'subscription', providerId: 'codex-cli', maxComplexity: 'critical', estimatedQuality: 0.95 },
        { id: 'paid-api', kind: 'metered', providerId: 'api', maxComplexity: 'critical', estimatedQuality: 1 },
      ],
    });
    const plan = governor.plan({
      messages: [{ role: 'user', content: `production architecture migration security refactor ${'x'.repeat(10_000)}` }],
      requirements: { reasoning: true },
    });
    expect(['complex', 'critical']).toContain(plan.complexity);
    expect(plan.lanes[0]?.id).toBe('codex-plan');
    const preferences = governor.preferencesFor(plan);
    expect(preferences.preferSubscription).toBe(true);
    expect(preferences.preferredProviders?.[0]).toBe('codex-cli');
  });

  it('serves an explicitly cacheable repeated request without paying the model twice', async () => {
    const cache = new ExactResultCache();
    const runtime = new PhoenixRuntime({ resultCache: cache });
    const adapter = new CountingAdapter('local');
    runtime.registerProvider(provider('local'), adapter);
    const request = {
      messages: [{ role: 'user' as const, content: 'deterministic formatting request' }],
      metadata: { cacheable: 'true', cacheNamespace: 'test' },
    };
    const first = await runtime.generate(request);
    const second = await runtime.generate(request);
    expect(first.content).toBe('stable result');
    expect(second.metadata?.phoenixCacheHit).toBe(true);
    expect(adapter.calls).toBe(1);
    const snapshot = runtime.usageBook.snapshot();
    expect(snapshot.cacheHits).toBe(1);
    expect(snapshot.avoidedInputTokens).toBeGreaterThan(0);
  });

  it('crystallizes repeated successful experience into a compact reusable skill', async () => {
    const compiler = new ExperienceCompiler();
    for (let index = 0; index < 2; index += 1) {
      compiler.observe({
        pattern: 'typescript-test-fix',
        goal: 'fix TypeScript failing tests',
        success: true,
        steps: ['inspect failing test', 'patch smallest cause', 'run typecheck and tests'],
        verification: ['typecheck passes', 'tests pass'],
        inputTokens: 2_000,
        outputTokens: 400,
      });
    }
    const skill = compiler.compile('typescript-test-fix');
    expect(skill?.evidence.successRate).toBe(1);
    const library = new SkillLibrary(join(tmpdir(), `phoenix-skills-${randomUUID()}.jsonl`));
    if (!skill) throw new Error('skill was not compiled');
    await library.save(skill);
    const context = await library.compactContext('fix typescript tests', 300);
    expect(context).toContain('patch smallest cause');
    expect(context).toContain('tests pass');
  });

  it('rebirths a mission with provider sessions and context fingerprints instead of starting from zero', async () => {
    const store = new RebirthStore(join(tmpdir(), `phoenix-missions-${randomUUID()}`));
    const mission = await store.create({ id: 'm1', title: 'Long coding mission', objective: 'ship verified patch' });
    await store.checkpoint(mission.id, {
      label: 'tests-green',
      nextAction: 'review diff',
      providerSessions: [{ providerId: 'codex-cli', sessionId: 'thread-123', modelId: 'default' }],
      contextFingerprints: ['abc', 'def'],
      tokenSnapshot: { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 500 },
    });
    const reborn = await store.rebirth(mission.id);
    expect(reborn.checkpoint?.nextAction).toBe('review diff');
    expect(reborn.providerSessions.get('codex-cli')?.sessionId).toBe('thread-123');
    expect(reborn.knownContextFingerprints.has('abc')).toBe(true);
  });

  it('compacts old agent history while preserving the newest tool-call transaction', () => {
    const messages = [
      { role: 'system' as const, content: 'Follow project rules.' },
      ...Array.from({ length: 10 }, (_, index) => ({
        role: index % 2 ? 'assistant' as const : 'user' as const,
        content: `old ${index} ${'context '.repeat(120)}`,
      })),
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'call-x', name: 'inspect', arguments: { path: 'x' } }] },
      { role: 'tool' as const, content: 'latest tool result', toolCallId: 'call-x' },
    ];
    const compacted = compactAgentHistory(messages, 500);
    expect(compacted.length).toBeLessThan(messages.length);
    expect(compacted.some((item) => item.role === 'assistant' && item.toolCalls?.[0]?.id === 'call-x')).toBe(true);
    expect(compacted.some((item) => item.role === 'tool' && item.toolCallId === 'call-x')).toBe(true);
  });

  it('only calls a challenger dominant when quality is not worse and fresh-token use is lower', () => {
    const comparison = compareEfficiency(result('raw-codex', 0.9, 10_000), result('phoenix', 0.91, 4_000));
    expect(comparison.qualityNotWorse).toBe(true);
    expect(comparison.usesFewerFreshInputTokens).toBe(true);
    expect(comparison.dominates).toBe(true);
  });
});
