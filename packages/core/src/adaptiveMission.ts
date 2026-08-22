import type { PhoenixRequest, PhoenixResponse } from '@phoenix/contracts';
import { AgentRunner, type AgentDefinition, type AgentRunResult, type AgentRunnerOptions } from './agents.js';
import { type CapabilityNeed, type ToolAcquisition, ToolsmithEngine } from './toolsmith.js';
import { ToolRegistry } from './tools.js';

export interface MissionAttempt {
  attempt: number;
  approach: string;
  acquiredTools: readonly string[];
  failures: readonly string[];
}

export interface AdaptiveMissionResult extends AgentRunResult {
  missionAttempts: number;
  attempts: readonly MissionAttempt[];
}

export interface MissionPivot {
  approach: string;
  additionalNeeds: readonly CapabilityNeed[];
  stop?: boolean;
}

export interface MissionPivotPlanner {
  pivot(
    mission: string,
    previousApproach: string,
    failures: readonly string[],
    attempt: number,
  ): Promise<MissionPivot>;
}

export interface MissionGenerationRuntime {
  generate(request: PhoenixRequest, signal?: AbortSignal): Promise<PhoenixResponse>;
  ledger?: { append(type: string, payload: unknown): unknown };
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const value = JSON.parse(trimmed) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected JSON object');
  return value as Record<string, unknown>;
}

function needFrom(value: unknown, index: number): CapabilityNeed | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.query !== 'string' || !item.query.trim()) return undefined;
  const risks = Array.isArray(item.acceptableRisks)
    ? item.acceptableRisks.filter((risk): risk is 'read' | 'write' | 'network' | 'exec' =>
        risk === 'read' || risk === 'write' || risk === 'network' || risk === 'exec')
    : undefined;
  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id : `pivot-need-${index + 1}`,
    query: item.query,
    reason: typeof item.reason === 'string' ? item.reason : item.query,
    required: item.required !== false,
    ...(risks?.length ? { acceptableRisks: risks } : {}),
    ...(item.testInput && typeof item.testInput === 'object' && !Array.isArray(item.testInput)
      ? { testInput: item.testInput as Record<string, unknown> }
      : {}),
  };
}

export class PhoenixMissionPivotPlanner implements MissionPivotPlanner {
  public constructor(private readonly runtime: MissionGenerationRuntime) {}

  public async pivot(
    mission: string,
    previousApproach: string,
    failures: readonly string[],
    attempt: number,
  ): Promise<MissionPivot> {
    const response = await this.runtime.generate({
      messages: [
        {
          role: 'system',
          content: [
            'You are PHOENIX strategy pivot control.',
            'A previous route failed. Return JSON only.',
            'Choose a materially different permitted approach rather than repeating the same failure.',
            'Identify any new tool capabilities required. Do not invent credentials or bypass permissions.',
            'Shape: {"approach":"...","stop":false,"additionalNeeds":[{"id":"...","query":"...","reason":"...","required":true,"acceptableRisks":["read","network"],"testInput":{}}]}',
          ].join('\n'),
        },
        { role: 'user', content: JSON.stringify({ mission, previousApproach, failures: failures.slice(-8), attempt }) },
      ],
      requirements: { json: true, reasoning: true },
      preferences: { preferLocal: true, preferFree: true, preferSubscription: true },
      metadata: { purpose: 'mission-strategy-pivot' },
    });
    const root = parseJsonObject(response.content);
    const additionalNeeds = (Array.isArray(root.additionalNeeds) ? root.additionalNeeds : [])
      .map(needFrom)
      .filter((item): item is CapabilityNeed => Boolean(item));
    return {
      approach: typeof root.approach === 'string' && root.approach.trim()
        ? root.approach
        : 'Retry using a different decomposition and the verified capabilities already available.',
      additionalNeeds,
      ...(root.stop === true ? { stop: true } : {}),
    };
  }
}

export interface AdaptiveMissionRunnerOptions extends AgentRunnerOptions {
  tools: ToolRegistry;
  toolsmith: ToolsmithEngine;
  pivotPlanner: MissionPivotPlanner;
  maxMissionAttempts?: number;
  ledger?: { append(type: string, payload: unknown): unknown };
}

