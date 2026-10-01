/** Evidence-backed task experience aggregation for Phoenix. */

import type { CognitiveMemoryInput, CognitiveMemoryRecord } from '@phoenix-ai/dsh-session-learning'
import { fingerprintTask, taskSimilarity, type TaskFingerprint } from './task-context.ts'

const EXPERIENCE_SUBJECT_PREFIX = 'phoenix.learning.experience.'
const STATE_VERSION = 1 as const
const MAX_RECENT_RUNS = 12
const MAX_TASK_SUMMARY = 512

/** How far a repeated task has progressed from novel work toward a trusted habit. */
export type ExperienceMaturity = 'novel' | 'repeated' | 'candidate' | 'validated' | 'habitual'

/** Observed Phoenix Auto execution shape for one verified task. */
export type PhoenixAutoExecutionStrategy = 'serial' | 'parallel-1' | 'parallel-2'

/** Resource facts for one completed task episode. */
export interface ExperienceRunMetrics {
  readonly occurredAt: number
  readonly wallTimeMs: number
  readonly totalTokens: number
  readonly toolCalls: number
  readonly failedToolCalls: number
  readonly retries: number
  readonly userInterventions: number
  readonly verified: boolean
  readonly qualityPassed: boolean
  /** Strategy is recorded only when a verified task actually used Sol 6.1 plus Luna. */
  readonly phoenixAutoStrategy?: PhoenixAutoExecutionStrategy
  /** Number of observed Sol 6.1 routing phases; phases after the first are rescue/replan phases. */
  readonly phoenixAutoPlannerPhases?: number
  /** Number of observed GPT-6 Luna routing phases. */
  readonly phoenixAutoWorkerPhases?: number
  /** Number of Sol phases beyond the initial plan. */
  readonly phoenixAutoRescues?: number
  /** Number of workflow child agents started during the episode. */
  readonly phoenixAutoAgents?: number
}

/** Durable aggregate for one task fingerprint. */
export interface ExperienceAggregate {
  readonly version: typeof STATE_VERSION
  readonly key: string
  readonly taskFingerprint: TaskFingerprint
  readonly taskSummary: string
  readonly projectId?: string
  readonly maturity: ExperienceMaturity
  readonly runs: number
  readonly verifiedSuccesses: number
  readonly failures: number
  readonly totalWallTimeMs: number
  readonly totalTokens: number
  readonly totalToolCalls: number
  readonly totalFailedToolCalls: number
  readonly totalRetries: number
  readonly totalUserInterventions: number
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly recentRuns: readonly ExperienceRunMetrics[]
}

/** Provenance required when publishing one aggregate into cognitive memory. */
export interface ExperienceMemoryProvenance {
  readonly sessionId: string
  readonly eventSeq: number
  readonly occurredAt: number
}

interface ActiveEpisode {
  readonly taskFingerprint: TaskFingerprint
  readonly taskSummary: string
  readonly projectId?: string
  readonly startedAt: number
  totalTokens: number
  toolCalls: number
  failedToolCalls: number
  retries: number
  userInterventions: number
  phoenixAutoPlannerPhases: number
  phoenixAutoWorkerPhases: number
  phoenixAutoAgents: number
}

/**
 * Lightweight experience learner. It records cheap counters during normal work
 * and promotes repetition only after fail-closed verified completion.
 */
export class ExperienceLearningEngine {
  private readonly active = new Map<string, ActiveEpisode>()
  private readonly aggregates = new Map<string, ExperienceAggregate>()
  /** Child session -> top-level task session for resource attribution only. */
  private readonly parentByChild = new Map<string, string>()

  /**
   * Restore durable experience aggregates without replacing newer in-memory evidence.
   * @param records - records supplied to this public operation.
   */
  restore(records: readonly CognitiveMemoryRecord[]): void {
    for (const record of records) {
      if (record.status !== 'active') continue
      const state = decodeExperienceAggregate(record)
      if (state === undefined) continue
      const current = this.aggregates.get(scopedKey(state.key, state.projectId))
      if (current === undefined || current.lastObservedAt < state.lastObservedAt) {
        this.aggregates.set(scopedKey(state.key, state.projectId), state)
      }
    }
  }

