import { describe, expect, it } from 'vitest';
import { ModelCapabilityRanking, type ModelDimension } from '@phoenix/model-rank';
import {
  CleanRoomEvidenceFirewall,
  MissionGraph,
  MissionGraphError,
  RankedMissionScheduler,
} from './index.js';

const dimensions: readonly ModelDimension[] = [
  'planning', 'orchestration', 'reasoning', 'coding', 'debugging', 'research',
  'toolUse', 'critique', 'judging', 'security', 'reliability', 'efficiency',
];

function seed(ranking: ModelCapabilityRanking, modelId: string, base: number, overrides: Partial<Record<ModelDimension, number>> = {}): void {
  ranking.registerDiscovered('provider', modelId);
  for (const dimension of dimensions) {
    ranking.observe({
      id: `${modelId}:${dimension}`,
      providerId: 'provider',
      modelId,
      dimension,
      score: overrides[dimension] ?? base,
      successRate: 0.99,
      reproducibility: 0.99,
      samples: 80,
      observedAt: new Date().toISOString(),
      source: 'benchmark',
    });
  }
}

describe('PHOENIX Mission Graph', () => {
  it('releases independent DAG work in parallel and unlocks dependents only after success', () => {
    const graph = new MissionGraph({
      id: 'mission-1',
      objective: 'Ship a verified change',
      tasks: [
        { id: 'research', objective: 'Research', role: 'analyst' },
        { id: 'reproduce', objective: 'Reproduce', role: 'reproducer' },
        { id: 'build', objective: 'Build', role: 'builder', dependencies: ['research', 'reproduce'] },
      ],
    });
    expect(graph.ready().map((task) => task.definition.id).sort()).toEqual(['reproduce', 'research']);

    const fakeModel = { providerId: 'p', modelId: 'm', role: 'analyst' as const, composite: 90, confidence: 0.9, eligible: true, reasons: [] };
    graph.start('research', fakeModel);
    graph.succeed('research', { finding: true });
    expect(graph.ready().map((task) => task.definition.id)).toEqual(['reproduce']);

    graph.start('reproduce', { ...fakeModel, role: 'reproducer' });
    graph.succeed('reproduce', { reproduced: true });
    expect(graph.ready().map((task) => task.definition.id)).toEqual(['build']);
  });

  it('detects cycles before a mission can run', () => {
    expect(() => new MissionGraph({
      id: 'cycle', objective: 'bad', tasks: [
        { id: 'a', objective: 'A', role: 'analyst', dependencies: ['b'] },
        { id: 'b', objective: 'B', role: 'builder', dependencies: ['a'] },
      ],
    })).toThrow(/cycle detected/i);
  });

  it('requires a pivot after bounded failures and rewires downstream work to a different path', () => {
    const graph = new MissionGraph({
      id: 'pivot', objective: 'Recover', tasks: [
        { id: 'path-a', objective: 'Try approach A', role: 'builder', maxAttempts: 1 },
        { id: 'verify', objective: 'Verify', role: 'critic', dependencies: ['path-a'] },
      ],
    });
    const model = { providerId: 'p', modelId: 'm', role: 'builder' as const, composite: 90, confidence: 0.9, eligible: true, reasons: [] };
    graph.start('path-a', model);
    expect(graph.fail('path-a', new Error('approach failed'))).toBe('pivot_required');
    const replacement = graph.replaceWithPivot('path-a', {
      id: 'path-b', objective: 'Use materially different approach B', role: 'builder', maxAttempts: 2,
    });
    const rebuilt = new MissionGraph(replacement);
    expect(rebuilt.task('verify').definition.dependencies).toEqual(['path-b']);
    expect(rebuilt.ready().map((task) => task.definition.id)).toEqual(['path-b']);
    expect(() => rebuilt.task('path-a')).toThrow(/unknown task/i);
  });

  it('assigns each ready role to a model qualified for that role and excludes quarantined model keys', () => {
    const ranking = new ModelCapabilityRanking();
    seed(ranking, 'great-builder', 88, {
      coding: 99, debugging: 97, toolUse: 94, reliability: 92,
      orchestration: 55, planning: 50, reasoning: 50, research: 50,
    });
    seed(ranking, 'great-analyst', 91, { reasoning: 98, research: 98, planning: 94 });
    const graph = new MissionGraph({
      id: 'ranked', objective: 'Use specialists', tasks: [
        { id: 'analysis', objective: 'Analyze', role: 'analyst' },
        { id: 'implementation', objective: 'Implement', role: 'builder' },
      ],
    });
    const scheduler = new RankedMissionScheduler(ranking, new Set(['provider::great-analyst']));
    const assignments = scheduler.assignments(graph);
    expect(assignments.find((item) => item.taskId === 'implementation')?.model.modelId).toBe('great-builder');
    expect(assignments.some((item) => item.taskId === 'analysis')).toBe(false);
  });

  it('snapshots state without embedding task outputs', () => {
    const graph = new MissionGraph({ id: 'snap', objective: 'Resume', tasks: [{ id: 'a', objective: 'A', role: 'analyst' }] });
    const model = { providerId: 'p', modelId: 'm', role: 'analyst' as const, composite: 90, confidence: 0.9, eligible: true, reasons: [] };
    graph.start('a', model);
    graph.succeed('a', { giantPrivateOutput: 'never stored in snapshot' });
    const snapshot = graph.snapshot();
    expect(snapshot.tasks[0]?.state).toBe('succeeded');
    expect(snapshot.tasks[0]?.outputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(snapshot)).not.toContain('giantPrivateOutput');
  });
});

describe('Clean Room Evidence Firewall', () => {
  it('turns inert remote evidence into an independent local reproduction task', () => {
    const task = new CleanRoomEvidenceFirewall().reconstruct({
      problemId: 'remote-1',
      category: 'token-regression',
      fingerprint: 'sha256:abc',
      summary: 'Remote node claims a regression.',
      metrics: { deltaPct: 42, reproduced: true },
    });
    expect(task.remoteContentExecutable).toBe(false);
    expect(task.allowedFacts).toEqual({ deltaPct: 42, reproduced: true });
    expect(task.objective).toMatch(/independently reproduce/i);
    expect(task.objective).not.toContain('Remote node claims');
  });

  it.each(['sourceCode', 'patch', 'artifact', 'mcpDefinition', 'command', 'script', 'secrets'])('rejects peer supplied executable field %s', (field) => {
    expect(() => new CleanRoomEvidenceFirewall().reconstruct({
      problemId: 'remote-2', category: 'bug', fingerprint: 'x', summary: 'claim', [field]: 'malicious',
    })).toThrow(MissionGraphError);
  });
});
