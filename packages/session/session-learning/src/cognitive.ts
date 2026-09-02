/**
 * Event-sourced cognitive memory for PHOENIX.
 *
 * The session log remains the canonical conversation archive. This ledger is
 * a durable, redacted index of every observed event and its derived memory
 * layers. It never compacts or physically removes canonical rows.
 *
 * @module @phoenix-ai/dsh-session-learning/cognitive
 */

import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { MemoryId, MemoryKind } from './ledger.ts'

/** Memory layers projected from one canonical session event. */
export type CognitiveMemoryLayer =
  | 'autobiographical'
  | 'working'
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'prospective'
  | 'associative'
  | 'temporal'

/** Kinds used by the cognitive index. */
export type CognitiveMemoryKind = MemoryKind | 'event' | 'conversation' | 'decision' | 'fact' | 'mission' | 'pending'

/** Lifecycle state of one canonical cognitive record. */
export type CognitiveMemoryStatus = 'active' | 'superseded' | 'obsolete' | 'forgotten'

/** A named entity used by associative retrieval. */
export interface CognitiveMemoryEntity {
  readonly type: 'person' | 'project' | 'file' | 'tool' | 'model' | 'mission' | 'concept' | 'event'
  readonly value: string
  readonly normalized: string
}

/** A typed edge between an event source and an entity or another memory. */
export interface CognitiveMemoryRelation {
  readonly type: 'about' | 'caused' | 'resolvedBy' | 'dependsOn' | 'partOf' | 'mentions' | 'contradicts' | 'supersedes'
  readonly from: string
  readonly to: string
}

/** Immutable source information retained with every cognitive record. */
export interface CognitiveMemoryProvenance {
  readonly sessionId: string
  readonly eventSeq: number
  readonly sourceEventType: string
  readonly sourceUri: string
  readonly occurredAt: number
  readonly projectId?: string
}

/** Canonical event projection plus derived memory metadata. */
export interface CognitiveMemoryRecord {
  readonly id: MemoryId
  readonly sessionId: string
  readonly eventSeq: number
  readonly kind: CognitiveMemoryKind
  readonly layers: readonly CognitiveMemoryLayer[]
  readonly content: string
  readonly summary: string
  readonly subject?: string
  readonly value?: string
  readonly projectId?: string
  readonly entities: readonly CognitiveMemoryEntity[]
  readonly relations: readonly CognitiveMemoryRelation[]
  readonly provenance: CognitiveMemoryProvenance
  readonly confidence: number
  readonly importance: number
  readonly frequency: number
  readonly validFrom: number
  readonly validUntil?: number
  readonly recordedAt: number
  readonly lastObservedAt: number
  readonly status: CognitiveMemoryStatus
  readonly supersedes?: MemoryId
  readonly supersededBy?: MemoryId
}

/** Input used to derive one cognitive record from a session event. */
export interface CognitiveMemoryInput {
  readonly sessionId: string
  readonly eventSeq: number
  readonly kind: CognitiveMemoryKind
  readonly layers: readonly CognitiveMemoryLayer[]
  readonly content: string
  readonly summary: string
  readonly sourceEventType: string
  readonly occurredAt: number
  readonly projectId?: string
  readonly subject?: string
  readonly value?: string
  readonly entities?: readonly CognitiveMemoryEntity[]
  readonly relations?: readonly CognitiveMemoryRelation[]
  readonly confidence: number
  readonly importance: number
}

/** Filters used by the deterministic hybrid cognitive search. */
export interface CognitiveMemoryQuery {
  readonly query?: string
  readonly layers?: readonly CognitiveMemoryLayer[]
  readonly projectId?: string
  readonly sessionId?: string
  readonly entity?: string
  readonly from?: number
  readonly to?: number
  readonly includeHistory?: boolean
  readonly limit?: number
}

/** One search result with explainable ranking signals. */
export interface CognitiveMemoryHit {
  readonly record: CognitiveMemoryRecord
  readonly score: number
  readonly reasons: readonly string[]
}

type CognitiveLedgerRow =
  | { readonly op: 'event'; readonly record: CognitiveMemoryRecord }
  | { readonly op: 'reinforce'; readonly id: MemoryId; readonly frequency: number; readonly lastObservedAt: number }
  | { readonly op: 'supersede'; readonly id: MemoryId; readonly supersededBy: MemoryId; readonly validUntil: number }
  | { readonly op: 'forget'; readonly id: MemoryId; readonly forgottenAt: number }

