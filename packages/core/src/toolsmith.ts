import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { PhoenixRequest, PhoenixResponse } from '@phoenix/contracts';
import {
  McpFederation,
  type McpCallPolicy,
  type McpRisk,
  type McpSearchHit,
  type McpServerSpec,
  type McpToolDescriptor,
} from '@phoenix/mcp';
import type { ToolRegistry } from './tools.js';

export interface CapabilityNeed {
  id: string;
  query: string;
  reason: string;
  required: boolean;
  acceptableRisks?: readonly McpRisk[];
  testInput?: Record<string, unknown>;
}

export type ForgeImplementationKind = 'http-json' | 'command-json';

export interface ToolBlueprint {
  id: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: McpRisk;
  implementation: {
    kind: ForgeImplementationKind;
    url?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headersEnv?: Readonly<Record<string, string>>;
    command?: string;
    args?: readonly string[];
  };
  probeInput?: Record<string, unknown>;
  rationale: string;
}

export interface ToolsmithFailure {
  attempt: number;
  stage: 'search' | 'blueprint' | 'forge' | 'discover' | 'probe';
  reason: string;
  blueprintId?: string;
}

export interface ToolAcquisition {
  status: 'reused' | 'forged';
  descriptor: McpToolDescriptor;
  server: McpServerSpec;
  attempts: number;
  failures: readonly ToolsmithFailure[];
}

export interface ToolsmithPlanner {
  identifyNeeds(mission: string): Promise<readonly CapabilityNeed[]>;
  proposeBlueprint(
    mission: string,
    need: CapabilityNeed,
    failures: readonly ToolsmithFailure[],
  ): Promise<ToolBlueprint>;
}

export interface ToolsmithGenerationRuntime {
  generate(request: PhoenixRequest, signal?: AbortSignal): Promise<PhoenixResponse>;
  ledger?: { append(type: string, payload: unknown): unknown };
}