  /**
   * Start measuring one direct user task. Starting a new task replaces only the
   * unfinished in-memory episode; unverified work is never promoted as success.
    * @param input - input supplied to this public operation.
   */
  beginTask(input: {
    readonly sessionId: string
    readonly text: string
    readonly occurredAt: number
    readonly projectId?: string
  }): void {
    const taskFingerprint = fingerprintTask(input.text)
    if (taskFingerprint.tokens.length === 0) return
    const current = this.active.get(input.sessionId)
    if (current !== undefined && taskSimilarity(current.taskFingerprint, taskFingerprint) >= 0.3) {
      current.userInterventions += 1
      return
    }
    this.clearChildLinks(input.sessionId)
    this.active.set(input.sessionId, {
      taskFingerprint,
      taskSummary: safeTaskSummary(input.text),
      startedAt: input.occurredAt,
      totalTokens: 0,
      toolCalls: 0,
      failedToolCalls: 0,
      retries: 0,
      userInterventions: 0,
      phoenixAutoPlannerPhases: 0,
      phoenixAutoWorkerPhases: 0,
      phoenixAutoAgents: 0,
      ...input.projectId === undefined ? {} : { projectId: input.projectId },
    })
  }

  /**
   * Record one model usage sample without storing prompts or model output.
   * @param sessionId - sessionId supplied to this public operation.
   * @param usage - usage supplied to this public operation.
   */
  observeUsage(sessionId: string, usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cacheReadTokens?: number
    readonly cacheWriteTokens?: number
    readonly reasoningTokens?: number
  }): void {
    const episode = this.episodeFor(sessionId)
    if (episode === undefined) return
    episode.totalTokens += nonNegative(usage.inputTokens)
      + nonNegative(usage.outputTokens)
      + nonNegative(usage.cacheReadTokens)
      + nonNegative(usage.cacheWriteTokens)
      + nonNegative(usage.reasoningTokens)
  }

  /**
   * Observe the effective provider/model route without retaining prompts or outputs.
   * Request headers are change snapshots, so these counters describe routing
   * phases rather than billing/model-call counts.
   * @param sessionId - Active task session.
   * @param route - Effective provider/model pair recorded by the request header.
   */
  observeModelRoute(sessionId: string, route: { readonly provider: string; readonly model: string }): void {
    const episode = this.episodeFor(sessionId)
    if (episode === undefined || route.provider !== 'openai-codex') return
    if (route.model === 'gpt-6.1-sol') episode.phoenixAutoPlannerPhases += 1
    else if (route.model === 'gpt-6-luna') episode.phoenixAutoWorkerPhases += 1
  }

  /**
   * Attribute one subagent session to the active top-level task without counting
   * it as parallelism. This captures direct-subagent resource cost as well as
   * workflow workers while keeping strategy classification tied to workflow
   * agent-start evidence.
   * @param parentSessionId - Durable parent session id.
   * @param childSessionId - Durable child session id.
   */
  linkChildSession(parentSessionId: string, childSessionId: string): void {
    if (childSessionId.length === 0 || childSessionId === parentSessionId) return
    const root = this.rootSessionId(parentSessionId)
    if (!this.active.has(root)) return
    this.parentByChild.set(childSessionId, root)
  }

  /**
   * Observe one workflow child start. Only the count is retained; child prompts,
   * labels, outputs, and identities never enter the learning aggregate.
   * @param sessionId - Active task session.
   */
  observeWorkflowAgentStart(sessionId: string, childSessionId?: string): void {
    const parentSessionId = this.rootSessionId(sessionId)
    const episode = this.active.get(parentSessionId)
    if (episode === undefined) return
    episode.phoenixAutoAgents += 1
    if (childSessionId !== undefined) this.linkChildSession(parentSessionId, childSessionId)
  }

  /**
   * Count a tool attempt. Raw arguments are deliberately not retained.
   * @param sessionId - sessionId supplied to this public operation.
   */
  observeToolCall(sessionId: string): void {
    const episode = this.episodeFor(sessionId)
    if (episode !== undefined) episode.toolCalls += 1
  }

  /**
   * Count a failed tool result as evidence of execution friction.
   * @param sessionId - sessionId supplied to this public operation.
   * @param failed - failed supplied to this public operation.
   */
  observeToolResult(sessionId: string, failed: boolean): void {
    const episode = this.episodeFor(sessionId)
    if (episode !== undefined && failed) episode.failedToolCalls += 1
  }

  /**
   * Count an LLM retry as avoidable resource overhead.
   * @param sessionId - sessionId supplied to this public operation.
   */
  observeRetry(sessionId: string): void {
    const episode = this.episodeFor(sessionId)
    if (episode !== undefined) episode.retries += 1
  }

  /**
   * Count an explicit human correction/intervention during an active episode.
   * @param sessionId - sessionId supplied to this public operation.
   */
  observeUserIntervention(sessionId: string): void {
    const episode = this.active.get(sessionId)
    if (episode !== undefined) episode.userInterventions += 1
  }

  /**
   * Drop unfinished experience when the governed task is explicitly cleared.
   * @param sessionId - sessionId supplied to this public operation.
   */
  clear(sessionId: string): void {
    const root = this.rootSessionId(sessionId)
    if (root !== sessionId) return
    this.active.delete(root)
    this.clearChildLinks(root)
  }

  /**
   * Promote the current episode after Phoenix's verified completion path.
   * End-to-end wall time is intentionally used so analysis and verification
   * cannot disappear from the efficiency accounting.
    * @param sessionId - sessionId supplied to this public operation.
    * @param occurredAt - occurredAt supplied to this public operation.
    * @returns Result produced by this public operation.
   */
  completeVerified(sessionId: string, occurredAt: number): ExperienceAggregate | undefined {
    const root = this.rootSessionId(sessionId)
    const episode = this.active.get(root)
    if (episode === undefined || root !== sessionId) return undefined
    this.active.delete(root)
    this.clearChildLinks(root)

    const previous = this.bestMatchingAggregate(episode.taskFingerprint, episode.projectId)
    const key = previous?.key ?? fingerprintKey(episode.taskFingerprint)
    const aggregateKey = scopedKey(key, episode.projectId)
    const phoenixAutoStrategy = executionStrategyFor(episode)
    const run: ExperienceRunMetrics = {
      occurredAt,
      wallTimeMs: Math.max(0, occurredAt - episode.startedAt),
      totalTokens: episode.totalTokens,
      toolCalls: episode.toolCalls,
      failedToolCalls: episode.failedToolCalls,
      retries: episode.retries,
      userInterventions: episode.userInterventions,
      verified: true,
      qualityPassed: true,
      ...phoenixAutoStrategy === undefined
        ? {}
        : {
            phoenixAutoStrategy,
            phoenixAutoPlannerPhases: episode.phoenixAutoPlannerPhases,
            phoenixAutoWorkerPhases: episode.phoenixAutoWorkerPhases,
            phoenixAutoRescues: Math.max(0, episode.phoenixAutoPlannerPhases - 1),
            phoenixAutoAgents: episode.phoenixAutoAgents,
          },
    }
    const runs = (previous?.runs ?? 0) + 1
    const verifiedSuccesses = (previous?.verifiedSuccesses ?? 0) + 1
    const failures = previous?.failures ?? 0
    const next: ExperienceAggregate = {
      version: STATE_VERSION,
      key,
      taskFingerprint: previous?.taskFingerprint ?? episode.taskFingerprint,
      taskSummary: previous?.taskSummary ?? episode.taskSummary,
      maturity: maturityFor(runs, verifiedSuccesses, failures),
      runs,
      verifiedSuccesses,
      failures,
      totalWallTimeMs: (previous?.totalWallTimeMs ?? 0) + run.wallTimeMs,
      totalTokens: (previous?.totalTokens ?? 0) + run.totalTokens,
      totalToolCalls: (previous?.totalToolCalls ?? 0) + run.toolCalls,
      totalFailedToolCalls: (previous?.totalFailedToolCalls ?? 0) + run.failedToolCalls,
      totalRetries: (previous?.totalRetries ?? 0) + run.retries,
      totalUserInterventions: (previous?.totalUserInterventions ?? 0) + run.userInterventions,
      firstObservedAt: previous?.firstObservedAt ?? episode.startedAt,
      lastObservedAt: occurredAt,
      recentRuns: [...(previous?.recentRuns ?? []), run].slice(-MAX_RECENT_RUNS),
      ...episode.projectId === undefined ? {} : { projectId: episode.projectId },
    }
    this.aggregates.set(aggregateKey, next)
    return next
  }

  /**
   * Find the best prior repeated-task experience for current model guidance.
   * @param text - text supplied to this public operation.
   * @param projectId - projectId supplied to this public operation.
   * @returns Result produced by this public operation.
   */
  matchTask(text: string, projectId?: string): ExperienceAggregate | undefined {
    const fingerprint = fingerprintTask(text)
    if (fingerprint.tokens.length === 0) return undefined
    const state = this.bestMatchingAggregate(fingerprint, projectId)
    return state === undefined ? undefined : structuredClone(state)
  }

  private bestMatchingAggregate(fingerprint: TaskFingerprint, projectId?: string): ExperienceAggregate | undefined {
    let best: ExperienceAggregate | undefined
    let bestScore = 0
    for (const state of this.aggregates.values()) {
      if (state.projectId !== projectId) continue
      const score = taskSimilarity(fingerprint, state.taskFingerprint)
      if (score < 0.3 || score <= bestScore) continue
      best = state
      bestScore = score
    }
    return best
  }

  /**
   * Read the latest aggregate for diagnostics and tests.
   * @param key - key supplied to this public operation.
   * @param projectId - projectId supplied to this public operation.
   * @returns Result produced by this public operation.
   */
  snapshot(key: string, projectId?: string): ExperienceAggregate | undefined {
    const state = this.aggregates.get(scopedKey(key, projectId))
    return state === undefined ? undefined : structuredClone(state)
  }

  private rootSessionId(sessionId: string): string {
    let current = sessionId
    const seen = new Set<string>()
    while (!seen.has(current)) {
      seen.add(current)
      const parent = this.parentByChild.get(current)
      if (parent === undefined) return current
      current = parent
    }
    return sessionId
  }

  private episodeFor(sessionId: string): ActiveEpisode | undefined {
    return this.active.get(this.rootSessionId(sessionId))
  }

  private clearChildLinks(parentSessionId: string): void {
    for (const [child, parent] of this.parentByChild) {
      if (parent === parentSessionId || child === parentSessionId) this.parentByChild.delete(child)
    }
  }
}

