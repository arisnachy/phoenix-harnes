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

interface RegisteredProvider {
  definition: ProviderDefinition;
  adapter: ProviderAdapter;
}

export interface PhoenixRuntimeOptions {
  ledger?: InMemoryLedger;
  evolution?: EvolutionEngine;
}

export class PhoenixRuntime {
  readonly #providers = new Map<string, RegisteredProvider>();
  readonly #health = new Map<string, ProviderHealth>();
  public readonly ledger: InMemoryLedger;
  public readonly evolution: EvolutionEngine;

  public constructor(options: PhoenixRuntimeOptions = {}) {
    this.ledger = options.ledger ?? new InMemoryLedger();
    this.evolution = options.evolution ?? new EvolutionEngine();
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
    const decision = route(request, { providers: this.providers(), health: this.health() });
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
          request,
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

export * from './agents.js';
export * from './arena.js';
export * from './bootstrap.js';
export * from './memory.js';
export * from './scheduler.js';
export * from './singularity.js';
export * from './tools.js';
export * from '@phoenix/contracts';
export * from '@phoenix/evolution';
export * from '@phoenix/ledger';
export * from '@phoenix/providers';
export * from '@phoenix/router';
