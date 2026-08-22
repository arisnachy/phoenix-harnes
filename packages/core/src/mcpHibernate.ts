import type { PhoenixTool } from '@phoenix/contracts';
import { McpFederation, type McpCallPolicy, type McpCallResult, type McpServerSpec, type McpToolDescriptor } from '@phoenix/mcp';
import { ResourceBudgetError, type ResourceGovernor, type ResourceLease } from './resourceGovernor.js';

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
  resourceGovernor?: ResourceGovernor;
  estimatedServerRamMb?: number;
  operationWallMs?: number;
  maxDiscoveryServers?: number;
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

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9_.:/-]+/i).filter((item) => item.length >= 2));
}

function scoreTool(query: Set<string>, tool: McpToolDescriptor): number {
  if (!query.size) return 0.01;
  const candidate = words(`${tool.name} ${tool.description} ${tool.tags.join(' ')}`);
  let matches = 0;
  for (const item of query) if (candidate.has(item)) matches += 1;
  const relevance = matches / query.size;
  const exact = query.has(tool.name.toLowerCase()) ? 1 : 0;
  return relevance + exact;
}

export class HibernatingMcpBroker {
  readonly #federation: McpFederation;
  readonly #hibernateAfterOperation: boolean;
  readonly #resourceGovernor: ResourceGovernor | undefined;
  readonly #estimatedServerRamMb: number;
  readonly #operationWallMs: number;
  readonly #maxDiscoveryServers: number;
  readonly #stripped = new Set<string>();
  #wakes = 0;
  #sleeps = 0;
  #calls = 0;
  #searches = 0;

  public constructor(federation = new McpFederation(), options: HibernatingMcpOptions = {}) {
    this.#federation = federation;
    this.#hibernateAfterOperation = options.hibernateAfterOperation ?? true;
    this.#resourceGovernor = options.resourceGovernor;
    this.#estimatedServerRamMb = Math.max(0, Math.floor(options.estimatedServerRamMb ?? 256));
    this.#operationWallMs = Math.max(1_000, Math.floor(options.operationWallMs ?? 120_000));
    this.#maxDiscoveryServers = Math.max(1, Math.floor(options.maxDiscoveryServers ?? 12));
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
    const candidates = this.#federation.servers()
      .filter((server) => server.enabled !== false)
      .slice(0, this.#maxDiscoveryServers);

    for (const server of candidates) {
      const lease = this.#acquire(server.id);
      this.#wakes += 1;
      try {
        await this.#federation.discover(server.id);
      } catch (error) {
        if (error instanceof ResourceBudgetError) throw error;
        // One unavailable MCP server must not poison lazy tool discovery.
      } finally {
        if (this.#hibernateAfterOperation) {
          await this.#federation.disconnect(server.id);
          this.#sleeps += 1;
        }
        this.#release(lease);
      }
    }

    const queryWords = words(query);
    return this.#federation.cachedTools()
      .map((tool) => ({ tool, score: scoreTool(queryWords, tool) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
      .slice(0, Math.max(1, limit))
      .map(({ tool }) => ({
        name: `${tool.serverId}__${tool.name}`,
        description: `[MCP:${tool.serverId}] ${tool.description}`.slice(0, 2_000),
        inputSchema: tool.inputSchema,
      }));
  }

  public async call(serverId: string, toolName: string, args: Record<string, unknown>, policy: McpCallPolicy = {}): Promise<McpCallResult> {
    this.#calls += 1;
    this.#wakes += 1;
    const lease = this.#acquire(serverId);
    try {
      return await this.#federation.call(serverId, toolName, args, policy);
    } finally {
      if (this.#hibernateAfterOperation) {
        await this.#federation.disconnect(serverId);
        this.#sleeps += 1;
      }
      this.#release(lease);
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

  #acquire(resourceId: string): ResourceLease | undefined {
    return this.#resourceGovernor?.acquire({
      kind: 'mcp',
      resourceId,
      estimatedRamMb: this.#estimatedServerRamMb,
      wallMs: this.#operationWallMs,
      leaseMs: this.#operationWallMs,
    });
  }

  #release(lease: ResourceLease | undefined): void {
    if (lease) this.#resourceGovernor?.release(lease);
  }
}