function parseObject(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected JSON object');
  return parsed as Record<string, unknown>;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

function parseRisk(value: unknown): McpRisk {
  return value === 'write' || value === 'network' || value === 'exec' ? value : 'read';
}

export class PhoenixToolsmithPlanner implements ToolsmithPlanner {
  public constructor(private readonly runtime: ToolsmithGenerationRuntime) {}

  public async identifyNeeds(mission: string): Promise<readonly CapabilityNeed[]> {
    const response = await this.runtime.generate({
      messages: [
        {
          role: 'system',
          content: [
            'You are the capability planner inside PHOENIX.',
            'Return JSON only. Identify capabilities that require tools or MCP servers.',
            'Do not invent credentials. Prefer read-only capabilities where possible.',
            'Shape: {"needs":[{"id":"...","query":"...","reason":"...","required":true,"acceptableRisks":["read","network"],"testInput":{}}]}',
          ].join('\n'),
        },
        { role: 'user', content: mission },
      ],
      requirements: { json: true, reasoning: true },
      preferences: { preferLocal: true, preferFree: true, preferSubscription: true },
      metadata: { purpose: 'toolsmith-identify-needs', cacheable: 'true' },
    });
    const root = parseObject(response.content);
    const needs = Array.isArray(root.needs) ? root.needs : [];
    return needs.flatMap((raw, index): CapabilityNeed[] => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const item = raw as Record<string, unknown>;
      const query = typeof item.query === 'string' ? item.query.trim() : '';
      if (!query) return [];
      return [{
        id: typeof item.id === 'string' && item.id.trim() ? item.id : `need-${index + 1}`,
        query,
        reason: typeof item.reason === 'string' ? item.reason : query,
        required: item.required !== false,
        ...(stringArray(item.acceptableRisks) ? { acceptableRisks: stringArray(item.acceptableRisks)?.map(parseRisk) } : {}),
        ...(item.testInput && typeof item.testInput === 'object' && !Array.isArray(item.testInput)
          ? { testInput: item.testInput as Record<string, unknown> }
          : {}),
      }];
    });
  }

  public async proposeBlueprint(
    mission: string,
    need: CapabilityNeed,
    failures: readonly ToolsmithFailure[],
  ): Promise<ToolBlueprint> {
    const response = await this.runtime.generate({
      messages: [
        {
          role: 'system',
          content: [
            'You design constrained tools for PHOENIX.',
            'Return exactly one JSON object and no prose.',
            'You may choose only implementation.kind = http-json or command-json.',
            'http-json wraps one fixed HTTP endpoint. command-json wraps one fixed executable without a shell.',
            'Never embed secrets. HTTP secret headers may reference environment variable names through headersEnv.',
            'Never use shell metacharacters or compound commands.',
            'If prior attempts failed, choose a materially different route when possible.',
            'Shape:',
            '{"id":"...","toolName":"...","description":"...","inputSchema":{"type":"object"},"risk":"read|write|network|exec","implementation":{"kind":"http-json|command-json","url":"https://...","method":"GET|POST","headersEnv":{"Authorization":"TOKEN_ENV"},"command":"binary","args":[]},"probeInput":{},"rationale":"..."}',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({ mission, need, failures: failures.slice(-4) }),
        },
      ],
      requirements: { json: true, reasoning: true },
      preferences: { preferLocal: true, preferFree: true, preferSubscription: true },
      metadata: { purpose: 'toolsmith-blueprint' },
    });
    const root = parseObject(response.content);
    const implementationRaw = root.implementation;
    if (!implementationRaw || typeof implementationRaw !== 'object' || Array.isArray(implementationRaw)) {
      throw new Error('Toolsmith blueprint missing implementation');
    }
    const implementation = implementationRaw as Record<string, unknown>;
    const kind = implementation.kind === 'command-json' ? 'command-json' : 'http-json';
    const toolName = typeof root.toolName === 'string' ? root.toolName.replace(/[^a-zA-Z0-9_-]/g, '_') : '';
    if (!toolName) throw new Error('Toolsmith blueprint missing toolName');
    const inputSchema = root.inputSchema && typeof root.inputSchema === 'object' && !Array.isArray(root.inputSchema)
      ? root.inputSchema as Record<string, unknown>
      : { type: 'object', additionalProperties: true };
    const blueprint: ToolBlueprint = {
      id: typeof root.id === 'string' && root.id.trim() ? root.id : randomUUID(),
      toolName,
      description: typeof root.description === 'string' ? root.description : need.reason,
      inputSchema,
      risk: parseRisk(root.risk),
      implementation: {
        kind,
        ...(typeof implementation.url === 'string' ? { url: implementation.url } : {}),
        ...(implementation.method === 'GET' || implementation.method === 'POST' || implementation.method === 'PUT' || implementation.method === 'PATCH' || implementation.method === 'DELETE'
          ? { method: implementation.method }
          : {}),
        ...(implementation.headersEnv && typeof implementation.headersEnv === 'object' && !Array.isArray(implementation.headersEnv)
          ? { headersEnv: Object.fromEntries(Object.entries(implementation.headersEnv as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }
          : {}),
        ...(typeof implementation.command === 'string' ? { command: implementation.command } : {}),
        ...(stringArray(implementation.args) ? { args: stringArray(implementation.args) } : {}),
      },
      ...(root.probeInput && typeof root.probeInput === 'object' && !Array.isArray(root.probeInput)
        ? { probeInput: root.probeInput as Record<string, unknown> }
        : {}),
      rationale: typeof root.rationale === 'string' ? root.rationale : 'Generated for capability gap',
    };
    validateBlueprint(blueprint);
    return blueprint;
  }
}

function validateBlueprint(blueprint: ToolBlueprint): void {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(blueprint.toolName)) throw new Error('Invalid forged tool name');
  if (blueprint.implementation.kind === 'http-json') {
    if (!blueprint.implementation.url) throw new Error('http-json blueprint requires url');
    const url = new URL(blueprint.implementation.url);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      throw new Error('Forged HTTP tools require HTTPS except loopback development endpoints');
    }
  } else {
    const command = blueprint.implementation.command?.trim();
    if (!command) throw new Error('command-json blueprint requires command');
    if (/\s|[;&|`$<>]/.test(command)) throw new Error('Forged command must be a single executable path/name without shell syntax');
    for (const arg of blueprint.implementation.args ?? []) {
      if (/[;&|`<>]/.test(arg)) throw new Error('Forged command args may not contain shell control syntax');
    }
  }
}

export interface McpForgeOptions {
  rootDir?: string;
}

export interface ForgedArtifact {
  id: string;
  directory: string;
  serverPath: string;
  manifestPath: string;
  spec: McpServerSpec;
  blueprint: ToolBlueprint;
}

