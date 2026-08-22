import type {
  PhoenixMessage,
  PhoenixRequest,
  PhoenixResponse,
  RequestRequirements,
  RoutingPreferences,
} from '@phoenix/contracts';
import type { SkillLibrary } from './experience.js';
import type { LocalMemoryStore } from './memory.js';
import { estimateTokens } from './tokenEconomy.js';
import type { ToolPolicy, ToolRegistry } from './tools.js';

export interface AgentDefinition {
  id: string;
  instructions: string;
  toolNames?: readonly string[];
  requirements?: RequestRequirements;
  preferences?: RoutingPreferences;
  maxTurns?: number;
  memoryNamespace?: string;
}

export interface AgentRunResult {
  agentId: string;
  response: PhoenixResponse;
  turns: number;
  toolExecutions: number;
  historyCompactions: number;
}

export interface AgentGenerationRuntime {
  generate(request: PhoenixRequest, signal?: AbortSignal): Promise<PhoenixResponse>;
  ledger?: {
    append(type: string, payload: unknown): unknown;
  };
}

export interface AgentRunnerOptions {
  tools?: ToolRegistry;
  toolPolicy?: ToolPolicy;
  memory?: LocalMemoryStore;
  skills?: SkillLibrary;
  skillTokenBudget?: number;
  historyTokenBudget?: number;
}

function renderToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function messageTokens(message: PhoenixMessage): number {
  return estimateTokens(message.content) + estimateTokens(JSON.stringify(message.toolCalls ?? [])) + 4;
}

function digestMessage(message: PhoenixMessage): string {
  const content = message.content.replace(/\s+/g, ' ').trim();
  const clipped = content.length > 220 ? `${content.slice(0, 205)}…` : content;
  const tools = message.toolCalls?.length ? ` tools=${message.toolCalls.map((item) => item.name).join(',')}` : '';
  return `${message.role}${tools}: ${clipped}`;
}

export function compactAgentHistory(messages: readonly PhoenixMessage[], budgetTokens: number): PhoenixMessage[] {
  const budget = Math.max(256, budgetTokens);
  const total = messages.reduce((sum, message) => sum + messageTokens(message), 0);
  if (total <= budget) return messages.map((item) => ({ ...item }));

  const system = messages.filter((message) => message.role === 'system');
  const nonSystem = messages.filter((message) => message.role !== 'system');
  const tail: PhoenixMessage[] = [];
  let used = system.reduce((sum, item) => sum + messageTokens(item), 0);

  // Preserve the newest interaction first. This keeps assistant tool_calls adjacent to their tool results.
  for (let index = nonSystem.length - 1; index >= 0; index -= 1) {
    const message = nonSystem[index];
    if (!message) continue;
    const cost = messageTokens(message);
    if (tail.length >= 6 || used + cost > Math.floor(budget * 0.82)) break;
    tail.unshift({ ...message });
    used += cost;
  }

  const tailSet = new Set(tail.map((item) => item));
  const tailStart = Math.max(0, nonSystem.length - tail.length);
  const omitted = nonSystem.slice(0, tailStart);
  let digest = omitted.map(digestMessage).join('\n');
  const digestBudget = Math.max(64, budget - used - 16);
  if (estimateTokens(digest) > digestBudget) digest = `${digest.slice(0, Math.max(0, digestBudget * 4 - 15))}\n…[compacted]`;

  const result: PhoenixMessage[] = [...system.map((item) => ({ ...item }))];
  if (digest.trim()) result.push({ role: 'system', content: `Earlier interaction digest:\n${digest}` });
  result.push(...tail);
  void tailSet;
  return result;
}

export class AgentRunner {
  public constructor(
    private readonly runtime: AgentGenerationRuntime,
    private readonly options: AgentRunnerOptions = {},
  ) {}

