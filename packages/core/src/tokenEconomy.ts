import { createHash } from 'node:crypto';
import type { PhoenixRequest, PhoenixResponse, RoutingPreferences } from '@phoenix/contracts';

export type TaskComplexity = 'tiny' | 'routine' | 'complex' | 'critical';
export type EconomyLaneKind = 'local' | 'subscription' | 'free' | 'metered';

export interface ContextArtifact {
  id: string;
  kind: 'instruction' | 'memory' | 'file' | 'diff' | 'skill' | 'tool-output' | 'other';
  content: string;
  priority?: number;
  changed?: boolean;
  tags?: readonly string[];
}

export interface ContextCompilerOptions {
  budgetTokens: number;
  knownFingerprints?: ReadonlySet<string>;
  allowSessionDelta?: boolean;
  minimumArtifactTokens?: number;
}

export interface CompiledContextItem {
  id: string;
  fingerprint: string;
  estimatedTokens: number;
  score: number;
  clipped: boolean;
}

export interface CompiledContext {
  text: string;
  estimatedTokens: number;
  included: readonly CompiledContextItem[];
  reused: readonly { id: string; fingerprint: string }[];
  excluded: readonly { id: string; reason: string }[];
}

export interface EconomyLane {
  id: string;
  kind: EconomyLaneKind;
  providerId?: string;
  modelId?: string;
  maxComplexity?: TaskComplexity;
  estimatedQuality?: number;
}

export interface TokenPlan {
  complexity: TaskComplexity;
  inputBudget: number;
  outputBudget: number;
  maxEscalations: number;
  lanes: readonly EconomyLane[];
  reasons: readonly string[];
}

export interface TokenGovernorOptions {
  lanes: readonly EconomyLane[];
  tinyInputBudget?: number;
  routineInputBudget?: number;
  complexInputBudget?: number;
  criticalInputBudget?: number;
  outputBudget?: number;
  maxEscalations?: number;
}

export interface UsageSample {
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  avoidedInputTokens?: number;
  cacheHit?: boolean;
}

export interface EconomySnapshot {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  avoidedInputTokens: number;
  cacheHits: number;
}

const complexityRank: Record<TaskComplexity, number> = {
  tiny: 0,
  routine: 1,
  complex: 2,
  critical: 3,
};

function terms(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9_.$/-]+/i)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2),
  );
}

function overlap(query: Set<string>, value: string): number {
  if (!query.size) return 0;
  const candidate = terms(value);
  let matches = 0;
  for (const item of query) if (candidate.has(item)) matches += 1;
  return matches / query.size;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Provider-neutral planning estimate only. Actual provider usage remains authoritative.
  return Math.max(1, Math.ceil(text.length / 4));
}

