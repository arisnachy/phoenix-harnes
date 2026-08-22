export type ModelDimension =
  | 'planning'
  | 'orchestration'
  | 'reasoning'
  | 'coding'
  | 'debugging'
  | 'research'
  | 'toolUse'
  | 'critique'
  | 'judging'
  | 'security'
  | 'reliability'
  | 'efficiency';

export type ModelRankStatus = 'provisional' | 'qualified' | 'elite' | 'restricted';
export type EvolutionModelRole =
  | 'orchestrator'
  | 'judge'
  | 'builder'
  | 'analyst'
  | 'critic'
  | 'reproducer'
  | 'benchmark'
  | 'observer';

export interface ModelIdentity {
  providerId: string;
  modelId: string;
  displayName?: string;
  discoveredAt: string;
}

export interface ModelEvidence {
  id: string;
  providerId: string;
  modelId: string;
  dimension: ModelDimension;
  score: number;
  successRate: number;
  reproducibility: number;
  samples: number;
  freshTokens?: number;
  latencyMs?: number;
  observedAt: string;
  source: 'benchmark' | 'live' | 'collective';
}

export interface DimensionScore {
  score: number;
  confidence: number;
  samples: number;
  lastObservedAt?: string;
}

export interface ModelRankProfile {
  identity: ModelIdentity;
  status: ModelRankStatus;
  dimensions: Readonly<Record<ModelDimension, DimensionScore>>;
  overall: number;
  overallConfidence: number;
  eligibleRoles: readonly EvolutionModelRole[];
}

export interface RoleRequirement {
  role: EvolutionModelRole;
  weights: Partial<Record<ModelDimension, number>>;
  hardMinimums?: Partial<Record<ModelDimension, number>>;
  minimumComposite: number;
  minimumConfidence: number;
  minimumSamples: number;
  commandRole: boolean;
}

export interface RankedModel {
  providerId: string;
  modelId: string;
  role: EvolutionModelRole;
  composite: number;
  confidence: number;
  eligible: boolean;
  reasons: readonly string[];
}

export interface RoleAssignment {
  role: EvolutionModelRole;
  model?: RankedModel;
  status: 'assigned' | 'unfilled';
  reason?: string;
}

export interface BenchmarkTask {
  dimension: ModelDimension;
  minimumSamples: number;
  authorityCritical: boolean;
}

const DIMENSIONS: readonly ModelDimension[] = [
  'planning', 'orchestration', 'reasoning', 'coding', 'debugging', 'research',
  'toolUse', 'critique', 'judging', 'security', 'reliability', 'efficiency',
];

const ROLE_REQUIREMENTS: Readonly<Record<EvolutionModelRole, RoleRequirement>> = {
  orchestrator: {
    role: 'orchestrator',
    weights: { orchestration: 0.30, planning: 0.24, reasoning: 0.18, reliability: 0.12, critique: 0.08, efficiency: 0.08 },
    hardMinimums: { orchestration: 82, planning: 78, reasoning: 76, reliability: 78 },
    minimumComposite: 82,
    minimumConfidence: 0.78,
    minimumSamples: 24,
    commandRole: true,
  },
  judge: {
    role: 'judge',
    weights: { judging: 0.30, critique: 0.24, reasoning: 0.18, reliability: 0.14, security: 0.08, research: 0.06 },
    hardMinimums: { judging: 80, critique: 78, reasoning: 76, reliability: 80 },
    minimumComposite: 81,
    minimumConfidence: 0.80,
    minimumSamples: 24,
    commandRole: true,
  },
  builder: {
    role: 'builder',
    weights: { coding: 0.35, debugging: 0.22, toolUse: 0.16, reasoning: 0.12, reliability: 0.10, efficiency: 0.05 },
    hardMinimums: { coding: 72, debugging: 68 },
    minimumComposite: 72,
    minimumConfidence: 0.60,
    minimumSamples: 12,
    commandRole: false,
  },
  analyst: {
    role: 'analyst',
    weights: { reasoning: 0.30, research: 0.25, planning: 0.16, critique: 0.12, reliability: 0.10, efficiency: 0.07 },
    minimumComposite: 70,
    minimumConfidence: 0.58,
    minimumSamples: 10,
    commandRole: false,
  },
  critic: {
    role: 'critic',
    weights: { critique: 0.35, reasoning: 0.23, security: 0.14, debugging: 0.10, reliability: 0.10, research: 0.08 },
    hardMinimums: { critique: 72 },
    minimumComposite: 72,
    minimumConfidence: 0.62,
    minimumSamples: 12,
    commandRole: false,
  },
  reproducer: {
    role: 'reproducer',
    weights: { debugging: 0.28, toolUse: 0.24, reliability: 0.22, coding: 0.12, reasoning: 0.08, efficiency: 0.06 },
    minimumComposite: 62,
    minimumConfidence: 0.45,
    minimumSamples: 6,
    commandRole: false,
  },
  benchmark: {
    role: 'benchmark',
    weights: { reliability: 0.32, efficiency: 0.28, reasoning: 0.14, toolUse: 0.12, critique: 0.08, research: 0.06 },
    minimumComposite: 64,
    minimumConfidence: 0.50,
    minimumSamples: 8,
    commandRole: false,
  },
  observer: {
    role: 'observer',
    weights: { reliability: 0.45, efficiency: 0.25, research: 0.15, toolUse: 0.15 },
    minimumComposite: 45,
    minimumConfidence: 0.20,
    minimumSamples: 2,
    commandRole: false,
  },
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function key(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

function emptyDimension(): DimensionScore {
  return { score: 0, confidence: 0, samples: 0 };
}

function emptyDimensions(): Record<ModelDimension, DimensionScore> {
  return Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, emptyDimension()])) as Record<ModelDimension, DimensionScore>;
}

