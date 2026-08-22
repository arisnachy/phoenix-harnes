import { randomUUID } from 'node:crypto';
import type {
  BillingMode,
  ModelDefinition,
  PhoenixRequest,
  ProviderDefinition,
  ProviderHealth,
  RouteCandidate,
  RouteDecision,
} from '@phoenix/contracts';

export interface RouterInput {
  providers: readonly ProviderDefinition[];
  health?: readonly ProviderHealth[];
}

function incompatibility(model: ModelDefinition, request: PhoenixRequest): string | undefined {
  const required = request.requirements;
  if (!required) return undefined;
  if (required.tools && !model.capabilities.tools) return 'tools_required';
  if (required.json && !model.capabilities.json) return 'json_required';
  if (required.reasoning && !model.capabilities.reasoning) return 'reasoning_required';
  if (required.streaming && !model.capabilities.streaming) return 'streaming_required';
  if (
    required.minimumContextWindow &&
    (!model.capabilities.contextWindow || model.capabilities.contextWindow < required.minimumContextWindow)
  ) return 'context_window_too_small';
  if (required.inputModalities?.some((item) => !model.capabilities.input.includes(item))) {
    return 'input_modality_unsupported';
  }
  return undefined;
}

function billingMode(provider: ProviderDefinition, model: ModelDefinition): BillingMode {
  if (model.economics?.billingMode) return model.economics.billingMode;
  if (model.economics?.free) return 'free';
  if (provider.local) return 'local';
  return 'unknown';
}

function scoreCandidate(
  provider: ProviderDefinition,
  model: ModelDefinition,
  request: PhoenixRequest,
  health: ProviderHealth | undefined,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const preferences = request.preferences;
  const billing = billingMode(provider, model);

  if (preferences?.preferFree !== false && billing === 'free') {
    score += 30;
    reasons.push('free_preference:+30');
  }
  if (preferences?.preferFree !== false && billing === 'metered') {
    score -= 8;
    reasons.push('metered_penalty:-8');
  }
  if (preferences?.preferSubscription && billing === 'subscription') {
    score += 30;
    reasons.push('subscription_preference:+30');
  }
  if (preferences?.preferLocal && provider.local) {
    score += 30;
    reasons.push('local_preference:+30');
  } else if (provider.local) {
    score += 10;
    reasons.push('locality:+10');
  }
  if (preferences?.preferredProviders?.includes(provider.id)) {
    score += 20;
    reasons.push('preferred_provider:+20');
  }
  if (preferences?.preferredModels?.includes(model.id)) {
    score += 25;
    reasons.push('preferred_model:+25');
  }
  if (typeof model.quality === 'number') {
    const qualityScore = Math.max(0, Math.min(1, model.quality)) * 25;
    score += qualityScore;
    reasons.push(`quality:+${qualityScore.toFixed(1)}`);
  }
  if (health?.successRate !== undefined) {
    const healthScore = Math.max(0, Math.min(1, health.successRate)) * 15;
    score += healthScore;
    reasons.push(`health:+${healthScore.toFixed(1)}`);
  }
  if (health?.consecutiveFailures) {
    const penalty = Math.min(30, health.consecutiveFailures * 10);
    score -= penalty;
    reasons.push(`consecutive_failures:-${penalty}`);
  }

  return { score, reasons };
}

export function route(request: PhoenixRequest, input: RouterInput): RouteDecision {
  const healthByProvider = new Map(
    input.health?.map((entry) => [entry.providerId, entry] as const),
  );
  const candidates: RouteCandidate[] = [];
  const rejected: Array<{ providerId: string; modelId: string; reason: string }> = [];
  const excludedProviders = new Set(request.preferences?.excludedProviders ?? []);
  const excludedModels = new Set(request.preferences?.excludedModels ?? []);

  for (const provider of input.providers) {
    const providerHealth = healthByProvider.get(provider.id);
    for (const model of provider.models) {
      if (excludedProviders.has(provider.id)) {
        rejected.push({ providerId: provider.id, modelId: model.id, reason: 'provider_excluded' });
        continue;
      }
      if (excludedModels.has(model.id)) {
        rejected.push({ providerId: provider.id, modelId: model.id, reason: 'model_excluded' });
        continue;
      }
      if (providerHealth?.available === false) {
        rejected.push({ providerId: provider.id, modelId: model.id, reason: 'provider_unavailable' });
        continue;
      }
      const mismatch = incompatibility(model, request);
      if (mismatch) {
        rejected.push({ providerId: provider.id, modelId: model.id, reason: mismatch });
        continue;
      }
      const scored = scoreCandidate(provider, model, request, providerHealth);
      candidates.push({ provider, model, score: scored.score, reasons: scored.reasons });
    }
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.provider.id.localeCompare(b.provider.id) ||
      a.model.id.localeCompare(b.model.id),
  );

  return { requestId: randomUUID(), candidates, rejected };
}
