import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { McpFederation } from '@phoenix/mcp';
import { AdaptiveMissionRunner, type MissionPivotPlanner } from './adaptiveMission.js';
import type { AgentDefinition } from './agents.js';
import {
  McpForge,
  ToolsmithEngine,
  type CapabilityNeed,
  type ToolBlueprint,
  type ToolsmithFailure,
  type ToolsmithPlanner,
} from './toolsmith.js';
import { ToolRegistry } from './tools.js';
import type { PhoenixRequest, PhoenixResponse } from '@phoenix/contracts';

async function jsonCommand(output: 'fail' | 'echo'): Promise<string> {
  const directory = join(tmpdir(), `phoenix-toolsmith-command-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'command.mjs');
  if (output === 'fail') {
    await writeFile(path, `process.stderr.write('planned failure'); process.exit(9);\n`, 'utf8');
  } else {
    await writeFile(path, `let data=''; process.stdin.setEncoding('utf8'); process.stdin.on('data',c=>data+=c); process.stdin.on('end',()=>process.stdout.write(JSON.stringify({ok:true,input:JSON.parse(data)})));\n`, 'utf8');
  }
  return path;
}

class RetryPlanner implements ToolsmithPlanner {
  public proposals = 0;
  public constructor(private readonly bad: string, private readonly good: string) {}
  public async identifyNeeds(): Promise<readonly CapabilityNeed[]> {
    return [{ id: 'cap', query: 'special helper', reason: 'Need a helper that does not exist', required: true, acceptableRisks: ['exec'], testInput: { value: 7 } }];
  }
  public async proposeBlueprint(
    _mission: string,
    _need: CapabilityNeed,
    failures: readonly ToolsmithFailure[],
  ): Promise<ToolBlueprint> {
    this.proposals += 1;
    return {
      id: `candidate-${this.proposals}`,
      toolName: `special_helper_${this.proposals}`,
      description: 'Execute a fixed local helper command for the mission',
      inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
      risk: 'exec',
      implementation: {
        kind: 'command-json',
        command: process.execPath,
        args: [failures.some((item) => item.stage === 'probe') ? this.good : this.bad],
      },
      probeInput: { value: 7 },
      rationale: failures.length ? 'Previous route failed; use alternate helper' : 'First route',
    };
  }
}

class NoNeedPlanner implements ToolsmithPlanner {
  public async identifyNeeds(): Promise<readonly CapabilityNeed[]> { return []; }
  public async proposeBlueprint(): Promise<ToolBlueprint> { throw new Error('not expected'); }
}

class FlakyMissionRuntime {
  public calls = 0;
  public readonly ledger = { append: () => undefined };
  public async generate(request: PhoenixRequest): Promise<PhoenixResponse> {
    this.calls += 1;
    const text = request.messages.at(-1)?.content ?? '';
    if (this.calls === 1) throw new Error('first route unavailable');
    return { providerId: 'local', modelId: 'model', content: `completed:${text}` };
  }
}

describe('PHOENIX Toolsmith and adaptive missions', () => {
  it('forges a new MCP, rejects a failed probe, changes route and verifies the replacement', async () => {
    const bad = await jsonCommand('fail');
    const good = await jsonCommand('echo');
    const rootDir = join(tmpdir(), `phoenix-forge-${randomUUID()}`);
    const federation = new McpFederation({ discoverOnSearch: false });
    const planner = new RetryPlanner(bad, good);
    const engine = new ToolsmithEngine({
      federation,
      planner,
      forge: new McpForge({ rootDir }),
      maxForgeAttempts: 3,
      callPolicy: { allowedRisks: ['read', 'write', 'network', 'exec'] },
    });

    const need = (await engine.analyzeMission('mission'))[0];
    expect(need).toBeDefined();
    const acquisition = await engine.acquire('mission', need!);
    expect(acquisition.status).toBe('forged');
    expect(acquisition.attempts).toBe(2);
    expect(acquisition.failures.some((failure) => failure.stage === 'probe')).toBe(true);
    expect(planner.proposals).toBe(2);

    const tools = new ToolRegistry();
    const name = await engine.bindToRegistry(tools, acquisition);
    const result = await tools.execute(name, { value: 9 }, { allowedRisks: ['read', 'write', 'network', 'exec'] });
    expect(JSON.stringify(result)).toContain('"ok":true');
    await federation.close();
  });

  it('pivots the whole mission after an execution route fails instead of repeating it', async () => {
    const runtime = new FlakyMissionRuntime();
    const federation = new McpFederation({ discoverOnSearch: false });
    const toolsmith = new ToolsmithEngine({ federation, planner: new NoNeedPlanner() });
    const pivotPlanner: MissionPivotPlanner = {
      pivot: async () => ({ approach: 'alternate approach', additionalNeeds: [] }),
    };
    const runner = new AdaptiveMissionRunner(runtime, {
      tools: new ToolRegistry(),
      toolsmith,
      pivotPlanner,
      maxMissionAttempts: 2,
    });
    const agent: AgentDefinition = { id: 'mission-worker', instructions: 'Complete the mission.', maxTurns: 1 };
    const result = await runner.run(agent, 'original approach');
    expect(result.missionAttempts).toBe(2);
    expect(result.attempts[1]?.approach).toBe('alternate approach');
    expect(result.response.content).toContain('alternate approach');
    await federation.close();
  });
});