const LAYERS: readonly CognitiveMemoryLayer[] = [
  'autobiographical', 'working', 'episodic', 'semantic', 'procedural', 'prospective', 'associative', 'temporal',
]
const KINDS: readonly CognitiveMemoryKind[] = [
  'interaction', 'error', 'success', 'lesson', 'skill', 'preference', 'event', 'conversation', 'decision', 'fact', 'mission', 'pending',
]
const MAX_CONTENT_LENGTH = 16_384
const MAX_SUMMARY_LENGTH = 4_096
const MAX_ENTITIES = 32
const MAX_RELATIONS = 64
const DEFAULT_LIMIT = 50
const STOP_WORDS = new Set([
  'a', 'about', 'after', 'all', 'and', 'are', 'at', 'be', 'been', 'by', 'de', 'del', 'el', 'en', 'es', 'for', 'from', 'has', 'have',
  'i', 'in', 'is', 'it', 'la', 'las', 'los', 'my', 'of', 'on', 'or', 'que', 'the', 'to', 'un', 'una', 'with', 'y',
])
const TOKEN_ALIASES: Readonly<Record<string, string>> = {
  always: 'prefer',
  breve: 'short',
  concise: 'short',
  corto: 'short',
  corta: 'short',
  detailed: 'long',
  detail: 'long',
  detallado: 'long',
  extensa: 'long',
  extenso: 'long',
  prefer: 'prefer',
  prefiero: 'prefer',
  remember: 'remember',
  recuerda: 'remember',
  sandbox: 'sandbox',
}

/** Durable append-only cognitive ledger with derived hybrid retrieval. */
export class CognitiveMemoryLedger {
  /** Resolved JSONL path used by this ledger. */
  readonly path: string
  private readonly records = new Map<MemoryId, CognitiveMemoryRecord>()
  private readonly sourceIndex = new Map<string, MemoryId>()
  private writeChain: Promise<void> = Promise.resolve()

  /** @param path - JSONL path owned by this ledger. */
  constructor(path: string) {
    if (path.trim() === '') throw new TypeError('cognitive memory ledger path must be non-empty')
    this.path = resolve(path)
  }

