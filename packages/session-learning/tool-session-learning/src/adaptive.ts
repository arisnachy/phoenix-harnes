/**
 * Outcome-driven learning layered on Phoenix's provenance-aware cognitive memory.
 *
 * Adaptive state is persisted as versioned semantic/procedural memory. Each
 * update supersedes the previous state for the same strategy, preserving the
 * cognitive ledger's audit trail while keeping model recall restricted to
 * strategies that earned active status from observed outcomes.
 */

import type { Context } from '@phoenix-ai/cordis'
import type { CognitiveMemoryHit, CognitiveMemoryRecord } from '@phoenix-ai/dsh-session-learning'

const ADAPTIVE_SUBJECT_PREFIX = 'phoenix.learning.strategy.'
const STATE_VERSION = 1 as const
const DEFAULT_RECOMMEND_LIMIT = 8
const MAX_RECOMMEND_LIMIT = 32
const DEFAULT_CANDIDATE_CONFIDENCE = 0.5
const VERIFIED_SUCCESS_CONFIDENCE = 0.85
const MAX_TEXT_CHARS = 2_048
const MAX_CONFIRM_RECENT = 4
const EXPLICIT_CORRECTION_PATTERN = new RegExp(
  String.raw`\b(?:${[
    String.raw`that(?:'s| is) wrong`,
    'incorrect',
    'wrong approach',
    String.raw`you got (?:it|that) wrong`,
    String.raw`eso est[aá] mal`,
    String.raw`incorrect[oa]`,
    'te dije que no',
    String.raw`esa estrategia est[aá] mal`,
    String.raw`corrige (?:eso|esto)`,
  ].join('|')})\b`,
  'iu',
)

/** Durable adaptive lifecycle, independent from the cognitive row lifecycle. */
export type AdaptiveLearningStatus = 'candidate' | 'active' | 'quarantined'
/** Evidence-bearing observation applied to one strategy. */
export type AdaptiveLearningOutcome = 'candidate' | 'success' | 'failure' | 'correction'

/** Minimum row shape needed by the adaptive engine. */
export interface AdaptiveStoredMemory {
  readonly subject?: string
  readonly value?: string
  readonly summary: string
  readonly projectId?: string
  readonly sessionId: string
  readonly status: 'active' | 'superseded' | 'obsolete' | 'forgotten'
  readonly occurredAt: number
  readonly sourceEventType: string
}

/** Durable write requested by the adaptive engine. */
export interface AdaptiveMemoryWrite {
  readonly subject: string
  readonly value: string
  readonly summary: string
  readonly sessionId: string
  readonly eventSeq: number
  readonly sourceEventType: string
  readonly occurredAt: number
  readonly confidence: number
  readonly importance: number
  readonly projectId?: string
}

/** Storage seam used so the learning policy can be tested without a runtime. */
export interface AdaptiveMemoryStore {
  timeline(query?: {
    readonly projectId?: string
    readonly sessionId?: string
    readonly includeHistory?: boolean
  }): readonly AdaptiveStoredMemory[]
  remember(input: AdaptiveMemoryWrite): Promise<void>
}

/** One outcome observation supplied by Phoenix runtime evidence. */
export interface AdaptiveOutcomeInput {
  readonly strategy: string
  readonly evidence: string
  readonly outcome: AdaptiveLearningOutcome
  readonly sessionId: string
  readonly eventSeq: number
  readonly sourceEventType: string
  readonly occurredAt: number
  readonly projectId?: string
  readonly verified?: boolean
  readonly ttlMs?: number
}

/**
 * Classify one tool result before it enters adaptive learning.
 * Computer reports accepted input before the application goal is verified, so
 * a successful Computer result remains a candidate until goal completion.
 * @param toolName - Model-facing tool name from the pending call.
 * @param failed - Whether the tool result reported an error.
 * @returns Safe outcome fields for `recordOutcome`.
 */
export function adaptiveOutcomeForToolResult(
  toolName: string,
  failed: boolean,
): { readonly outcome: AdaptiveLearningOutcome; readonly verified?: boolean } {
  if (failed) return { outcome: 'failure' }
  if (toolName === 'computer') return { outcome: 'candidate' }
  return { outcome: 'success', verified: true }
}

/** Versioned state retained for one normalized strategy. */
export interface AdaptiveLearningState {
  readonly version: typeof STATE_VERSION
  readonly key: string
  readonly strategy: string
  readonly status: AdaptiveLearningStatus
  readonly successes: number
  readonly failures: number
  readonly corrections: number
  readonly confirmations: number
  readonly confidence: number
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly lastOutcome: AdaptiveLearningOutcome
  readonly lastEvidence: string
  readonly projectId?: string
  readonly expiresAt?: number
}

/** Query for usable strategies. */
export interface AdaptiveRecommendationQuery {
  readonly projectId?: string
  readonly sessionId?: string
  readonly limit?: number
  readonly now?: number
}

/**
 * Learn from observed outcomes rather than treating model assertions as truth.
 * Verified successes promote strategies; repeated failure or explicit user
 * correction quarantines them; TTL prevents stale world-dependent strategies
 * from being recommended indefinitely.
 */
export class AdaptiveLearningEngine {
  private writeTail: Promise<void> = Promise.resolve()

  constructor(private readonly store: AdaptiveMemoryStore) {}

  /**
   * Record one evidence-bearing outcome and persist the resulting state.
   * @param input - Verified or candidate evidence about one strategy outcome.
   * @returns The durable adaptive state after applying the observation.
   */
  recordOutcome(input: AdaptiveOutcomeInput): Promise<AdaptiveLearningState> {
    const task = this.writeTail.then(() => this.recordOutcomeNow(input))
    this.writeTail = task.then(() => undefined, () => undefined)
    return task
  }

  /**
   * Return only currently active, non-expired strategies.
   * @param query - Optional project, session, time, and result-count filters.
   * @returns Active strategies ordered by confidence and supporting evidence.
   */
  recommend(query: AdaptiveRecommendationQuery = {}): AdaptiveLearningState[] {
    const limit = query.limit ?? DEFAULT_RECOMMEND_LIMIT
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECOMMEND_LIMIT) {
      throw new TypeError(`adaptive learning recommendation limit must be an integer between 1 and ${String(MAX_RECOMMEND_LIMIT)}`)
    }
    const now = query.now ?? Date.now()
    const latest = new Map<string, AdaptiveLearningState>()
    for (const row of this.store.timeline({
      ...query.projectId === undefined ? {} : { projectId: query.projectId },
      ...query.sessionId === undefined ? {} : { sessionId: query.sessionId },
      includeHistory: false,
    })) {
      const state = decodeAdaptiveState(row)
      if (state !== undefined) latest.set(state.key, state)
    }
    return [...latest.values()]
      .filter(state => state.status === 'active')
      .filter(state => state.expiresAt === undefined || state.expiresAt > now)
      .sort((left, right) => right.confidence - left.confidence
        || right.confirmations - left.confirmations
        || right.lastObservedAt - left.lastObservedAt)
      .slice(0, limit)
  }

  /**
   * Promote recent candidate strategies from one session after Phoenix's
   * fail-closed goal completion path provides verified success evidence.
   * @param input - Completion evidence and session provenance for promotion.
   * @param eligible - Optional filter restricting which candidate states are promoted.
   * @returns Candidate states that were re-observed as verified successes.
   */
  async confirmRecentCandidates(input: {
    readonly sessionId: string
    readonly eventSeq: number
    readonly sourceEventType: string
    readonly occurredAt: number
    readonly evidence: string
    readonly projectId?: string
  }, eligible: (state: AdaptiveLearningState) => boolean = () => true): Promise<readonly AdaptiveLearningState[]> {
    const candidates = this.states({
      sessionId: input.sessionId,
      ...input.projectId === undefined ? {} : { projectId: input.projectId },
    })
      .filter(state => state.status === 'candidate')
      .filter(eligible)
      .sort((left, right) => right.lastObservedAt - left.lastObservedAt)
      .slice(0, MAX_CONFIRM_RECENT)
    const promoted: AdaptiveLearningState[] = []
    for (const candidate of candidates) {
      promoted.push(await this.recordOutcome({
        strategy: candidate.strategy,
        evidence: input.evidence,
        outcome: 'success',
        verified: true,
        sessionId: input.sessionId,
        eventSeq: input.eventSeq,
        sourceEventType: input.sourceEventType,
        occurredAt: input.occurredAt,
        ...input.projectId === undefined ? {} : { projectId: input.projectId },
        ...candidate.expiresAt === undefined ? {} : { ttlMs: Math.max(1, candidate.expiresAt - input.occurredAt) },
      }))
    }
    return promoted
  }

  private states(query: { readonly projectId?: string; readonly sessionId?: string }): AdaptiveLearningState[] {
    const latest = new Map<string, AdaptiveLearningState>()
    for (const row of this.store.timeline({
      ...query.projectId === undefined ? {} : { projectId: query.projectId },
      ...query.sessionId === undefined ? {} : { sessionId: query.sessionId },
      includeHistory: false,
    })) {
      const state = decodeAdaptiveState(row)
      if (state !== undefined) latest.set(state.key, state)
    }
    return [...latest.values()]
  }

  private async recordOutcomeNow(input: AdaptiveOutcomeInput): Promise<AdaptiveLearningState> {
    validateOutcomeInput(input)
    rejectSecrets(input.strategy)
    rejectSecrets(input.evidence)

    const strategy = normalizeText(input.strategy)
    const evidence = normalizeText(input.evidence)
    const key = strategyKey(strategy)
    const subject = `${ADAPTIVE_SUBJECT_PREFIX}${key}`
    const previous = this.states(input.projectId === undefined ? {} : { projectId: input.projectId })
      .find(state => state.key === key)
    const next = applyOutcome(previous, {
      ...input,
      strategy,
      evidence,
      key,
    })
    const value = JSON.stringify(next)
    const summary = adaptiveSummary(next)
    await this.store.remember({
      subject,
      value,
      summary,
      sessionId: input.sessionId,
      eventSeq: input.eventSeq,
      sourceEventType: `adaptive/${sanitizeEventType(input.sourceEventType)}/${input.outcome}`,
      occurredAt: input.occurredAt,
      confidence: next.confidence,
      importance: next.status === 'active' ? 0.95 : next.status === 'quarantined' ? 0.9 : 0.75,
      ...input.projectId === undefined ? {} : { projectId: input.projectId },
    })
    return next
  }
}

interface OutcomeWithKey extends AdaptiveOutcomeInput {
  readonly strategy: string
  readonly evidence: string
  readonly key: string
}

function applyOutcome(previous: AdaptiveLearningState | undefined, input: OutcomeWithKey): AdaptiveLearningState {
  const verifiedWeight = input.outcome === 'success' && input.verified === true ? 2 : 1
  const successes = (previous?.successes ?? 0) + (input.outcome === 'success' ? 1 : 0)
  const failures = (previous?.failures ?? 0) + (input.outcome === 'failure' ? 1 : 0)
  const corrections = (previous?.corrections ?? 0) + (input.outcome === 'correction' ? 1 : 0)
  const confirmations = (previous?.confirmations ?? 0) + (
    input.outcome === 'candidate' ? 1 : input.outcome === 'success' ? verifiedWeight : 0
  )

  let confidence = previous?.confidence ?? DEFAULT_CANDIDATE_CONFIDENCE
  if (input.outcome === 'success') {
    confidence = input.verified === true
      ? Math.max(VERIFIED_SUCCESS_CONFIDENCE, confidence + 0.25)
      : Math.min(0.98, confidence + 0.15)
  } else if (input.outcome === 'failure') {
    confidence = Math.max(0.05, confidence - 0.25)
  } else if (input.outcome === 'correction') {
    confidence = Math.max(0.05, confidence - 0.5)
  }
  confidence = Math.min(1, confidence)

  const quarantined = corrections > 0 || (failures >= 2 && failures >= successes)
  const promotable = confirmations >= 2 && successes > 0 && successes >= failures
  const status: AdaptiveLearningStatus = quarantined ? 'quarantined' : promotable ? 'active' : 'candidate'
  const expiresAt = input.ttlMs === undefined
    ? previous?.expiresAt
    : input.occurredAt + input.ttlMs
  const projectId = input.projectId ?? previous?.projectId

  return {
    version: STATE_VERSION,
    key: input.key,
    strategy: input.strategy,
    status,
    successes,
    failures,
    corrections,
    confirmations,
    confidence,
    firstObservedAt: previous?.firstObservedAt ?? input.occurredAt,
    lastObservedAt: input.occurredAt,
    lastOutcome: input.outcome,
    lastEvidence: input.evidence,
    ...projectId === undefined ? {} : { projectId },
    ...expiresAt === undefined ? {} : { expiresAt },
  }
}

function adaptiveSummary(state: AdaptiveLearningState): string {
  if (state.status === 'active') {
    return `Validated adaptive strategy: ${state.strategy}. Confidence ${state.confidence.toFixed(2)} from ${String(state.confirmations)} confirmation(s).`
  }
  if (state.status === 'quarantined') {
    return `Quarantined adaptive strategy; do not use without new evidence: ${state.strategy}. Failures ${String(state.failures)}, corrections ${String(state.corrections)}.`
  }
  return `Candidate adaptive strategy awaiting verified outcome: ${state.strategy}.`
}

/**
 * Decode a cognitive adaptive-state row without trusting arbitrary stored JSON.
 * @param row - Cognitive memory row that may contain versioned adaptive state.
 * @returns Valid adaptive state, or undefined when the row is unrelated or invalid.
 */
export function decodeAdaptiveState(row: AdaptiveStoredMemory): AdaptiveLearningState | undefined {
  if (row.subject === undefined || !row.subject.startsWith(ADAPTIVE_SUBJECT_PREFIX) || row.value === undefined) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(row.value)
  } catch {
    return undefined
  }
  if (!isRecord(raw) || raw.version !== STATE_VERSION) return undefined
  if (typeof raw.key !== 'string' || typeof raw.strategy !== 'string') return undefined
  if (raw.status !== 'candidate' && raw.status !== 'active' && raw.status !== 'quarantined') return undefined
  if (!isCount(raw.successes) || !isCount(raw.failures) || !isCount(raw.corrections) || !isCount(raw.confirmations)) return undefined
  if (!isConfidence(raw.confidence) || !isTimestamp(raw.firstObservedAt) || !isTimestamp(raw.lastObservedAt)) return undefined
  if (raw.lastOutcome !== 'candidate' && raw.lastOutcome !== 'success' && raw.lastOutcome !== 'failure' && raw.lastOutcome !== 'correction') return undefined
  if (typeof raw.lastEvidence !== 'string') return undefined
  if (raw.projectId !== undefined && typeof raw.projectId !== 'string') return undefined
  if (raw.expiresAt !== undefined && !isTimestamp(raw.expiresAt)) return undefined
  return {
    version: STATE_VERSION,
    key: raw.key,
    strategy: raw.strategy,
    status: raw.status,
    successes: raw.successes,
    failures: raw.failures,
    corrections: raw.corrections,
    confirmations: raw.confirmations,
    confidence: raw.confidence,
    firstObservedAt: raw.firstObservedAt,
    lastObservedAt: raw.lastObservedAt,
    lastOutcome: raw.lastOutcome,
    lastEvidence: raw.lastEvidence,
    ...raw.projectId === undefined ? {} : { projectId: raw.projectId },
    ...raw.expiresAt === undefined ? {} : { expiresAt: raw.expiresAt },
  }
}

/**
 * Hide candidate, quarantined, and expired adaptive rows from normal model memory search.
 * @param hits - Cognitive memory search results to filter.
 * @param now - Timestamp used to evaluate adaptive TTL expiry.
 * @returns Search results containing only usable adaptive rows plus unrelated memories.
 */
export function filterAdaptiveSearchHits(hits: readonly CognitiveMemoryHit[], now: number = Date.now()): CognitiveMemoryHit[] {
  return hits.filter((hit) => {
    if (hit.record.subject === undefined || !hit.record.subject.startsWith(ADAPTIVE_SUBJECT_PREFIX)) return true
    const state = decodeAdaptiveState(cognitiveRow(hit.record))
    return state?.status === 'active' && (state.expiresAt === undefined || state.expiresAt > now)
  })
}

/**
 * Install autonomous outcome observation into the existing learning plugin.
 * @param ctx - Cordis context providing session events and learning-memory services.
 * @returns Adaptive learning engine attached to the current runtime context.
 */
export function installAdaptiveLearning(ctx: Context): AdaptiveLearningEngine {
  const engine = new AdaptiveLearningEngine(cognitiveStore(ctx))
  const pendingTools = new Map<string, { readonly name: string; readonly strategy: string }>()
  const computerCandidates = new Map<string, Set<string>>()
  const lastStrategies = new Map<string, string>()

  ctx.on('session/event', (session, event) => {
    const sessionId = String(session.id)
    const eventType = String(event.type)
    const data = event.data as unknown
    const occurredAt = typeof event.time === 'number' ? event.time : Date.now()
    const eventSeq = typeof event.seq === 'number' ? event.seq : 0
    const projectId = ctx.learningMemory.currentProjectId()

    const run = async (): Promise<void> => {
      if (eventType === 'goal/false-pass') {
        computerCandidates.delete(sessionId)
        const payload = isRecord(data) ? data : {}
        const lessons = stringArray(payload.candidateProceduralLessons).slice(0, MAX_CONFIRM_RECENT)
        for (const strategy of lessons) {
          await engine.recordOutcome({
            strategy,
            evidence: 'Independent goal verification identified a corrective strategy after a false pass.',
            outcome: 'candidate',
            sessionId,
            eventSeq,
            sourceEventType: eventType,
            occurredAt,
            ...projectId === undefined ? {} : { projectId },
          })
          lastStrategies.set(sessionId, strategy)
        }
        return
      }

      if (eventType === 'goal/change' && isRecord(data) && data.operation === 'complete') {
        const eligibleComputerCandidates = computerCandidates.get(sessionId) ?? new Set<string>()
        const promoted = await engine.confirmRecentCandidates({
          sessionId,
          eventSeq,
          sourceEventType: eventType,
          occurredAt,
          evidence: 'Phoenix goal completion passed the configured fail-closed verification path.',
          ...projectId === undefined ? {} : { projectId },
        }, state => state.strategy !== 'Use tool computer' || eligibleComputerCandidates.has(state.strategy))
        computerCandidates.delete(sessionId)
        const newest = promoted.at(-1)
        if (newest !== undefined) lastStrategies.set(sessionId, newest.strategy)
        return
      }

      if (eventType === 'tool/call' && isRecord(data) && typeof data.name === 'string' && data.name.trim() !== '') {
        const name = data.name.trim().slice(0, 160)
        const strategy = `Use tool ${name}`
        pendingTools.set(sessionId, { name, strategy })
        lastStrategies.set(sessionId, strategy)
        return
      }

      if (eventType === 'tool/result') {
        const pending = pendingTools.get(sessionId)
        if (pending === undefined) return
        pendingTools.delete(sessionId)
        const failed = toolResultFailed(data)
        const outcome = adaptiveOutcomeForToolResult(pending.name, failed)
        if (pending.name === 'computer' && outcome.outcome === 'candidate') {
          const candidates = computerCandidates.get(sessionId) ?? new Set<string>()
          candidates.add(pending.strategy)
          computerCandidates.set(sessionId, candidates)
        } else if (pending.name === 'computer' && failed) {
          computerCandidates.get(sessionId)?.delete(pending.strategy)
        }
        await engine.recordOutcome({
          strategy: pending.strategy,
          evidence: failed ? 'The tool returned an error result.' : 'The tool completed without an error result.',
          ...outcome,
          sessionId,
          eventSeq,
          sourceEventType: eventType,
          occurredAt,
          ...projectId === undefined ? {} : { projectId },
        })
        return
      }

      if (eventType === 'goal/change' && isRecord(data) && data.operation === 'clear') {
        computerCandidates.delete(sessionId)
        return
      }

      if (eventType === 'user/message') {
        const text = messageText(data)
        const strategy = lastStrategies.get(sessionId)
        if (strategy !== undefined && text !== undefined && isExplicitCorrection(text)) {
          await engine.recordOutcome({
            strategy,
            evidence: 'The user explicitly corrected the previous strategy.',
            outcome: 'correction',
            sessionId,
            eventSeq,
            sourceEventType: 'user/correction',
            occurredAt,
            ...projectId === undefined ? {} : { projectId },
          })
        }
      }
    }

    void run().catch((error: unknown) => {
      ctx.logger.warn(`adaptive-learning: ignored ${eventType} outcome in ${sessionId}: ${String(error)}`)
    })
  })

  return engine
}

function cognitiveStore(ctx: Context): AdaptiveMemoryStore {
  return {
    timeline(query = {}) {
      return ctx.learningMemory.timeline({
        ...query.projectId === undefined ? {} : { projectId: query.projectId },
        ...query.sessionId === undefined ? {} : { sessionId: query.sessionId },
        ...query.includeHistory === undefined ? {} : { includeHistory: query.includeHistory },
      }).map(cognitiveRow)
    },
    async remember(input) {
      await ctx.learningMemory.rememberCognitive({
        sessionId: input.sessionId,
        eventSeq: input.eventSeq,
        kind: 'lesson',
        layers: ['autobiographical', 'semantic', 'procedural', 'temporal'],
        content: input.summary,
        summary: input.summary,
        sourceEventType: input.sourceEventType,
        occurredAt: input.occurredAt,
        subject: input.subject,
        value: input.value,
        confidence: input.confidence,
        importance: input.importance,
        ...input.projectId === undefined ? {} : { projectId: input.projectId },
      })
    },
  }
}

function cognitiveRow(record: CognitiveMemoryRecord): AdaptiveStoredMemory {
  return {
    summary: record.summary,
    sessionId: record.sessionId,
    status: record.status,
    occurredAt: record.provenance.occurredAt,
    sourceEventType: record.provenance.sourceEventType,
    ...record.subject === undefined ? {} : { subject: record.subject },
    ...record.value === undefined ? {} : { value: record.value },
    ...record.projectId === undefined ? {} : { projectId: record.projectId },
  }
}

function validateOutcomeInput(input: AdaptiveOutcomeInput): void {
  if (normalizeText(input.strategy) === '') throw new TypeError('adaptive learning strategy must be non-empty')
  if (normalizeText(input.evidence) === '') throw new TypeError('adaptive learning evidence must be non-empty')
  if (input.strategy.length > MAX_TEXT_CHARS || input.evidence.length > MAX_TEXT_CHARS) {
    throw new TypeError(`adaptive learning text must not exceed ${String(MAX_TEXT_CHARS)} characters`)
  }
  if (!Number.isSafeInteger(input.eventSeq) || input.eventSeq < 0) throw new TypeError('adaptive learning eventSeq must be a non-negative safe integer')
  if (!isTimestamp(input.occurredAt)) throw new TypeError('adaptive learning occurredAt must be a non-negative finite number')
  if (input.sessionId.trim() === '') throw new TypeError('adaptive learning sessionId must be non-empty')
  if (input.sourceEventType.trim() === '') throw new TypeError('adaptive learning sourceEventType must be non-empty')
  if (input.ttlMs !== undefined && (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1)) {
    throw new TypeError('adaptive learning ttlMs must be a positive safe integer')
  }
}

function rejectSecrets(value: string): void {
  const secretPatterns = [
    /\bbearer\s+\S+/iu,
    /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization|cookie)\s*[:=]\s*\S+/iu,
    /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/u,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  ] as const
  if (secretPatterns.some(pattern => pattern.test(value))) {
    throw new TypeError('adaptive learning refuses to persist secret-bearing evidence or strategies')
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function strategyKey(strategy: string): string {
  const normalized = strategy.normalize('NFKD').toLocaleLowerCase().replace(/\p{Diacritic}/gu, '').trim()
  let hash = 0x811c9dc5
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function sanitizeEventType(value: string): string {
  return value.replace(/[^A-Za-z0-9_./:-]/gu, '_').slice(0, 160)
}

function isExplicitCorrection(text: string): boolean {
  return EXPLICIT_CORRECTION_PATTERN.test(text)
}

function toolResultFailed(data: unknown): boolean {
  if (!isRecord(data)) return false
  const message = data.message
  if (!isRecord(message) || !Array.isArray(message.content)) return false
  const first = message.content[0]
  return isRecord(first) && first.isError === true
}

function messageText(data: unknown): string | undefined {
  if (!isRecord(data) || !Array.isArray(data.content)) return undefined
  const parts = data.content.flatMap(part => isRecord(part) && typeof part.text === 'string' ? [part.text] : [])
  const text = parts.join(' ').trim()
  return text === '' ? undefined : text
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
