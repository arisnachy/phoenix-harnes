import { randomUUID } from 'node:crypto';
import type {
  ModelDefinition,
  PhoenixMessage,
  PhoenixRequest,
  PhoenixResponse,
  PhoenixToolCall,
  ProviderAdapter,
  ProviderDefinition,
} from '@phoenix/contracts';

const textCapabilities = {
  input: ['text'] as const,
  output: ['text'] as const,
  tools: true,
  json: true,
  reasoning: true,
  streaming: true,
};

export function orcaRouterProvider(): ProviderDefinition {
  return {
    id: 'orcarouter',
    displayName: 'OrcaRouter',
    baseUrl: 'https://api.orcarouter.ai/v1',
    protocol: 'openai-chat',
    apiKeyEnv: 'ORCAROUTER_API_KEY',
    models: [
      {
        id: 'orcarouter/free',
        displayName: 'OrcaRouter Free',
        capabilities: textCapabilities,
        economics: { free: true },
        tags: ['free-bootstrap', 'adaptive-router'],
      },
    ],
    tags: ['gateway', 'free-bootstrap'],
  };
}

export function ollamaProvider(models: readonly string[] = []): ProviderDefinition {
  return {
    id: 'ollama',
    displayName: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    protocol: 'openai-chat',
    local: true,
    models: models.map((id) => ({
      id,
      capabilities: textCapabilities,
      economics: { free: true },
      tags: ['local'],
    })),
    tags: ['local'],
  };
}

export interface CustomOpenAIProviderOptions {
  id: string;
  displayName?: string;
  baseUrl: string;
  apiKeyEnv?: string;
  local?: boolean;
  models: readonly ModelDefinition[];
}

export function customOpenAIProvider(options: CustomOpenAIProviderOptions): ProviderDefinition {
  return {
    id: options.id,
    displayName: options.displayName ?? options.id,
    baseUrl: options.baseUrl.replace(/\/$/, ''),
    protocol: 'openai-chat',
    ...(options.apiKeyEnv ? { apiKeyEnv: options.apiKeyEnv } : {}),
    ...(options.local !== undefined ? { local: options.local } : {}),
    models: options.models,
  };
}

function toOpenAITools(request: PhoenixRequest) {
  return request.tools?.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      parameters: tool.inputSchema,
    },
  }));
}

function toOpenAIMessage(message: PhoenixMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolCalls?.length ? {
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        },
      })),
    } : {}),
  };
}

function normalizeToolCalls(value: unknown): PhoenixToolCall[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const calls: PhoenixToolCall[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const fn = record.function as Record<string, unknown> | undefined;
    if (!fn || typeof fn.name !== 'string') continue;
    let args: Record<string, unknown> = {};
    if (typeof fn.arguments === 'string') {
      try {
        const parsed = JSON.parse(fn.arguments) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        args = { _raw: fn.arguments };
      }
    }
    calls.push({
      id: typeof record.id === 'string' ? record.id : randomUUID(),
      name: fn.name,
      arguments: args,
    });
  }
  return calls.length ? calls : undefined;
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  public constructor(public readonly providerId: string) {}

  public async generate(
    provider: ProviderDefinition,
    model: ModelDefinition,
    request: PhoenixRequest,
    context?: { signal?: AbortSignal },
  ): Promise<PhoenixResponse> {
    const key = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined;
    if (provider.apiKeyEnv && !key) {
      throw new ProviderTransportError(
        `Missing credential environment variable ${provider.apiKeyEnv}`,
        undefined,
        false,
      );
    }

    const body: Record<string, unknown> = {
      model: model.id,
      messages: request.messages.map(toOpenAIMessage),
      stream: false,
    };
    const tools = toOpenAITools(request);
    if (tools?.length) body.tools = tools;
    if (request.requirements?.json) body.response_format = { type: 'json_object' };

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (key) headers.authorization = `Bearer ${key}`;

    let response: Response;
    try {
      response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...(context?.signal ? { signal: context.signal } : {}),
      });
    } catch (error) {
      throw new ProviderTransportError(
        error instanceof Error ? error.message : 'Provider transport failure',
        undefined,
        true,
      );
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      throw new ProviderTransportError(
        `Provider ${provider.id} returned HTTP ${response.status}: ${detail}`,
        response.status,
        response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const choices = payload.choices;
    if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') {
      throw new ProviderTransportError(`Provider ${provider.id} returned an invalid response shape`, undefined, false);
    }
    const choice = choices[0] as Record<string, unknown>;
    const message = (choice.message ?? {}) as Record<string, unknown>;
    const usage = (payload.usage ?? {}) as Record<string, unknown>;
    const toolCalls = normalizeToolCalls(message.tool_calls);

    return {
      providerId: provider.id,
      modelId: model.id,
      content: typeof message.content === 'string' ? message.content : '',
      ...(toolCalls ? { toolCalls } : {}),
      ...(typeof choice.finish_reason === 'string' ? { finishReason: choice.finish_reason } : {}),
      usage: {
        ...(typeof usage.prompt_tokens === 'number' ? { inputTokens: usage.prompt_tokens } : {}),
        ...(typeof usage.completion_tokens === 'number' ? { outputTokens: usage.completion_tokens } : {}),
      },
    };
  }
}

export class ProviderTransportError extends Error {
  public constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderTransportError';
  }
}

export * from './discovery.js';