  /** Load canonical event rows and lifecycle rows without compacting them. */
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
      let raw: unknown
      try {
        raw = JSON.parse(line)
      } catch (error) {
        throw new Error(`cognitive memory row ${index + 1} is not valid JSON`, { cause: error })
      }
      this.applyRow(validateRow(raw, index + 1))
    }
  }

  /**
   * Add one source event or consolidate it into an existing semantic fact.
   * Replaying the same source event is idempotent; no canonical event is pruned.
   * @param input - Redacted event projection.
   * @returns The active or explicitly forgotten record for that source.
   */
  async remember(input: CognitiveMemoryInput): Promise<CognitiveMemoryRecord> {
    validateInput(input)
    const sourceKey = sourceKeyOf(input)
    const existingId = this.sourceIndex.get(sourceKey)
    if (existingId !== undefined) {
      const existing = this.records.get(existingId)
      if (existing !== undefined) return { ...existing }
    }

    const previous = input.subject === undefined || !input.layers.includes('semantic')
      ? undefined
      : this.currentSubject(input.subject, input.projectId)
    const same = previous !== undefined && sameValue(previous, input)
    if (same) {
      const reinforced: CognitiveLedgerRow = {
        op: 'reinforce',
        id: previous.id,
        frequency: previous.frequency + 1,
        lastObservedAt: input.occurredAt,
      }
      await this.appendRows([reinforced])
      this.applyRow(reinforced)
      return { ...previous, frequency: reinforced.frequency, lastObservedAt: reinforced.lastObservedAt }
    }

    const record = makeRecord(input, previous?.id)
    const rows: CognitiveLedgerRow[] = [{ op: 'event', record }]
    if (previous !== undefined) {
      rows.push({ op: 'supersede', id: previous.id, supersededBy: record.id, validUntil: input.occurredAt })
    }
    await this.appendRows(rows)
    for (const row of rows) this.applyRow(row)
    return { ...record }
  }

  /** Search records using lexical, entity, relation, metadata, and recency signals.
   * @param query - optional hybrid-search filters and result limit.
   * @returns ranked records with explainable matching signals.
   */
  search(query: CognitiveMemoryQuery = {}): CognitiveMemoryHit[] {
    const limit = query.limit ?? DEFAULT_LIMIT
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('cognitive memory search limit must be a positive safe integer')
    const queryTokens = [...tokenize(query.query ?? '')]
    const candidates = [...this.records.values()]
      .filter(record => query.includeHistory === true ? record.status !== 'forgotten' : record.status === 'active')
      .filter(record => query.layers === undefined || query.layers.some(layer => record.layers.includes(layer)))
      .filter(record => query.projectId === undefined || record.projectId === query.projectId)
      .filter(record => query.sessionId === undefined || record.sessionId === query.sessionId)
      .filter(record => query.from === undefined || record.provenance.occurredAt >= query.from)
      .filter(record => query.to === undefined || record.provenance.occurredAt <= query.to)
      .filter(record => query.entity === undefined || hasEntity(record, query.entity))

    if (candidates.length === 0) return []
    const bounds = recencyBounds(candidates)
    const hasQuery = queryTokens.length > 0
    const scored = candidates.flatMap((record) => {
      const textTokens = hasQuery
        ? tokenize(`${record.summary} ${record.content} ${record.subject ?? ''} ${record.value ?? ''} ${record.entities.map(entity => entity.value).join(' ')}`)
        : undefined
      const overlap = hasQuery && textTokens !== undefined
        ? queryTokens.filter(token => textTokens.has(token)).length
        : 0
      const entityMatches = query.entity === undefined
        ? hasQuery ? queryTokens.filter(token => record.entities.some(entity => entity.normalized === token)).length : 0
        : 1
      const relationMatches = hasQuery
        ? queryTokens.filter(token => record.relations.some(relation => relation.from === token || relation.to === token)).length
        : 0
      if (hasQuery && overlap === 0 && entityMatches === 0 && relationMatches === 0) return []
      const lexicalScore = hasQuery ? overlap / queryTokens.length : 0
      const entityScore = hasQuery ? Math.min(1, entityMatches / queryTokens.length) : query.entity === undefined ? 0 : 1
      const relationScore = hasQuery ? Math.min(1, relationMatches / queryTokens.length) : 0
      const recencyScore = recency(record.lastObservedAt, bounds)
      const score = lexicalScore * 0.5 + entityScore * 0.15 + relationScore * 0.1
        + record.importance * 0.1 + record.confidence * 0.1 + Math.min(1, Math.log2(record.frequency + 1) / 8) * 0.05 + recencyScore * 0.05
      const reasons = [
        ...lexicalScore > 0 ? [`lexical:${overlap}/${queryTokens.length}`] : [],
        ...entityScore > 0 ? ['entity-match'] : [],
        ...relationScore > 0 ? ['relation-match'] : [],
        `importance:${record.importance.toFixed(2)}`,
        `confidence:${record.confidence.toFixed(2)}`,
        `frequency:${String(record.frequency)}`,
      ]
      return [{ record: { ...record }, score, reasons }]
    })
    return scored.sort((left, right) => right.score - left.score || right.record.lastObservedAt - left.record.lastObservedAt)
      .slice(0, limit)
  }

  /** Return all non-forgotten records for a subject, including superseded values.
   * @param subject - exact normalized subject to inspect.
   * @param projectId - optional project isolation key.
   * @returns chronological records, including superseded values.
   */
  history(subject: string, projectId?: string): CognitiveMemoryRecord[] {
    const normalized = normalize(subject)
    return [...this.records.values()]
      .filter(record => record.status !== 'forgotten' && normalize(record.subject ?? '') === normalized)
      .filter(record => projectId === undefined || record.projectId === projectId)
      .sort((left, right) => left.validFrom - right.validFrom || left.recordedAt - right.recordedAt)
      .map(record => ({ ...record }))
  }

  /** Return the latest active working records for a project or session.
   * @param projectId - optional project isolation key.
   * @param sessionId - optional session isolation key.
   * @param limit - positive maximum number of records.
   * @returns newest active working records.
   */
  working(projectId?: string, sessionId?: string, limit = 20): CognitiveMemoryRecord[] {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('working memory limit must be a positive safe integer')
    return [...this.records.values()]
      .filter(record => record.status === 'active' && record.layers.includes('working'))
      .filter(record => projectId === undefined || record.projectId === projectId)
      .filter(record => sessionId === undefined || record.sessionId === sessionId)
      .sort((left, right) => right.lastObservedAt - left.lastObservedAt)
      .slice(0, limit)
      .map(record => ({ ...record }))
  }

  /** Return a chronological project or time-window view without using a summary index as authority.
   * @param query - project, session, history, and time-window filters.
   * @returns canonical records ordered by occurrence.
   */
  timeline(query: Pick<CognitiveMemoryQuery, 'projectId' | 'sessionId' | 'from' | 'to' | 'includeHistory'> = {}): CognitiveMemoryRecord[] {
    return [...this.records.values()]
      .filter(record => query.includeHistory === true ? record.status !== 'forgotten' : record.status === 'active')
      .filter(record => query.projectId === undefined || record.projectId === query.projectId)
      .filter(record => query.sessionId === undefined || record.sessionId === query.sessionId)
      .filter(record => query.from === undefined || record.provenance.occurredAt >= query.from)
      .filter(record => query.to === undefined || record.provenance.occurredAt <= query.to)
      .sort((left, right) => left.provenance.occurredAt - right.provenance.occurredAt || left.eventSeq - right.eventSeq)
      .map(record => ({ ...record }))
  }

  /** Return every canonical record for audit; explicit tombstones remain visible here.
   * @returns all records ordered by recording time.
   */
  allRecords(): CognitiveMemoryRecord[] {
    return [...this.records.values()].sort((left, right) => left.recordedAt - right.recordedAt).map(record => ({ ...record }))
  }

  /** Append an explicit forget tombstone; the underlying canonical event remains auditable.
   * @param id - canonical cognitive record to mark forgotten.
   * @returns a promise that settles after the tombstone is durable.
   */
  async forget(id: MemoryId): Promise<void> {
    const record = this.records.get(id)
    if (record === undefined || record.status === 'forgotten') return
    const row: CognitiveLedgerRow = { op: 'forget', id, forgottenAt: Date.now() }
    await this.appendRows([row])
    this.applyRow(row)
  }

  private currentSubject(subject: string, projectId?: string): CognitiveMemoryRecord | undefined {
    return [...this.records.values()]
      .filter(record => record.status === 'active' && record.layers.includes('semantic'))
      .filter(record => record.subject === subject && record.projectId === projectId)
      .sort((left, right) => right.lastObservedAt - left.lastObservedAt)[0]
  }

  private async appendRows(rows: readonly CognitiveLedgerRow[]): Promise<void> {
    const text = rows.map(row => JSON.stringify(row)).join('\n') + '\n'
    const task = this.writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      await appendFile(this.path, text, { encoding: 'utf8', mode: 0o600 })
    })
    this.writeChain = task.then(() => undefined, () => undefined)
    await task
  }

  private applyRow(row: CognitiveLedgerRow): void {
    if (row.op === 'event') {
      this.records.set(row.record.id, row.record)
      this.sourceIndex.set(sourceKeyOf(row.record), row.record.id)
      return
    }
    const existing = this.records.get(row.id)
    if (existing === undefined) return
    if (row.op === 'reinforce') {
      this.records.set(row.id, { ...existing, frequency: row.frequency, lastObservedAt: row.lastObservedAt })
    } else if (row.op === 'supersede') {
      this.records.set(row.id, { ...existing, status: 'superseded', validUntil: row.validUntil, supersededBy: row.supersededBy })
    } else {
      this.records.set(row.id, { ...existing, status: 'forgotten' })
    }
  }
}

