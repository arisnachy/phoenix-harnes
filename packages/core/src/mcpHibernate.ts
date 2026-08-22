import type { PhoenixTool } from '@phoenix/contracts';
import { McpFederation, type McpCallPolicy, type McpCallResult, type McpServerSpec } from '@phoenix/mcp';

export interface McpHibernateStats {
  wakes: number;
  sleeps: number;
  calls: number;
  searches: number;
  strippedEnvironmentServers: readonly string[];
}

export interface HibernatingMcpOptions {
  /** Keep every MCP process asleep between operations. */
  hibernateAfterOperation?: boolean;
}

function inertSpec(spec: McpServerSpec, stripped: string[]): McpServerSpec {
  if (!spec.env) return { ...spec };
  const { env: _env, ...safe } = spec;
  stripped.push(spec.id);
  return {
    ...safe,
    trusted: false,
    tags: [...(spec.tags ?? []), 'phoenix-env-stripped'],
  };
}

export class HibernatingMcpBroker {
  readonly #federation: McpFederation;
  readonly #hibernateAfterOperation: boolean;
  readonly #stripped = new Set<string>();
  #wakes = 0;
  #sleeps = 0;
  #calls = 0;
  #searches = 0;

  public constructor(federation = new McpFederation(), options: HibernatingMcpOptions = {}) {
    this.#federation = federation;
    this.#hibernateAfterOperation = options.hibernateAfterOperation ?? true;
  }

  public register(spec: McpServerSpec): void {
    const stripped: string[] = [];
    this.#federation.upsert(inertSpec(spec, stripped));
    for (const id of stripped) this.#stripped.add(id);
  }

  public registerMany(specs: readonly McpServerSpec[]): void {
    for (const spec of specs) this.register(spec);
  }

  public servers(): readonly McpServerSpec[] {
    return this.#federation.servers();
  }

  public async toolDefinitions(query: string, limit = 8): Promise<readonly PhoenixTool[]> {
    this.#searches += 1;
    this.#wakes += 1;
    try {
      return await this.#federation.toolDefinitions(query, limit);
    } finally {
      if (this.#hibernateAfterOperation) await this.hibernateAll();
    }
  }

  public async call(serverId: string, toolName: string, args: Record<string, unknown>, policy: McpCallPolicy = {}): Promise<McpCallResult> {
    this.#calls += 1;
    this.#wakes += 1;
    try {
      return await this.#federation.call(serverId, toolName, args, policy);
    } finally {
      if (this.#hibernateAfterOperation) {
        await this.#federation.disconnect(serverId);
        this.#sleeps += 1;
      }
    }
  }

  public async hibernateAll(): Promise<void> {
    await this.#federation.close();
    this.#sleeps += 1;
  }

  public stats(): McpHibernateStats {
    return {
      wakes: this.#wakes,
      sleeps: this.#sleeps,
      calls: this.#calls,
      searches: this.#searches,
      strippedEnvironmentServers: [...this.#stripped].sort(),
    };
  }

  public federation(): McpFederation { return this.#federation; }
}
