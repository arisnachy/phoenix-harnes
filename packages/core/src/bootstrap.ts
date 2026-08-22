import { readFile } from 'node:fs/promises';
import type { ModelCapabilities, ModelDefinition, ProviderAdapter, ProviderDefinition } from '@phoenix/contracts';
import type { ModelCapabilityRanking } from '@phoenix/model-rank';
import { onboardDiscoveredModels } from '@phoenix/model-rank/onboarding';
import {
  ClaudeCodeCliAdapter,
  CodexCliAdapter,
  OpenAICompatibleAdapter,
  claudeCodeSubscriptionProvider,
  codexSubscriptionProvider,
  customOpenAIProvider,
  discoverOpenAICompatible,
} from '@phoenix/providers';

export type CapabilityPreset = 'conservative' | 'agentic-text';
export type ProviderManifestKind = 'openai-compatible' | 'codex-cli' | 'claude-code-cli';

export interface ProviderManifestEntry {
  id: string;
  kind?: ProviderManifestKind;
  displayName?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  local?: boolean;
  discover?: boolean;
  capabilityPreset?: CapabilityPreset;
  models?: readonly string[];
  binary?: string;
}

export interface PhoenixManifest {
  providers: readonly ProviderManifestEntry[];
}

export interface ProviderRegistrationRuntime {
  registerProvider(definition: ProviderDefinition, adapter: ProviderAdapter): void;
}

export interface ProviderBootstrapOptions {
  ranking?: ModelCapabilityRanking;
}

const conservative: ModelCapabilities = {
  input: ['text'], output: ['text'], tools: false, json: false, reasoning: false, streaming: true,
};
const agenticText: ModelCapabilities = {
  input: ['text'], output: ['text'], tools: true, json: true, reasoning: true, streaming: true,
};

function capabilities(preset: CapabilityPreset | undefined): ModelCapabilities {
  return preset === 'agentic-text' ? agenticText : conservative;
}

function validateManifest(value: unknown): PhoenixManifest {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { providers?: unknown }).providers)) {
    throw new Error('Invalid PHOENIX manifest: providers[] is required');
  }
  const providers = (value as { providers: unknown[] }).providers;
  for (const entry of providers) {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid PHOENIX provider manifest entry');
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string') throw new Error('Each PHOENIX provider requires id');
    const kind = typeof record.kind === 'string' ? record.kind : 'openai-compatible';
    if (!['openai-compatible', 'codex-cli', 'claude-code-cli'].includes(kind)) {
      throw new Error(`Unsupported PHOENIX provider kind: ${kind}`);
    }
    if (kind === 'openai-compatible' && typeof record.baseUrl !== 'string') {
      throw new Error(`OpenAI-compatible provider ${record.id} requires baseUrl`);
    }
  }
  return value as PhoenixManifest;
}

function onboardProvider(ranking: ModelCapabilityRanking | undefined, provider: ProviderDefinition): void {
  if (!ranking) return;
  onboardDiscoveredModels(ranking, {
    providerId: provider.id,
    modelIds: provider.models.map((model) => model.id),
  });
}

export async function loadPhoenixManifest(path = 'phoenix.providers.json'): Promise<PhoenixManifest> {
  return validateManifest(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export async function bootstrapProviderManifest(
  runtime: ProviderRegistrationRuntime,
  manifest: PhoenixManifest,
  options: ProviderBootstrapOptions = {},
): Promise<readonly ProviderDefinition[]> {
  const registered: ProviderDefinition[] = [];
  for (const entry of manifest.providers) {
    const kind = entry.kind ?? 'openai-compatible';
    if (kind === 'codex-cli') {
      const provider = codexSubscriptionProvider(entry.models?.length ? entry.models : ['default']);
      runtime.registerProvider(provider, new CodexCliAdapter(entry.binary ?? 'codex'));
      onboardProvider(options.ranking, provider);
      registered.push(provider);
      continue;
    }
    if (kind === 'claude-code-cli') {
      const provider = claudeCodeSubscriptionProvider(entry.models?.length ? entry.models : ['default']);
      runtime.registerProvider(provider, new ClaudeCodeCliAdapter(entry.binary ?? 'claude'));
      onboardProvider(options.ranking, provider);
      registered.push(provider);
      continue;
    }

    const baseUrl = entry.baseUrl;
    if (!baseUrl) throw new Error(`Provider ${entry.id} requires baseUrl`);
    let provider: ProviderDefinition;
    if (entry.discover !== false) {
      const report = await discoverOpenAICompatible({
        id: entry.id,
        ...(entry.displayName ? { displayName: entry.displayName } : {}),
        baseUrl,
        ...(entry.apiKeyEnv ? { apiKeyEnv: entry.apiKeyEnv } : {}),
        ...(entry.local !== undefined ? { local: entry.local } : {}),
        capabilitiesForModel: () => capabilities(entry.capabilityPreset),
      });
      provider = report.provider;
    } else {
      const models: ModelDefinition[] = (entry.models ?? []).map((id) => ({
        id,
        capabilities: capabilities(entry.capabilityPreset),
        ...(entry.local ? { economics: { free: true, billingMode: 'local' as const } } : {}),
      }));
      if (!models.length) throw new Error(`Provider ${entry.id} has discovery disabled but no models were declared`);
      provider = customOpenAIProvider({
        id: entry.id,
        ...(entry.displayName ? { displayName: entry.displayName } : {}),
        baseUrl,
        ...(entry.apiKeyEnv ? { apiKeyEnv: entry.apiKeyEnv } : {}),
        ...(entry.local !== undefined ? { local: entry.local } : {}),
        models,
      });
    }
    runtime.registerProvider(provider, new OpenAICompatibleAdapter(provider.id));
    onboardProvider(options.ranking, provider);
    registered.push(provider);
  }
  return registered;
}
