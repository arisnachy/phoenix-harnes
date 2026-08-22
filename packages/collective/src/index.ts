import { createHash, randomUUID } from 'node:crypto';

export type EvolutionProblemKind = 'bug' | 'capability_gap' | 'efficiency' | 'security' | 'evolution';
export type EvolutionRole = 'observer' | 'reproducer' | 'analyst' | 'builder' | 'critic' | 'benchmark';
export type JudgeVote = 'approve' | 'reject' | 'abstain';
export type ModelTier = 'none' | 'small' | 'medium' | 'frontier';

export interface EvolutionProblem {
  id: string;
  kind: EvolutionProblemKind;
  title: string;
  fingerprint: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  requiredCapabilities: readonly string[];
  createdAt: string;
}

export interface EvolutionCapsule {
  id: string;
  problemId: string;
  fingerprint: string;
  phoenixVersion: string;
  category: EvolutionProblemKind;
  summary: string;
  evidence: Readonly<Record<string, number | string | boolean>>;
  privacy: {
    rawPromptIncluded: false;
    sourceCodeIncluded: boolean;
    secretsIncluded: false;
  };
  createdAt: string;
}

export interface DailyEvolutionBudget {
  maxAiTokens: number;
  maxCpuMs: number;
  maxNetworkBytes: number;
  maxSubscriptionCalls: number;
}

export interface EvolutionUsage {
  aiTokens: number;
  cpuMs: number;
  networkBytes: number;
  subscriptionCalls: number;
}

export interface EvolutionSpend extends Partial<EvolutionUsage> {}

export interface EvolutionNodeProfile {
  nodeId: string;
  phoenixVersion: string;
  platform: string;
  capabilities: readonly string[];
  modelTier: ModelTier;
  judgeReliability: number;
  contributionReliability: number;
  optIn: boolean;
  budget: DailyEvolutionBudget;
}

export interface EvolutionContributionOffer {
  id: string;
  nodeId: string;
  problemId: string;
  preferredRoles: readonly EvolutionRole[];
  maxAiTokens: number;
  maxCpuMs: number;
  modelTier: ModelTier;
  capabilities: readonly string[];
}

export interface CellAssignment {
  nodeId: string;
  role: EvolutionRole;
  aiTokenBudget: number;
  cpuMsBudget: number;
}

export interface JudgeAssignment {
  nodeId: string;
  weight: number;
}

export interface EvolutionCell {
  id: string;
  problem: EvolutionProblem;
  contributors: readonly CellAssignment[];
  judges: readonly JudgeAssignment[];
  createdAt: string;
  expiresAt: string;
}

export interface CellPolicy {
  contributorCount?: number;
  judgeCount?: number;
  maxTokensPerContributor?: number;
  maxCpuMsPerContributor?: number;
  ttlMs?: number;
}

export interface CandidateMetrics {
  qualityDelta: number;
  successRateDelta: number;
  freshTokensDeltaPct: number;
  latencyDeltaPct: number;
  regressionCount: number;
  securityPassed: boolean;
  reproducibleRuns: number;
}

export interface CandidateImprovement {
  id: string;
  problemId: string;
  baseSha: string;
  artifactHash: string;
  contributionNodeIds: readonly string[];
  metrics: CandidateMetrics;
  createdAt: string;
}

export interface JudgeVerdict {
  candidateId: string;
  problemId: string;
  judgeNodeId: string;
  vote: JudgeVote;
  confidence: number;
  reasons: readonly string[];
  checks: {
    reproduced: boolean;
    testsPassed: boolean;
    securityReviewed: boolean;
    tokenEconomyReviewed: boolean;
  };
  createdAt: string;
}

export interface JudgePolicy {
  minimumJudges?: number;
  approvalRatio?: number;
  minimumConfidence?: number;
  minimumReproducibleRuns?: number;
  requireSecurityReview?: boolean;
  requireTokenEconomyReview?: boolean;
}

export interface JudgeDecision {
  candidateId: string;
  status: 'approved' | 'rejected' | 'insufficient_evidence';
  eligibleForPullRequest: boolean;
  approvalRatio: number;
  independentJudges: number;
  reasons: readonly string[];
  requiresProtectedBranchGate: true;
}