/**
 * Convert a verified experience aggregate into one durable cognitive-memory update.
 * @param state - state supplied to this public operation.
 * @param provenance - provenance supplied to this public operation.
 * @returns Result produced by this public operation.
 */
export function experienceMemoryInput(
  state: ExperienceAggregate,
  provenance: ExperienceMemoryProvenance,
): CognitiveMemoryInput {
  const averageMs = state.runs === 0 ? 0 : Math.round(state.totalWallTimeMs / state.runs)
  const averageTokens = state.runs === 0 ? 0 : Math.round(state.totalTokens / state.runs)
  const summary = [
    `Verified repeated-task experience [${state.maturity}] for: ${state.taskSummary}`,
    `runs=${state.runs}`,
    `verified=${state.verifiedSuccesses}`,
    `avgWallMs=${averageMs}`,
    `avgTokens=${averageTokens}`,
    `toolFailures=${state.totalFailedToolCalls}`,
    `retries=${state.totalRetries}`,
    `userInterventions=${state.totalUserInterventions}`,
  ].join(' · ')
  return {
    sessionId: provenance.sessionId,
    eventSeq: provenance.eventSeq,
    kind: 'lesson',
    layers: ['autobiographical', 'episodic', 'semantic', 'procedural', 'temporal'],
    content: summary,
    summary,
    sourceEventType: 'experience/verified-completion',
    occurredAt: provenance.occurredAt,
    subject: `${EXPERIENCE_SUBJECT_PREFIX}${state.key}`,
    value: JSON.stringify(state),
    confidence: confidenceFor(state),
    importance: state.maturity === 'habitual' ? 0.96 : state.maturity === 'validated' ? 0.9 : 0.76,
    ...state.projectId === undefined ? {} : { projectId: state.projectId },
  }
}

