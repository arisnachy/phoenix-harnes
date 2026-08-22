export type ProviderProtocol =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'gemini-native'
  | 'ollama-native'
  | 'custom';

export type Modality = 'text' | 'image' | 'audio' | 'video';

export interface ModelCapabilities {
  input: readonly Modality[];
  output: readonly Modality[];
  tools: boolean;
  json: boolean;
  reasoning: boolean;
  streaming: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface ModelEconomics {
  free?: boolean;
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
}

export interface ModelDefinition {
  id: string;
  displayName?: string;
  capabilities: ModelCapabilities;
  economics?: ModelEconomics;
  quality?: number;
  tags?: readonly string[];
}

export interface ProviderDefinition {
  id: string;
  displayName: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  apiKeyEnv?: string;
  local?: boolean;
  models: readonly ModelDefinition[];
  tags?: readonly string[];
}

export interface PhoenixToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface PhoenixMessage {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: readonly PhoenixToolCall[];
}

export interface PhoenixTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface RequestRequirements {
  tools?: boolean;
  json?: boolean;
  reasoning?: boolean;
  streaming?: boolean;
  inputModalities?: readonly Modality[];
  minimumContextWindow?: number;
}

export interface RoutingPreferences {
  preferFree?: boolean;
  preferLocal?: boolean;
  maxEstimatedCostUsd?: number;
  excludedProviders?: readonly string[];
  preferredProviders?: readonly string[];
  excludedModels?: readonly string[];
  preferredModels?: readonly string[];
}

export interface PhoenixRequest {
  messages: readonly PhoenixMessage[];
  tools?: readonly PhoenixTool[];
  requirements?: RequestRequirements;
  preferences?: RoutingPreferences;
  metadata?: Record<string, string>;
}

export interface PhoenixResponse {
  providerId: string;
  modelId: string;
  content: string;
  toolCalls?: readonly PhoenixToolCall[];
  finishReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface ProviderHealth {
  providerId: string;
  available: boolean;
  successRate?: number;
  p50LatencyMs?: number;
  consecutiveFailures?: number;
}

export interface RouteCandidate {
  provider: ProviderDefinition;
  model: ModelDefinition;
  score: number;
  reasons: readonly string[];
}

export interface RouteDecision {
  requestId: string;
  candidates: readonly RouteCandidate[];
  rejected: readonly {
    providerId: string;
    modelId: string;
    reason: string;
  }[];
}

export interface GenerationContext {
  signal?: AbortSignal;
}

export interface ProviderAdapter {
  readonly providerId: string;
  generate(
    provider: ProviderDefinition,
    model: ModelDefinition,
    request: PhoenixRequest,
    context?: GenerationContext,
  ): Promise<PhoenixResponse>;
}

export type ExecutionOutcome = 'success' | 'retryable_failure' | 'terminal_failure';

export interface ExecutionObservation {
  requestId: string;
  providerId: string;
  modelId: string;
  outcome: ExecutionOutcome;
  latencyMs: number;
  statusCode?: number;
  errorClass?: string;
}
