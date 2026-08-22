import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export type MemoryKind = 'episodic' | 'semantic' | 'checkpoint';

export interface MemoryRecord {
  id: string;
  namespace: string;
  kind: MemoryKind;
  content: string;
  tags: readonly string[];
  metadata: Record<string, string>;
  createdAt: string;
}

export interface MemoryInput {
  namespace?: string;
  kind?: MemoryKind;
  content: string;
  tags?: readonly string[];
  metadata?: Record<string, string>;
}

export interface MemorySearchOptions {
  namespace?: string;
  kinds?: readonly MemoryKind[];
  limit?: number;
}

function terms(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((item) => item.length > 1));
}

function score(record: MemoryRecord, query: string): number {
  const wanted = terms(query);
  if (!wanted.size) return 0;
  const haystack = terms(`${record.content} ${record.tags.join(' ')} ${Object.values(record.metadata).join(' ')}`);
  let hits = 0;
  for (const term of wanted) if (haystack.has(term)) hits += 1;
  return hits / wanted.size;
}

export class LocalMemoryStore {
  public constructor(private readonly path = '.phoenix/memory.jsonl') {}

  public async remember(input: MemoryInput): Promise<MemoryRecord> {
    const record: MemoryRecord = {
      id: randomUUID(),
      namespace: input.namespace ?? 'default',
      kind: input.kind ?? 'episodic',
      content: input.content,
      tags: [...(input.tags ?? [])],
      metadata: { ...(input.metadata ?? {}) },
      createdAt: new Date().toISOString(),
    };
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }

  public async all(): Promise<readonly MemoryRecord[]> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const records: MemoryRecord[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as MemoryRecord);
      } catch {
        // Ignore a malformed tail record; append-only history before it remains usable.
      }
    }
    return records;
  }

  public async search(query: string, options: MemorySearchOptions = {}): Promise<readonly MemoryRecord[]> {
    const allowedKinds = options.kinds ? new Set(options.kinds) : undefined;
    const ranked = (await this.all())
      .filter((record) => !options.namespace || record.namespace === options.namespace)
      .filter((record) => !allowedKinds || allowedKinds.has(record.kind))
      .map((record) => ({ record, score: score(record, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.record.createdAt.localeCompare(a.record.createdAt));
    return ranked.slice(0, options.limit ?? 8).map((entry) => entry.record);
  }
}
