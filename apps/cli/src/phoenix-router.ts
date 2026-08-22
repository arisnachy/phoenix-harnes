/**
 * PHOENIX's deterministic task router. It keeps routine work on a local lane
 * and promotes explicitly requested, long, or configured high-complexity work
 * to a separately declared free lane. Provider adapters and credentials stay
 * outside this package; it only selects an already registered route.
 *
 * @module @deepseek-ai/dsh/phoenix-router
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  installModelSelection,
  type Agent,
  type ModelSelection,
  type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'

/** Prefix that forces a task onto the local lane. The prefix remains model-visible. */
export const FORCE_LOCAL_PREFIX = '[phoenix:local]'
/** Prefix that forces a task onto the configured free external lane. */
export const FORCE_FREE_PREFIX = '[phoenix:free]'

/** Default bilingual signals that indicate work needing the stronger free lane. */
export const DEFAULT_EXTERNAL_SIGNALS = [
  'architecture',
  'arquitectura',
  'security audit',
  'auditoría de seguridad',
  'threat model',
  'modelo de amenazas',
  'migration plan',
  'plan de migración',
  'race condition',
  'condición de carrera',
  'root cause',
  'causa raíz',
  'cross-module',
  'multi-package',
  'formal proof',
  'prueba formal',
] as const

/** One registered Harness provider/model pair. */
export interface Route {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** PHOENIX router configuration. Every tunable is composition-visible. */
export interface Config {
  /** Local, no-network-by-design lane. */
  local: Route
  /** Free external lane; the shipped profile binds this to `orcarouter/free`. */
  free: Route
  /** Promote user text at or above this character count. */
  externalMinChars?: number
  /** Number of distinct configured signals required for promotion. */
  externalSignalThreshold?: number
  /** Case-insensitive literal substrings counted as complexity signals. */
  externalSignals?: string[]
}

const routeSchema: z<Route> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
})

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  local: routeSchema,
  free: routeSchema,
  externalMinChars: z.number().step(1).min(1).default(1200),
  externalSignalThreshold: z.number().step(1).min(1).default(1),
  externalSignals: z.array(z.string()).default([...DEFAULT_EXTERNAL_SIGNALS]),
})

/** Stable explanation for a routing decision. */
export type RouteReason = 'forced-local' | 'forced-free' | 'length' | 'signals' | 'default-local'

/** Observable result of the pure classifier. */
export interface RouteDecision {
  /** Selected lane. */
  lane: 'local' | 'free'
  /** Stable decision category. */
  reason: RouteReason
  /** Input length used by the policy. */
  inputChars: number
  /** Distinct configured signals found in the input. */
  matchedSignals: string[]
}

/** Fully defaulted facts consumed by the pure classifier. */
export interface ClassifierPolicy {
  externalMinChars: number
  externalSignalThreshold: number
  externalSignals: readonly string[]
}

/**
 * Classify task text without network, model, history, or hidden state.
 * Explicit prefixes win, then length, then distinct literal signals.
 *
 * @param text - New task text for one step.
 * @param policy - Fully resolved public policy thresholds.
 * @returns Selected lane plus stable evidence for the choice.
 */
export function classifyTask(text: string, policy: ClassifierPolicy): RouteDecision {
  const normalized = text.trimStart().toLocaleLowerCase('en-US')
  const localPrefix = FORCE_LOCAL_PREFIX.toLocaleLowerCase('en-US')
  const freePrefix = FORCE_FREE_PREFIX.toLocaleLowerCase('en-US')
  const matchedSignals = [...new Set(policy.externalSignals
    .map(signal => signal.trim().toLocaleLowerCase('en-US'))
    .filter(signal => signal.length > 0 && normalized.includes(signal)))]
  if (normalized.startsWith(localPrefix)) {
    return { lane: 'local', reason: 'forced-local', inputChars: text.length, matchedSignals }
  }
  if (normalized.startsWith(freePrefix)) {
    return { lane: 'free', reason: 'forced-free', inputChars: text.length, matchedSignals }
  }
  if (text.length >= policy.externalMinChars) {
    return { lane: 'free', reason: 'length', inputChars: text.length, matchedSignals }
  }
  if (matchedSignals.length >= policy.externalSignalThreshold) {
    return { lane: 'free', reason: 'signals', inputChars: text.length, matchedSignals }
  }
  return { lane: 'local', reason: 'default-local', inputChars: text.length, matchedSignals }
}

/** Text carried by a task-opening message, excluding tool results and ordinary plugin notices. */
function taskText(message: UserMessage): string | undefined {
  if (message.source.kind !== 'user'
    && !(message.source.kind === 'plugin' && message.source.form === 'relay')) return undefined
  return message.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join('\n')
}

/** Cordis plugin name. */
export const name = 'phoenix-model-router'
/** The agent registry must exist so current and future agents receive the policy. */
export const inject = ['agents']

/** Install PHOENIX routing over the Agent extension seams. */
export function apply(ctx: Context, config: Config): void {
  const local: ModelSelection = { ...config.local }
  const free: ModelSelection = { ...config.free }
  const policy: ClassifierPolicy = {
    externalMinChars: config.externalMinChars as number,
    externalSignalThreshold: config.externalSignalThreshold as number,
    externalSignals: config.externalSignals as string[],
  }
  if (policy.externalSignals.every(signal => signal.trim().length === 0)) {
    throw new Error('phoenix-model-router: `externalSignals` must contain at least one non-empty signal')
  }

  const selections = new WeakMap<Agent, ModelSelectionRef>()
  const disposers = new Map<Agent, () => void>()
  const install = (agent: Agent): void => {
    if (disposers.has(agent)) return
    const selection: ModelSelectionRef = { current: local, assembled: undefined }
    selections.set(agent, selection)
    disposers.set(agent, installModelSelection(agent.ctx, selection))
  }
  const uninstall = (agent: Agent): void => {
    disposers.get(agent)?.()
    disposers.delete(agent)
    selections.delete(agent)
  }

  for (const agent of ctx.agents.list()) install(agent)
  ctx.on('agent/created', ({ agent }) => { install(agent) })
  ctx.on('agent/disposed', ({ agent }) => { uninstall(agent) })
  // Inbox claiming precedes system-prompt assembly in the Agent machine. That
  // ordering is the earliest point where the new task text is known and keeps
  // persona variables and request routing on the same selection snapshot.
  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    const text = taskText(message)
    if (text !== undefined) {
      const decision = classifyTask(text, policy)
      const selection = selections.get(agent)
      if (selection !== undefined) selection.current = decision.lane === 'free' ? free : local
      ctx.logger.debug(
        `phoenix-model-router: ${agent.id} -> ${decision.lane} (${decision.reason}; chars=${decision.inputChars}; signals=${decision.matchedSignals.length})`,
      )
    }
  })
  ctx.effect(() => () => {
    for (const dispose of disposers.values()) dispose()
    disposers.clear()
  }, 'phoenix-model-router: agent selections')
}
