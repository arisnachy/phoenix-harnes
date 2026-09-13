/** Read-only Cordis service projecting deterministic cognitive state per session. */

import { Context, Service } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type {} from '@phoenix-ai/dsh-agent'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import { SessionId } from '@phoenix-ai/dsh-session'
import type { LearningMemoryService } from '@phoenix-ai/dsh-session-learning'
import type { AssembleContext } from '@phoenix-ai/dsh-system-prompt'
import { scoreAttention } from './attention.ts'
import { validateCognitiveState } from './invariant.ts'
import { partitionWorkingMemory } from './working-memory.ts'
import { createGlobalWorkspace } from './workspace.ts'
import { cloneAttentionCandidate } from './clone.ts'
import { renderCognitiveModelContext } from './model-context.ts'
import type { CognitiveModelContextOptions } from './model-context.ts'
import { COMPLETION_AUDIT_PROMPT, turnNeedsQualityAudit } from './quality-gate.ts'
import type { AttentionWeights, CognitiveState } from './types.ts'

export { scoreAttention } from './attention.ts'
export { partitionWorkingMemory } from './working-memory.ts'
export { createGlobalWorkspace } from './workspace.ts'
export { renderCognitiveModelContext } from './model-context.ts'
export type { CognitiveModelContextOptions } from './model-context.ts'
export { COMPLETION_AUDIT_PROMPT, turnNeedsQualityAudit } from './quality-gate.ts'
export type * from './types.ts'

declare module '@phoenix-ai/cordis' {
  interface Context {
    cognitiveRuntime: CognitiveRuntimeService
    learningMemory: LearningMemoryService
  }

  interface Events {
    /**
     * Internal validation signal for one successful process-local snapshot.
     * @mode emit
     * @param state - Detached cognitive state published after validation.
     * @param config - Resolved bounds used to derive the state.
     */
    'cognitive-runtime/state'(state: CognitiveState, config: Readonly<CognitiveRuntimeConfig>): void
  }
}

/** Deployment-owned bounded attention and working-memory configuration. */
export interface CognitiveRuntimeConfig {
  /** Maximum active ledger records read for one session refresh. */
  readonly maxCandidates: number
  /** Maximum records retained after the focus candidate. */
  readonly activeLimit: number
  /** Maximum records retained in the lower-priority background region. */
  readonly backgroundLimit: number
  /** Relative weights used by the pure attention scorer. */
  readonly weights: AttentionWeights
}

/** Compatibility name for the resolved cognitive-runtime configuration. */
export type Config = CognitiveRuntimeConfig

const MAX_CANDIDATES = 128
const MAX_REGION = 128
const COGNITIVE_CONTEXT_ORDER = 7_000
const DEFAULT_CONFIG: CognitiveRuntimeConfig = {
  maxCandidates: 64,
  activeLimit: 8,
  backgroundLimit: 16,
  weights: {
    importance: 1,
    confidence: 1,
    recency: 1,
    urgency: 1,
    goalRelevance: 1,
    novelty: 1,
  },
}

const WeightConfig: z<AttentionWeights> = z.object({
  importance: z.number().min(0).default(1),
  confidence: z.number().min(0).default(1),
  recency: z.number().min(0).default(1),
  urgency: z.number().min(0).default(1),
  goalRelevance: z.number().min(0).default(1),
  novelty: z.number().min(0).default(1),
})

/** Runtime schema with explicit finite bounds for every deployment tunable. */
export const Config: z<CognitiveRuntimeConfig> = z.object({
  maxCandidates: z.number().step(1).min(1).max(MAX_CANDIDATES).default(DEFAULT_CONFIG.maxCandidates),
  activeLimit: z.number().step(1).min(0).max(MAX_REGION).default(DEFAULT_CONFIG.activeLimit),
  backgroundLimit: z.number().step(1).min(0).max(MAX_REGION).default(DEFAULT_CONFIG.backgroundLimit),
  weights: WeightConfig.default(DEFAULT_CONFIG.weights),
})

/** Event-backed, process-local cognitive runtime service. */
export class CognitiveRuntimeService extends Service {
  static inject = ['sessions', 'learningMemory']
  static Config: z<CognitiveRuntimeConfig> = Config

