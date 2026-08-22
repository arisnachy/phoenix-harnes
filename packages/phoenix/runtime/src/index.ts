/**
 * PHOENIX Runtime — adaptive policy layer mounted inside DeepSeek Harness.
 * It uses DSH seams rather than replacing the agent loop.
 * @module @arisnachy/phoenix-runtime
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig, LlmModelInfo } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-token-meter'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { classifyTaskRole, isTrivialDelegation } from './task-role.ts'
import {
  ModelCapabilityLadder,
  type CapabilityEvidence,
  type ModelRef,
  type PhoenixRole,
  type RankedModel,
} from './model-ladder.ts'
import { readLocalState, writeLocalState, type PhoenixLocalState } from './persistence.ts'

export * from './model-ladder.ts'
export * from './task-role.ts'
export type * from './persistence.ts'

/** PHOENIX runtime policy knobs; all defaults preserve native DSH execution seams. */
export interface PhoenixRuntimeConfig {
  /** Enable evidence-ranked model selection for qualified candidates. */
  routing?: boolean
  /** Permit bounded cross-provider failover after the native provider retry chain declines. */
  failover?: boolean
  /** Deny trivial delegations whose model cost exceeds the expected deterministic-tool value. */
  agentRoi?: boolean
  /** Persist local benchmark evidence and quarantine state between harness launches. */
  localEvolution?: boolean
  /** Optional fail-closed ceiling for measured request-context tokens before a model step may enter. */
  hardContextTokens?: number
  /** Maximum cross-provider retries PHOENIX may request for one agent step. */
  maxFailoversPerStep?: number
  /** Optional local state file; defaults under the DSH home directory. */
  statePath?: string
}

export interface FlightRecord {
  at: number
  agentId: string
  turn: number
  step: number
  role: PhoenixRole
  totalTokens: number
  surfaceTokens: number
  systemTokens?: number
  toolsTokens?: number
  messageTokens?: number
}

interface AttemptTarget extends ModelRef {
  role: PhoenixRole
  turn: number
  step: number
}

interface ContextBreakdownLike {
  systemTokens?: number
  toolsTokens?: number
  messageTokens?: number
}

const RETRYABLE_FAILOVER_CODES = new Set([
  'RATE_LIMIT',
  'QUOTA',
  'OVERLOADED',
  'SERVER',
  'TRANSPORT',
  'TIMEOUT',
  'UPSTREAM',
])

function agentKey(agent: Agent, turn: number, step: number): string {
  return `${String(agent.id)}:${turn}:${step}`
}

function sameRef(a: ModelRef, b: ModelRef): boolean {
  return a.provider === b.provider && a.model === b.model
}

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  for (const key of ['task', 'prompt', 'message', 'description', 'objective']) {
    if (typeof record[key] === 'string') return record[key]
  }
  return ''
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    phoenix: PhoenixRuntime
  }
}

/**
 * PHOENIX adaptive policy service. Capability ranking and authority stay
 * separate: quarantined/provisional models are never selected by the router.
 */
export default class PhoenixRuntime extends Service {
  static inject = ['llm', 'tokenMeter', 'tools']
  static Config: z<PhoenixRuntimeConfig> = z.object({
    routing: z.boolean().default(true),
    failover: z.boolean().default(true),
    agentRoi: z.boolean().default(true),
    localEvolution: z.boolean().default(true),
    hardContextTokens: z.number().min(1),
    maxFailoversPerStep: z.number().min(0).max(8).step(1).default(2),
    statePath: z.string(),
  }) as z<PhoenixRuntimeConfig>

  readonly ladder: ModelCapabilityLadder = new ModelCapabilityLadder()
  readonly flight: FlightRecord[] = []
  private readonly config: Required<Pick<PhoenixRuntimeConfig, 'routing' | 'failover' | 'agentRoi' | 'localEvolution' | 'maxFailoversPerStep'>> & PhoenixRuntimeConfig
  private readonly roles = new WeakMap<Agent, PhoenixRole>()
  private readonly selected = new Map<string, AttemptTarget>()
  private readonly override = new Map<string, ModelRef>()
  private readonly failovers = new Map<string, number>()
  private catalog: ModelRef[] = []
  private readonly statePath: string
  private localState: PhoenixLocalState

