/**
 * Durable, user-controlled learning ledger. The file is append-only so a
 * later repair can explain when a memory was learned or forgotten.
 *
 * @module @phoenix-ai/dsh-session-learning/ledger
 */

import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Branded } from '@phoenix-ai/dsh-brand'

/** Nominal identifier owned by the learning ledger. */
export type MemoryId = Branded<'MemoryId'>

/** Categories of durable observations produced by Phoenix. */
export type MemoryKind = 'interaction' | 'error' | 'success' | 'lesson' | 'skill' | 'preference'

/** One active or forgotten durable learning record. */
export interface MemoryRecord {
  /** Stable identifier for this record. */
  readonly id: MemoryId
  /** Session that produced the observation. */
  readonly sessionId: string
  /** Sequence number of the source session event. */
  readonly eventSeq: number
  /** Classification used by search and later learning policies. */
  readonly kind: MemoryKind
  /** Human-readable bounded summary; never contains credentials by policy. */
  readonly summary: string
  /** Source event type for provenance. */
  readonly sourceEventType: string
  /** Confidence from 0 through 1. */
  readonly confidence: number
  /** Source event timestamp in Unix milliseconds. */
  readonly occurredAt: number
  /** Ledger insertion timestamp in Unix milliseconds. */
  readonly recordedAt: number
  /** Current lifecycle state. */
  readonly status: 'active' | 'forgotten'
}

/** Input needed to create one learning record. */
export type MemoryRecordInput = Omit<MemoryRecord, 'id' | 'recordedAt' | 'status'>

type LedgerRow =
  | { readonly op: 'upsert'; readonly record: MemoryRecord }
  | { readonly op: 'forget'; readonly id: MemoryId; readonly forgottenAt: number }

const DEFAULT_MAX_RECORDS = 10_000
const MAX_SUMMARY_LENGTH = 4_096

/** Durable append-only memory store with source-event deduplication and search. */
export class MemoryLedger {
  /** Resolved JSONL path used by this ledger. */
  readonly path: string
  private readonly maxRecords: number
  private readonly records = new Map<MemoryId, MemoryRecord>()
  private readonly sourceIndex = new Map<string, MemoryId>()
  private writeChain: Promise<void> = Promise.resolve()

  /**
   * @param path - JSONL path owned by the ledger.
   * @param maxRecords - maximum retained records; must be a positive safe integer.
   */
  constructor(path: string, maxRecords = DEFAULT_MAX_RECORDS) {
    if (path.trim() === '') throw new TypeError('memory ledger path must be non-empty')
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
      throw new TypeError('memory ledger maxRecords must be a positive safe integer')
    }
    this.path = resolve(path)
    this.maxRecords = maxRecords
  }

  /** Load and validate the append-only ledger, treating an absent file as empty. */
  async load(): Promise<void> {
    await this.writeChain
    this.records.clear()
    this.sourceIndex.clear()
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const [index, line] of text.split('\n').entries()) {
      if (line.trim() === '') continue
      let row: unknown
      try {
        row = JSON.parse(line)
      } catch (error) {
        throw new Error(`memory ledger row ${index + 1} is not valid JSON`, { cause: error })
      }
      this.applyRow(validateRow(row, index + 1))
    }
    this.enforceLimit()
  }

  /**
   * Add one observation exactly once for its source event and return its record.
   * Repeating the same source event is idempotent, which makes reload and retry safe.
   * @param input - validated learning observation.
   * @returns the existing or newly recorded memory.
   */
  async remember(input: MemoryRecordInput): Promise<MemoryRecord> {
    validateInput(input)
    const sourceKey = sourceKeyOf(input)
    const existingId = this.sourceIndex.get(sourceKey)
    if (existingId !== undefined) {
      const existing = this.records.get(existingId)
      if (existing !== undefined && existing.status === 'active') return existing
    }
    const record: MemoryRecord = {
      ...input,
      id: `memory-${randomUUID()}` as MemoryId,
      recordedAt: Date.now(),
      status: 'active',
    }
    await this.append({ op: 'upsert', record })
    this.applyRow({ op: 'upsert', record })
    this.enforceLimit()
    return record
  }

  /**
   * Search active records using case-insensitive all-token matching.
   * @param query - words to find in summaries, kinds, or source event types.
   * @param limit - maximum number of records returned.
   * @returns newest matching records first.
   */
  async search(query = '', limit = 50): Promise<MemoryRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('memory search limit must be a positive safe integer')
    const tokens = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
    return [...this.records.values()]
      .filter(record => record.status === 'active')
      .filter((record) => {
        const haystack = `${record.summary} ${record.kind} ${record.sourceEventType}`.toLocaleLowerCase()
        return tokens.every(token => haystack.includes(token))
      })
      .sort((left, right) => right.recordedAt - left.recordedAt)
      .slice(0, limit)
      .map(record => ({ ...record }))
  }

  /**
   * Read the newest active records without applying a query filter.
   * @param limit - Maximum number of records to return.
   * @returns Newest active records.
   */
  recent(limit = 20): MemoryRecord[] {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('memory recent limit must be a positive safe integer')
    return [...this.records.values()]
      .filter(record => record.status === 'active')
      .sort((left, right) => right.recordedAt - left.recordedAt)
      .slice(0, limit)
      .map(record => ({ ...record }))
  }

  /**
   * Read bounded continuity context with durable lessons ahead of noisy recent activity.
   * @param limit - Maximum number of records to return.
   * @returns High-confidence durable records followed by newest active observations.
   */
  recall(limit = 20): MemoryRecord[] {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('memory recall limit must be a positive safe integer')
    const active = [...this.records.values()].filter(record => record.status === 'active')
    const durable = active
      .filter(record => (record.kind === 'preference' || record.kind === 'lesson' || record.kind === 'skill') && record.confidence >= 0.8)
      .sort((left, right) => right.confidence - left.confidence || right.recordedAt - left.recordedAt || right.occurredAt - left.occurredAt)
    const newest = active.sort((left, right) => right.recordedAt - left.recordedAt || right.occurredAt - left.occurredAt)
    const selected = new Map<MemoryId, MemoryRecord>()
    for (const record of [...durable, ...newest]) {
      if (selected.size >= limit) break
      selected.set(record.id, record)
    }
    return [...selected.values()].map(record => ({ ...record }))
  }

  /**
   * Forget one record while retaining an auditable tombstone.
   * @param id - Memory identity to forget.
   */
  async forget(id: MemoryId): Promise<void> {
    const record = this.records.get(id)
    if (record === undefined || record.status === 'forgotten') return
    const forgottenAt = Date.now()
    await this.append({ op: 'forget', id, forgottenAt })
    this.applyRow({ op: 'forget', id, forgottenAt })
  }

  private async append(row: LedgerRow): Promise<void> {
    const task = this.writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      await appendFile(this.path, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 })
    })
    this.writeChain = task.then(() => undefined, () => undefined)
    await task
  }

  private applyRow(row: LedgerRow): void {
    if (row.op === 'forget') {
      const existing = this.records.get(row.id)
      if (existing !== undefined) this.records.set(row.id, { ...existing, status: 'forgotten' })
      return
    }
    this.records.set(row.record.id, row.record)
    this.sourceIndex.set(sourceKeyOf(row.record), row.record.id)
  }

  private enforceLimit(): void {
    const active = [...this.records.values()].filter(record => record.status === 'active')
    if (active.length <= this.maxRecords) return
    active.sort((left, right) => left.recordedAt - right.recordedAt)
    for (const record of active.slice(0, active.length - this.maxRecords)) {
      this.records.set(record.id, { ...record, status: 'forgotten' })
    }
  }
}

