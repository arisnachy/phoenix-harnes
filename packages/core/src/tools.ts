import type { PhoenixTool } from '@phoenix/contracts';

export type ToolRisk = 'read' | 'write' | 'network' | 'exec';

export interface ToolContext {
  signal?: AbortSignal;
  metadata?: Record<string, string>;
}

export interface RuntimeTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  risk: ToolRisk;
  execute(input: Record<string, unknown>, context?: ToolContext): Promise<unknown>;
}

export interface ToolPolicy {
  allowedRisks?: readonly ToolRisk[];
  deniedTools?: readonly string[];
  requireApprovalFor?: readonly ToolRisk[];
  approve?: (tool: RuntimeTool, input: Record<string, unknown>) => Promise<boolean>;
}

export class ToolPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ToolPolicyError';
  }
}

export class ToolRegistry {
  readonly #tools = new Map<string, RuntimeTool>();

  public register(tool: RuntimeTool): void {
    if (this.#tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.#tools.set(tool.name, tool);
  }

  public upsert(tool: RuntimeTool): void {
    this.#tools.set(tool.name, tool);
  }

  public unregister(name: string): boolean {
    return this.#tools.delete(name);
  }

  public has(name: string): boolean {
    return this.#tools.has(name);
  }

  public get(name: string): RuntimeTool | undefined {
    return this.#tools.get(name);
  }

  public names(): readonly string[] {
    return [...this.#tools.keys()].sort();
  }

  public definitions(names?: readonly string[]): PhoenixTool[] {
    const allowed = names ? new Set(names) : undefined;
    return [...this.#tools.values()]
      .filter((tool) => !allowed || allowed.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema,
      }));
  }

  public async execute(
    name: string,
    input: Record<string, unknown>,
    policy: ToolPolicy = {},
    context?: ToolContext,
  ): Promise<unknown> {
    const tool = this.#tools.get(name);
    if (!tool) throw new ToolPolicyError(`Unknown tool: ${name}`);
    if (policy.deniedTools?.includes(name)) throw new ToolPolicyError(`Tool denied by policy: ${name}`);
    if (policy.allowedRisks && !policy.allowedRisks.includes(tool.risk)) {
      throw new ToolPolicyError(`Tool risk not allowed: ${tool.risk}`);
    }
    if (policy.requireApprovalFor?.includes(tool.risk)) {
      if (!policy.approve) throw new ToolPolicyError(`Approval required for ${tool.risk} tool: ${name}`);
      if (!(await policy.approve(tool, input))) throw new ToolPolicyError(`Approval denied for tool: ${name}`);
    }
    return tool.execute(input, context);
  }
}