/**
 * Decode one durable aggregate without trusting arbitrary JSON.
 * @param record - record supplied to this public operation.
 * @returns Result produced by this public operation.
 */
export function decodeExperienceAggregate(record: Pick<CognitiveMemoryRecord, 'subject' | 'value'>): ExperienceAggregate | undefined {
  if (record.subject === undefined || !record.subject.startsWith(EXPERIENCE_SUBJECT_PREFIX) || record.value === undefined) return undefined
  let raw: unknown
  try { raw = JSON.parse(record.value) } catch { return undefined }
  if (!isRecord(raw) || raw.version !== STATE_VERSION) return undefined
  if (typeof raw.key !== 'string' || typeof raw.taskSummary !== 'string') return undefined
  if (!isTaskFingerprint(raw.taskFingerprint) || !isMaturity(raw.maturity)) return undefined
  if (!isCount(raw.runs) || !isCount(raw.verifiedSuccesses) || !isCount(raw.failures)) return undefined
  if (!isCount(raw.totalWallTimeMs) || !isCount(raw.totalTokens) || !isCount(raw.totalToolCalls)) return undefined
  if (!isCount(raw.totalFailedToolCalls) || !isCount(raw.totalRetries) || !isCount(raw.totalUserInterventions)) return undefined
  if (!isCount(raw.firstObservedAt) || !isCount(raw.lastObservedAt)) return undefined
  if (raw.projectId !== undefined && typeof raw.projectId !== 'string') return undefined
  if (!Array.isArray(raw.recentRuns) || raw.recentRuns.length > MAX_RECENT_RUNS || !raw.recentRuns.every(isRunMetrics)) return undefined
  return {
    version: STATE_VERSION,
    key: raw.key,
    taskFingerprint: raw.taskFingerprint,
    taskSummary: raw.taskSummary,
    maturity: raw.maturity,
    runs: raw.runs,
    verifiedSuccesses: raw.verifiedSuccesses,
    failures: raw.failures,
    totalWallTimeMs: raw.totalWallTimeMs,
    totalTokens: raw.totalTokens,
    totalToolCalls: raw.totalToolCalls,
    totalFailedToolCalls: raw.totalFailedToolCalls,
    totalRetries: raw.totalRetries,
    totalUserInterventions: raw.totalUserInterventions,
    firstObservedAt: raw.firstObservedAt,
    lastObservedAt: raw.lastObservedAt,
    recentRuns: raw.recentRuns,
    ...raw.projectId === undefined ? {} : { projectId: raw.projectId },
  }
}

