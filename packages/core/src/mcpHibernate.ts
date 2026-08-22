import type { PhoenixTool } from '@phoenix/contracts';
import { McpFederation, type McpCallPolicy, type McpCallResult, type McpServerSpec } from '@phoenix/mcp';
import type { ResourceGovernor, ResourceLease } from './resourceGovernor.js';

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
  readonly #resourceGovernor: ResourceGovernor | undefined;
  readonly #estimatedServerRamMb: number;
  readonly #operationWallMs: number;
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
    const lease = this.#acquire('mcp-discovery');
    try {
      return await this.#federation.toolDefinitions(query, limit);
    } finally {
      if (this.#hibernateAfterOperation) await this.hibernateAll();
      this.#release(lease);
    }
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
