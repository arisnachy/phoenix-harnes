import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { estimateTokens } from './tokenEconomy.js';

export interface ExperienceReceipt {
  id?: string;
  pattern: string;
  goal: string;
  success: boolean;
  steps: readonly string[];
  verification?: readonly string[];
  providerId?: string;
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  tags?: readonly string[];
}

export interface CompiledSkill {
  id: string;
  pattern: string;
  triggerTerms: readonly string[];
  recipe: readonly string[];
  verification: readonly string[];
  evidence: {
    samples: number;
    successes: number;
    successRate: number;
    averageInputTokens?: number;
    averageOutputTokens?: number;
  };
  sourceReceiptIds: readonly string[];
  createdAt: string;
}

export interface SkillSearchResult {
  skill: CompiledSkill;
  score: number;
}

function normalizeTerms(value: string): string[] {
  return [...new Set(value
    .toLowerCase()
    .split(/[^a-z0-9_.$/-]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3))];
}

function stableId(pattern: string): string {
  return `skill:${createHash('sha256').update(pattern.trim().toLowerCase()).digest('hex').slice(0, 16)}`;
}

function average(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function commonOrderedSteps(receipts: readonly ExperienceReceipt[]): string[] {
  const successful = receipts.filter((item) => item.success);
  if (!successful.length) return [];
  const frequency = new Map<string, number>();
  for (const receipt of successful) {
    for (const step of new Set(receipt.steps.map((item) => item.trim()).filter(Boolean))) {
      frequency.set(step, (frequency.get(step) ?? 0) + 1);
    }
  }
  const threshold = Math.max(1, Math.ceil(successful.length * 0.6));
  const first = successful[0]?.steps ?? [];
  const ordered = first.filter((step) => (frequency.get(step.trim()) ?? 0) >= threshold);
  if (ordered.length) return ordered;
  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([step]) => step);
}

export class ExperienceCompiler {
  readonly #receipts: ExperienceReceipt[] = [];

  public observe(receipt: ExperienceReceipt): string {
    const id = receipt.id ?? randomUUID();
    this.#receipts.push({ ...receipt, id });
    return id;
  }

  public receipts(): readonly ExperienceReceipt[] {
    return this.#receipts.map((item) => ({ ...item }));
  }

  public compile(pattern: string, options: { minimumSamples?: number; minimumSuccessRate?: number } = {}): CompiledSkill | undefined {
    const matches = this.#receipts.filter((item) => item.pattern === pattern);
    const minimumSamples = Math.max(1, options.minimumSamples ?? 2);
    if (matches.length < minimumSamples) return undefined;
    const successful = matches.filter((item) => item.success);
    const successRate = successful.length / matches.length;
    if (successRate < (options.minimumSuccessRate ?? 0.8)) return undefined;

    const goals = successful.map((item) => item.goal).join(' ');
    const verification = [...new Set(successful.flatMap((item) => item.verification ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 8);
    const recipe = commonOrderedSteps(matches).slice(0, 10);
    if (!recipe.length) return undefined;
    const input = successful.flatMap((item) => typeof item.inputTokens === 'number' ? [item.inputTokens] : []);
    const output = successful.flatMap((item) => typeof item.outputTokens === 'number' ? [item.outputTokens] : []);
    const avgInput = average(input);
    const avgOutput = average(output);

    return {
      id: stableId(pattern),
      pattern,
      triggerTerms: normalizeTerms(`${pattern} ${goals}`).slice(0, 24),
      recipe,
      verification,
      evidence: {
        samples: matches.length,
        successes: successful.length,
        successRate,
        ...(avgInput !== undefined ? { averageInputTokens: avgInput } : {}),
        ...(avgOutput !== undefined ? { averageOutputTokens: avgOutput } : {}),
      },
      sourceReceiptIds: matches.map((item) => item.id ?? '').filter(Boolean),
      createdAt: new Date().toISOString(),
    };
  }

  public compileReady(options: { minimumSamples?: number; minimumSuccessRate?: number } = {}): CompiledSkill[] {
    const patterns = [...new Set(this.#receipts.map((item) => item.pattern))];
    return patterns.flatMap((pattern) => {
      const skill = this.compile(pattern, options);
      return skill ? [skill] : [];
    });
  }
}

export class SkillLibrary {
  public constructor(public readonly path = '.phoenix/skills.jsonl') {}

  public async save(skill: CompiledSkill): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(skill)}\n`, 'utf8');
  }

  public async all(): Promise<CompiledSkill[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return [];
      throw error;
    }
    const latest = new Map<string, CompiledSkill>();
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const skill = JSON.parse(line) as CompiledSkill;
        if (skill?.id && Array.isArray(skill.recipe)) latest.set(skill.id, skill);
      } catch {
        // Ignore a partial trailing line; append-only stores can recover on the next valid record.
      }
    }
    return [...latest.values()];
  }

  public async search(query: string, limit = 4): Promise<SkillSearchResult[]> {
    const queryTerms = new Set(normalizeTerms(query));
    const skills = await this.all();
    const scored = skills.map((skill) => {
      let matches = 0;
      for (const term of skill.triggerTerms) if (queryTerms.has(term)) matches += 1;
      const score = queryTerms.size ? matches / queryTerms.size : 0;
      return { skill, score };
    });
    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.skill.evidence.successRate - a.skill.evidence.successRate)
      .slice(0, Math.max(1, limit));
  }

  public async compactContext(query: string, tokenBudget = 500): Promise<string> {
    const results = await this.search(query, 6);
    const parts: string[] = [];
    let used = 0;
    for (const { skill } of results) {
      const text = [
        `Skill ${skill.id} (${Math.round(skill.evidence.successRate * 100)}% over ${skill.evidence.samples} samples):`,
        ...skill.recipe.map((step, index) => `${index + 1}. ${step}`),
        ...(skill.verification.length ? [`Verify: ${skill.verification.join('; ')}`] : []),
      ].join('\n');
      const tokens = estimateTokens(text);
      if (used + tokens > tokenBudget) continue;
      parts.push(text);
      used += tokens;
    }
    return parts.join('\n\n');
  }
}
