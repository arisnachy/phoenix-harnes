import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { McpFederation } from '@phoenix/mcp';
import { bootstrapMcpFederation } from './mcpBootstrap.js';

describe('PHOENIX MCP bootstrap', () => {
  it('loads Codex user config plus Claude project/user MCP definitions without executing them', async () => {
    const root = join(tmpdir(), `phoenix-mcp-bootstrap-${randomUUID()}`);
    const home = join(root, 'home');
    const project = join(root, 'project');
    await mkdir(join(home, '.codex'), { recursive: true });
    await mkdir(project, { recursive: true });

    await writeFile(join(home, '.codex', 'config.toml'), `
[mcp_servers.codex_docs]
command = "node"
args = ["codex-docs.mjs"]
`, 'utf8');
    await writeFile(join(project, '.mcp.json'), JSON.stringify({
      mcpServers: {
        project_docs: { command: 'node', args: ['project-docs.mjs'] },
      },
    }), 'utf8');
    await writeFile(join(home, '.claude.json'), JSON.stringify({
      mcpServers: {
        user_docs: { type: 'http', url: 'https://example.test/mcp' },
      },
    }), 'utf8');

    const federation = new McpFederation({ discoverOnSearch: false });
    const report = await bootstrapMcpFederation(federation, {
      homeDir: home,
      projectDir: project,
      includeAgentServers: false,
    });

    expect(report.servers.map((item) => item.id).sort()).toEqual([
      'codex_docs',
      'project_docs',
      'user_docs',
    ]);
    expect(report.servers.every((item) => item.trusted === false)).toBe(true);
    expect(report.loaded.reduce((sum, item) => sum + item.count, 0)).toBe(3);
    await federation.close();
  });
});
