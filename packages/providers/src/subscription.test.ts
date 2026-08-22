import { randomUUID } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeCliAdapter,
  CodexCliAdapter,
  claudeCodeSubscriptionProvider,
  codexSubscriptionProvider,
} from './subscription.js';

async function executable(name: string, source: string): Promise<string> {
  const path = join(tmpdir(), `${name}-${randomUUID()}.mjs`);
  await writeFile(path, `#!/usr/bin/env node\n${source}\n`, 'utf8');
  await chmod(path, 0o755);
  return path;
}

describe('subscription CLI bridges', () => {
  it('parses Codex JSONL, preserves the session id and forces read-only sandboxing', async () => {
    const binary = await executable('fake-codex', `
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  console.log(JSON.stringify({type:'thread.started', thread_id:'thread-test'}));
  console.log(JSON.stringify({type:'item.completed', item:{id:'a', type:'agent_message', text:'codex ok args=' + process.argv.slice(2).join(' ') + ' input=' + input.slice(0, 20)}}));
  console.log(JSON.stringify({type:'turn.completed', usage:{input_tokens:120,cached_input_tokens:80,cache_write_input_tokens:0,output_tokens:20,reasoning_output_tokens:5}}));
});`);
    const definition = codexSubscriptionProvider();
    const model = definition.models[0];
    if (!model) throw new Error('missing test model');
    const adapter = new CodexCliAdapter(binary);
    const response = await adapter.generate(definition, model, {
      messages: [{ role: 'user', content: 'inspect this safely' }],
    });
    expect(response.content).toContain('--sandbox read-only');
    expect(response.providerSessionId).toBe('thread-test');
    expect(response.usage?.inputTokens).toBe(120);
    expect(response.usage?.cachedInputTokens).toBe(80);

    const resumed = await adapter.generate(definition, model, {
      messages: [{ role: 'user', content: 'continue' }],
      metadata: { providerSessionId: 'thread-test' },
    });
    expect(resumed.content).toContain('resume thread-test -');
  });

  it('parses Claude Code JSON and forces plan permission mode', async () => {
    const binary = await executable('fake-claude', `
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  console.log(JSON.stringify({
    type:'result', subtype:'success', is_error:false,
    result:'claude ok args=' + process.argv.slice(2).join(' ') + ' input=' + input.slice(0, 20),
    session_id:'claude-session', total_cost_usd:0.01, duration_ms:50, num_turns:1,
    usage:{input_tokens:90,cache_read_input_tokens:40,cache_creation_input_tokens:0,output_tokens:15}
  }));
});`);
    const definition = claudeCodeSubscriptionProvider();
    const model = definition.models[0];
    if (!model) throw new Error('missing test model');
    const adapter = new ClaudeCodeCliAdapter(binary);
    const response = await adapter.generate(definition, model, {
      messages: [{ role: 'user', content: 'reason about this' }],
    });
    expect(response.content).toContain('--permission-mode plan');
    expect(response.providerSessionId).toBe('claude-session');
    expect(response.usage?.cachedInputTokens).toBe(40);
    expect(response.usage?.estimatedCostUsd).toBe(0.01);
  });
});