function makeRecord(input: CognitiveMemoryInput, supersedes?: MemoryId): CognitiveMemoryRecord {
  const id = `cognitive-${randomUUID()}` as MemoryId
  const sourceUri = `session:${input.sessionId}#event:${String(input.eventSeq)}`
  const entities = input.entities === undefined ? [] : input.entities.map(entity => ({ ...entity }))
  const relations = input.relations === undefined
    ? entities.map(entity => ({ type: 'mentions' as const, from: sourceUri, to: entity.normalized }))
    : input.relations.map(relation => ({ ...relation }))
  return {
    id,
    sessionId: input.sessionId,
    eventSeq: input.eventSeq,
    kind: input.kind,
    layers: [...new Set(input.layers)],
    content: input.content,
    summary: input.summary,
    ...input.subject === undefined ? {} : { subject: input.subject },
    ...input.value === undefined ? {} : { value: input.value },
    ...input.projectId === undefined ? {} : { projectId: input.projectId },
    entities,
    relations,
    provenance: {
      sessionId: input.sessionId,
      eventSeq: input.eventSeq,
      sourceEventType: input.sourceEventType,
      sourceUri,
      occurredAt: input.occurredAt,
      ...input.projectId === undefined ? {} : { projectId: input.projectId },
    },
    confidence: input.confidence,
    importance: input.importance,
    frequency: 1,
    validFrom: input.occurredAt,
    recordedAt: Date.now(),
    lastObservedAt: input.occurredAt,
    status: 'active',
    ...supersedes === undefined ? {} : { supersedes },
  }
}