function generatedServerSource(blueprint: ToolBlueprint): string {
  const serialized = JSON.stringify(blueprint);
  return `#!/usr/bin/env node
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const blueprint = ${serialized};
const write = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
const ok = (id, result) => write({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

async function execute(input) {
  const impl = blueprint.implementation;
  if (impl.kind === 'http-json') {
    const headers = { 'content-type': 'application/json' };
    for (const [header, envName] of Object.entries(impl.headersEnv || {})) {
      const value = process.env[envName];
      if (!value) throw new Error('Missing environment variable ' + envName);
      headers[header] = value;
    }
    const method = impl.method || 'POST';
    const target = new URL(impl.url);
    const init = { method, headers };
    if (method === 'GET') {
      for (const [key, value] of Object.entries(input || {})) target.searchParams.set(key, String(value));
    } else {
      init.body = JSON.stringify(input || {});
    }
    const response = await fetch(target, init);
    const text = await response.text();
    if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + text.slice(0, 1000));
    try { return JSON.parse(text); } catch { return text; }
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(impl.command, impl.args || [], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error('Command exit ' + code + ': ' + stderr.slice(-1000)));
      const trimmed = stdout.trim();
      try { resolve(JSON.parse(trimmed)); } catch { resolve(trimmed); }
    });
    child.stdin.end(JSON.stringify(input || {}));
  });
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  let request;
  try { request = JSON.parse(line); } catch { continue; }
  const id = request.id;
  try {
    if (request.method === 'initialize') {
      ok(id, {
        protocolVersion: request.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'phoenix-forged-${blueprint.toolName}', version: '0.0.1' },
      });
    } else if (request.method === 'notifications/initialized') {
      // no response for notifications
    } else if (request.method === 'ping') {
      ok(id, {});
    } else if (request.method === 'tools/list') {
      ok(id, { tools: [{
        name: blueprint.toolName,
        description: blueprint.description,
        inputSchema: blueprint.inputSchema,
      }] });
    } else if (request.method === 'tools/call') {
      if (request.params?.name !== blueprint.toolName) return fail(id, -32601, 'Unknown tool');
      const value = await execute(request.params?.arguments || {});
      ok(id, { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError: false });
    } else {
      fail(id, -32601, 'Method not found');
    }
  } catch (error) {
    fail(id, -32000, error instanceof Error ? error.message : String(error));
  }
}
`;
}

export class McpForge {
  readonly #rootDir: string;

  public constructor(options: McpForgeOptions = {}) {
    this.#rootDir = resolve(options.rootDir ?? '.phoenix/forge');
  }

