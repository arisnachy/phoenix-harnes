import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PhoenixRequest, PhoenixResponse } from '@phoenix/contracts';
import { AgentRoiGate } from './agentEconomy.js';
import { TokenFlightRecorder } from './flightRecorder.js';
import { HibernatingMcpBroker } from './mcpHibernate.js';
import { MemoryGenome } from './memoryGenome.js';
import { ResilientGenerationRuntime, classifyFailure } from './resilience.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fakeMcpServer(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-hibernate-mcp-'));
  roots.push(directory);
  const path = join(directory, 'server.mjs');
  await mkdir(directory, { recursive: true });
  await writeFile(path, `#!/usr/bin/env node
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (x) => process.stdout.write(JSON.stringify(x) + '\\n');
for await (const line of rl) {
  const req = JSON.parse(line);
  if (req.method === 'notifications/initialized') continue;
  if (req.method === 'initialize') send({jsonrpc:'2.0',id:req.id,result:{protocolVersion:req.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}}});
  else if (req.method === 'tools/list') send({jsonrpc:'2.0',id:req.id,result:{tools:[{name:'read_value',description:'Read a value',inputSchema:{type:'object',properties:{q:{type:'string'}}}}]}});
  else if (req.method === 'tools/call') send({jsonrpc:'2.0',id:req.id,result:{content:[{type:'text',text:'ok:' + req.params.arguments.q}],isError:false}});
  else if (req.method === 'ping') send({jsonrpc:'2.0',id:req.id,result:{}});
}
`, 'utf8');
  await chmod(path, 0o700).catch(() => undefined);
  return path;
}

function request(): PhoenixRequest {
  return {
    messages: [
      { role: 'system', content: 'You are PHOENIX.' },
      { role: 'user', content: 'Fix the repository bug and verify it.' },
    ],
    tools: [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
    preferences: { maxInputTokens: 1_000 },
    metadata: { missionId: 'mission-v9' },
  };
}

describe('Token Flight Recorder', () => {
  it('shows where context is spent and tracks actual/cached/avoided usage', () => {
    const recorder = new TokenFlightRecorder();
    const forecast = recorder.recordRequest('mission-v9', request());
    expect(forecast.breakdown.system).toBeGreaterThan(0);
    expect(forecast.breakdown.user).toBeGreaterThan(0);
    expect(forecast.breakdown['tool-schema']).toBeGreaterThan(0);
    recorder.recordResponse('mission-v9', {
      providerId: 'p', modelId: 'm', content: 'done',
      usage: { inputTokens: 900, cachedInputTokens: 400, outputTokens: 20 },
    }, 900);
    recorder.recordAvoided('mission-v9', 600);
    const snapshot = recorder.snapshot('mission-v9');
    expect(snapshot.actualInputTokens).toBe(900);
    expect(snapshot.cachedInputTokens).toBe(400);
    expect(snapshot.avoidedInputTokens).toBe(600);
    expect(recorder.efficiencyScore('mission-v9', 0.95, true)).toBeGreaterThan(60);
  });
});

describe('Agent ROI Gate', () => {
  it('uses deterministic work instead of wasting a subagent on a trivial task', () => {
    const gate = new AgentRoiGate();
    const decision = gate.decide({
      taskId: 'find-symbol', estimatedTokens: 2_000, complexity: 0.2,
      deterministicAlternative: true, specializationGain: 0.1,
    });
    expect(decision.mode).toBe('deterministic');
    expect(decision.allowedAgents).toBe(0);
  });

  it('allows bounded parallel agents only when parallel ROI is high', () => {
    const gate = new AgentRoiGate({ maxAgents: 4 });
    const decision = gate.decide({
      taskId: 'audit', estimatedTokens: 3_000, complexity: 0.95, parallelizable: true,
      specializationGain: 0.95, contextIsolationGain: 0.9, expectedQualityGain: 0.8,
      expectedLatencyGain: 0.8, requestedAgents: 10,
    });
    expect(decision.mode).toBe('parallel-agents');
    expect(decision.allowedAgents).toBe(4);
  });
});

describe('Never-Stop bounded resilience', () => {
  it('classifies rate limits and resumes after checkpoint without infinite retries', async () => {
    let calls = 0;
    let checkpoints = 0;
    const inner = {
      generate: async (): Promise<PhoenixResponse> => {
        calls += 1;
        if (calls < 3) throw new Error('429 rate limit');
        return { providerId: 'p', modelId: 'm', content: 'recovered' };
      },
    };
    const resilient = new ResilientGenerationRuntime(inner, {
      maxAttempts: 4, baseDelayMs: 1, checkpointAfterAttempt: 2,
    }, {
      sleep: async () => undefined,
      checkpoint: async () => { checkpoints += 1; },
    });
    const response = await resilient.generate(request());
    expect(response.content).toBe('recovered');
    expect(calls).toBe(3);
    expect(checkpoints).toBe(1);
    expect(classifyFailure(new Error('401 authentication failed'))).toBe('terminal');
  });
});

describe('Memory Genome', () => {
  it('ages memory, supersedes stale knowledge and excludes disputed facts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-memory-genome-'));
    roots.push(directory);
    const genome = new MemoryGenome(join(directory, 'genome.jsonl'));
    const old = await genome.remember({
      kind: 'fact', content: 'router mode is legacy', source: 'test', confidence: 0.9, ttlMs: 10,
    }, new Date('2026-01-01T00:00:00Z'));
    const current = await genome.remember({
      kind: 'fact', content: 'router mode is adaptive', source: 'test', confidence: 0.95, supersedes: old.id,
    }, new Date('2026-01-02T00:00:00Z'));
    const records = await genome.current(new Date('2026-01-03T00:00:00Z'));
    expect(records.find((item) => item.id === old.id)?.state).toBe('retired');
    expect(records.find((item) => item.id === current.id)?.state).toBe('active');
    expect((await genome.search('adaptive router', { now: new Date('2026-01-03T00:00:00Z') }))[0]?.id).toBe(current.id);
  });
});

describe('MCP Hibernate', () => {
  it('strips server env and sleeps the MCP after discovery and use', async () => {
    const server = await fakeMcpServer();
    const broker = new HibernatingMcpBroker();
    broker.register({
      id: 'fake', source: 'manual', transport: 'stdio', command: process.execPath, args: [server],
      env: { SECRET_TOKEN: 'must-not-be-inherited' }, trusted: true,
    });
    expect(broker.servers()[0]?.env).toBeUndefined();
    expect(broker.servers()[0]?.trusted).toBe(false);
    const definitions = await broker.toolDefinitions('read value');
    expect(definitions[0]?.name).toContain('read_value');
    const result = await broker.call('fake', 'read_value', { q: 'phoenix' }, { allowedRisks: ['read'] });
    expect(JSON.stringify(result.content)).toContain('ok:phoenix');
    const stats = broker.stats();
    expect(stats.strippedEnvironmentServers).toEqual(['fake']);
    expect(stats.wakes).toBe(2);
    expect(stats.sleeps).toBeGreaterThanOrEqual(2);
  });
});
