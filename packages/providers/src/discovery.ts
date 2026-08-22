import type { ModelCapabilities, ModelDefinition, ProviderDefinition } from '@phoenix/contracts';

export interface DiscoveryOptions {
  id: string;
  displayName?: string;
  baseUrl: string;
  apiKeyEnv?: string;
  local?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  capabilitiesForModel?: (modelId: string) => ModelCapabilities;
}

export interface ProviderDiscoveryReport {
  provider: ProviderDefinition;
  discoveredAt: string;
  source: 'openai-models';
  modelIds: readonly string[];
  warnings: readonly string[];
}

export class ProviderDiscoveryError extends Error {
  public constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderDiscoveryError';
  }
}

const conservativeCapabilities: ModelCapabilities = {
  input: ['text'],
  output: ['text'],
  tools: false,
  json: false,
  reasoning: false,
  streaming: true,
};

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export async function discoverOpenAICompatible(
  options: DiscoveryOptions,
): Promise<ProviderDiscoveryReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const key = options.apiKeyEnv ? process.env[options.apiKeyEnv] : undefined;
  if (options.apiKeyEnv && !key) {
    throw new ProviderDiscoveryError(
      `Missing credential environment variable ${options.apiKeyEnv}`,
      undefined,
      false,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;

  let response: Response;
  try {
    response = await fetchImpl(`${options.baseUrl.replace(/\/$/, '')}/models`, {
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    throw new ProviderDiscoveryError(
      error instanceof Error ? error.message : 'Provider discovery transport failure',
      undefined,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new ProviderDiscoveryError(
      `Provider discovery returned HTTP ${response.status}: ${detail}`,
      response.status,
      retryableStatus(response.status),
    );
  }

  const payload = (await response.json()) as { data?: unknown };
  const raw = Array.isArray(payload.data) ? payload.data : [];
  const modelIds = [...new Set(raw
    .map((item) => (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
      ? (item as { id: string }).id
      : undefined))
    .filter((item): item is string => Boolean(item)))]
    .sort();

  const warnings: string[] = [];
  if (!modelIds.length) warnings.push('provider_returned_no_models');
  if (!options.capabilitiesForModel) warnings.push('capabilities_default_to_conservative');

  const models: ModelDefinition[] = modelIds.map((id) => ({
    id,
    capabilities: options.capabilitiesForModel?.(id) ?? conservativeCapabilities,
    ...(options.local ? {
      economics: { free: true, billingMode: 'local' as const, quotaBucket: 'local-compute' },
    } : {}),
    tags: ['discovered', ...(options.local ? ['local'] : [])],
  }));

  const provider: ProviderDefinition = {
    id: options.id,
    displayName: options.displayName ?? options.id,
    baseUrl: options.baseUrl.replace(/\/$/, ''),
    protocol: 'openai-chat',
    ...(options.apiKeyEnv ? { apiKeyEnv: options.apiKeyEnv } : {}),
    ...(options.local !== undefined ? { local: options.local } : {}),
    models,
    tags: ['discovered', ...(options.local ? ['local'] : [])],
  };

  return {
    provider,
    discoveredAt: new Date().toISOString(),
    source: 'openai-models',
    modelIds,
    warnings,
  };
}

export function discoverOllama(options: Omit<DiscoveryOptions, 'id' | 'displayName' | 'local' | 'baseUrl'> & {
  baseUrl?: string;
} = {}): Promise<ProviderDiscoveryReport> {
  return discoverOpenAICompatible({
    ...options,
    id: 'ollama',
    displayName: 'Ollama',
    local: true,
    baseUrl: options.baseUrl ?? 'http://127.0.0.1:11434/v1',
  });
}
