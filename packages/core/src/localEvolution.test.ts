import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LocalEvolutionAutopilot,
  LocalEvolutionBudgetLedger,
  LocalEvolutionGate,
  LocalEvolutionPolicyError,
  LocalEvolutionStore,
  LocalOpportunityDetector,
  LocalPolicyBank,
  makeLocalCandidate,
  type LocalEvolutionCandidate,
  type LocalEvolutionMetrics,
} from './localEvolution.js';

const roots: string[] = [];

async function store(): Promise<{ root: string; store: LocalEvolutionStore }> {
  const root = await mkdtemp(join(tmpdir(), 'phoenix-local-evolution-'));
  roots.push(root);
  return { root, store: new LocalEvolutionStore(root) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function metrics(overrides: Partial<LocalEvolutionMetrics> = {}): LocalEvolutionMetrics {
  return {
    quality: 0.92,
    successRate: 0.94,
    freshInputTokens: 10_000,
    latencyMs: 1_000,
    samples: 20,
    securityPassed: true,
    regressions: 0,
    ...overrides,
  };
}

describe('PHOENIX local self-evolution', () => {
  it('detects local opportunities without using an LLM', () => {
    const opportunities = new LocalOpportunityDetector().detect({
      missionId: 'm1',
      success: false,
      freshInputTokens: 18_000,
      contextInputTokens: 16_000,
      latencyMs: 2_000,
      retries: 3,
      fallbackCount: 2,
      usedSkill: false,
    });
    expect(opportunities.map((item) => item.scope)).toContain('context');
    expect(opportunities.map((item) => item.scope)).toContain('routing');
    expect(opportunities.map((item) => item.scope)).toContain('mission-strategy');
    expect(opportunities[0]?.priority).toBeGreaterThanOrEqual(opportunities.at(-1)?.priority ?? 0);
  });

  it('defaults to zero subscription calls and enforces the local daily budget', async () => {
    const { store: localStore } = await store();
    const ledger = new LocalEvolutionBudgetLedger(localStore, { maxAiTokensPerDay: 100 });
    expect(ledger.limits().maxSubscriptionCallsPerDay).toBe(0);
    await expect(ledger.consume({ subscriptionCalls: 1 })).rejects.toThrow(/subscription-call budget/i);
    await ledger.consume({ aiTokens: 80 });
    await expect(ledger.consume({ aiTokens: 21 })).rejects.toThrow(/AI token budget/i);
  });

  it('promotes a local context policy only when evidence shows a material non-regressive improvement', async () => {
    const { root, store: localStore } = await store();
    const bank = new LocalPolicyBank(localStore);
    const gate = new LocalEvolutionGate();
    const candidate = makeLocalCandidate({
      scope: 'context',
      summary: 'Reduce unchanged context re-send',
      parameters: { maxFreshContextTokens: 6_000, reuseFingerprints: true },
    });
    const trial = {
      candidate,
      baseline: metrics(),
      challenger: metrics({ quality: 0.921, successRate: 0.94, freshInputTokens: 5_800, latencyMs: 900 }),
    };
    const decision = gate.evaluate(trial);
    expect(decision.verdict).toBe('promote');
    await bank.promote(trial, decision);
    expect(await bank.parameters('context')).toEqual({ maxFreshContextTokens: 6_000, reuseFingerprints: true });
    const persisted = JSON.parse(await readFile(join(root, 'state.json'), 'utf8')) as { active: { context?: { candidateId: string } } };
    expect(persisted.active.context?.candidateId).toBe(candidate.id);
  });

  it('fails closed on remote, source-rewriting or executable self-evolution candidates', () => {
    const gate = new LocalEvolutionGate();
    const good = makeLocalCandidate({ scope: 'routing', summary: 'route', parameters: { preferLocal: true } });
    const trial = { candidate: good, baseline: metrics(), challenger: metrics({ freshInputTokens: 8_000 }) };

    const remote = { ...good, origin: 'remote' } as unknown as LocalEvolutionCandidate;
    expect(() => gate.evaluate({ ...trial, candidate: remote })).toThrow(LocalEvolutionPolicyError);

    const source = { ...good, touchesSourceCode: true } as unknown as LocalEvolutionCandidate;
    expect(() => gate.evaluate({ ...trial, candidate: source })).toThrow(/may not rewrite/i);

    const executable = { ...good, containsExecutablePayload: true } as unknown as LocalEvolutionCandidate;
    expect(() => gate.evaluate({ ...trial, candidate: executable })).toThrow(/inert policy/i);
  });

  it('requires an independent judge before changing mission strategy or model teams', () => {
    const gate = new LocalEvolutionGate();
    const candidate = makeLocalCandidate({
      scope: 'model-team',
      summary: 'Pair a stronger critic with the builder',
      parameters: { criticModel: 'provider::critic-b' },
      proposerModelKey: 'provider::builder-a',
    });
    const trial = { candidate, baseline: metrics(), challenger: metrics({ quality: 0.95, successRate: 0.96 }) };
    expect(gate.evaluate(trial).reasons).toContain('independent_judge_required');
    expect(gate.evaluate(trial, [{
      judgeId: 'j1', modelKey: 'provider::builder-a', verdict: 'approve', confidence: 0.99,
    }]).reasons).toContain('independent_judge_required');
    expect(gate.evaluate(trial, [{
      judgeId: 'j2', modelKey: 'provider::judge-b', verdict: 'approve', confidence: 0.9,
    }]).verdict).toBe('promote');
  });

  it('rolls back automatically when a promoted local policy regresses', async () => {
    const { store: localStore } = await store();
    const bank = new LocalPolicyBank(localStore);
    const gate = new LocalEvolutionGate();
    const first = makeLocalCandidate({ scope: 'routing', summary: 'first', parameters: { route: 'a' } });
    const trial1 = { candidate: first, baseline: metrics(), challenger: metrics({ freshInputTokens: 8_000 }) };
    await bank.promote(trial1, gate.evaluate(trial1));

    const second = makeLocalCandidate({ scope: 'routing', summary: 'second', parameters: { route: 'b' } });
    const trial2 = { candidate: second, baseline: metrics({ quality: 0.93 }), challenger: metrics({ quality: 0.94, freshInputTokens: 7_000 }) };
    await bank.promote(trial2, gate.evaluate(trial2));
    expect(await bank.parameters('routing')).toEqual({ route: 'b' });

    expect(await bank.verifyAfterPromotion('routing', metrics({ quality: 0.80, successRate: 0.70 }))).toBe('rollback');
    expect(await bank.parameters('routing')).toEqual({ route: 'a' });
  });

  it('runs a bounded local evolution cycle and spends no subscription quota by default', async () => {
    const { store: localStore } = await store();
    const autopilot = new LocalEvolutionAutopilot({ store: localStore, budget: { maxAiTokensPerDay: 200 } });
    const opportunity = new LocalOpportunityDetector().detect({
      missionId: 'm2', success: true, freshInputTokens: 15_000, latencyMs: 800, retries: 0, fallbackCount: 0,
    })[0]!;
    const decision = await autopilot.runOnce(opportunity, {
      propose: async () => ({
        candidate: makeLocalCandidate({ scope: 'context', summary: 'compact', parameters: { budget: 5_000 } }),
        aiTokensUsed: 50,
      }),
      benchmark: async () => ({ baseline: metrics(), challenger: metrics({ freshInputTokens: 6_000 }), runsUsed: 6 }),
    });
    expect(decision.verdict).toBe('promote');
    const remaining = await autopilot.budget().remaining();
    expect(remaining.maxSubscriptionCallsPerDay).toBe(0);
    expect(await autopilot.bank().parameters('context')).toEqual({ budget: 5_000 });
  });
});