  /** Resolved immutable configuration used by every snapshot. */
  readonly config: Readonly<CognitiveRuntimeConfig>
  private readonly states = new Map<string, CognitiveState>()
  private readonly auditedTurns = new Map<string, Set<number>>()
  private operationTail: Promise<void> = Promise.resolve()

  /** @param ctx - Host context containing sessions and learning memory. */
  constructor(ctx: Context, config: CognitiveRuntimeConfig = DEFAULT_CONFIG) {
    super(ctx, 'cognitiveRuntime')
    const resolved = resolveConfig(config)
    this.config = Object.freeze({ ...resolved, weights: Object.freeze({ ...resolved.weights }) })

    // Prompt assembly is optional for diagnostics/tests that run the cognitive
    // service without an agent stack. When present, this provider is evaluated
    // before every model step through the existing runtime-context projection.
    ctx.inject(['systemPrompt'], (promptCtx) => {
      promptCtx.systemPrompt.context({
        name: 'cognitive-runtime:workspace',
        order: COGNITIVE_CONTEXT_ORDER,
        interpolateVariables: false,
        text: (context) => {
          const sessionId = sessionIdFromAssembly(context)
          return sessionId === undefined ? '' : this.modelContext(sessionId)
        },
      })
    })
  }

  /** Seed existing sessions and subscribe to the canonical live event stream. */
  protected async [Service.init](): Promise<void> {
    this.ctx.on('session/created', (session) => { void this.enqueue(() => this.refreshSafe(session.id)) })
    this.ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/end') this.clearAudit(session.id, event.data.turn)
      if (event.type === 'assistant/chunk' || event.ignorable === true) return
      void this.enqueue(() => this.refreshSafe(session.id))
    })
    this.ctx.on('session/disposed', (session) => {
      this.states.delete(String(session.id))
      this.auditedTurns.delete(String(session.id))
    })

    // A tool-using turn receives one bounded completion audit before it may
    // close. The audit marker is set before steering so re-entrant stop checks
    // cannot schedule a second review for the same turn.
    this.ctx.on('agent/turn-stopping', ({ agent, turn }) => {
      const alreadyAudited = this.wasAudited(agent.id, turn)
      if (!turnNeedsQualityAudit(agent.session.events, turn, alreadyAudited)) return
      this.markAudited(agent.id, turn)
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: COMPLETION_AUDIT_PROMPT }],
        source: { kind: 'plugin', plugin: 'cognitive-runtime' },
      }))
    })

    await this.enqueue(async () => {
      for (const session of this.ctx.sessions.list()) await this.refreshSafe(session.id)
    })
  }

  /** Wait until initial reconstruction and all queued refreshes are settled. */
  async ready(): Promise<void> {
    await this.operationTail
  }

  /**
   * Read a detached state for one exact live session.
   * @param sessionId - Session identity to read.
   * @returns A detached state, or `undefined` when the session is not live.
   */
  get(sessionId: SessionId): CognitiveState | undefined {
    if (this.ctx.sessions.get(sessionId) === undefined) return undefined
    const state = this.states.get(String(sessionId))
    return state === undefined ? undefined : cloneState(state)
  }

  /**
   * Render the bounded cognitive workspace consumed by the model at each step.
   * The canonical state remains detached and background/suppressed memory stays
   * outside the prompt budget.
   */
  modelContext(sessionId: SessionId, options: CognitiveModelContextOptions = {}): string {
    return renderCognitiveModelContext(this.get(sessionId), options)
  }

  /**
   * Rebuild one session's state through the serialized refresh queue.
   * @param sessionId - Session identity to refresh.
   * @returns The newly rebuilt state, the retained prior state after failure, or `undefined` for a missing session.
   */
  async refresh(sessionId: SessionId): Promise<CognitiveState | undefined> {
    return this.enqueue(() => this.refreshSafe(sessionId))
  }

  /** Rebuild one state and retain the last successful value after a failure. */
  private async refreshSafe(sessionId: SessionId): Promise<CognitiveState | undefined> {
    try {
      return await this.refreshNow(sessionId)
    } catch (error: unknown) {
      this.ctx.logger.warn(`cognitive-runtime: refresh for "${String(sessionId)}" failed; retaining prior state: ${String(error)}`)
      return this.get(sessionId)
    }
  }

  /** Derive and publish one state only after every input and invariant succeeds. */
  private async refreshNow(sessionId: SessionId): Promise<CognitiveState | undefined> {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) {
      this.states.delete(String(sessionId))
      return undefined
    }
    await this.ctx.learningMemory.ready()
    const records = this.ctx.learningMemory.cognitiveForSession(sessionId, this.config.maxCandidates)
    const candidates = scoreAttention(records, this.config.weights)
    const partition = partitionWorkingMemory(candidates, this.config.activeLimit, this.config.backgroundLimit)
    const observedSeq = records.reduce((max, record) => Math.max(max, record.eventSeq), -1)
    const projectId = records.find(record => record.projectId !== undefined)?.projectId
    const state = createGlobalWorkspace(session.id, projectId, observedSeq, candidates, partition)
    validateCognitiveState(state, this.config)
    this.ctx.emit('cognitive-runtime/state', state, this.config)
    this.states.set(String(sessionId), state)
    return cloneState(state)
  }

  /** Queue one operation while allowing a failed predecessor to be followed. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationTail.then(operation)
    this.operationTail = next.then(() => undefined, () => undefined)
    return next
  }

  private wasAudited(sessionId: SessionId, turn: number): boolean {
    return this.auditedTurns.get(String(sessionId))?.has(turn) === true
  }

  private markAudited(sessionId: SessionId, turn: number): void {
    const key = String(sessionId)
    const turns = this.auditedTurns.get(key) ?? new Set<number>()
    turns.add(turn)
    this.auditedTurns.set(key, turns)
  }

  private clearAudit(sessionId: SessionId, turn: number): void {
    const key = String(sessionId)
    const turns = this.auditedTurns.get(key)
    if (turns === undefined) return
    turns.delete(turn)
    if (turns.size === 0) this.auditedTurns.delete(key)
  }
}

function sessionIdFromAssembly(context: AssembleContext): SessionId | undefined {
  const candidate = (context as AssembleContext & { agent?: { id?: unknown } }).agent?.id
  return typeof candidate === 'string' && candidate.length > 0 ? SessionId(candidate) : undefined
}

function resolveConfig(config: CognitiveRuntimeConfig): CognitiveRuntimeConfig {
  if (!Number.isSafeInteger(config.maxCandidates) || config.maxCandidates < 1 || config.maxCandidates > MAX_CANDIDATES) {
    throw new TypeError(`cognitive-runtime maxCandidates must be a safe integer between 1 and ${String(MAX_CANDIDATES)}`)
  }
  if (!Number.isSafeInteger(config.activeLimit) || config.activeLimit < 0 || config.activeLimit > MAX_REGION) {
    throw new TypeError(`cognitive-runtime activeLimit must be a non-negative safe integer up to ${String(MAX_REGION)}`)
  }
  if (!Number.isSafeInteger(config.backgroundLimit) || config.backgroundLimit < 0 || config.backgroundLimit > MAX_REGION) {
    throw new TypeError(`cognitive-runtime backgroundLimit must be a non-negative safe integer up to ${String(MAX_REGION)}`)
  }
  const weights = { ...config.weights }
  for (const [key, value] of Object.entries(weights)) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`cognitive-runtime weight ${key} must be finite and non-negative`)
  }
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0)
  if (totalWeight <= 0) throw new TypeError('cognitive-runtime weights must have a positive total')
  return { ...config, weights }
}

function cloneState(state: CognitiveState): CognitiveState {
  return {
    sessionId: state.sessionId,
    ...state.projectId === undefined ? {} : { projectId: state.projectId },
    observedSeq: state.observedSeq,
    candidateCount: state.candidateCount,
    ...state.focus === undefined ? {} : { focus: cloneAttentionCandidate(state.focus) },
    active: state.active.map(cloneAttentionCandidate),
    background: state.background.map(cloneAttentionCandidate),
    suppressed: state.suppressed.map(cloneAttentionCandidate),
  }
}

export { CognitiveRuntimeService as default }