  constructor(ctx: Context, config: PhoenixRuntimeConfig = {}) {
    super(ctx, 'phoenix')
    this.config = {
      routing: config.routing ?? true,
      failover: config.failover ?? true,
      agentRoi: config.agentRoi ?? true,
      localEvolution: config.localEvolution ?? true,
      maxFailoversPerStep: config.maxFailoversPerStep ?? 2,
      ...config,
    }
    this.statePath = config.statePath ?? dshHomePath('phoenix', 'local-evolution.json')
    this.localState = this.config.localEvolution ? readLocalState(this.statePath) : { version: 1, evidence: [], quarantined: [] }
    for (const evidence of this.localState.evidence) this.ladder.record(evidence)
    for (const ref of this.localState.quarantined) this.ladder.quarantine(ref)

    void this.refreshCatalog()
    ctx.on('llm/adapters-updated', () => { void this.refreshCatalog() })

    ctx.on('agent/pre-step', async ({ agent, messages, turn, step }, next) => {
      const decision = await next()
      const entering = decision.kind === 'enter' ? decision.messages : messages
      const role = classifyTaskRole(entering)
      this.roles.set(agent, role)
      const measurement = ctx.tokenMeter.measure(agent.session)
      const breakdown = (measurement as unknown as { contextBreakdown?: ContextBreakdownLike }).contextBreakdown
      this.flight.push({
        at: Date.now(),
        agentId: String(agent.id),
        turn,
        step,
        role,
        totalTokens: measurement.totalTokens,
        surfaceTokens: measurement.surfaceTokens,
        ...breakdown?.systemTokens === undefined ? {} : { systemTokens: breakdown.systemTokens },
        ...breakdown?.toolsTokens === undefined ? {} : { toolsTokens: breakdown.toolsTokens },
        ...breakdown?.messageTokens === undefined ? {} : { messageTokens: breakdown.messageTokens },
      })
      if (this.flight.length > 1000) this.flight.splice(0, this.flight.length - 1000)
      if (decision.kind === 'enter' && this.config.hardContextTokens !== undefined
        && measurement.totalTokens > this.config.hardContextTokens) {
        ctx.logger.warn(`phoenix: context pressure ${measurement.totalTokens} exceeds hard ceiling ${this.config.hardContextTokens}; rejecting step fail-closed`)
        return { kind: 'reject' as const }
      }
      return decision
    })

    ctx.on('agent/request', async ({ agent, turn, step }, next): Promise<LlmCallConfig> => {
      const base = await next()
      const role = this.roles.get(agent) ?? 'routine'
      const key = agentKey(agent, turn, step)
      const forced = this.override.get(key)
      const ranked = this.config.routing ? this.ladder.rank(role, this.catalog) : []
      const target = forced ?? ranked[0]
      const chosen = target === undefined ? { provider: base.provider, model: base.model } : target
      this.selected.set(key, { ...chosen, role, turn, step })
      if (sameRef(chosen, { provider: base.provider, model: base.model })) return base
      return { ...base, provider: chosen.provider, model: chosen.model }
    }, { prepend: true })

    ctx.on('agent/request-error', async ({ agent, turn, step, provider, failure, signal }, next) => {
      const key = agentKey(agent, turn, step)
      const attempt = this.selected.get(key)
      if (attempt !== undefined) this.observeMission(attempt, 'reliability', 0, false)

      const downstream = await next()
      if (downstream !== undefined || signal.aborted || !this.config.failover
        || !RETRYABLE_FAILOVER_CODES.has(failure.code)) return downstream

      const used = this.failovers.get(key) ?? 0
      if (used >= this.config.maxFailoversPerStep) return undefined
      const role = attempt?.role ?? this.roles.get(agent) ?? 'routine'
      const ranked = this.ladder.rank(role, this.catalog)
      const current: ModelRef = attempt ?? { provider, model: agent.options.model ?? '' }
      const alternate = ranked.find(candidate => candidate.provider !== provider && !sameRef(candidate, current))
      if (alternate === undefined) return undefined
      this.override.set(key, alternate)
      this.failovers.set(key, used + 1)
      ctx.logger.warn(`phoenix: ${failure.code} on ${provider}; failing over to ${alternate.provider}/${alternate.model}`)
      return { kind: 'retry' as const }
    }, { prepend: true })

    ctx.on('agent/turn-stopping', ({ agent, turn }) => {
      for (const [key, attempt] of this.selected) {
        if (!key.startsWith(`${String(agent.id)}:${turn}:`)) continue
        this.observeMission(attempt, 'reliability', 100, true)
        this.override.delete(key)
        this.failovers.delete(key)
        this.selected.delete(key)
      }
    })

    ctx.on('agent/error', ({ agent, turn, step }) => {
      const key = agentKey(agent, turn, step)
      this.override.delete(key)
      this.failovers.delete(key)
      this.selected.delete(key)
    })

    if (this.config.agentRoi) {
      ctx.on('tools/pre-execute', async (exec: ToolExecution, next): Promise<PreToolDecision> => {
        if (!/subagent|spawn_agent|delegate/i.test(exec.name)) return next()
        const task = textFromUnknown(exec.arguments)
        if (!isTrivialDelegation(task)) return next()
        return {
          kind: 'deny',
          reason: 'PHOENIX Agent ROI Gate: use a direct deterministic tool for this trivial lookup instead of spawning a subagent',
        }
      }, { prepend: true })
    }

    ctx.tools.guard(exec => this.motherGuard(exec))
  }