function recencyWeight(observedAt: string, now: number): number {
  const ageDays = Math.max(0, (now - Date.parse(observedAt)) / 86_400_000);
  return Math.max(0.35, Math.exp(-ageDays / 120));
}

function evidenceQuality(item: ModelEvidence): number {
  const sourceWeight = item.source === 'collective' ? 1 : item.source === 'benchmark' ? 0.95 : 0.82;
  return sourceWeight * clamp(item.successRate, 0, 1) * clamp(item.reproducibility, 0, 1);
}

export class ModelCapabilityRanking {
  readonly #models = new Map<string, ModelIdentity>();
  readonly #evidence = new Map<string, ModelEvidence[]>();

  public register(identity: ModelIdentity): void {
    const modelKey = key(identity.providerId, identity.modelId);
    if (!this.#models.has(modelKey)) this.#models.set(modelKey, { ...identity });
  }

  public registerDiscovered(providerId: string, modelId: string, displayName?: string): ModelRankProfile {
    this.register({ providerId, modelId, ...(displayName ? { displayName } : {}), discoveredAt: new Date().toISOString() });
    return this.profile(providerId, modelId)!;
  }

  public observe(item: ModelEvidence): void {
    this.register({ providerId: item.providerId, modelId: item.modelId, discoveredAt: item.observedAt });
    const modelKey = key(item.providerId, item.modelId);
    const list = this.#evidence.get(modelKey) ?? [];
    if (list.some((entry) => entry.id === item.id)) return;
    list.push({
      ...item,
      score: clamp(item.score),
      successRate: clamp(item.successRate, 0, 1),
      reproducibility: clamp(item.reproducibility, 0, 1),
      samples: Math.max(1, Math.floor(item.samples)),
    });
    this.#evidence.set(modelKey, list);
  }

  public profile(providerId: string, modelId: string, now = Date.now()): ModelRankProfile | undefined {
    const identity = this.#models.get(key(providerId, modelId));
    if (!identity) return undefined;
    const evidence = this.#evidence.get(key(providerId, modelId)) ?? [];
    const dimensions = emptyDimensions();

    for (const dimension of DIMENSIONS) {
      const rows = evidence.filter((item) => item.dimension === dimension);
      let weighted = 0;
      let weightTotal = 0;
      let samples = 0;
      let newest: string | undefined;
      for (const row of rows) {
        const weight = row.samples * evidenceQuality(row) * recencyWeight(row.observedAt, now);
        weighted += row.score * weight;
        weightTotal += weight;
        samples += row.samples;
        if (!newest || Date.parse(row.observedAt) > Date.parse(newest)) newest = row.observedAt;
      }
      const score = weightTotal > 0 ? weighted / weightTotal : 0;
      const confidence = weightTotal > 0 ? Math.min(0.99, (1 - Math.exp(-samples / 18)) * Math.min(1, weightTotal / Math.max(1, samples))) : 0;
      dimensions[dimension] = {
        score: Number(score.toFixed(2)),
        confidence: Number(confidence.toFixed(3)),
        samples,
        ...(newest ? { lastObservedAt: newest } : {}),
      };
    }

    const meaningful = DIMENSIONS.map((dimension) => dimensions[dimension]).filter((item) => item.samples > 0);
    const overall = meaningful.length ? meaningful.reduce((sum, item) => sum + item.score, 0) / meaningful.length : 0;
    const overallConfidence = meaningful.length ? meaningful.reduce((sum, item) => sum + item.confidence, 0) / meaningful.length : 0;
    const eligibleRoles = (Object.keys(ROLE_REQUIREMENTS) as EvolutionModelRole[])
      .filter((role) => this.evaluateRoleFromDimensions(dimensions, role).eligible);
    const commandEligible = eligibleRoles.includes('orchestrator') || eligibleRoles.includes('judge');
    const totalSamples = meaningful.reduce((sum, item) => sum + item.samples, 0);
    let status: ModelRankStatus = 'provisional';
    if (totalSamples >= 12 && eligibleRoles.length > 0) status = 'qualified';
    if (commandEligible && overallConfidence >= 0.80) status = 'elite';

    return {
      identity: { ...identity },
      status,
      dimensions,
      overall: Number(overall.toFixed(2)),
      overallConfidence: Number(overallConfidence.toFixed(3)),
      eligibleRoles,
    };
  }

  public evaluateRole(providerId: string, modelId: string, role: EvolutionModelRole): RankedModel | undefined {
    const profile = this.profile(providerId, modelId);
    if (!profile) return undefined;
    return this.evaluateRoleFromDimensions(profile.dimensions, role, providerId, modelId);
  }

  public rank(role: EvolutionModelRole): readonly RankedModel[] {
    return [...this.#models.values()]
      .map((identity) => this.evaluateRole(identity.providerId, identity.modelId, role))
      .filter((item): item is RankedModel => Boolean(item))
      .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.composite - a.composite || b.confidence - a.confidence);
  }

  public assign(roles: readonly EvolutionModelRole[]): readonly RoleAssignment[] {
    const usedCommandModels = new Set<string>();
    return roles.map((role) => {
      const requirement = ROLE_REQUIREMENTS[role];
      const ranked = this.rank(role).filter((candidate) => {
        if (!candidate.eligible) return false;
        if (!requirement.commandRole) return true;
        return !usedCommandModels.has(key(candidate.providerId, candidate.modelId));
      });
      const selected = ranked[0];
      if (!selected) {
        return {
          role,
          status: 'unfilled' as const,
          reason: requirement.commandRole
            ? 'No model meets PHOENIX command authority gates; do not downgrade the role.'
            : 'No model currently meets the role capability gate.',
        };
      }
      if (requirement.commandRole) usedCommandModels.add(key(selected.providerId, selected.modelId));
      return { role, model: selected, status: 'assigned' as const };
    });
  }

  public onboardingPlan(providerId: string, modelId: string): readonly BenchmarkTask[] {
    const profile = this.profile(providerId, modelId);
    if (!profile) throw new Error('Model must be registered before onboarding');
    const critical: ModelDimension[] = ['planning', 'orchestration', 'reasoning', 'judging', 'critique', 'reliability'];
    return DIMENSIONS.map((dimension) => ({
      dimension,
      minimumSamples: critical.includes(dimension) ? 8 : 4,
      authorityCritical: critical.includes(dimension),
    }));
  }

  private evaluateRoleFromDimensions(
    dimensions: Readonly<Record<ModelDimension, DimensionScore>>,
    role: EvolutionModelRole,
    providerId = 'unregistered',
    modelId = 'unregistered',
  ): RankedModel {
    const requirement = ROLE_REQUIREMENTS[role];
    const reasons: string[] = [];
    let weightedScore = 0;
    let weightTotal = 0;
    let confidenceWeighted = 0;
    let totalSamples = 0;

    for (const [dimension, weight] of Object.entries(requirement.weights) as [ModelDimension, number][]) {
      const item = dimensions[dimension];
      weightedScore += item.score * weight;
      confidenceWeighted += item.confidence * weight;
      weightTotal += weight;
      totalSamples += item.samples;
    }
    const composite = weightTotal > 0 ? weightedScore / weightTotal : 0;
    const confidence = weightTotal > 0 ? confidenceWeighted / weightTotal : 0;

    for (const [dimension, minimum] of Object.entries(requirement.hardMinimums ?? {}) as [ModelDimension, number][]) {
      if (dimensions[dimension].score < minimum) reasons.push(`${dimension}<${minimum}`);
    }
    if (composite < requirement.minimumComposite) reasons.push(`composite<${requirement.minimumComposite}`);
    if (confidence < requirement.minimumConfidence) reasons.push(`confidence<${requirement.minimumConfidence}`);
    if (totalSamples < requirement.minimumSamples) reasons.push(`samples<${requirement.minimumSamples}`);

    return {
      providerId,
      modelId,
      role,
      composite: Number(composite.toFixed(2)),
      confidence: Number(confidence.toFixed(3)),
      eligible: reasons.length === 0,
      reasons,
    };
  }
}

export function roleRequirement(role: EvolutionModelRole): RoleRequirement {
  const requirement = ROLE_REQUIREMENTS[role];
  return {
    ...requirement,
    weights: { ...requirement.weights },
    ...(requirement.hardMinimums ? { hardMinimums: { ...requirement.hardMinimums } } : {}),
  };
}
