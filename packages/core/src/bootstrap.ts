import { readFile } from 'node:fs/promises';
import type { ModelCapabilities, ModelDefinition, ProviderAdapter, ProviderDefinition } from '@phoenix/contracts';
import {
  OpenAICompatibleAdapter,
  customOpenAIProvider,
  discoverOpenAICompatible,
} from '@phoenix/providers';

export type CapabilityPreset = 'conservative' | 'agentic-text';

export interface ProviderManifestEntry {
  id: string;
  displayName?: string;
  baseUrl: string;
  apiKeyEnv?: string;
  local?: boolean;
  discover?: boolean;
  capabilityPreset?: CapabilityPreset;
  models?: readonly string[];
}

export interface PhoenixManifest {
  providers: readonly ProviderManifestEntry[];
}

export interface ProviderRegistrationRuntime {
  registerProvider(definition: ProviderDefinition, adapter: ProviderAdapter): void;
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
    if (typeof record.id !== 'string' || typeof record.baseUrl !== 'string') {
      throw new Error('Each PHOENIX provider requires id and baseUrl');
    }
  }
  return value as PhoenixManifest;
}

export async function loadPhoenixManifest(path = 'phoenix.providers.json'): Promise<PhoenixManifest> {
  return validateManifest(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export async function bootstrapProviderManifest(
  runtime: ProviderRegistrationRuntime,
  manifest: PhoenixManifest,
): Promise<readonly ProviderDefinition[]> {
  const registered: ProviderDefinition[] = [];
  for (const entry of manifest.providers) {
    let provider: ProviderDefinition;
    if (entry.discover !== false) {
      const report = await discoverOpenAICompatible({
        id: entry.id,
        ...(entry.displayName ? { displayName: entry.displayName } : {}),
        baseUrl: entry.baseUrl,
        ...(entry.apiKeyEnv ? { apiKeyEnv: entry.apiKeyEnv } : {}),
        ...(entry.local !== undefined ? { local: entry.local } : {}),
        capabilitiesForModel: () => capabilities(entry.capabilityPreset),
      });
      provider = report.provider;
    } else {
      const models: ModelDefinition[] = (entry.models ?? []).map((id) => ({
        id,
        capabilities: capabilities(entry.capabilityPreset),
        ...(entry.local ? { economics: { free: true } } : {}),
      }));
      if (!models.length) throw new Error(`Provider ${entry.id} has discovery disabled but no models were declared`);
      provider = customOpenAIProvider({
        id: entry.id,
        ...(entry.displayName ? { displayName: entry.displayName } : {}),
        baseUrl: entry.baseUrl,
        ...(entry.apiKeyEnv ? { apiKeyEnv: entry.apiKeyEnv } : {}),
        ...(entry.local !== undefined ? { local: entry.local } : {}),
        models,
      });
    }
    runtime.registerProvider(provider, new OpenAICompatibleAdapter(provider.id));
    registered.push(provider);
  }
  return registered;
}
