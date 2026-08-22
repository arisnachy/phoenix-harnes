import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { PhoenixTool } from '@phoenix/contracts';

export type McpTransportKind = 'stdio' | 'http' | 'sse' | 'ws';
export type McpSource = 'phoenix' | 'codex' | 'claude-code' | 'project' | 'generated' | 'manual';
export type McpRisk = 'read' | 'write' | 'network' | 'exec';

export interface McpServerSpec {
  id: string;
  transport: McpTransportKind;
  source: McpSource;
  scope?: 'local' | 'project' | 'user' | 'managed';
  command?: string;
  args?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  url?: string;
  headers?: Readonly<Record<string, string>>;
  enabled?: boolean;
  trusted?: boolean;
  instructions?: string;
  tags?: readonly string[];
}

export interface McpToolDescriptor {
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  fingerprint: string;
  risk: McpRisk;
  source: McpSource;
  tags: readonly string[];
}

export interface McpSearchHit {
  tool: McpToolDescriptor;
  score: number;
  reasons: readonly string[];
}

export interface McpCallPolicy {
  allowedRisks?: readonly McpRisk[];
  trustedServers?: readonly string[];
  requireTrustedServer?: boolean;
}

export interface McpCallResult {
  serverId: string;
  toolName: string;
  content: unknown;
  isError: boolean;
  truncated?: boolean;
}

export interface McpDiscoveryReport {
  serverId: string;
  toolCount: number;
  discoveredAt: string;
  tools: readonly McpToolDescriptor[];
}

export interface McpFederationOptions {
  discoveryTtlMs?: number;
  discoverOnSearch?: boolean;
  maxServersPerSearch?: number;
  maxToolResultChars?: number;
}

interface ConnectionState {
  client: Client;
  close(): Promise<void>;
}

interface CachedDiscovery {
  expiresAt: number;
  report: McpDiscoveryReport;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9_.:/-]+/i).filter((item) => item.length >= 2));
}

function overlap(query: Set<string>, value: string): number {
  if (!query.size) return 0;
  const candidate = words(value);
  let matches = 0;
  for (const item of query) if (candidate.has(item)) matches += 1;
  return matches / query.size;
}

function inferRisk(name: string, description: string): McpRisk {
  const text = `${name} ${description}`.toLowerCase();
  if (/shell|terminal|command|exec|process/.test(text)) return 'exec';
  if (/delete|remove|deploy|publish|send|write|update|create|merge|commit|push|payment/.test(text)) return 'write';
  if (/http|fetch|web|browser|network|download|upload|api/.test(text)) return 'network';
  return 'read';
}

function normalizeSchema(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return { type: 'object', additionalProperties: true };
}

function trimRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') result[key] = raw;
  }
  return Object.keys(result).length ? result : undefined;
}

function makeClient(id: string): Client {
  return new Client({ name: `phoenix-${id}`, version: '0.0.1' });
}

async function connect(spec: McpServerSpec): Promise<ConnectionState> {
  if (spec.enabled === false) throw new Error(`MCP server ${spec.id} is disabled`);
  const client = makeClient(spec.id);

  if (spec.transport === 'stdio') {
    if (!spec.command) throw new Error(`MCP stdio server ${spec.id} requires command`);
    const transport = new StdioClientTransport({
      command: spec.command,
      ...(spec.args ? { args: [...spec.args] } : {}),
      ...(spec.cwd ? { cwd: spec.cwd } : {}),
      ...(spec.env ? { env: { ...process.env, ...spec.env } as Record<string, string> } : {}),
    });
    await client.connect(transport);
    return { client, close: async () => { await transport.close(); } };
  }

  if (spec.transport === 'http') {
    if (!spec.url) throw new Error(`MCP HTTP server ${spec.id} requires url`);
    const transport = new StreamableHTTPClientTransport(new URL(spec.url), {
      ...(spec.headers ? { requestInit: { headers: { ...spec.headers } } } : {}),
    });
    // The SDK currently exposes sessionId as optional in one transport and exact-optional
    // in the base Transport interface. Runtime behavior is compatible; keep our project strict.
    await client.connect(transport as unknown as Parameters<Client['connect']>[0]);
    return { client, close: async () => { await transport.close(); } };
  }

  throw new Error(`MCP transport ${spec.transport} is catalogued but not executable by PHOENIX v3 yet`);
}