  /**
   * Record authority-grade benchmark or operator evidence for one model capability.
   * Mission and collective observations are rejected here so they cannot grant role authority.
   * @param evidence - benchmark/operator capability evidence to add to the ladder and durable local state.
   */
  recordBenchmark(evidence: CapabilityEvidence): void {
    if (evidence.source !== 'benchmark' && evidence.source !== 'operator') {
      throw new Error('PHOENIX authority evidence must come from benchmark or operator sources')
    }
    const safe: CapabilityEvidence = { ...evidence }
    this.ladder.record(safe)
    if (this.config.localEvolution) {
      this.localState.evidence.push(safe)
      this.localState.evidence = this.localState.evidence.slice(-5000)
      this.flushState()
    }
  }

  /**
   * Quarantine a provider/model so it cannot win PHOENIX routing.
   * @param ref - provider/model identity to quarantine.
   */
  quarantine(ref: ModelRef): void {
    this.ladder.quarantine(ref)
    if (this.config.localEvolution) {
      if (!this.localState.quarantined.some(value => sameRef(value, ref))) this.localState.quarantined.push({ ...ref })
      this.flushState()
    }
  }

  /**
   * Release a provider/model from quarantine; it regains only the trust justified by authority-grade evidence.
   * @param ref - provider/model identity whose quarantine marker should be removed.
   */
  releaseQuarantine(ref: ModelRef): void {
    this.ladder.releaseQuarantine(ref)
    if (this.config.localEvolution) {
      this.localState.quarantined = this.localState.quarantined.filter(value => !sameRef(value, ref))
      this.flushState()
    }
  }

  /**
   * Rank currently discovered, qualified models for one PHOENIX role.
   * @param role - capability role whose weighted evidence profile should be applied.
   * @returns Qualified model candidates ordered from strongest to weakest evidence score.
   */
  rank(role: PhoenixRole): RankedModel[] {
    return this.ladder.rank(role, this.catalog)
  }

  private observeMission(target: AttemptTarget, dimension: 'reliability' | 'efficiency', score: number, reproducible: boolean): void {
    const evidence: CapabilityEvidence = {
      provider: target.provider,
      model: target.model,
      dimension,
      score,
      source: 'mission',
      observedAt: Date.now(),
      reproducible,
      weight: 0.25,
    }
    this.ladder.record(evidence)
  }

  private async refreshCatalog(): Promise<void> {
    const seen = new Map<string, ModelRef>()
    for (const provider of this.ctx.llm.listProviders()) {
      let models: readonly LlmModelInfo[] = []
      try {
        models = await this.ctx.llm.listModels(provider.id)
      } catch {
        continue
      }
      for (const model of models) {
        const ref = { provider: model.provider, model: model.id }
        seen.set(`${ref.provider}\u0000${ref.model}`, ref)
        this.ladder.register(ref)
      }
    }
    this.catalog = [...seen.values()]
  }

  private motherGuard(exec: ToolExecution): string | undefined {
    const raw = JSON.stringify(exec.arguments).toLowerCase()
    if (/git\s+push\s+.*(--force|-f)\b/.test(raw)) return 'PHOENIX Mother Guard: force-push is forbidden'
    if (/\.github\/|packages\/phoenix\/security|security\.md|codeowners/.test(raw)
      && /(write|edit|replace|delete|remove|patch|mv|move)/.test(`${exec.name} ${raw}`)) {
      return 'PHOENIX Mother Guard: security/control-plane paths require explicit human-governed change flow'
    }
    if (/(peer.?to.?peer|remote).{0,80}(execute|install|mcp|script|command|patch)/.test(raw)) {
      return 'PHOENIX Security Membrane: peer-supplied executable evolution is forbidden'
    }
    return undefined
  }

  private flushState(): void {
    writeLocalState(this.statePath, this.localState)
  }
}