export function fingerprintText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function clipToEstimatedTokens(text: string, budgetTokens: number): string {
  if (estimateTokens(text) <= budgetTokens) return text;
  const maxChars = Math.max(0, budgetTokens * 4);
  if (maxChars <= 16) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 15)}\n…[truncated]`;
}

export class ContextCompiler {
  public compile(query: string, artifacts: readonly ContextArtifact[], options: ContextCompilerOptions): CompiledContext {
    const queryTerms = terms(query);
    const known = options.knownFingerprints ?? new Set<string>();
    const allowDelta = options.allowSessionDelta ?? false;
    const minimum = Math.max(8, options.minimumArtifactTokens ?? 24);
    const reused: Array<{ id: string; fingerprint: string }> = [];
    const excluded: Array<{ id: string; reason: string }> = [];
    const candidates: Array<{
      artifact: ContextArtifact;
      fingerprint: string;
      score: number;
      tokens: number;
    }> = [];
    const seen = new Set<string>();

    for (const artifact of artifacts) {
      const fingerprint = fingerprintText(artifact.content);
      if (seen.has(fingerprint)) {
        excluded.push({ id: artifact.id, reason: 'duplicate_content' });
        continue;
      }
      seen.add(fingerprint);
      if (allowDelta && known.has(fingerprint) && !artifact.changed) {
        reused.push({ id: artifact.id, fingerprint });
        continue;
      }
      const relevance = overlap(queryTerms, `${artifact.id} ${artifact.tags?.join(' ') ?? ''} ${artifact.content}`);
      const priority = Math.max(0, Math.min(10, artifact.priority ?? 1));
      const changedBonus = artifact.changed ? 2 : 0;
      const kindBonus = artifact.kind === 'instruction' ? 4 : artifact.kind === 'diff' ? 3 : artifact.kind === 'skill' ? 2 : 0;
      const score = relevance * 20 + priority + changedBonus + kindBonus;
      candidates.push({ artifact, fingerprint, score, tokens: estimateTokens(artifact.content) });
    }

    candidates.sort((a, b) => b.score - a.score || a.tokens - b.tokens || a.artifact.id.localeCompare(b.artifact.id));

    const included: CompiledContextItem[] = [];
    const parts: string[] = [];
    let remaining = Math.max(0, options.budgetTokens);

    for (const candidate of candidates) {
      if (remaining < minimum) {
        excluded.push({ id: candidate.artifact.id, reason: 'budget_exhausted' });
        continue;
      }
      const header = `[${candidate.artifact.kind}:${candidate.artifact.id}]\n`;
      const headerTokens = estimateTokens(header);
      const bodyBudget = Math.max(0, remaining - headerTokens);
      if (bodyBudget < minimum) {
        excluded.push({ id: candidate.artifact.id, reason: 'budget_exhausted' });
        continue;
      }
      const body = clipToEstimatedTokens(candidate.artifact.content, bodyBudget);
      const rendered = `${header}${body}`;
      const used = estimateTokens(rendered);
      if (used <= 0 || used > remaining) {
        excluded.push({ id: candidate.artifact.id, reason: 'budget_exhausted' });
        continue;
      }
      const clipped = body !== candidate.artifact.content;
      included.push({
        id: candidate.artifact.id,
        fingerprint: candidate.fingerprint,
        estimatedTokens: used,
        score: candidate.score,
        clipped,
      });
      parts.push(rendered);
      remaining -= used;
    }

    return {
      text: parts.join('\n\n'),
      estimatedTokens: options.budgetTokens - remaining,
      included,
      reused,
      excluded,
    };
  }
}

export function classifyTask(request: PhoenixRequest): TaskComplexity {
  const text = request.messages.map((item) => item.content).join('\n');
  const lower = text.toLowerCase();
  let score = 0;
  if (text.length > 1_500) score += 1;
  if (text.length > 8_000) score += 1;
  if ((text.match(/```/g) ?? []).length >= 2) score += 1;
  if (request.tools?.length) score += 1;
  if (request.requirements?.reasoning) score += 1;
  if (request.requirements?.inputModalities?.some((item) => item !== 'text')) score += 1;
  if (/security|migration|architecture|production|critical|incident|refactor|multi[- ]?file/.test(lower)) score += 1;
  if (/delete|deploy|payment|credential|secret|database migration|production write/.test(lower)) score += 2;
  if (score <= 0) return 'tiny';
  if (score <= 2) return 'routine';
  if (score <= 4) return 'complex';
  return 'critical';
}

function laneSupports(lane: EconomyLane, complexity: TaskComplexity): boolean {
  return complexityRank[complexity] <= complexityRank[lane.maxComplexity ?? 'critical'];
}

export class TokenGovernor {
  public constructor(private readonly options: TokenGovernorOptions) {}

  public plan(request: PhoenixRequest): TokenPlan {
    const complexity = classifyTask(request);
    const budgetByComplexity: Record<TaskComplexity, number> = {
      tiny: this.options.tinyInputBudget ?? 800,
      routine: this.options.routineInputBudget ?? 2_500,
      complex: this.options.complexInputBudget ?? 8_000,
      critical: this.options.criticalInputBudget ?? 16_000,
    };
    const compatible = this.options.lanes.filter((lane) => laneSupports(lane, complexity));
    const order: Record<EconomyLaneKind, number> = {
      local: 0,
      free: 1,
      subscription: complexityRank[complexity] >= complexityRank.complex ? 0 : 2,
      metered: 3,
    };
    compatible.sort((a, b) => {
      const kind = order[a.kind] - order[b.kind];
      if (kind !== 0) return kind;
      return (b.estimatedQuality ?? 0) - (a.estimatedQuality ?? 0);
    });
    return {
      complexity,
      inputBudget: budgetByComplexity[complexity],
      outputBudget: this.options.outputBudget ?? 2_000,
      maxEscalations: Math.max(0, this.options.maxEscalations ?? 2),
      lanes: compatible,
      reasons: [
        `complexity:${complexity}`,
        `input_budget:${budgetByComplexity[complexity]}`,
        `lane_count:${compatible.length}`,
      ],
    };
  }