export class AdaptiveMissionRunner {
  readonly #runtime: MissionGenerationRuntime;
  readonly #tools: ToolRegistry;
  readonly #toolsmith: ToolsmithEngine;
  readonly #pivotPlanner: MissionPivotPlanner;
  readonly #maxMissionAttempts: number;
  readonly #agentOptions: AgentRunnerOptions;
  readonly #ledger: AdaptiveMissionRunnerOptions['ledger'];

  public constructor(runtime: MissionGenerationRuntime, options: AdaptiveMissionRunnerOptions) {
    this.#runtime = runtime;
    this.#tools = options.tools;
    this.#toolsmith = options.toolsmith;
    this.#pivotPlanner = options.pivotPlanner;
    this.#maxMissionAttempts = Math.max(1, options.maxMissionAttempts ?? 3);
    this.#ledger = options.ledger ?? runtime.ledger;
    this.#agentOptions = {
      tools: options.tools,
      ...(options.toolPolicy ? { toolPolicy: options.toolPolicy } : {}),
      ...(options.memory ? { memory: options.memory } : {}),
      ...(options.skills ? { skills: options.skills } : {}),
      ...(options.skillTokenBudget !== undefined ? { skillTokenBudget: options.skillTokenBudget } : {}),
      ...(options.historyTokenBudget !== undefined ? { historyTokenBudget: options.historyTokenBudget } : {}),
    };
  }

  public async run(agent: AgentDefinition, mission: string, signal?: AbortSignal): Promise<AdaptiveMissionResult> {
    let approach = mission;
    let pendingNeeds = [...await this.#toolsmith.analyzeMission(mission)];
    const boundTools = new Set(agent.toolNames ?? []);
    const attempts: MissionAttempt[] = [];
    const cumulativeFailures: string[] = [];

    for (let attempt = 1; attempt <= this.#maxMissionAttempts; attempt += 1) {
      const acquired: ToolAcquisition[] = [];
      const attemptFailures: string[] = [];
      for (const need of pendingNeeds) {
        try {
          const acquisition = await this.#toolsmith.acquire(mission, need);
          const toolName = await this.#toolsmith.bindToRegistry(this.#tools, acquisition);
          boundTools.add(toolName);
          acquired.push(acquisition);
        } catch (error) {
          const reason = `capability ${need.id}: ${error instanceof Error ? error.message : String(error)}`;
          attemptFailures.push(reason);
          cumulativeFailures.push(reason);
          if (need.required) continue;
        }
      }

      const attemptRecord: MissionAttempt = {
        attempt,
        approach,
        acquiredTools: acquired.map((item) => `${item.descriptor.serverId}/${item.descriptor.name}`),
        failures: [...attemptFailures],
      };
      attempts.push(attemptRecord);
      this.#ledger?.append('mission.attempt', attemptRecord);

      const requiredFailure = pendingNeeds.some((need) => need.required)
        && pendingNeeds.filter((need) => need.required).some((need) => attemptFailures.some((failure) => failure.includes(`capability ${need.id}:`)));

      if (!requiredFailure) {
        try {
          const runner = new AgentRunner(this.#runtime, this.#agentOptions);
          const result = await runner.run({
            ...agent,
            toolNames: [...boundTools],
          }, approach, signal);
          this.#ledger?.append('mission.completed', {
            attempts: attempt,
            providerId: result.response.providerId,
            modelId: result.response.modelId,
            tools: [...boundTools],
          });
          return { ...result, missionAttempts: attempt, attempts };
        } catch (error) {
          const reason = `execution attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`;
          attemptFailures.push(reason);
          cumulativeFailures.push(reason);
          attempts[attempts.length - 1] = { ...attemptRecord, failures: [...attemptFailures] };
        }
      }

      if (attempt >= this.#maxMissionAttempts) break;
      const pivot = await this.#pivotPlanner.pivot(mission, approach, cumulativeFailures, attempt);
      this.#ledger?.append('mission.pivot', {
        attempt,
        from: approach,
        to: pivot.approach,
        additionalNeeds: pivot.additionalNeeds,
        stop: pivot.stop ?? false,
      });
      if (pivot.stop) break;
      approach = pivot.approach;
      pendingNeeds = [...pivot.additionalNeeds];
    }

    this.#ledger?.append('mission.exhausted', { attempts, failures: cumulativeFailures });
    throw new Error(`PHOENIX mission exhausted ${attempts.length} strategy attempts: ${cumulativeFailures.slice(-3).join(' | ')}`);
  }
}
