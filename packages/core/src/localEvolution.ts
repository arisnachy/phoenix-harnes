import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type LocalEvolutionScope =
  | 'routing'
  | 'context'
  | 'mission-strategy'
  | 'skill-selection'
  | 'model-team';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface LocalEvolutionBudget {
  maxCandidatesPerDay: number;
  maxAiTokensPerDay: number;
  maxSubscriptionCallsPerDay: number;
  maxBenchmarkRunsPerDay: number;
}

export interface LocalEvolutionUsage {
  date: string;
  candidates: number;
  aiTokens: number;
  subscriptionCalls: number;
  benchmarkRuns: number;
}

export interface LocalMissionObservation {
  missionId: string;
  success: boolean;
  quality?: number;
  freshInputTokens: number;
  latencyMs: number;
  retries: number;
  fallbackCount: number;
  contextInputTokens?: number;
  usedSkill?: boolean;
  observedAt?: string;
}

export interface LocalEvolutionOpportunity {
  id: string;
  scope: LocalEvolutionScope;
  reason: string;
  missionId: string;
  priority: number;
  createdAt: string;
}

export interface LocalEvolutionCandidate {
  id: string;
  scope: LocalEvolutionScope;
  summary: string;
  parameters: Readonly<Record<string, JsonValue>>;
  createdAt: string;
  origin: 'local';
  localOnly: true;
  touchesSourceCode: false;
  containsExecutablePayload: false;
  proposerModelKey?: string;
}

export interface LocalEvolutionMetrics {
  quality: number;
  successRate: number;
  freshInputTokens: number;
  latencyMs: number;
  samples: number;
  securityPassed: boolean;
  regressions: number;
}

export interface LocalEvolutionTrial {
  candidate: LocalEvolutionCandidate;
  baseline: LocalEvolutionMetrics;
  challenger: LocalEvolutionMetrics;
}

export interface LocalJudgeVote {
  judgeId: string;
  modelKey?: string;
  verdict: 'approve' | 'reject';
  confidence: number;
}

export interface LocalEvolutionDecision {
  candidateId: string;
  verdict: 'promote' | 'reject' | 'insufficient_evidence';
  reasons: readonly string[];
  evidence: {
    qualityDelta: number;
    successDelta: number;
    freshTokenDeltaPct: number;
    latencyDeltaPct: number;
    samples: number;
  };
}

export interface LocalEvolutionPolicyVersion {
  candidateId: string;
  scope: LocalEvolutionScope;
  parameters: Readonly<Record<string, JsonValue>>;
  promotedAt: string;
  baseline: LocalEvolutionMetrics;
}

export interface LocalEvolutionState {
  version: 1;
  active: Partial<Record<LocalEvolutionScope, LocalEvolutionPolicyVersion>>;
  previous: Partial<Record<LocalEvolutionScope, LocalEvolutionPolicyVersion>>;
  usage: LocalEvolutionUsage;
}

export interface LocalEvolutionEvent {
  id: string;
  type: 'candidate' | 'decision' | 'promotion' | 'rollback' | 'opportunity';
  at: string;
  payload: Readonly<Record<string, JsonValue>>;
}

const DEFAULT_BUDGET: LocalEvolutionBudget = {
  maxCandidatesPerDay: 3,
  maxAiTokensPerDay: 800,
  maxSubscriptionCallsPerDay: 0,
  maxBenchmarkRunsPerDay: 20,
};

const MEDIUM_RISK_SCOPES = new Set<LocalEvolutionScope>(['mission-strategy', 'model-team']);

function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function freshUsage(now = new Date()): LocalEvolutionUsage {
  return { date: utcDay(now), candidates: 0, aiTokens: 0, subscriptionCalls: 0, benchmarkRuns: 0 };
}

function pctDelta(next: number, previous: number): number {
  if (previous === 0) return next === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (next - previous) / previous;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export class LocalEvolutionPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'LocalEvolutionPolicyError';
  }
}

export class LocalEvolutionStore {
  readonly #statePath: string;
  readonly #eventsPath: string;