  public preferencesFor(plan: TokenPlan, base: RoutingPreferences = {}): RoutingPreferences {
    const first = plan.lanes[0];
    if (!first) return base;
    return {
      ...base,
      ...(first.providerId ? { preferredProviders: [first.providerId, ...(base.preferredProviders ?? []).filter((id) => id !== first.providerId)] } : {}),
      ...(first.modelId ? { preferredModels: [first.modelId, ...(base.preferredModels ?? []).filter((id) => id !== first.modelId)] } : {}),
      preferLocal: first.kind === 'local' ? true : base.preferLocal,
      preferSubscription: first.kind === 'subscription' ? true : base.preferSubscription,
      maxInputTokens: Math.min(base.maxInputTokens ?? plan.inputBudget, plan.inputBudget),
      maxOutputTokens: Math.min(base.maxOutputTokens ?? plan.outputBudget, plan.outputBudget),
    };
  }
}

interface CacheEntry {
  expiresAt: number;
  response: PhoenixResponse;
}

export class ExactResultCache {
  readonly #entries = new Map<string, CacheEntry>();

  public constructor(private readonly ttlMs = 30 * 60_000) {}

  public key(request: PhoenixRequest): string {
    const stable = JSON.stringify({
      messages: request.messages,
      tools: request.tools ?? [],
      requirements: request.requirements ?? {},
      preferences: request.preferences ?? {},
      cacheNamespace: request.metadata?.cacheNamespace ?? 'default',
    });
    return fingerprintText(stable);
  }

  public get(request: PhoenixRequest, now = Date.now()): PhoenixResponse | undefined {
    const key = this.key(request);
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.response;
  }

  public set(request: PhoenixRequest, response: PhoenixResponse, now = Date.now()): void {
    this.#entries.set(this.key(request), { expiresAt: now + this.ttlMs, response });
  }

  public clear(): void {
    this.#entries.clear();
  }
}

export class TokenUsageBook {
  readonly #samples: UsageSample[] = [];

  public record(sample: UsageSample): void {
    this.#samples.push({ ...sample });
  }

  public samples(): readonly UsageSample[] {
    return this.#samples.map((item) => ({ ...item }));
  }

  public snapshot(): EconomySnapshot {
    return this.#samples.reduce<EconomySnapshot>((acc, item) => ({
      calls: acc.calls + 1,
      inputTokens: acc.inputTokens + item.inputTokens,
      outputTokens: acc.outputTokens + item.outputTokens,
      cachedInputTokens: acc.cachedInputTokens + (item.cachedInputTokens ?? 0),
      avoidedInputTokens: acc.avoidedInputTokens + (item.avoidedInputTokens ?? 0),
      cacheHits: acc.cacheHits + (item.cacheHit ? 1 : 0),
    }), { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, avoidedInputTokens: 0, cacheHits: 0 });
  }
}

export function compileRequestContext(
  request: PhoenixRequest,
  query: string,
  artifacts: readonly ContextArtifact[],
  compiler: ContextCompiler,
  options: ContextCompilerOptions,
): { request: PhoenixRequest; context: CompiledContext } {
  const context = compiler.compile(query, artifacts, options);
  if (!context.text) return { request, context };
  return {
    context,
    request: {
      ...request,
      messages: [
        ...request.messages,
        { role: 'system', content: `PHOENIX compact context:\n${context.text}` },
      ],
      metadata: {
        ...(request.metadata ?? {}),
        phoenixContextTokens: String(context.estimatedTokens),
        phoenixContextArtifacts: String(context.included.length),
        phoenixContextReused: String(context.reused.length),
      },
    },
  };
}
