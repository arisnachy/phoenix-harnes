import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export type GenomeMemoryState = 'active' | 'stale' | 'disputed' | 'retired';
export type GenomeMemoryKind = 'fact' | 'preference' | 'strategy' | 'failure' | 'procedure';

export interface GenomeMemoryRecord {
  id: string;
  namespace: string;
  kind: GenomeMemoryKind;
  content: string;
  confidence: number;
  state: GenomeMemoryState;
  source: string;
  createdAt: string;
  lastVerifiedAt: string;
  expiresAt?: string;
  tags: readonly string[];
  supersedes?: string;
}

export interface GenomeMemoryInput {
  namespace?: string;
  kind: GenomeMemoryKind;
  content: string;
  confidence?: number;
  source: string;
  ttlMs?: number;
  tags?: readonly string[];
  supersedes?: string;
}

export interface GenomeSearchOptions {
  namespace?: string;
  kinds?: readonly GenomeMemoryKind[];
  minimumConfidence?: number;
  includeStale?: boolean;
  limit?: number;
  now?: Date;
}

function terms(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((item) => item.length > 1));
}

function lexicalScore(query: string, record: GenomeMemoryRecord): number {
  const wanted = terms(query);
  if (!wanted.size) return 0;
  const haystack = terms(`${record.content} ${record.tags.join(' ')} ${record.kind}`);
  let hits = 0;
  for (const term of wanted) if (haystack.has(term)) hits += 1;
  return hits / wanted.size;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export class MemoryGenome {
  public constructor(private readonly path = '.phoenix/memory-genome.jsonl') {}

  public async remember(input: GenomeMemoryInput, now = new Date()): Promise<GenomeMemoryRecord> {
    const record: GenomeMemoryRecord = {
      id: randomUUID(),
      namespace: input.namespace ?? 'default',
      kind: input.kind,
      content: input.content,
      confidence: clamp01(input.confidence ?? 0.8),
      state: 'active',
      source: input.source,
      createdAt: now.toISOString(),
      lastVerifiedAt: now.toISOString(),
      ...(input.ttlMs !== undefined ? { expiresAt: new Date(now.getTime() + Math.max(0, input.ttlMs)).toISOString() } : {}),
      tags: [...(input.tags ?? [])],
      ...(input.supersedes ? { supersedes: input.supersedes } : {}),
    };
    await this.#append(record);
    return record;
  }

  public async transition(id: string, state: GenomeMemoryState, confidence?: number, now = new Date()): Promise<GenomeMemoryRecord> {
    const current = (await this.current()).find((item) => item.id === id);
    if (!current) throw new Error(`Unknown memory genome record: ${id}`);
    const next: GenomeMemoryRecord = {
      ...current,
      state,
      ...(confidence !== undefined ? { confidence: clamp01(confidence) } : {}),
      lastVerifiedAt: now.toISOString(),
    };
    await this.#append(next);
    return next;
  }

  public async verify(id: string, confidence: number, now = new Date()): Promise<GenomeMemoryRecord> {
    return this.transition(id, 'active', confidence, now);
  }

  public async allEvents(): Promise<readonly GenomeMemoryRecord[]> {
    let text: string;
    try { text = await readFile(this.path, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const records: GenomeMemoryRecord[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line) as GenomeMemoryRecord); } catch { /* tolerate malformed tail */ }
    }
    return records;
  }

  public async current(now = new Date()): Promise<readonly GenomeMemoryRecord[]> {
    const latest = new Map<string, GenomeMemoryRecord>();
    for (const record of await this.allEvents()) latest.set(record.id, record);
    const superseded = new Set([...latest.values()].map((item) => item.supersedes).filter((item): item is string => Boolean(item)));
    return [...latest.values()].map((record) => {
      if (superseded.has(record.id) && record.state === 'active') return { ...record, state: 'retired' as const };
      if (record.state === 'active' && record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime()) {
        return { ...record, state: 'stale' as const };
      }
      return record;
    });
  }

  public async search(query: string, options: GenomeSearchOptions = {}): Promise<readonly GenomeMemoryRecord[]> {
    const now = options.now ?? new Date();
    const allowedKinds = options.kinds ? new Set(options.kinds) : undefined;
    const minimumConfidence = clamp01(options.minimumConfidence ?? 0.35);
    const stateAllowed = (state: GenomeMemoryState): boolean => state === 'active' || (options.includeStale === true && state === 'stale');
    return (await this.current(now))
      .filter((record) => (!options.namespace || record.namespace === options.namespace))
      .filter((record) => (!allowedKinds || allowedKinds.has(record.kind)))
      .filter((record) => stateAllowed(record.state) && record.confidence >= minimumConfidence)
      .map((record) => {
        const lexical = lexicalScore(query, record);
        const ageDays = Math.max(0, (now.getTime() - new Date(record.lastVerifiedAt).getTime()) / 86_400_000);
        const freshness = 1 / (1 + ageDays / 30);
        const score = lexical * 0.65 + record.confidence * 0.25 + freshness * 0.10;
        return { record, score };
      })
      .filter((item) => item.score > 0.15)
      .sort((a, b) => b.score - a.score || b.record.lastVerifiedAt.localeCompare(a.record.lastVerifiedAt))
      .slice(0, Math.max(1, options.limit ?? 8))
      .map((item) => item.record);
  }

  public async disputeConflicts(namespace = 'default'): Promise<readonly string[]> {
    const records = (await this.current()).filter((item) => item.namespace === namespace && item.state === 'active' && item.kind === 'fact');
    const disputed: string[] = [];
    for (let i = 0; i < records.length; i += 1) {
      for (let j = i + 1; j < records.length; j += 1) {
        const a = records[i];
        const b = records[j];
        if (!a || !b) continue;
        const overlap = lexicalScore(a.content, b);
        if (overlap < 0.5) continue;
        const negated = /\b(no|not|never|false|disabled|without)\b/i.test(a.content) !== /\b(no|not|never|false|disabled|without)\b/i.test(b.content);
        if (!negated) continue;
        await this.transition(a.id, 'disputed');
        await this.transition(b.id, 'disputed');
        disputed.push(a.id, b.id);
      }
    }
    return [...new Set(disputed)];
  }

  async #append(record: GenomeMemoryRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(record)}\n`, 'utf8');
  }
}