  public constructor(root = '.phoenix/evolution') {
    this.#statePath = join(root, 'state.json');
    this.#eventsPath = join(root, 'events.jsonl');
  }

  public async load(now = new Date()): Promise<LocalEvolutionState> {
    try {
      const parsed = JSON.parse(await readFile(this.#statePath, 'utf8')) as LocalEvolutionState;
      if (parsed.usage.date !== utcDay(now)) parsed.usage = freshUsage(now);
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { version: 1, active: {}, previous: {}, usage: freshUsage(now) };
    }
  }

  public async save(state: LocalEvolutionState): Promise<void> {
    await mkdir(dirname(this.#statePath), { recursive: true });
    const temporary = `${this.#statePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temporary, this.#statePath);
  }

  public async append(event: LocalEvolutionEvent): Promise<void> {
    await mkdir(dirname(this.#eventsPath), { recursive: true });
    await appendFile(this.#eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
  }
}

export class LocalEvolutionBudgetLedger {
  readonly #store: LocalEvolutionStore;
  readonly #budget: LocalEvolutionBudget;

  public constructor(store: LocalEvolutionStore, budget: Partial<LocalEvolutionBudget> = {}) {
    this.#store = store;
    this.#budget = { ...DEFAULT_BUDGET, ...budget };
  }

  public limits(): LocalEvolutionBudget { return { ...this.#budget }; }

  public async remaining(now = new Date()): Promise<LocalEvolutionBudget> {
    const state = await this.#store.load(now);
    return {
      maxCandidatesPerDay: Math.max(0, this.#budget.maxCandidatesPerDay - state.usage.candidates),
      maxAiTokensPerDay: Math.max(0, this.#budget.maxAiTokensPerDay - state.usage.aiTokens),
      maxSubscriptionCallsPerDay: Math.max(0, this.#budget.maxSubscriptionCallsPerDay - state.usage.subscriptionCalls),
      maxBenchmarkRunsPerDay: Math.max(0, this.#budget.maxBenchmarkRunsPerDay - state.usage.benchmarkRuns),
    };
  }

  public async consume(input: {
    candidates?: number;
    aiTokens?: number;
    subscriptionCalls?: number;
    benchmarkRuns?: number;
  }, now = new Date()): Promise<LocalEvolutionUsage> {
    const state = await this.#store.load(now);
    const next: LocalEvolutionUsage = {
      date: state.usage.date,
      candidates: state.usage.candidates + Math.max(0, Math.floor(input.candidates ?? 0)),
      aiTokens: state.usage.aiTokens + Math.max(0, Math.floor(input.aiTokens ?? 0)),
      subscriptionCalls: state.usage.subscriptionCalls + Math.max(0, Math.floor(input.subscriptionCalls ?? 0)),
      benchmarkRuns: state.usage.benchmarkRuns + Math.max(0, Math.floor(input.benchmarkRuns ?? 0)),
    };
    if (next.candidates > this.#budget.maxCandidatesPerDay) throw new LocalEvolutionPolicyError('Daily candidate budget exceeded');
    if (next.aiTokens > this.#budget.maxAiTokensPerDay) throw new LocalEvolutionPolicyError('Daily AI token budget exceeded');
    if (next.subscriptionCalls > this.#budget.maxSubscriptionCallsPerDay) throw new LocalEvolutionPolicyError('Daily subscription-call budget exceeded');
    if (next.benchmarkRuns > this.#budget.maxBenchmarkRunsPerDay) throw new LocalEvolutionPolicyError('Daily benchmark budget exceeded');
    state.usage = next;
    await this.#store.save(state);
    return next;
  }
}

export class LocalOpportunityDetector {
  public detect(observation: LocalMissionObservation): readonly LocalEvolutionOpportunity[] {
    const at = observation.observedAt ?? new Date().toISOString();
    const opportunities: LocalEvolutionOpportunity[] = [];
    if (observation.freshInputTokens >= 12_000 || (observation.contextInputTokens ?? 0) >= 10_000) {
      opportunities.push({
        id: randomUUID(), scope: 'context', missionId: observation.missionId,
        reason: 'high_fresh_context_cost', priority: 0.9, createdAt: at,
      });
    }
    if (observation.fallbackCount >= 2) {
      opportunities.push({
        id: randomUUID(), scope: 'routing', missionId: observation.missionId,
        reason: 'repeated_provider_or_model_fallback', priority: 0.82, createdAt: at,
      });
    }
    if (observation.retries >= 2 || !observation.success) {
      opportunities.push({
        id: randomUUID(), scope: 'mission-strategy', missionId: observation.missionId,
        reason: observation.success ? 'repeated_strategy_retries' : 'mission_failure', priority: observation.success ? 0.78 : 0.95, createdAt: at,
      });
    }
    if (observation.usedSkill === false && observation.success) {
      opportunities.push({
        id: randomUUID(), scope: 'skill-selection', missionId: observation.missionId,
        reason: 'successful_work_without_reusable_skill', priority: 0.55, createdAt: at,
      });
    }
    return opportunities.sort((a, b) => b.priority - a.priority);
  }
}

export class LocalEvolutionGate {
  public evaluate(trial: LocalEvolutionTrial, votes: readonly LocalJudgeVote[] = []): LocalEvolutionDecision {
    this.#assertCandidate(trial.candidate);
    const reasons: string[] = [];
    const samples = Math.min(trial.baseline.samples, trial.challenger.samples);
    const qualityDelta = trial.challenger.quality - trial.baseline.quality;
    const successDelta = trial.challenger.successRate - trial.baseline.successRate;
    const freshTokenDeltaPct = pctDelta(trial.challenger.freshInputTokens, trial.baseline.freshInputTokens);
    const latencyDeltaPct = pctDelta(trial.challenger.latencyMs, trial.baseline.latencyMs);

    if (samples < 5) reasons.push('insufficient_samples');
    if (!trial.challenger.securityPassed) reasons.push('security_not_passed');
    if (trial.challenger.regressions > 0) reasons.push('regressions_detected');
    if (trial.challenger.quality < trial.baseline.quality - 0.01) reasons.push('quality_regression');
    if (trial.challenger.successRate < trial.baseline.successRate - 0.005) reasons.push('success_regression');

    const materiallyBetter = qualityDelta >= 0.01
      || successDelta >= 0.01
      || freshTokenDeltaPct <= -0.05
      || latencyDeltaPct <= -0.10;
    if (!materiallyBetter) reasons.push('no_material_improvement');

    const independentVotes = votes.filter((vote) =>
      vote.confidence >= 0.6
      && (!trial.candidate.proposerModelKey || vote.modelKey !== trial.candidate.proposerModelKey));
    if (independentVotes.some((vote) => vote.verdict === 'reject' && vote.confidence >= 0.8)) {
      reasons.push('independent_judge_rejected');
    }
    if (MEDIUM_RISK_SCOPES.has(trial.candidate.scope)
      && independentVotes.filter((vote) => vote.verdict === 'approve').length < 1) {
      reasons.push('independent_judge_required');
    }

    const evidence = {
      qualityDelta: Number(qualityDelta.toFixed(4)),
      successDelta: Number(successDelta.toFixed(4)),
      freshTokenDeltaPct: Number(freshTokenDeltaPct.toFixed(4)),
      latencyDeltaPct: Number(latencyDeltaPct.toFixed(4)),
      samples,
    };
    if (reasons.length === 1 && reasons[0] === 'insufficient_samples') {
      return { candidateId: trial.candidate.id, verdict: 'insufficient_evidence', reasons, evidence };
    }
    return { candidateId: trial.candidate.id, verdict: reasons.length ? 'reject' : 'promote', reasons, evidence };
  }

  #assertCandidate(candidate: LocalEvolutionCandidate): void {
    if (candidate.origin !== 'local' || candidate.localOnly !== true) throw new LocalEvolutionPolicyError('Only local candidates may evolve a PHOENIX installation');
    if (candidate.touchesSourceCode !== false) throw new LocalEvolutionPolicyError('Local self-evolution may not rewrite PHOENIX source code');
    if (candidate.containsExecutablePayload !== false) throw new LocalEvolutionPolicyError('Local self-evolution candidates must be inert policy/configuration data');
  }
}

export class LocalPolicyBank {
  readonly #store: LocalEvolutionStore;

  public constructor(store: LocalEvolutionStore) {
    this.#store = store;
  }

  public async promote(trial: LocalEvolutionTrial, decision: LocalEvolutionDecision, now = new Date()): Promise<LocalEvolutionPolicyVersion> {
    if (decision.verdict !== 'promote') throw new LocalEvolutionPolicyError(`Cannot promote decision ${decision.verdict}`);
    const state = await this.#store.load(now);
    const version: LocalEvolutionPolicyVersion = {
      candidateId: trial.candidate.id,
      scope: trial.candidate.scope,
      parameters: { ...trial.candidate.parameters },
      promotedAt: now.toISOString(),
      baseline: { ...trial.baseline },
    };
    const current = state.active[trial.candidate.scope];
    if (current) state.previous[trial.candidate.scope] = current;
    state.active[trial.candidate.scope] = version;
    await this.#store.save(state);
    await this.#store.append({
      id: randomUUID(), type: 'promotion', at: now.toISOString(),
      payload: { candidateId: trial.candidate.id, scope: trial.candidate.scope },
    });
    return version;
  }

  public async rollback(scope: LocalEvolutionScope, reason: string, now = new Date()): Promise<LocalEvolutionPolicyVersion | undefined> {
    const state = await this.#store.load(now);
    const current = state.active[scope];
    const previous = state.previous[scope];
    if (!current) return undefined;
    if (previous) state.active[scope] = previous;
    else delete state.active[scope];
    delete state.previous[scope];
    await this.#store.save(state);
    await this.#store.append({
      id: randomUUID(), type: 'rollback', at: now.toISOString(),
      payload: { candidateId: current.candidateId, scope, reason },
    });
    return previous;
  }

  public async parameters(scope: LocalEvolutionScope): Promise<Readonly<Record<string, JsonValue>>> {
    const state = await this.#store.load();
    return { ...(state.active[scope]?.parameters ?? {}) };
  }

  public async verifyAfterPromotion(scope: LocalEvolutionScope, observed: LocalEvolutionMetrics): Promise<'keep' | 'rollback'> {
    const state = await this.#store.load();
    const active = state.active[scope];
    if (!active) return 'keep';
    const baseline = active.baseline;
    const qualityRegression = observed.quality < baseline.quality - 0.015;
    const successRegression = observed.successRate < baseline.successRate - 0.01;
    const securityRegression = !observed.securityPassed || observed.regressions > 0;
    if (qualityRegression || successRegression || securityRegression) {
      await this.rollback(scope, securityRegression ? 'post_promotion_security_or_regression' : 'post_promotion_performance_regression');
      return 'rollback';
    }
    return 'keep';
  }
}

export interface LocalEvolutionHooks {
  propose(opportunity: LocalEvolutionOpportunity, remaining: LocalEvolutionBudget): Promise<{
    candidate: LocalEvolutionCandidate;
    aiTokensUsed?: number;
    subscriptionCallsUsed?: number;
  }>;
  benchmark(candidate: LocalEvolutionCandidate): Promise<{
    baseline: LocalEvolutionMetrics;
    challenger: LocalEvolutionMetrics;
    runsUsed: number;
  }>;
  judge?(candidate: LocalEvolutionCandidate, trial: LocalEvolutionTrial): Promise<{
    votes: readonly LocalJudgeVote[];
    aiTokensUsed?: number;
    subscriptionCallsUsed?: number;
  }>;
}

export class LocalEvolutionAutopilot {
  readonly #store: LocalEvolutionStore;
  readonly #budget: LocalEvolutionBudgetLedger;
  readonly #gate: LocalEvolutionGate;
  readonly #bank: LocalPolicyBank;

  public constructor(options: {
    store?: LocalEvolutionStore;
    budget?: Partial<LocalEvolutionBudget>;
    gate?: LocalEvolutionGate;
    bank?: LocalPolicyBank;
  } = {}) {
    this.#store = options.store ?? new LocalEvolutionStore();
    this.#budget = new LocalEvolutionBudgetLedger(this.#store, options.budget);
    this.#gate = options.gate ?? new LocalEvolutionGate();
    this.#bank = options.bank ?? new LocalPolicyBank(this.#store);
  }

  public bank(): LocalPolicyBank { return this.#bank; }
  public budget(): LocalEvolutionBudgetLedger { return this.#budget; }

  public async runOnce(opportunity: LocalEvolutionOpportunity, hooks: LocalEvolutionHooks): Promise<LocalEvolutionDecision> {
    await this.#store.append({
      id: randomUUID(), type: 'opportunity', at: new Date().toISOString(),
      payload: { opportunityId: opportunity.id, scope: opportunity.scope, reason: opportunity.reason, missionId: opportunity.missionId },
    });
    const remaining = await this.#budget.remaining();
    if (remaining.maxCandidatesPerDay < 1) throw new LocalEvolutionPolicyError('No local evolution candidate budget remains today');

    const proposed = await hooks.propose(opportunity, remaining);
    await this.#budget.consume({
      candidates: 1,
      aiTokens: proposed.aiTokensUsed ?? 0,
      subscriptionCalls: proposed.subscriptionCallsUsed ?? 0,
    });
    this.#gate.evaluate({
      candidate: proposed.candidate,
      baseline: { quality: 0, successRate: 0, freshInputTokens: 0, latencyMs: 0, samples: 0, securityPassed: true, regressions: 0 },
      challenger: { quality: 0, successRate: 0, freshInputTokens: 0, latencyMs: 0, samples: 0, securityPassed: true, regressions: 0 },
    });
    await this.#store.append({
      id: randomUUID(), type: 'candidate', at: new Date().toISOString(),
      payload: { candidateId: proposed.candidate.id, scope: proposed.candidate.scope, summary: proposed.candidate.summary },
    });

    const benchmark = await hooks.benchmark(proposed.candidate);
    await this.#budget.consume({ benchmarkRuns: benchmark.runsUsed });
    const trial: LocalEvolutionTrial = {
      candidate: proposed.candidate,
      baseline: benchmark.baseline,
      challenger: benchmark.challenger,
    };

    let votes: readonly LocalJudgeVote[] = [];
    if (hooks.judge && MEDIUM_RISK_SCOPES.has(proposed.candidate.scope)) {
      const judged = await hooks.judge(proposed.candidate, trial);
      votes = judged.votes;
      await this.#budget.consume({
        aiTokens: judged.aiTokensUsed ?? 0,
        subscriptionCalls: judged.subscriptionCallsUsed ?? 0,
      });
    }
    const decision = this.#gate.evaluate(trial, votes);
    await this.#store.append({
      id: randomUUID(), type: 'decision', at: new Date().toISOString(),
      payload: { candidateId: decision.candidateId, verdict: decision.verdict, reasons: [...decision.reasons] },
    });
    if (decision.verdict === 'promote') await this.#bank.promote(trial, decision);
    return decision;
  }
}

export function makeLocalCandidate(input: {
  scope: LocalEvolutionScope;
  summary: string;
  parameters: Readonly<Record<string, JsonValue>>;
  proposerModelKey?: string;
}): LocalEvolutionCandidate {
  return {
    id: randomUUID(),
    scope: input.scope,
    summary: input.summary,
    parameters: { ...input.parameters },
    createdAt: new Date().toISOString(),
    origin: 'local',
    localOnly: true,
    touchesSourceCode: false,
    containsExecutablePayload: false,
    ...(input.proposerModelKey ? { proposerModelKey: input.proposerModelKey } : {}),
  };
}