/**
 * Stable key for one bounded task fingerprint.
 * @param fingerprint - fingerprint supplied to this public operation.
 * @returns Result produced by this public operation.
 */
export function fingerprintKey(fingerprint: TaskFingerprint): string {
  const source = fingerprint.tokens.length === 0 ? fingerprint.normalized : fingerprint.tokens.join('\n')
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function executionStrategyFor(episode: ActiveEpisode): PhoenixAutoExecutionStrategy | undefined {
  if (episode.phoenixAutoPlannerPhases === 0 || episode.phoenixAutoWorkerPhases === 0) return undefined
  if (episode.phoenixAutoAgents >= 2) return 'parallel-2'
  if (episode.phoenixAutoAgents === 1) return 'parallel-1'
  return 'serial'
}

function maturityFor(runs: number, verifiedSuccesses: number, failures: number): ExperienceMaturity {
  const successRate = verifiedSuccesses / Math.max(1, verifiedSuccesses + failures)
  if (verifiedSuccesses >= 5 && successRate >= 0.9) return 'habitual'
  if (verifiedSuccesses >= 3 && successRate >= 0.8) return 'validated'
  if (runs >= 3) return 'candidate'
  if (runs >= 2) return 'repeated'
  return 'novel'
}

function confidenceFor(state: ExperienceAggregate): number {
  if (state.maturity === 'habitual') return 0.97
  if (state.maturity === 'validated') return 0.92
  if (state.maturity === 'candidate') return 0.82
  if (state.maturity === 'repeated') return 0.72
  return 0.62
}

function safeTaskSummary(value: string): string {
  return value
    .replace(/\bbearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*\S+/giu, '[REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/gu, '[REDACTED]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_TASK_SUMMARY)
}

function scopedKey(key: string, projectId?: string): string {
  return `${projectId ?? 'global'}:${key}`
}

function nonNegative(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.trunc(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isMaturity(value: unknown): value is ExperienceMaturity {
  return value === 'novel' || value === 'repeated' || value === 'candidate' || value === 'validated' || value === 'habitual'
}

function isTaskFingerprint(value: unknown): value is TaskFingerprint {
  if (!isRecord(value) || typeof value.normalized !== 'string' || !Array.isArray(value.tokens)) return false
  return value.tokens.length <= 64 && value.tokens.every(token => typeof token === 'string' && token.length <= 160)
}

function isRunMetrics(value: unknown): value is ExperienceRunMetrics {
  if (!isRecord(value)) return false
  return isCount(value.occurredAt)
    && isCount(value.wallTimeMs)
    && isCount(value.totalTokens)
    && isCount(value.toolCalls)
    && isCount(value.failedToolCalls)
    && isCount(value.retries)
    && isCount(value.userInterventions)
    && value.verified === true
    && value.qualityPassed === true
    && (value.phoenixAutoStrategy === undefined || isPhoenixAutoStrategy(value.phoenixAutoStrategy))
    && (value.phoenixAutoPlannerPhases === undefined || isCount(value.phoenixAutoPlannerPhases))
    && (value.phoenixAutoWorkerPhases === undefined || isCount(value.phoenixAutoWorkerPhases))
    && (value.phoenixAutoRescues === undefined || isCount(value.phoenixAutoRescues))
    && (value.phoenixAutoAgents === undefined || isCount(value.phoenixAutoAgents))
}

function isPhoenixAutoStrategy(value: unknown): value is PhoenixAutoExecutionStrategy {
  return value === 'serial' || value === 'parallel-1' || value === 'parallel-2'
}
