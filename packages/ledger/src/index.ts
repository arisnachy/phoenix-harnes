import { createHash, randomUUID } from 'node:crypto';

export interface LedgerEvent<T = unknown> {
  id: string;
  sequence: number;
  timestamp: string;
  type: string;
  payload: T;
  previousHash: string;
  hash: string;
}

function stable(value: unknown): string {
  if (value === undefined) return '"__phoenix_undefined__"';
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value) ?? JSON.stringify(String(value));
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
    .join(',')}}`;
}

function digest(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export class InMemoryLedger {
  readonly #events: LedgerEvent[] = [];

  public append<T>(type: string, payload: T): LedgerEvent<T> {
    const sequence = this.#events.length + 1;
    const previousHash = this.#events.at(-1)?.hash ?? 'GENESIS';
    const timestamp = new Date().toISOString();
    const id = randomUUID();
    const hash = digest(stable({ id, sequence, timestamp, type, payload, previousHash }));
    const event: LedgerEvent<T> = { id, sequence, timestamp, type, payload, previousHash, hash };
    this.#events.push(event as LedgerEvent);
    return event;
  }

  public all(): readonly LedgerEvent[] {
    return [...this.#events];
  }

  public verify(): boolean {
    let previousHash = 'GENESIS';
    for (const event of this.#events) {
      if (event.previousHash !== previousHash) return false;
      const expected = digest(stable({
        id: event.id,
        sequence: event.sequence,
        timestamp: event.timestamp,
        type: event.type,
        payload: event.payload,
        previousHash: event.previousHash,
      }));
      if (expected !== event.hash) return false;
      previousHash = event.hash;
    }
    return true;
  }
}