function sourceKeyOf(input: Pick<MemoryRecord, 'sessionId' | 'eventSeq' | 'kind'>): string {
  return `${input.sessionId}:${String(input.eventSeq)}:${input.kind}`
}

function validateInput(input: MemoryRecordInput): void {
  if (typeof input.sessionId !== 'string' || input.sessionId.trim() === '') throw new TypeError('memory sessionId must be non-empty')
  if (!Number.isSafeInteger(input.eventSeq) || input.eventSeq < 0) throw new TypeError('memory eventSeq must be a non-negative safe integer')
  if (!['interaction', 'error', 'success', 'lesson', 'skill', 'preference'].includes(input.kind)) throw new TypeError('memory kind is unsupported')
  if (typeof input.summary !== 'string' || input.summary.trim() === '' || input.summary.length > MAX_SUMMARY_LENGTH) throw new TypeError(`memory summary must contain 1-${MAX_SUMMARY_LENGTH} characters`)
  if (typeof input.sourceEventType !== 'string' || input.sourceEventType.trim() === '') throw new TypeError('memory sourceEventType must be non-empty')
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new TypeError('memory confidence must be between 0 and 1')
  if (!Number.isFinite(input.occurredAt) || input.occurredAt < 0) throw new TypeError('memory occurredAt must be a non-negative finite number')
}

function validateRow(value: unknown, line: number): LedgerRow {
  if (typeof value !== 'object' || value === null || !('op' in value)) throw new TypeError(`memory ledger row ${line} has no operation`)
  const row = value as { op?: unknown; record?: unknown; id?: unknown; forgottenAt?: unknown }
  if (row.op === 'upsert') {
    const record = row.record
    if (typeof record !== 'object' || record === null) throw new TypeError(`memory ledger row ${line} has no record`)
    const candidate = record as Partial<MemoryRecord>
    if (typeof candidate.id !== 'string' || typeof candidate.recordedAt !== 'number' || candidate.status !== 'active') throw new TypeError(`memory ledger row ${line} has invalid record identity`)
    const input: MemoryRecordInput = {
      sessionId: candidate.sessionId as string,
      eventSeq: candidate.eventSeq as number,
      kind: candidate.kind as MemoryKind,
      summary: candidate.summary as string,
      sourceEventType: candidate.sourceEventType as string,
      confidence: candidate.confidence as number,
      occurredAt: candidate.occurredAt as number,
    }
    validateInput(input)
    if (!Number.isFinite(candidate.recordedAt) || candidate.recordedAt < 0) throw new TypeError(`memory ledger row ${line} has invalid recordedAt`)
    return { op: 'upsert', record: { ...input, id: candidate.id as MemoryId, recordedAt: candidate.recordedAt, status: 'active' } }
  }
  if (row.op === 'forget' && typeof row.id === 'string' && typeof row.forgottenAt === 'number' && Number.isFinite(row.forgottenAt)) {
    return { op: 'forget', id: row.id as MemoryId, forgottenAt: row.forgottenAt }
  }
  throw new TypeError(`memory ledger row ${line} has unsupported operation`)
}