  public async materialize(blueprint: ToolBlueprint): Promise<ForgedArtifact> {
    validateBlueprint(blueprint);
    const id = `${Date.now()}-${blueprint.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const directory = join(this.#rootDir, id);
    await mkdir(directory, { recursive: true });
    const serverPath = join(directory, 'server.mjs');
    const manifestPath = join(directory, 'forge.json');
    await writeFile(serverPath, generatedServerSource(blueprint), 'utf8');
    await chmod(serverPath, 0o700).catch(() => undefined);
    const persisted = {
      version: 1,
      status: 'ephemeral',
      createdAt: new Date().toISOString(),
      blueprint,
      provenance: { source: 'phoenix-toolsmith', autoPromoted: false },
    };
    await writeFile(manifestPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
    return {
      id,
      directory,
      serverPath,
      manifestPath,
      blueprint,
      spec: {
        id: `forged-${blueprint.toolName}-${id}`,
        transport: 'stdio',
        source: 'generated',
        command: process.execPath,
        args: [serverPath],
        trusted: false,
        instructions: `${blueprint.description} Generated by PHOENIX Toolsmith; ephemeral until verified/promoted.`,
        tags: ['forged', blueprint.toolName, blueprint.risk],
      },
    };
  }

  public async promote(artifact: ForgedArtifact): Promise<void> {
    const raw = JSON.parse(await readFile(artifact.manifestPath, 'utf8')) as Record<string, unknown>;
    await writeFile(artifact.manifestPath, `${JSON.stringify({ ...raw, status: 'verified', verifiedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  }
}

export interface ToolsmithEngineOptions {
  federation: McpFederation;
  planner: ToolsmithPlanner;
  forge?: McpForge;
  maxForgeAttempts?: number;
  reuseScoreThreshold?: number;
  callPolicy?: McpCallPolicy;
  ledger?: { append(type: string, payload: unknown): unknown };
}

export class ToolsmithEngine {
  readonly #federation: McpFederation;
  readonly #planner: ToolsmithPlanner;
  readonly #forge: McpForge;
  readonly #maxForgeAttempts: number;
  readonly #reuseScoreThreshold: number;
  readonly #callPolicy: McpCallPolicy;
  readonly #ledger: ToolsmithEngineOptions['ledger'];

  public constructor(options: ToolsmithEngineOptions) {
    this.#federation = options.federation;
    this.#planner = options.planner;
    this.#forge = options.forge ?? new McpForge();
    this.#maxForgeAttempts = Math.max(1, options.maxForgeAttempts ?? 3);
    this.#reuseScoreThreshold = options.reuseScoreThreshold ?? 0.2;
    this.#callPolicy = options.callPolicy ?? { allowedRisks: ['read', 'network'] };
    this.#ledger = options.ledger;
  }

  public async analyzeMission(mission: string): Promise<readonly CapabilityNeed[]> {
    const needs = await this.#planner.identifyNeeds(mission);
    this.#ledger?.append('toolsmith.needs', { mission, needs });
    return needs;
  }

  public async acquire(mission: string, need: CapabilityNeed): Promise<ToolAcquisition> {
    const failures: ToolsmithFailure[] = [];
    const hits = await this.#federation.search(need.query, 8);
    const reusable = hits.find((hit) => this.#acceptable(hit, need));
    if (reusable && reusable.score >= this.#reuseScoreThreshold) {
      const server = this.#federation.server(reusable.tool.serverId);
      if (!server) throw new Error(`MCP server disappeared: ${reusable.tool.serverId}`);
      this.#ledger?.append('toolsmith.reused', { needId: need.id, serverId: server.id, tool: reusable.tool.name, score: reusable.score });
      return { status: 'reused', descriptor: reusable.tool, server, attempts: 0, failures };
    }
    failures.push({ attempt: 0, stage: 'search', reason: 'No acceptable existing MCP tool matched capability need' });

    for (let attempt = 1; attempt <= this.#maxForgeAttempts; attempt += 1) {
      let blueprint: ToolBlueprint;
      try {
        blueprint = await this.#planner.proposeBlueprint(mission, need, failures);
      } catch (error) {
        failures.push({ attempt, stage: 'blueprint', reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (need.acceptableRisks?.length && !need.acceptableRisks.includes(blueprint.risk)) {
        failures.push({ attempt, stage: 'blueprint', blueprintId: blueprint.id, reason: `Blueprint risk ${blueprint.risk} is outside acceptable risks` });
        continue;
      }

      let artifact: ForgedArtifact;
      try {
        artifact = await this.#forge.materialize(blueprint);
      } catch (error) {
        failures.push({ attempt, stage: 'forge', blueprintId: blueprint.id, reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
      this.#federation.upsert(artifact.spec);

      let descriptor: McpToolDescriptor | undefined;
      try {
        const report = await this.#federation.discover(artifact.spec.id, true);
        descriptor = report.tools.find((tool) => tool.name === blueprint.toolName);
        if (!descriptor) throw new Error('Forged MCP did not expose expected tool');
      } catch (error) {
        failures.push({ attempt, stage: 'discover', blueprintId: blueprint.id, reason: error instanceof Error ? error.message : String(error) });
        await this.#federation.disconnect(artifact.spec.id);
        continue;
      }

      const probe = blueprint.probeInput ?? need.testInput;
      if (probe) {
        try {
          const result = await this.#federation.call(artifact.spec.id, descriptor.name, probe, {
            ...this.#callPolicy,
            allowedRisks: [...new Set([...(this.#callPolicy.allowedRisks ?? []), descriptor.risk])],
          });
          if (result.isError) throw new Error('Forged MCP probe returned isError=true');
        } catch (error) {
          failures.push({ attempt, stage: 'probe', blueprintId: blueprint.id, reason: error instanceof Error ? error.message : String(error) });
          await this.#federation.disconnect(artifact.spec.id);
          continue;
        }
      }

      await this.#forge.promote(artifact);
      this.#ledger?.append('toolsmith.forged', {
        needId: need.id,
        attempt,
        serverId: artifact.spec.id,
        tool: descriptor.name,
        risk: descriptor.risk,
        failures,
      });
      return { status: 'forged', descriptor, server: artifact.spec, attempts: attempt, failures };
    }

    this.#ledger?.append('toolsmith.exhausted', { needId: need.id, failures });
    throw new Error(`Toolsmith exhausted ${this.#maxForgeAttempts} forge attempts for ${need.id}`);
  }

  public async bindToRegistry(registry: ToolRegistry, acquisition: ToolAcquisition): Promise<string> {
    const name = `mcp_${acquisition.descriptor.serverId.replace(/[^a-zA-Z0-9_]/g, '_')}__${acquisition.descriptor.name}`;
    registry.upsert({
      name,
      description: acquisition.descriptor.description,
      inputSchema: acquisition.descriptor.inputSchema,
      risk: acquisition.descriptor.risk,
      execute: async (input) => {
        const result = await this.#federation.call(
          acquisition.descriptor.serverId,
          acquisition.descriptor.name,
          input,
          this.#callPolicy,
        );
        if (result.isError) throw new Error(`MCP tool ${acquisition.descriptor.name} returned an error`);
        return result.content;
      },
    });
    return name;
  }

  #acceptable(hit: McpSearchHit, need: CapabilityNeed): boolean {
    if (need.acceptableRisks?.length && !need.acceptableRisks.includes(hit.tool.risk)) return false;
    return true;
  }
}
