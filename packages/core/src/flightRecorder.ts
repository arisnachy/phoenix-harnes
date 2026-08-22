import type { PhoenixRequest, PhoenixResponse } from '@phoenix/contracts';
import { estimateTokens } from './tokenEconomy.js';

export type TokenBucket =
  | 'system'
  | 'user'
  | 'assistant'
  | 'tool-result'
  | 'tool-schema'
  | 'other';

export interface TokenBreakdown {
  system: number;
  user: number;
  assistant: number;
  'tool-result': number;
  'tool-schema': number;
  other: number;
}

export interface MissionTokenFlight {
  missionId: string;
  calls: number;
  estimatedRequestTokens: number;
  actualInputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  avoidedInputTokens: number;
  frontierCalls: number;
  breakdown: TokenBreakdown;
  providers: Readonly<Record<string, number>>;
  models: Readonly<Record<string, number>>;
}

export interface FlightForecast {
  estimatedInputTokens: number;
  tokenBudget?: number;
  projectedUtilization?: number;
  warning?: 'budget_near_limit' | 'budget_exceeded';
  breakdown: TokenBreakdown;
}

function emptyBreakdown(): TokenBreakdown {
  return { system: 0, user: 0, assistant: 0, 'tool-result': 0, 'tool-schema': 0, other: 0 };
}

export function estimateRequestTokenBreakdown(request: PhoenixRequest): TokenBreakdown {
  const result = emptyBreakdown();
  for (const message of request.messages) {
    const cost = estimateTokens(message.content)
      + estimateTokens(JSON.stringify(message.toolCalls ?? []))
      + 4;
    if (message.role === 'system') result.system += cost;
    else if (message.role === 'user') result.user += cost;
    else if (message.role === 'assistant') result.assistant += cost;
    else if (message.role === 'tool') result['tool-result'] += cost;
    else result.other += cost;
  }
  result['tool-schema'] = estimateTokens(JSON.stringify(request.tools ?? []));
  return result;
}

function sumBreakdown(value: TokenBreakdown): number {
  return Object.values(value).reduce((sum, item) => sum + item, 0);
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

interface MutableMissionTokenFlight {
  missionId: string;
  calls: number;
  estimatedRequestTokens: number;
  actualInputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  avoidedInputTokens: number;
  frontierCalls: number;
  breakdown: TokenBreakdown;
  providers: Record<string, number>;
  models: Record<string, number>;
}

function newFlight(missionId: string): MutableMissionTokenFlight {
  return {
    missionId,
    calls: 0,
    estimatedRequestTokens: 0,
    actualInputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    avoidedInputTokens: 0,
    frontierCalls: 0,
    breakdown: emptyBreakdown(),
    providers: {},
    models: {},
  };
}

export class TokenFlightRecorder {
  readonly #missions = new Map<string, MutableMissionTokenFlight>();

  public forecast(request: PhoenixRequest, tokenBudget?: number): FlightForecast {
    const breakdown = estimateRequestTokenBreakdown(request);
    const estimatedInputTokens = sumBreakdown(breakdown);
    const utilization = tokenBudget && tokenBudget > 0 ? estimatedInputTokens / tokenBudget : undefined;
    return {
      estimatedInputTokens,
      ...(tokenBudget !== undefined ? { tokenBudget } : {}),
      ...(utilization !== undefined ? { projectedUtilization: utilization } : {}),
      ...(utilization !== undefined && utilization > 1
        ? { warning: 'budget_exceeded' as const }
        : utilization !== undefined && utilization >= 0.85
          ? { warning: 'budget_near_limit' as const }
          : {}),
      breakdown,
    };
  }

  public recordRequest(missionId: string, request: PhoenixRequest): FlightForecast {
    const flight = this.#missions.get(missionId) ?? newFlight(missionId);
    const forecast = this.forecast(request, request.preferences?.maxInputTokens);
    flight.calls += 1;
    flight.estimatedRequestTokens += forecast.estimatedInputTokens;
    for (const [bucket, tokens] of Object.entries(forecast.breakdown) as Array<[keyof TokenBreakdown, number]>) {
      flight.breakdown[bucket] += tokens;
    }
    this.#missions.set(missionId, flight);
    return forecast;
  }

  public recordResponse(missionId: string, response: PhoenixResponse, inputFallback = 0): void {
    const flight = this.#missions.get(missionId) ?? newFlight(missionId);
    flight.actualInputTokens += response.usage?.inputTokens ?? inputFallback;
    flight.outputTokens += response.usage?.outputTokens ?? estimateTokens(response.content);
    flight.cachedInputTokens += response.usage?.cachedInputTokens ?? 0;
    increment(flight.providers, response.providerId);
    increment(flight.models, `${response.providerId}::${response.modelId}`);
    const frontier = response.metadata?.billingMode === 'subscription'
      || response.metadata?.frontier === true
      || response.metadata?.frontier === 'true';
    if (frontier) flight.frontierCalls += 1;
    this.#missions.set(missionId, flight);
  }

  public recordAvoided(missionId: string, tokens: number): void {
    const flight = this.#missions.get(missionId) ?? newFlight(missionId);
    flight.avoidedInputTokens += Math.max(0, Math.floor(tokens));
    this.#missions.set(missionId, flight);
  }

  public snapshot(missionId: string): MissionTokenFlight {
    const flight = this.#missions.get(missionId) ?? newFlight(missionId);
    return {
      ...flight,
      breakdown: { ...flight.breakdown },
      providers: { ...flight.providers },
      models: { ...flight.models },
    };
  }

  public efficiencyScore(missionId: string, quality: number, success: boolean): number {
    const value = this.snapshot(missionId);
    const quality01 = Math.max(0, Math.min(1, quality));
    if (!success) return 0;
    const fresh = Math.max(1, value.actualInputTokens - value.cachedInputTokens);
    const avoidedRatio = value.avoidedInputTokens / (fresh + value.avoidedInputTokens);
    const economy = 1 / (1 + fresh / 10_000);
    return Math.round((quality01 * 0.65 + economy * 0.25 + avoidedRatio * 0.10) * 1000) / 10;
  }
}