function boundContent(content: unknown, maxChars: number): { content: unknown; truncated: boolean } {
  let serialized: string;
  try { serialized = JSON.stringify(content); } catch { serialized = String(content); }
  if (serialized.length <= maxChars) return { content, truncated: false };
  return {
    content: [{ type: 'text', text: `${serialized.slice(0, Math.max(0, maxChars - 40))}\n…[PHOENIX MCP output truncated]` }],
    truncated: true,
  };
}

export class McpFederation {
  readonly #servers = new Map<string, McpServerSpec>();
  readonly #connections = new Map<string, ConnectionState>();
  readonly #discoveries = new Map<string, CachedDiscovery>();
  readonly #options: Required<McpFederationOptions>;

  public constructor(options: McpFederationOptions = {}) {
    this.#options = {
      discoveryTtlMs: options.discoveryTtlMs ?? 5 * 60_000,
      discoverOnSearch: options.discoverOnSearch ?? true,
      maxServersPerSearch: options.maxServersPerSearch ?? 12,
      maxToolResultChars: options.maxToolResultChars ?? 40_000,
    };
  }

  public register(spec: McpServerSpec): void {
    if (!spec.id.trim()) throw new Error('MCP server id is required');
    if (this.#servers.has(spec.id)) throw new Error(`MCP server already registered: ${spec.id}`);
    this.#servers.set(spec.id, { ...spec });
  }

  public upsert(spec: McpServerSpec): void {
    this.#servers.set(spec.id, { ...spec });
    this.#discoveries.delete(spec.id);
  }

  public registerMany(specs: readonly McpServerSpec[]): void {
    for (const spec of specs) this.upsert(spec);
  }

  public servers(): readonly McpServerSpec[] {
    return [...this.#servers.values()].map((item) => ({ ...item }));
  }

  public server(id: string): McpServerSpec | undefined {
    const item = this.#servers.get(id);
    return item ? { ...item } : undefined;
  }

  public cachedTools(): readonly McpToolDescriptor[] {
    return [...this.#discoveries.values()].flatMap((item) => item.report.tools);
  }

  public async discover(serverId: string, force = false): Promise<McpDiscoveryReport> {
    const spec = this.#servers.get(serverId);
    if (!spec) throw new Error(`Unknown MCP server: ${serverId}`);
    const cached = this.#discoveries.get(serverId);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.report;

    const connection = await this.#connection(serverId);
    const response = await connection.client.listTools();
    const tools: McpToolDescriptor[] = response.tools.map((tool) => {
      const description = typeof tool.description === 'string' ? tool.description : '';
      const inputSchema = normalizeSchema(tool.inputSchema);
      const tags = [...(spec.tags ?? []), ...words(`${tool.name} ${description}`)].slice(0, 30);
      return {
        serverId,
        name: tool.name,
        description,
        inputSchema,
        fingerprint: fingerprint({ serverId, name: tool.name, description, inputSchema }),
        risk: inferRisk(tool.name, description),
        source: spec.source,
        tags,
      };
    });
    const report: McpDiscoveryReport = {
      serverId,
      toolCount: tools.length,
      discoveredAt: new Date().toISOString(),
      tools,
    };
    this.#discoveries.set(serverId, { expiresAt: Date.now() + this.#options.discoveryTtlMs, report });
    return report;
  }

  public async refreshAll(): Promise<readonly McpDiscoveryReport[]> {
    const reports: McpDiscoveryReport[] = [];
    for (const server of this.#servers.values()) {
      if (server.enabled === false) continue;
      try { reports.push(await this.discover(server.id, true)); } catch { /* one offline server must not poison federation */ }
    }
    return reports;
  }

  public async search(query: string, limit = 12): Promise<readonly McpSearchHit[]> {
    if (this.#options.discoverOnSearch) {
      const undiscovered = [...this.#servers.values()]
        .filter((server) => server.enabled !== false && !this.#discoveries.has(server.id))
        .slice(0, this.#options.maxServersPerSearch);
      await Promise.all(undiscovered.map(async (server) => {
        try { await this.discover(server.id); } catch { /* lazy search tolerates unavailable servers */ }
      }));
    }

    const queryWords = words(query);
    const hits: McpSearchHit[] = [];
    for (const tool of this.cachedTools()) {
      const relevance = overlap(queryWords, `${tool.name} ${tool.description} ${tool.tags.join(' ')}`);
      const exact = queryWords.has(tool.name.toLowerCase()) ? 1 : 0;
      const sourceBoost = tool.source === 'generated' ? 0.04 : 0;
      const score = relevance + exact + sourceBoost;
      if (score <= 0 && queryWords.size) continue;
      hits.push({
        tool,
        score,
        reasons: [
          `relevance:${relevance.toFixed(3)}`,
          ...(exact ? ['exact_name:+1'] : []),
          ...(sourceBoost ? ['generated_local:+0.04'] : []),
        ],
      });
    }
    return hits.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name)).slice(0, Math.max(1, limit));
  }

  public async toolDefinitions(query: string, limit = 8): Promise<readonly PhoenixTool[]> {
    const hits = await this.search(query, limit);
    return hits.map(({ tool }) => ({
      name: `${tool.serverId}__${tool.name}`,
      description: `[MCP:${tool.serverId}] ${tool.description}`.slice(0, 2_000),
      inputSchema: tool.inputSchema,
    }));
  }

  public async call(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    policy: McpCallPolicy = {},
  ): Promise<McpCallResult> {
    const spec = this.#servers.get(serverId);
    if (!spec) throw new Error(`Unknown MCP server: ${serverId}`);
    if (policy.requireTrustedServer && spec.trusted !== true && !policy.trustedServers?.includes(serverId)) {
      throw new Error(`MCP server ${serverId} is not trusted for execution`);
    }
    const report = await this.discover(serverId);
    const descriptor = report.tools.find((tool) => tool.name === toolName);
    if (!descriptor) throw new Error(`MCP tool ${serverId}/${toolName} not found`);
    const allowed = new Set(policy.allowedRisks ?? ['read']);
    if (!allowed.has(descriptor.risk)) throw new Error(`MCP tool ${serverId}/${toolName} risk=${descriptor.risk} is not allowed by policy`);

    const run = async (): Promise<McpCallResult> => {
      const connection = await this.#connection(serverId);
      const result = await connection.client.callTool({ name: toolName, arguments: args });
      const bounded = boundContent(result.content, this.#options.maxToolResultChars);
      return {
        serverId,
        toolName,
        content: bounded.content,
        isError: result.isError === true,
        ...(bounded.truncated ? { truncated: true } : {}),
      };
    };

    try {
      return await run();
    } catch (error) {
      await this.disconnect(serverId);
      try { return await run(); } catch { throw error; }
    }
  }

  public async disconnect(serverId: string): Promise<void> {
    const connection = this.#connections.get(serverId);
    if (!connection) return;
    this.#connections.delete(serverId);
    await connection.close().catch(() => undefined);
  }

  public async close(): Promise<void> {
    await Promise.all([...this.#connections.keys()].map((id) => this.disconnect(id)));
  }

  async #connection(serverId: string): Promise<ConnectionState> {
    const current = this.#connections.get(serverId);
    if (current) return current;
    const spec = this.#servers.get(serverId);
    if (!spec) throw new Error(`Unknown MCP server: ${serverId}`);
    const next = await connect(spec);
    this.#connections.set(serverId, next);
    return next;
  }
}

export function codexAsMcpServer(): McpServerSpec {
  return {
    id: 'codex-agent', transport: 'stdio', source: 'codex', command: 'codex', args: ['mcp-server'], trusted: false,
    instructions: 'Use Codex as a callable coding/reasoning engine through its official MCP server.',
    tags: ['coding', 'review', 'repository', 'agent'],
  };
}

export function claudeCodeAsMcpServer(): McpServerSpec {
  return {
    id: 'claude-code-agent', transport: 'stdio', source: 'claude-code', command: 'claude', args: ['mcp', 'serve'], trusted: false,
    instructions: 'Use Claude Code tools through its official stdio MCP server.',
    tags: ['coding', 'repository', 'agent', 'analysis'],
  };
}

interface ClaudeMcpEntry {
  type?: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
  headers?: unknown;
  disabled?: unknown;
}

export function importClaudeMcpJson(text: string, source: McpSource = 'claude-code'): McpServerSpec[] {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const root = parsed as Record<string, unknown>;
  const rawServers = root.mcpServers && typeof root.mcpServers === 'object' && !Array.isArray(root.mcpServers)
    ? root.mcpServers as Record<string, unknown>
    : root;
  const specs: McpServerSpec[] = [];
  for (const [id, raw] of Object.entries(rawServers)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as ClaudeMcpEntry;
    const command = typeof entry.command === 'string' ? entry.command : undefined;
    const url = typeof entry.url === 'string' ? entry.url : undefined;
    const declaredType = typeof entry.type === 'string' ? entry.type : undefined;
    const env = trimRecord(entry.env);
    const headers = trimRecord(entry.headers);
    const transport: McpTransportKind = declaredType === 'streamable-http' ? 'http'
      : declaredType === 'http' || declaredType === 'sse' || declaredType === 'ws' || declaredType === 'stdio'
        ? declaredType
        : url ? 'http' : 'stdio';
    if (!command && !url) continue;
    specs.push({
      id,
      transport,
      source,
      ...(command ? { command } : {}),
      ...(Array.isArray(entry.args) ? { args: entry.args.filter((item): item is string => typeof item === 'string') } : {}),
      ...(env ? { env } : {}),
      ...(url ? { url } : {}),
      ...(headers ? { headers } : {}),
      enabled: entry.disabled !== true,
      trusted: false,
    });
  }
  return specs;
}

function parseTomlString(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return undefined;
  try { return JSON.parse(trimmed) as string; } catch { return trimmed.slice(1, -1); }
}

function parseTomlArray(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : undefined;
  } catch { return undefined; }
}

function parseInlineTomlMap(value: string): Record<string, string> | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  const result: Record<string, string> = {};
  for (const pair of trimmed.slice(1, -1).split(',')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const key = pair.slice(0, index).trim().replace(/^"|"$/g, '');
    const parsedValue = parseTomlString(pair.slice(index + 1));
    if (key && parsedValue !== undefined) result[key] = parsedValue;
  }
  return Object.keys(result).length ? result : undefined;
}

export function importCodexMcpToml(text: string): McpServerSpec[] {
  const servers = new Map<string, Record<string, string>>();
  let current: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) continue;
    const section = line.match(/^\[mcp_servers\.([^\]]+)\]$/);
    if (section?.[1]) {
      current = section[1].replace(/^"|"$/g, '');
      if (!servers.has(current)) servers.set(current, {});
      continue;
    }
    if (!current) continue;
    const index = line.indexOf('=');
    if (index < 0) continue;
    const target = servers.get(current);
    if (!target) continue;
    target[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }

  const specs: McpServerSpec[] = [];
  for (const [id, values] of servers) {
    const command = values.command ? parseTomlString(values.command) : undefined;
    const url = values.url ? parseTomlString(values.url) : undefined;
    const args = values.args ? parseTomlArray(values.args) : undefined;
    const env = values.env ? parseInlineTomlMap(values.env) : undefined;
    const enabled = values.enabled?.trim() !== 'false';
    if (!command && !url) continue;
    specs.push({
      id,
      transport: url ? 'http' : 'stdio',
      source: 'codex',
      ...(command ? { command } : {}),
      ...(args ? { args } : {}),
      ...(env ? { env } : {}),
      ...(url ? { url } : {}),
      enabled,
      trusted: false,
    });
  }
  return specs;
}

export function redactMcpSpecForPersistence(spec: McpServerSpec): McpServerSpec {
  return {
    ...spec,
    ...(spec.env ? { env: Object.fromEntries(Object.keys(spec.env).map((key) => [key, `<ENV:${key}>`])) } : {}),
    ...(spec.headers ? { headers: Object.fromEntries(Object.keys(spec.headers).map((key) => [key, '<REDACTED>'])) } : {}),
  };
}