  public async run(agent: AgentDefinition, input: string, signal?: AbortSignal): Promise<AgentRunResult> {
    let messages: PhoenixMessage[] = [{ role: 'system', content: agent.instructions }];
    const namespace = agent.memoryNamespace ?? `agent:${agent.id}`;
    if (this.options.memory) {
      const memories = await this.options.memory.search(input, { namespace, limit: 6 });
      if (memories.length) {
        messages.push({
          role: 'system',
          content: `Relevant local memory:\n${memories.map((item) => `- ${item.content}`).join('\n')}`,
        });
      }
    }
    if (this.options.skills) {
      const skillContext = await this.options.skills.compactContext(input, this.options.skillTokenBudget ?? 500);
      if (skillContext) messages.push({ role: 'system', content: `Verified reusable PHOENIX skills:\n${skillContext}` });
    }
    messages.push({ role: 'user', content: input });

    const toolDefinitions = this.options.tools?.definitions(agent.toolNames) ?? [];
    const maxTurns = Math.max(1, agent.maxTurns ?? 8);
    const historyBudget = Math.max(512, this.options.historyTokenBudget ?? 4_000);
    let toolExecutions = 0;
    let historyCompactions = 0;
    let providerSessionId: string | undefined;
    let pinnedProviderId: string | undefined;
    let pinnedModelId: string | undefined;

    for (let turn = 1; turn <= maxTurns; turn += 1) {
      const compacted = compactAgentHistory(messages, historyBudget);
      if (compacted.length !== messages.length || compacted.some((item, index) => item.content !== messages[index]?.content)) {
        historyCompactions += 1;
        this.runtime.ledger?.append('economy.history_compacted', {
          agentId: agent.id,
          turn,
          beforeTokens: messages.reduce((sum, item) => sum + messageTokens(item), 0),
          afterTokens: compacted.reduce((sum, item) => sum + messageTokens(item), 0),
        });
      }
      messages = compacted;
      const preferences: RoutingPreferences = {
        ...(agent.preferences ?? {}),
        ...(pinnedProviderId ? { preferredProviders: [pinnedProviderId] } : {}),
        ...(pinnedModelId ? { preferredModels: [pinnedModelId] } : {}),
      };
      const request: PhoenixRequest = {
        messages,
        ...(toolDefinitions.length ? { tools: toolDefinitions } : {}),
        requirements: {
          ...(agent.requirements ?? {}),
          ...(toolDefinitions.length ? { tools: true } : {}),
        },
        ...(Object.keys(preferences).length ? { preferences } : {}),
        metadata: {
          agentId: agent.id,
          turn: String(turn),
          ...(providerSessionId ? { providerSessionId } : {}),
        },
      };
      const response = await this.runtime.generate(request, signal);
      if (response.providerSessionId) {
        providerSessionId = response.providerSessionId;
        pinnedProviderId = response.providerId;
        pinnedModelId = response.modelId;
      }
      this.runtime.ledger?.append('agent.turn', {
        agentId: agent.id,
        turn,
        providerId: response.providerId,
        modelId: response.modelId,
        providerSessionId: response.providerSessionId ?? null,
        toolCalls: response.toolCalls?.map((call) => call.name) ?? [],
        usage: response.usage ?? {},
      });

      if (!response.toolCalls?.length) {
        if (this.options.memory && response.content.trim()) {
          await this.options.memory.remember({
            namespace,
            kind: 'episodic',
            content: `Input: ${input}\nResponse: ${response.content}`,
            tags: ['agent-run', agent.id],
            metadata: { providerId: response.providerId, modelId: response.modelId },
          });
        }
        return { agentId: agent.id, response, turns: turn, toolExecutions, historyCompactions };
      }

      if (!this.options.tools) throw new Error(`Agent ${agent.id} requested tools but no ToolRegistry is configured`);
      messages.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls });
      for (const call of response.toolCalls) {
        const result = await this.options.tools.execute(
          call.name,
          call.arguments,
          this.options.toolPolicy,
          signal ? { signal, metadata: { agentId: agent.id } } : { metadata: { agentId: agent.id } },
        );
        toolExecutions += 1;
        this.runtime.ledger?.append('tool.execution', {
          agentId: agent.id,
          tool: call.name,
          callId: call.id,
          outcome: 'success',
        });
        messages.push({ role: 'tool', toolCallId: call.id, content: renderToolResult(result) });
      }
    }

    throw new Error(`Agent ${agent.id} exceeded maxTurns=${maxTurns}`);
  }
}
