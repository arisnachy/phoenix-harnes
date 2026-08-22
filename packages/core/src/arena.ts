import { performance } from 'node:perf_hooks';
import type { PhoenixRequest, PhoenixResponse } from '@phoenix/contracts';

export interface BenchmarkScenario {
  id: string;
  request: PhoenixRequest;
  evaluate(response: PhoenixResponse): number;
}

export interface BenchmarkTarget {
  id: string;
  providerId: string;
  modelId?: string;
}

export interface BenchmarkSample {
  scenarioId: string;
  targetId: string;
  score: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}

export interface BenchmarkResult {
  target: BenchmarkTarget;
  samples: readonly BenchmarkSample[];
  meanScore: number;
  successRate: number;
  p50LatencyMs: number;
}

export interface ArenaRuntime {
  providers(): readonly { id: string; models: readonly { id: string }[] }[];
  generate(request: PhoenixRequest, signal?: AbortSignal): Promise<PhoenixResponse>;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle];
  if (value === undefined) return 0;
  if (sorted.length % 2) return value;
  const before = sorted[middle - 1] ?? value;
  return (before + value) / 2;
}

export class BenchmarkArena {
  public constructor(private readonly runtime: ArenaRuntime) {}

  public async run(
    target: BenchmarkTarget,
    scenarios: readonly BenchmarkScenario[],
    signal?: AbortSignal,
  ): Promise<BenchmarkResult> {
    const providers = this.runtime.providers();
    const excludedProviders = providers.filter((provider) => provider.id !== target.providerId).map((provider) => provider.id);
    const targetProvider = providers.find((provider) => provider.id === target.providerId);
    if (!targetProvider) throw new Error(`Unknown benchmark provider: ${target.providerId}`);
    const excludedModels = target.modelId
      ? targetProvider.models.filter((model) => model.id !== target.modelId).map((model) => model.id)
      : [];

    const samples: BenchmarkSample[] = [];
    for (const scenario of scenarios) {
      const started = performance.now();
      try {
        const response = await this.runtime.generate({
          ...scenario.request,
          preferences: {
            ...(scenario.request.preferences ?? {}),
            preferredProviders: [target.providerId],
            excludedProviders,
            ...(target.modelId ? { preferredModels: [target.modelId], excludedModels } : {}),
          },
          metadata: { ...(scenario.request.metadata ?? {}), benchmark: scenario.id, target: target.id },
        }, signal);
        samples.push({
          scenarioId: scenario.id,
          targetId: target.id,
          score: Math.max(0, Math.min(1, scenario.evaluate(response))),
          latencyMs: performance.now() - started,
          success: true,
        });
      } catch (error) {
        samples.push({
          scenarioId: scenario.id,
          targetId: target.id,
          score: 0,
          latencyMs: performance.now() - started,
          success: false,
          error: error instanceof Error ? error.message : 'UnknownError',
        });
      }
    }

    const meanScore = samples.length ? samples.reduce((sum, item) => sum + item.score, 0) / samples.length : 0;
    const successRate = samples.length ? samples.filter((item) => item.success).length / samples.length : 0;
    return {
      target,
      samples,
      meanScore,
      successRate,
      p50LatencyMs: median(samples.map((item) => item.latencyMs)),
    };
  }
}
