import { randomUUID } from 'node:crypto';

export type ResourceKind = 'agent' | 'mcp' | 'process' | 'tool';

export interface ResourceBudget {
  maxConcurrentAgents: number;
  maxConcurrentMcpServers: number;
  maxConcurrentProcesses: number;
  maxEstimatedRamMb: number;
  maxCpuMsPerTask: number;
  maxWallMsPerTask: number;
  maxOutputBytes: number;
}

export interface ResourceRequest {
  kind: ResourceKind;
  resourceId: string;
  estimatedRamMb?: number;
  cpuMs?: number;
  wallMs?: number;
  outputBytes?: number;
  leaseMs?: number;
}

export interface ResourceLease {
  id: string;
  kind: ResourceKind;
  resourceId: string;
  issuedAt: number;
  expiresAt: number;
  estimatedRamMb: number;
  cpuMs: number;
  wallMs: number;
  outputBytes: number;
}

export interface ResourceSnapshot {
  activeLeases: number;
  concurrentAgents: number;
  concurrentMcpServers: number;
  concurrentProcesses: number;
  concurrentTools: number;
  estimatedRamMb: number;
  budget: ResourceBudget;
  leases: readonly ResourceLease[];
}

const DEFAULT_BUDGET: ResourceBudget = {
  maxConcurrentAgents: 6,
  maxConcurrentMcpServers: 4,
  maxConcurrentProcesses: 8,
  maxEstimatedRamMb: 4_096,
  maxCpuMsPerTask: 120_000,
  maxWallMsPerTask: 600_000,
  maxOutputBytes: 2_000_000,
};

function nonNegative(value: number | undefined): number {
  return Math.max(0, Math.floor(value ?? 0));
}

export class ResourceBudgetError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ResourceBudgetError';
  }
}

export class ResourceGovernor {
  readonly #budget: ResourceBudget;
  readonly #leases = new Map<string, ResourceLease>();

  public constructor(budget: Partial<ResourceBudget> = {}) {
    this.#budget = {
      maxConcurrentAgents: Math.max(1, Math.floor(budget.maxConcurrentAgents ?? DEFAULT_BUDGET.maxConcurrentAgents)),
      maxConcurrentMcpServers: Math.max(1, Math.floor(budget.maxConcurrentMcpServers ?? DEFAULT_BUDGET.maxConcurrentMcpServers)),
      maxConcurrentProcesses: Math.max(1, Math.floor(budget.maxConcurrentProcesses ?? DEFAULT_BUDGET.maxConcurrentProcesses)),
      maxEstimatedRamMb: Math.max(128, Math.floor(budget.maxEstimatedRamMb ?? DEFAULT_BUDGET.maxEstimatedRamMb)),
      maxCpuMsPerTask: Math.max(1, Math.floor(budget.maxCpuMsPerTask ?? DEFAULT_BUDGET.maxCpuMsPerTask)),
      maxWallMsPerTask: Math.max(1, Math.floor(budget.maxWallMsPerTask ?? DEFAULT_BUDGET.maxWallMsPerTask)),
      maxOutputBytes: Math.max(1, Math.floor(budget.maxOutputBytes ?? DEFAULT_BUDGET.maxOutputBytes)),
    };
  }

  public budget(): ResourceBudget { return { ...this.#budget }; }

  public acquire(request: ResourceRequest, now = Date.now()): ResourceLease {
    this.#prune(now);
    if (!request.resourceId.trim()) throw new ResourceBudgetError('resourceId is required');
    const estimatedRamMb = nonNegative(request.estimatedRamMb);
    const cpuMs = nonNegative(request.cpuMs);
    const wallMs = nonNegative(request.wallMs);
    const outputBytes = nonNegative(request.outputBytes);
    if (cpuMs > this.#budget.maxCpuMsPerTask) throw new ResourceBudgetError('CPU budget exceeded');
    if (wallMs > this.#budget.maxWallMsPerTask) throw new ResourceBudgetError('Wall-time budget exceeded');
    if (outputBytes > this.#budget.maxOutputBytes) throw new ResourceBudgetError('Output budget exceeded');

    const current = this.snapshot(now);
    const kindCount = request.kind === 'agent' ? current.concurrentAgents
      : request.kind === 'mcp' ? current.concurrentMcpServers
        : request.kind === 'process' ? current.concurrentProcesses
          : current.concurrentTools;
    const kindLimit = request.kind === 'agent' ? this.#budget.maxConcurrentAgents
      : request.kind === 'mcp' ? this.#budget.maxConcurrentMcpServers
        : request.kind === 'process' ? this.#budget.maxConcurrentProcesses
          : Number.POSITIVE_INFINITY;
    if (kindCount + 1 > kindLimit) throw new ResourceBudgetError(`Concurrent ${request.kind} budget exceeded`);
    if (current.estimatedRamMb + estimatedRamMb > this.#budget.maxEstimatedRamMb) {
      throw new ResourceBudgetError('Estimated RAM budget exceeded');
    }

    const leaseMs = Math.max(1_000, Math.min(request.leaseMs ?? Math.max(wallMs, 60_000), this.#budget.maxWallMsPerTask));
    const lease: ResourceLease = {
      id: randomUUID(),
      kind: request.kind,
      resourceId: request.resourceId,
      issuedAt: now,
      expiresAt: now + leaseMs,
      estimatedRamMb,
      cpuMs,
      wallMs,
      outputBytes,
    };
    this.#leases.set(lease.id, lease);
    return { ...lease };
  }

  public release(leaseOrId: ResourceLease | string): boolean {
    const id = typeof leaseOrId === 'string' ? leaseOrId : leaseOrId.id;
    return this.#leases.delete(id);
  }

  public assertOutputBytes(bytes: number): void {
    if (nonNegative(bytes) > this.#budget.maxOutputBytes) throw new ResourceBudgetError('Output budget exceeded');
  }

  public snapshot(now = Date.now()): ResourceSnapshot {
    this.#prune(now);
    const leases = [...this.#leases.values()].map((lease) => ({ ...lease }));
    return {
      activeLeases: leases.length,
      concurrentAgents: leases.filter((lease) => lease.kind === 'agent').length,
      concurrentMcpServers: leases.filter((lease) => lease.kind === 'mcp').length,
      concurrentProcesses: leases.filter((lease) => lease.kind === 'process').length,
      concurrentTools: leases.filter((lease) => lease.kind === 'tool').length,
      estimatedRamMb: leases.reduce((sum, lease) => sum + lease.estimatedRamMb, 0),
      budget: { ...this.#budget },
      leases,
    };
  }

  #prune(now: number): void {
    for (const [id, lease] of this.#leases) if (lease.expiresAt <= now) this.#leases.delete(id);
  }
}