function sameValue(record: CognitiveMemoryRecord, input: CognitiveMemoryInput): boolean {
  const left = normalize(record.value ?? record.content)
  const right = normalize(input.value ?? input.content)
  return left !== '' && left === right
}

function sourceKeyOf(input: CognitiveMemoryInput | CognitiveMemoryRecord): string {
  const sourceEventType = 'provenance' in input ? input.provenance.sourceEventType : input.sourceEventType
  return [input.sessionId, String(input.eventSeq), sourceEventType, input.kind, input.subject ?? ''].join(':')
}

function hasEntity(record: CognitiveMemoryRecord, query: string): boolean {
  const target = normalize(query)
  return record.entities.some(entity => entity.normalized === target || entity.normalized.includes(target))
}

interface RecencyBounds {
  readonly oldest: number
  readonly newest: number
}

function recencyBounds(candidates: readonly CognitiveMemoryRecord[]): RecencyBounds {
  let oldest = Number.POSITIVE_INFINITY
  let newest = Number.NEGATIVE_INFINITY
  for (const record of candidates) {
    if (record.lastObservedAt < oldest) oldest = record.lastObservedAt
    if (record.lastObservedAt > newest) newest = record.lastObservedAt
  }
  return { oldest, newest }
}

function recency(observedAt: number, bounds: RecencyBounds): number {
  if (bounds.newest === bounds.oldest) return 1
  return (observedAt - bounds.oldest) / (bounds.newest - bounds.oldest)
}

function tokenize(value: string): Set<string> {
  const tokens = value.normalize('NFKD').toLocaleLowerCase().replace(/\p{Diacritic}/gu, '').match(/[\p{L}\p{N}_-]{2,}/gu) ?? []
  return new Set(tokens.map(token => TOKEN_ALIASES[token] ?? token).filter(token => !STOP_WORDS.has(token)))
}

/** Normalize identifiers and facts for deduplication and associative search.
 * @param value - text to tokenize and normalize.
 * @returns sorted canonical token text.
 */
export function normalize(value: string): string {
  return [...tokenize(value)].sort().join(' ')
}

