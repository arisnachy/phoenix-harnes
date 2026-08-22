import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  McpFederation,
  claudeCodeAsMcpServer,
  codexAsMcpServer,
  importClaudeMcpJson,
  importCodexMcpToml,
  type McpServerSpec,
} from '@phoenix/mcp';

export interface McpBootstrapOptions {
  projectDir?: string;
  homeDir?: string;
  includeCodexConfig?: boolean;
  includeClaudeProjectConfig?: boolean;
  includeClaudeUserConfig?: boolean;
  includeAgentServers?: boolean;
}

export interface McpBootstrapReport {
  loaded: readonly { source: string; count: number }[];
  skipped: readonly { source: string; reason: string }[];
  servers: readonly McpServerSpec[];
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;
    throw error;
  }
}

function nestedClaudeServers(text: string): McpServerSpec[] {
  const direct = importClaudeMcpJson(text, 'claude-code');
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; } catch { return direct; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return direct;
  const root = parsed as Record<string, unknown>;
  const projects = root.projects;
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return direct;
  const extra: McpServerSpec[] = [];
  for (const [projectPath, value] of Object.entries(projects as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const servers = entry.mcpServers;
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) continue;
    const imported = importClaudeMcpJson(JSON.stringify({ mcpServers: servers }), 'claude-code');
    for (const spec of imported) {
      extra.push({ ...spec, id: `claude-${projectPath.replace(/[^a-zA-Z0-9_-]/g, '_')}-${spec.id}`, scope: 'local' });
    }
  }
  return [...direct, ...extra];
}

export async function bootstrapMcpFederation(
  federation: McpFederation,
  options: McpBootstrapOptions = {},
): Promise<McpBootstrapReport> {
  const projectDir = resolve(options.projectDir ?? process.cwd());
  const homeDir = resolve(options.homeDir ?? homedir());
  const loaded: Array<{ source: string; count: number }> = [];
  const skipped: Array<{ source: string; reason: string }> = [];
  const specs: McpServerSpec[] = [];

  if (options.includeAgentServers !== false) {
    specs.push(codexAsMcpServer(), claudeCodeAsMcpServer());
    loaded.push({ source: 'agent-servers', count: 2 });
  }

  if (options.includeCodexConfig !== false) {
    const path = join(homeDir, '.codex', 'config.toml');
    const text = await readOptional(path);
    if (text) {
      const imported = importCodexMcpToml(text).map((spec) => ({ ...spec, scope: 'user' as const }));
      specs.push(...imported);
      loaded.push({ source: path, count: imported.length });
    } else {
      skipped.push({ source: path, reason: 'not_found' });
    }
  }

  if (options.includeClaudeProjectConfig !== false) {
    const path = join(projectDir, '.mcp.json');
    const text = await readOptional(path);
    if (text) {
      const imported = importClaudeMcpJson(text, 'project').map((spec) => ({ ...spec, scope: 'project' as const }));
      specs.push(...imported);
      loaded.push({ source: path, count: imported.length });
    } else {
      skipped.push({ source: path, reason: 'not_found' });
    }
  }

  if (options.includeClaudeUserConfig !== false) {
    const path = join(homeDir, '.claude.json');
    const text = await readOptional(path);
    if (text) {
      const imported = nestedClaudeServers(text).map((spec) => ({ ...spec, scope: spec.scope ?? 'user' as const }));
      specs.push(...imported);
      loaded.push({ source: path, count: imported.length });
    } else {
      skipped.push({ source: path, reason: 'not_found' });
    }
  }

  const unique = new Map<string, McpServerSpec>();
  for (const spec of specs) {
    const existing = unique.get(spec.id);
    if (!existing || existing.source === 'codex' || existing.source === 'claude-code') unique.set(spec.id, spec);
  }
  federation.registerMany([...unique.values()]);
  return { loaded, skipped, servers: federation.servers() };
}
