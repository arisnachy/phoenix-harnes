import { performance } from 'node:perf_hooks';
import type {
  ExecutionObservation,
  PhoenixRequest,
  PhoenixResponse,
  ProviderAdapter,
  ProviderDefinition,
  ProviderHealth,
} from '@phoenix/contracts';
import { EvolutionEngine } from '@phoenix/evolution';
import { InMemoryLedger } from '@phoenix/ledger';
import { ProviderTransportError } from '@phoenix/providers';
import { route } from '@phoenix/router';
import {
  estimateTokens,
  ExactResultCache,
  TokenGovernor,
  TokenUsageBook,
} from './tokenEconomy.js';

interface RegisteredProvider {
  definition: ProviderDefinition;
  adapter: ProviderAdapter;
}

export interface RequestPolicy {
  apply(request: PhoenixRequest): PhoenixRequest;
}

export interface PhoenixRuntimeOptions {
  ledger?: InMemoryLedger;
  evolution?: EvolutionEngine;
  policy?: RequestPolicy;
  governor?: TokenGovernor;
  resultCache?: ExactResultCache;
  usageBook?: TokenUsageBook;
}

function estimatedRequestTokens(request: PhoenixRequest): number {
  return request.messages.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0)
    + estimateTokens(JSON.stringify(request.tools ?? []));
}

export class PhoenixRuntime {
  readonly #providers = new Map<string, RegisteredProvider>();
  readonly #health = new Map<string, ProviderHealth>();
  public readonly ledger: InMemoryLedger;
  public readonly evolution: EvolutionEngine;
  public readonly policy: RequestPolicy | undefined;
  public readonly governor: TokenGovernor | undefined;
  public readonly resultCache: ExactResultCache | undefined;
  public readonly usageBook: TokenUsageBook;

  public constructor(options: PhoenixRuntimeOptions = {}) {
    this.ledger = options.ledger ?? new InMemoryLedger();
    this.evolution = options.evolution ?? new EvolutionEngine();
    this.policy = options.policy;
    this.governor = options.governor;
    this.resultCache = options.resultCache;
    this.usageBook = options.usageBook ?? new TokenUsageBook();
  }