function validateInput(input: CognitiveMemoryInput): void {
  if (typeof input.sessionId !== 'string' || input.sessionId.trim() === '') throw new TypeError('cognitive memory sessionId must be non-empty')
  if (!Number.isSafeInteger(input.eventSeq) || input.eventSeq < 0) throw new TypeError('cognitive memory eventSeq must be a non-negative safe integer')
  if (!KINDS.includes(input.kind)) throw new TypeError('cognitive memory kind is unsupported')
  const knownLayers = new Set<string>(LAYERS)
  if (input.layers.length === 0 || input.layers.some(layer => !knownLayers.has(layer))) throw new TypeError('cognitive memory layers are unsupported')
  if (typeof input.content !== 'string' || input.content.trim() === '' || input.content.length > MAX_CONTENT_LENGTH) throw new TypeError(`cognitive memory content must contain 1-${MAX_CONTENT_LENGTH} characters`)
  if (typeof input.summary !== 'string' || input.summary.trim() === '' || input.summary.length > MAX_SUMMARY_LENGTH) throw new TypeError(`cognitive memory summary must contain 1-${MAX_SUMMARY_LENGTH} characters`)
  if (typeof input.sourceEventType !== 'string' || input.sourceEventType.trim() === '') throw new TypeError('cognitive memory sourceEventType must be non-empty')
  if (!Number.isFinite(input.occurredAt) || input.occurredAt < 0) throw new TypeError('cognitive memory occurredAt must be a non-negative finite number')
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new TypeError('cognitive memory confidence must be between 0 and 1')
  if (!Number.isFinite(input.importance) || input.importance < 0 || input.importance > 1) throw new TypeError('cognitive memory importance must be between 0 and 1')
  if (input.projectId !== undefined && (typeof input.projectId !== 'string' || input.projectId.trim() === '' || input.projectId.length > 256)) throw new TypeError('cognitive memory projectId is invalid')
  if (input.subject !== undefined && (typeof input.subject !== 'string' || input.subject.trim() === '' || input.subject.length > 256)) throw new TypeError('cognitive memory subject is invalid')
  if (input.value !== undefined && (typeof input.value !== 'string' || input.value.length > MAX_SUMMARY_LENGTH)) throw new TypeError('cognitive memory value is invalid')
  if (input.entities !== undefined && (!Array.isArray(input.entities) || input.entities.length > MAX_ENTITIES)) throw new TypeError('cognitive memory entities are invalid')
  if (input.relations !== undefined && (!Array.isArray(input.relations) || input.relations.length > MAX_RELATIONS)) throw new TypeError('cognitive memory relations are invalid')
}

function validateRow(value: unknown, line: number): CognitiveLedgerRow {
  if (typeof value !== 'object' || value === null || !('op' in value)) throw new TypeError(`cognitive memory row ${line} has no operation`)
  const row = value as {
    op?: unknown
    record?: unknown
    id?: unknown
    frequency?: unknown
    lastObservedAt?: unknown
    supersededBy?: unknown
    validUntil?: unknown
    forgottenAt?: unknown
  }
  if (row.op === 'event') {
    if (typeof row.record !== 'object' || row.record === null) throw new TypeError(`cognitive memory row ${line} has no record`)
    const record = row.record as CognitiveMemoryRecord
    const input: CognitiveMemoryInput = {
      sessionId: record.sessionId,
      eventSeq: record.eventSeq,
      kind: record.kind,
      layers: record.layers,
      content: record.content,
      summary: record.summary,
      sourceEventType: record.provenance.sourceEventType,
      occurredAt: record.provenance.occurredAt,
      ...record.projectId === undefined ? {} : { projectId: record.projectId },
      ...record.subject === undefined ? {} : { subject: record.subject },
      ...record.value === undefined ? {} : { value: record.value },
      entities: record.entities,
      relations: record.relations,
      confidence: record.confidence,
      importance: record.importance,
    }
    validateInput(input)
    if (typeof record.id !== 'string' || typeof record.recordedAt !== 'number' || record.status !== 'active' || typeof record.frequency !== 'number' || typeof record.lastObservedAt !== 'number') throw new TypeError(`cognitive memory row ${line} has invalid record identity`)
    if (record.provenance.sourceUri !== `session:${record.sessionId}#event:${String(record.eventSeq)}`) throw new TypeError(`cognitive memory row ${line} has invalid provenance`)
    return { op: 'event', record: { ...record, id: record.id, status: 'active' } }
  }
  if (row.op === 'reinforce' && typeof row.id === 'string' && typeof row.frequency === 'number' && Number.isSafeInteger(row.frequency) && row.frequency >= 1 && typeof row.lastObservedAt === 'number' && Number.isFinite(row.lastObservedAt)) {
    return { op: 'reinforce', id: row.id as MemoryId, frequency: row.frequency, lastObservedAt: row.lastObservedAt }
  }
  if (row.op === 'supersede' && typeof row.id === 'string' && typeof row.supersededBy === 'string' && typeof row.validUntil === 'number' && Number.isFinite(row.validUntil)) {
    return { op: 'supersede', id: row.id as MemoryId, supersededBy: row.supersededBy as MemoryId, validUntil: row.validUntil }
  }
  if (row.op === 'forget' && typeof row.id === 'string' && typeof row.forgottenAt === 'number' && Number.isFinite(row.forgottenAt)) {
    return { op: 'forget', id: row.id as MemoryId, forgottenAt: row.forgottenAt }
  }
  throw new TypeError(`cognitive memory row ${line} has unsupported operation`)
}