export interface EvolutionMicroTask {
  id: string;
  problemId: string;
  role: EvolutionRole;
  objective: string;
  preferredCapabilities: readonly string[];
  maxAiTokens: number;
  maxCpuMs: number;
}

export interface ContributionEvidence {
  contributionId: string;
  nodeId: string;
  problemId: string;
  role: EvolutionRole;
  summary: string;
  artifactHash?: string;
  reproducible: boolean;
  metrics: Readonly<Record<string, number | string | boolean>>;
  spend: EvolutionUsage;
  createdAt: string;
}

function bounded(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function modelTierScore(tier: ModelTier): number {
  if (tier === 'frontier') return 4;
  if (tier === 'medium') return 3;
  if (tier === 'small') return 2;
  return 1;
}

function capabilityScore(problem: EvolutionProblem, node: EvolutionNodeProfile): number {
  if (!problem.requiredCapabilities.length) return 1;
  const available = new Set(node.capabilities);
  let matches = 0;
  for (const capability of problem.requiredCapabilities) {
    if (available.has(capability)) matches += 1;
  }
  return matches / problem.requiredCapabilities.length;
}

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export class EvolutionBudgetGate {
  readonly #budget: DailyEvolutionBudget;
  #day = dayKey();
  #usage: EvolutionUsage = { aiTokens: 0, cpuMs: 0, networkBytes: 0, subscriptionCalls: 0 };

  public constructor(budget: DailyEvolutionBudget) {
    this.#budget = {
      maxAiTokens: Math.max(0, Math.floor(budget.maxAiTokens)),
      maxCpuMs: Math.max(0, Math.floor(budget.maxCpuMs)),
      maxNetworkBytes: Math.max(0, Math.floor(budget.maxNetworkBytes)),
      maxSubscriptionCalls: Math.max(0, Math.floor(budget.maxSubscriptionCalls)),
    };
  }

  public snapshot(now = new Date()): EvolutionUsage {
    this.#refresh(now);
    return { ...this.#usage };
  }

  public remaining(now = new Date()): EvolutionUsage {
    this.#refresh(now);
    return {
      aiTokens: Math.max(0, this.#budget.maxAiTokens - this.#usage.aiTokens),
      cpuMs: Math.max(0, this.#budget.maxCpuMs - this.#usage.cpuMs),
      networkBytes: Math.max(0, this.#budget.maxNetworkBytes - this.#usage.networkBytes),
      subscriptionCalls: Math.max(0, this.#budget.maxSubscriptionCalls - this.#usage.subscriptionCalls),
    };
  }

  public canSpend(spend: EvolutionSpend, now = new Date()): boolean {
    const remaining = this.remaining(now);
    return (spend.aiTokens ?? 0) <= remaining.aiTokens
      && (spend.cpuMs ?? 0) <= remaining.cpuMs
      && (spend.networkBytes ?? 0) <= remaining.networkBytes
      && (spend.subscriptionCalls ?? 0) <= remaining.subscriptionCalls;
  }

  public spend(spend: EvolutionSpend, now = new Date()): EvolutionUsage {
    this.#refresh(now);
    const normalized: EvolutionUsage = {
      aiTokens: Math.max(0, Math.floor(spend.aiTokens ?? 0)),
      cpuMs: Math.max(0, Math.floor(spend.cpuMs ?? 0)),
      networkBytes: Math.max(0, Math.floor(spend.networkBytes ?? 0)),
      subscriptionCalls: Math.max(0, Math.floor(spend.subscriptionCalls ?? 0)),
    };
    if (!this.canSpend(normalized, now)) throw new Error('PHOENIX evolution contribution exceeds the user daily budget');
    this.#usage = {
      aiTokens: this.#usage.aiTokens + normalized.aiTokens,
      cpuMs: this.#usage.cpuMs + normalized.cpuMs,
      networkBytes: this.#usage.networkBytes + normalized.networkBytes,
      subscriptionCalls: this.#usage.subscriptionCalls + normalized.subscriptionCalls,
    };
    return { ...this.#usage };
  }

  #refresh(now: Date): void {
    const current = dayKey(now);
    if (current === this.#day) return;
    this.#day = current;
    this.#usage = { aiTokens: 0, cpuMs: 0, networkBytes: 0, subscriptionCalls: 0 };
  }
}

export class EvolutionAgent {
  readonly #profile: EvolutionNodeProfile;
  readonly #budget: EvolutionBudgetGate;

  public constructor(profile: EvolutionNodeProfile) {
    this.#profile = { ...profile };
    this.#budget = new EvolutionBudgetGate(profile.budget);
  }

  public profile(): EvolutionNodeProfile {
    return { ...this.#profile };
  }

  public offer(problem: EvolutionProblem): EvolutionContributionOffer | undefined {
    if (!this.#profile.optIn) return undefined;
    const remaining = this.#budget.remaining();
    if (remaining.aiTokens <= 0 && remaining.cpuMs <= 0) return undefined;
    const capability = capabilityScore(problem, this.#profile);
    const roles: EvolutionRole[] = capability >= 0.5
      ? ['reproducer', 'analyst', 'critic', 'benchmark']
      : ['observer', 'reproducer', 'benchmark'];
    if (this.#profile.modelTier === 'medium' || this.#profile.modelTier === 'frontier') roles.push('builder');
    return {
      id: randomUUID(),
      nodeId: this.#profile.nodeId,
      problemId: problem.id,
      preferredRoles: roles,
      maxAiTokens: Math.min(250, remaining.aiTokens),
      maxCpuMs: Math.min(15_000, remaining.cpuMs),
      modelTier: this.#profile.modelTier,
      capabilities: [...this.#profile.capabilities],
    };
  }

  public reserve(spend: EvolutionSpend): EvolutionUsage {
    return this.#budget.spend(spend);
  }

  public remaining(): EvolutionUsage {
    return this.#budget.remaining();
  }
}

export class EvolutionCellCoordinator {
  public formCell(
    problem: EvolutionProblem,
    nodes: readonly EvolutionNodeProfile[],
    policy: CellPolicy = {},
  ): EvolutionCell {
    const contributorCount = Math.max(2, Math.floor(policy.contributorCount ?? 6));
    const judgeCount = Math.max(3, Math.floor(policy.judgeCount ?? 5));
    const maxTokens = Math.max(0, Math.floor(policy.maxTokensPerContributor ?? 200));
    const maxCpuMs = Math.max(0, Math.floor(policy.maxCpuMsPerContributor ?? 10_000));
    const ttlMs = Math.max(60_000, Math.floor(policy.ttlMs ?? 30 * 60_000));

    const eligible = nodes.filter((node) => node.optIn && (node.budget.maxAiTokens > 0 || node.budget.maxCpuMs > 0));
    if (eligible.length < contributorCount + judgeCount) {
      throw new Error('Not enough independent PHOENIX nodes to form contributors and judges');
    }

    const contributorCandidates = [...eligible].sort((a, b) => {
      const scoreA = capabilityScore(problem, a) * 4 + a.contributionReliability * 2 + modelTierScore(a.modelTier);
      const scoreB = capabilityScore(problem, b) * 4 + b.contributionReliability * 2 + modelTierScore(b.modelTier);
      return scoreB - scoreA || a.nodeId.localeCompare(b.nodeId);
    });

    const roleCycle: EvolutionRole[] = ['reproducer', 'analyst', 'builder', 'critic', 'benchmark', 'observer'];
    const contributors: CellAssignment[] = contributorCandidates.slice(0, contributorCount).map((node, index) => ({
      nodeId: node.nodeId,
      role: roleCycle[index % roleCycle.length] ?? 'observer',
      aiTokenBudget: Math.min(maxTokens, node.budget.maxAiTokens),
      cpuMsBudget: Math.min(maxCpuMs, node.budget.maxCpuMs),
    }));
    const contributorIds = new Set(contributors.map((item) => item.nodeId));

    const judgeCandidates = eligible
      .filter((node) => !contributorIds.has(node.nodeId))
      .sort((a, b) => {
        const scoreA = a.judgeReliability * 5 + modelTierScore(a.modelTier) + capabilityScore(problem, a);
        const scoreB = b.judgeReliability * 5 + modelTierScore(b.modelTier) + capabilityScore(problem, b);
        return scoreB - scoreA || a.nodeId.localeCompare(b.nodeId);
      });
    const judges = judgeCandidates.slice(0, judgeCount).map((node) => ({
      nodeId: node.nodeId,
      weight: bounded(0.5 + node.judgeReliability / 2, 0.5, 1),
    }));
    if (judges.length < judgeCount) throw new Error('Insufficient independent judge nodes');

    const createdAt = new Date();
    return {
      id: randomUUID(),
      problem,
      contributors,
      judges,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
    };
  }
}

export class EvolutionMicroTaskBroker {
  public tasks(cell: EvolutionCell): readonly EvolutionMicroTask[] {
    return cell.contributors.map((assignment) => ({
      id: randomUUID(),
      problemId: cell.problem.id,
      role: assignment.role,
      objective: this.#objective(cell.problem, assignment.role),
      preferredCapabilities: [...cell.problem.requiredCapabilities],
      maxAiTokens: assignment.aiTokenBudget,
      maxCpuMs: assignment.cpuMsBudget,
    }));
  }

  #objective(problem: EvolutionProblem, role: EvolutionRole): string {
    if (role === 'reproducer') return `Reproduce ${problem.title} with the smallest deterministic case and report evidence.`;
    if (role === 'analyst') return `Analyze root causes for ${problem.title}; prefer falsifiable hypotheses.`;
    if (role === 'builder') return `Propose the smallest reversible challenger for ${problem.title}.`;
    if (role === 'critic') return `Try to break or disprove the current challenger for ${problem.title}.`;
    if (role === 'benchmark') return `Measure quality, success, latency and fresh-token impact for ${problem.title}.`;
    return `Observe ${problem.title} and contribute compact anonymized evidence only.`;
  }
}

export class ContributionLedger {
  readonly #items = new Map<string, ContributionEvidence>();
  readonly #fingerprints = new Set<string>();

  public add(evidence: ContributionEvidence): boolean {
    const fingerprint = hash({
      problemId: evidence.problemId,
      role: evidence.role,
      summary: evidence.summary,
      artifactHash: evidence.artifactHash ?? null,
      metrics: evidence.metrics,
    });
    if (this.#fingerprints.has(fingerprint)) return false;
    this.#fingerprints.add(fingerprint);
    this.#items.set(evidence.contributionId, evidence);
    return true;
  }

  public forProblem(problemId: string): readonly ContributionEvidence[] {
    return [...this.#items.values()].filter((item) => item.problemId === problemId);
  }
}

export class EvolutionJudgePanel {
  public decide(
    cell: EvolutionCell,
    candidate: CandidateImprovement,
    verdicts: readonly JudgeVerdict[],
    policy: JudgePolicy = {},
  ): JudgeDecision {
    const minimumJudges = Math.max(3, Math.floor(policy.minimumJudges ?? 3));
    const requiredRatio = bounded(policy.approvalRatio ?? 0.67, 0.5, 1);
    const minimumConfidence = bounded(policy.minimumConfidence ?? 0.6, 0, 1);
    const minimumRuns = Math.max(1, Math.floor(policy.minimumReproducibleRuns ?? 3));
    const requireSecurity = policy.requireSecurityReview ?? true;
    const requireTokenEconomy = policy.requireTokenEconomyReview ?? true;
    const reasons: string[] = [];

    if (candidate.problemId !== cell.problem.id) reasons.push('candidate_problem_mismatch');
    const contributorIds = new Set(cell.contributors.map((item) => item.nodeId));
    const allowedJudges = new Map(cell.judges.map((item) => [item.nodeId, item.weight] as const));
    const unique = new Map<string, JudgeVerdict>();
    for (const verdict of verdicts) {
      if (verdict.candidateId !== candidate.id || verdict.problemId !== cell.problem.id) continue;
      if (!allowedJudges.has(verdict.judgeNodeId)) continue;
      if (contributorIds.has(verdict.judgeNodeId)) continue;
      if (!unique.has(verdict.judgeNodeId)) unique.set(verdict.judgeNodeId, verdict);
    }
    const independent = [...unique.values()];
    if (independent.length < minimumJudges) reasons.push('judge_quorum_not_met');
    if (!candidate.metrics.securityPassed) reasons.push('candidate_security_gate_failed');
    if (candidate.metrics.regressionCount > 0) reasons.push('candidate_has_regressions');
    if (candidate.metrics.reproducibleRuns < minimumRuns) reasons.push('candidate_not_reproduced_enough');
    if (candidate.metrics.successRateDelta < 0) reasons.push('success_rate_regressed');
    if (candidate.metrics.qualityDelta < -0.01) reasons.push('quality_regressed');
    if (candidate.metrics.freshTokensDeltaPct > 0) reasons.push('fresh_token_use_increased');

    let approveWeight = 0;
    let rejectWeight = 0;
    let securityReviews = 0;
    let tokenReviews = 0;
    for (const verdict of independent) {
      const weight = allowedJudges.get(verdict.judgeNodeId) ?? 0;
      const confidenceWeight = weight * bounded(verdict.confidence, 0, 1);
      if (verdict.vote === 'approve' && verdict.confidence >= minimumConfidence) approveWeight += confidenceWeight;
      if (verdict.vote === 'reject') rejectWeight += confidenceWeight;
      if (verdict.checks.securityReviewed) securityReviews += 1;
      if (verdict.checks.tokenEconomyReviewed) tokenReviews += 1;
      if (!verdict.checks.reproduced || !verdict.checks.testsPassed) rejectWeight += weight * 0.5;
    }
    if (requireSecurity && securityReviews < Math.min(minimumJudges, independent.length)) reasons.push('independent_security_review_missing');
    if (requireTokenEconomy && tokenReviews < Math.min(minimumJudges, independent.length)) reasons.push('independent_token_review_missing');

    const denominator = approveWeight + rejectWeight;
    const approvalRatio = denominator > 0 ? approveWeight / denominator : 0;
    if (approvalRatio < requiredRatio) reasons.push('judge_approval_ratio_not_met');

    const hardFailure = reasons.some((reason) => reason !== 'judge_quorum_not_met' && reason !== 'candidate_not_reproduced_enough');
    const insufficient = independent.length < minimumJudges || candidate.metrics.reproducibleRuns < minimumRuns;
    const status: JudgeDecision['status'] = hardFailure ? 'rejected' : insufficient ? 'insufficient_evidence' : 'approved';
    return {
      candidateId: candidate.id,
      status,
      eligibleForPullRequest: status === 'approved',
      approvalRatio,
      independentJudges: independent.length,
      reasons,
      requiresProtectedBranchGate: true,
    };
  }
}

export function createEvolutionProblem(input: Omit<EvolutionProblem, 'id' | 'fingerprint' | 'createdAt'>): EvolutionProblem {
  const fingerprint = hash({
    kind: input.kind,
    title: input.title.trim().toLowerCase(),
    description: input.description.trim().toLowerCase(),
    requiredCapabilities: [...input.requiredCapabilities].sort(),
  });
  return {
    ...input,
    id: `phx-${fingerprint.slice(0, 16)}`,
    fingerprint,
    createdAt: new Date().toISOString(),
  };
}

export function createEvolutionCapsule(
  problem: EvolutionProblem,
  phoenixVersion: string,
  summary: string,
  evidence: Readonly<Record<string, number | string | boolean>>,
  options: { sourceCodeIncluded?: boolean } = {},
): EvolutionCapsule {
  return {
    id: randomUUID(),
    problemId: problem.id,
    fingerprint: problem.fingerprint,
    phoenixVersion,
    category: problem.kind,
    summary: summary.slice(0, 2_000),
    evidence,
    privacy: {
      rawPromptIncluded: false,
      sourceCodeIncluded: options.sourceCodeIncluded === true,
      secretsIncluded: false,
    },
    createdAt: new Date().toISOString(),
  };
}
