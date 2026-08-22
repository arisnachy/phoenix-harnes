import type {
  PhoenixMessage,
  PhoenixRequest,
  PhoenixResponse,
  RequestRequirements,
  RoutingPreferences,
} from '@phoenix/contracts';
import type { LocalMemoryStore } from './memory.js';
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
}

function renderToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export class AgentRunner {
  public constructor(
    private readonly runtime: AgentGenerationRuntime,
    private readonly options: AgentRunnerOptions = {},
  ) {}

  public async run(agent: AgentDefinition, input: string, signal?: AbortSignal): Promise<AgentRunResult> {
    const messages: PhoenixMessage[] = [{ role: 'system', content: agent.instructions }];
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
    messages.push({ role: 'user', content: input });

    const toolDefinitions = this.options.tools?.definitions(agent.toolNames) ?? [];
    const maxTurns = Math.max(1, agent.maxTurns ?? 8);
    let toolExecutions = 0;

    for (let turn = 1; turn <= maxTurns; turn += 1) {
      const request: PhoenixRequest = {
        messages,
        ...(toolDefinitions.length ? { tools: toolDefinitions } : {}),
        requirements: {
          ...(agent.requirements ?? {}),
          ...(toolDefinitions.length ? { tools: true } : {}),
        },
        ...(agent.preferences ? { preferences: agent.preferences } : {}),
        metadata: { agentId: agent.id, turn: String(turn) },
      };
      const response = await this.runtime.generate(request, signal);
      this.runtime.ledger?.append('agent.turn', {
        agentId: agent.id,
        turn,
        providerId: response.providerId,
        modelId: response.modelId,
        toolCalls: response.toolCalls?.map((call) => call.name) ?? [],
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
        return { agentId: agent.id, response, turns: turn, toolExecutions };
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