  public registerProvider(definition: ProviderDefinition, adapter: ProviderAdapter): void {
    if (adapter.providerId !== definition.id) {
      throw new Error(`Adapter/provider mismatch: ${adapter.providerId} != ${definition.id}`);
    }
    this.#providers.set(definition.id, { definition, adapter });
    this.#health.set(definition.id, {
      providerId: definition.id,
      available: true,
      successRate: 1,
      consecutiveFailures: 0,
    });
  }

  public providers(): readonly ProviderDefinition[] {
    return [...this.#providers.values()].map((entry) => entry.definition);
  }

  public health(): readonly ProviderHealth[] {
    return [...this.#health.values()];
  }

  public async generate(request: PhoenixRequest, signal?: AbortSignal): Promise<PhoenixResponse> {
    const governor = this.governor;
    const plan = governor?.plan(request);
    const governedRequest: PhoenixRequest = plan && governor ? {
      ...request,
      preferences: governor.preferencesFor(plan, request.preferences ?? {}),
      metadata: {
        ...(request.metadata ?? {}),
        phoenixComplexity: plan.complexity,
        phoenixInputBudget: String(plan.inputBudget),
        phoenixOutputBudget: String(plan.outputBudget),
      },
    } : request;
    if (plan) {
      this.ledger.append('economy.plan', {
        complexity: plan.complexity,
        inputBudget: plan.inputBudget,
        outputBudget: plan.outputBudget,
        lanes: plan.lanes.map((lane) => ({ id: lane.id, kind: lane.kind, providerId: lane.providerId ?? null, modelId: lane.modelId ?? null })),
      });
    }

    const effectiveRequest = this.policy?.apply(governedRequest) ?? governedRequest;
    if (effectiveRequest !== governedRequest) {
      this.ledger.append('routing.policy_applied', {
        metadata: effectiveRequest.metadata ?? {},
        preferences: effectiveRequest.preferences ?? {},
      });
    }

    const cacheable = effectiveRequest.metadata?.cacheable === 'true';
    if (cacheable && this.resultCache) {
      const cached = this.resultCache.get(effectiveRequest);
      if (cached) {
        const avoided = estimatedRequestTokens(effectiveRequest);
        this.usageBook.record({
          providerId: cached.providerId,
          modelId: cached.modelId,
          inputTokens: 0,
          outputTokens: 0,
          avoidedInputTokens: avoided,
          cacheHit: true,
        });
        this.ledger.append('economy.cache_hit', { providerId: cached.providerId, modelId: cached.modelId, avoidedInputTokens: avoided });
        return {
          ...cached,
          metadata: { ...(cached.metadata ?? {}), phoenixCacheHit: true },
        };
      }
    }

    const decision = route(effectiveRequest, { providers: this.providers(), health: this.health() });
    this.ledger.append('route.decision', {
      requestId: decision.requestId,
      candidates: decision.candidates.map((candidate) => ({
        providerId: candidate.provider.id,
        modelId: candidate.model.id,
        score: candidate.score,
        reasons: candidate.reasons,
      })),
      rejected: decision.rejected,
    });

    if (!decision.candidates.length) throw new Error('No compatible PHOENIX route is available');

    let lastError: unknown;
    for (const candidate of decision.candidates) {
      const registered = this.#providers.get(candidate.provider.id);
      if (!registered) continue;
      const started = performance.now();
      try {
        const response = await registered.adapter.generate(
          candidate.provider,
          candidate.model,
          effectiveRequest,
          signal ? { signal } : undefined,
        );
        const observation: ExecutionObservation = {
          requestId: decision.requestId,
          providerId: candidate.provider.id,
          modelId: candidate.model.id,
          outcome: 'success',
          latencyMs: performance.now() - started,
        };
        this.#recordObservation(observation);
        const inputTokens = response.usage?.inputTokens ?? estimatedRequestTokens(effectiveRequest);
        const outputTokens = response.usage?.outputTokens ?? estimateTokens(response.content);
        this.usageBook.record({
          providerId: response.providerId,
          modelId: response.modelId,
          inputTokens,
          outputTokens,
          ...(typeof response.usage?.cachedInputTokens === 'number' ? { cachedInputTokens: response.usage.cachedInputTokens } : {}),
        });
        this.ledger.append('economy.usage', {
          providerId: response.providerId,
          modelId: response.modelId,
          inputTokens,
          outputTokens,
          cachedInputTokens: response.usage?.cachedInputTokens ?? 0,
          estimated: response.usage?.inputTokens === undefined || response.usage?.outputTokens === undefined,
        });
        if (cacheable && this.resultCache) this.resultCache.set(effectiveRequest, response);
        return response;
      } catch (error) {
        lastError = error;
        const transport = error instanceof ProviderTransportError ? error : undefined;
        const retryable = transport?.retryable ?? true;
        const observation: ExecutionObservation = {
          requestId: decision.requestId,
          providerId: candidate.provider.id,
          modelId: candidate.model.id,
          outcome: retryable ? 'retryable_failure' : 'terminal_failure',
          latencyMs: performance.now() - started,
          ...(transport?.statusCode !== undefined ? { statusCode: transport.statusCode } : {}),
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        };
        this.#recordObservation(observation);
        if (!retryable) throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('All PHOENIX routes failed');
  }

  #recordObservation(observation: ExecutionObservation): void {
    this.evolution.observe(observation);
    this.ledger.append('execution.observation', observation);
    const current = this.#health.get(observation.providerId) ?? {
      providerId: observation.providerId,
      available: true,
      successRate: 1,
      consecutiveFailures: 0,
    };
    if (observation.outcome === 'success') {
      this.#health.set(observation.providerId, { ...current, available: true, consecutiveFailures: 0 });
      return;
    }
    const failures = (current.consecutiveFailures ?? 0) + 1;
    this.#health.set(observation.providerId, {
      ...current,
      consecutiveFailures: failures,
      available: failures < 3,
    });
  }
}

export * from './adaptiveMission.js';
export * from './agents.js';
export * from './arena.js';
export * from './bootstrap.js';
export * from './experience.js';
export * from './mcpBootstrap.js';
export * from './memory.js';
export * from './rebirth.js';
export * from './scheduler.js';
export * from './singularity.js';
export * from './tokenEconomy.js';
export * from './tools.js';
export * from './toolsmith.js';
export * from '@phoenix/contracts';
export * from '@phoenix/evolution';
export * from '@phoenix/ledger';
export * from '@phoenix/mcp';
export * from '@phoenix/providers';
export * from '@phoenix/router';