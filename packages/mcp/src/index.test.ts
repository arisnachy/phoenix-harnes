import { randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  McpFederation,
  claudeCodeAsMcpServer,
  codexAsMcpServer,
  importClaudeMcpJson,
  importCodexMcpToml,
} from './index.js';

async function fakeMcpServer(): Promise<string> {
  const directory = join(tmpdir(), `phoenix-mcp-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'server.mjs');
  await writeFile(path, `#!/usr/bin/env node
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (x) => process.stdout.write(JSON.stringify(x) + '\\n');
for await (const line of rl) {
  const req = JSON.parse(line);
  if (req.method === 'notifications/initialized') continue;
  if (req.method === 'initialize') send({jsonrpc:'2.0',id:req.id,result:{protocolVersion:req.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}}});
  else if (req.method === 'tools/list') send({jsonrpc:'2.0',id:req.id,result:{tools:[{name:'search_docs',description:'Search documentation read only',inputSchema:{type:'object',properties:{q:{type:'string'}}}}]}});
  else if (req.method === 'tools/call') send({jsonrpc:'2.0',id:req.id,result:{content:[{type:'text',text:'found:' + req.params.arguments.q}],isError:false}});
  else if (req.method === 'ping') send({jsonrpc:'2.0',id:req.id,result:{}});
}
`, 'utf8');
  await chmod(path, 0o700).catch(() => undefined);
  return path;
}

describe('PHOENIX MCP federation', () => {
  it('imports Claude project MCP JSON and Codex TOML without special-casing vendors in core', () => {
    const claude = importClaudeMcpJson(JSON.stringify({
      mcpServers: {
        docs: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'secret' } },
        local: { command: 'node', args: ['server.mjs'], env: { TOKEN: 'value' } },
      },
    }));
    expect(claude.map((item) => item.id)).toEqual(['docs', 'local']);
    expect(claude[0]?.transport).toBe('http');
    expect(claude[1]?.transport).toBe('stdio');

    const codex = importCodexMcpToml(`
[mcp_servers.docs]
command = "npx"
args = ["-y", "docs-mcp"]
env = { "DOCS_TOKEN" = "value" }

[mcp_servers.remote]
url = "https://example.test/mcp"
enabled = true
`);
    expect(codex.map((item) => item.id)).toEqual(['docs', 'remote']);
    expect(codex[0]?.command).toBe('npx');
    expect(codex[1]?.transport).toBe('http');
  });

  it('registers official Codex and Claude Code MCP server launchers', () => {
    expect(codexAsMcpServer().args).toEqual(['mcp-server']);
    expect(claudeCodeAsMcpServer().args).toEqual(['mcp', 'serve']);
  });

  it('discovers tools lazily, searches schemas on demand and reconnects through stdio', async () => {
    const path = await fakeMcpServer();
    const federation = new McpFederation({ discoverOnSearch: true });
    federation.register({
      id: 'fake',
      source: 'manual',
      transport: 'stdio',
      command: process.execPath,
      args: [path],
      trusted: true,
    });

    expect(federation.cachedTools()).toHaveLength(0);
    const hits = await federation.search('search documentation', 3);
    expect(hits[0]?.tool.name).toBe('search_docs');
    expect(federation.cachedTools()).toHaveLength(1);

    const result = await federation.call('fake', 'search_docs', { q: 'phoenix' }, {
      allowedRisks: ['read'],
      requireTrustedServer: true,
    });
    expect(JSON.stringify(result.content)).toContain('found:phoenix');
    await federation.close();
  });
});
