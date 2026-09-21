/**
 * Low-latency completion-quality policy.
 *
 * The guard treats successful mutations as invalidating prior verification
 * evidence, accepts only verification observed after the latest mutation, and
 * uses the existing post-tool and turn-stopping extension points to nudge the
 * model without any extra model request on the compliant path.
 * @module @phoenix-ai/dsh-quality-policy
 */

import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import type { UserMessage } from '@phoenix-ai/dsh-session'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@phoenix-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'quality-policy'
/** The policy observes the tool pipeline and requires the registry to exist. */
export const inject = ['tools']

/** Tool activity relevant to completion-quality evidence. */
export type QualityActivity = 'mutation' | 'verification' | 'inspection' | 'other'

/** Broad artifact families used only to select a short verification hint. */
export type QualityDomain = 'code' | 'web' | 'docs' | 'data' | 'config' | 'generic'

/** Deployment policy. */
export interface Config {
  /**
   * Maximum turn-stop corrective nudges for one direct human task.
   * Zero disables the stop nudge while retaining in-band post-mutation context.
   */
  maxStopNudges?: number
}

/** Validated deployment schema. */
export const Config: z<Config> = z.object({
  maxStopNudges: z.number().step(1).min(0).max(3).default(1),
})

const MUTATION_NAME = /^(?:write|edit|str_replace_editor|apply_patch|create_file|update_file|delete_file|move_file|rename_file|upload(?:_.*)?|deploy(?:_.*)?|publish(?:_.*)?)$/
const VERIFICATION_NAME = /^(?:verify(?:_.*)?|check(?:_.*)?|test(?:_.*)?|lint(?:_.*)?|typecheck(?:_.*)?|build(?:_.*)?|smoke(?:_.*)?)$/
const INSPECTION_NAME = /^(?:read|grep|glob|search|find|fetch|web_fetch|screenshot(?:_.*)?)$/
const SHELL_NAME = /^(?:bash|pwsh|run_code)$/
const SHELL_VERIFY = /\b(?:vitest|pytest|unittest|jest|mocha|tsc|oxlint|eslint|ruff|mypy|cargo\s+test|go\s+test|dotnet\s+test|pnpm\s+(?:run\s+)?(?:test|check|lint|typecheck|build|verify)|npm\s+(?:run\s+)?(?:test|check|lint|build|verify)|yarn\s+(?:test|check|lint|build)|python\s+-m\s+pytest)\b/i
const SHELL_MUTATE = /(?:^|[\s;&|])(?:rm|mv|cp|mkdir|touch|git\s+(?:add|commit|merge|rebase|cherry-pick|reset|checkout|switch)|npm\s+(?:install|i)|pnpm\s+(?:install|add|remove)|pip\s+install)\b|(?:>>?|\b(?:sed\s+-i|tee)\b)/i

const DOMAIN_PATTERNS: ReadonlyArray<readonly [QualityDomain, RegExp]> = [
  ['web', /\.(?:html?|css|scss|sass|less|tsx|jsx|vue|svelte)\b/i],
  ['code', /\.(?:ts|js|mjs|cjs|py|rs|go|java|kt|kts|c|cc|cpp|h|hpp|cs|php|rb|swift)\b/i],
  ['docs', /\.(?:md|mdx|txt|rst|docx|pdf|pptx)\b/i],
  ['data', /\.(?:csv|tsv|xlsx|xls|parquet|arrow|sql|sqlite|db)\b/i],
  ['config', /(?:^|[\\/])(?:package\.json|tsconfig[^\\/]*\.json|[^\\/]+\.(?:ya?ml|toml|ini|env))\b/i],
]

const DOMAIN_HINTS: Record<QualityDomain, string> = {
  code: 'Prefer one focused automated check that exercises the changed behavior; include boundary/error cases when material.',
  web: 'Prefer a build plus one real rendered/entrypoint smoke for the changed surface; do not accept console/runtime errors or broken assets.',
  docs: 'Inspect the final rendered/read-back artifact for completeness, consistency, formatting, links, and requested language/structure.',
  data: 'Validate schema, nulls, ranges, units, row/record integrity, and one representative read-back.',
  config: 'Validate parsing/loading and the consuming command or startup path, not only the edited text.',
  generic: 'Use the cheapest check that proves the requested outcome at the real consumer boundary.',
}

/** Lossless JSON arguments have a stable enough textual projection for local classification. */
function argumentText(argumentsValue: unknown): string {
  return JSON.stringify(argumentsValue)
}

/**
 * Classify one tool call without network, filesystem, or model work.
 * @param toolName - registered tool name.
 * @param argumentsValue - already-materialized tool arguments.
 * @returns the quality-relevant activity class.
 */
export function classifyQualityActivity(toolName: string, argumentsValue: unknown): QualityActivity {
  const normalized = toolName.toLowerCase()
  if (MUTATION_NAME.test(normalized)) return 'mutation'
  if (VERIFICATION_NAME.test(normalized)) return 'verification'
  if (INSPECTION_NAME.test(normalized)) return 'inspection'
  if (!SHELL_NAME.test(normalized)) return 'other'
  const text = argumentText(argumentsValue)
  if (SHELL_VERIFY.test(text)) return 'verification'
  if (SHELL_MUTATE.test(text)) return 'mutation'
  return 'other'
}

/**
 * Infer the artifact families touched by one call from its JSON arguments.
 * Multiple domains are retained because e.g. TSX is both code and web work.
 * @param argumentsValue - already-materialized tool arguments.
 * @returns at least one domain, with generic as the fallback.
 */
export function inferQualityDomains(argumentsValue: unknown): QualityDomain[] {
  const text = argumentText(argumentsValue)
  const domains = DOMAIN_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([domain]) => domain)
  return domains.length === 0 ? ['generic'] : [...new Set(domains)]
}

interface QualityState {
  generation: number
  verifiedGeneration: number
  reminderGeneration: number
  nudgedGeneration: number
  stopNudges: number
  domains: Set<QualityDomain>
}

function stateFor(states: WeakMap<Agent, QualityState>, agent: Agent): QualityState {
  let state = states.get(agent)
  if (state !== undefined) return state
  state = {
    generation: 0,
    verifiedGeneration: 0,
    reminderGeneration: 0,
    nudgedGeneration: 0,
    stopNudges: 0,
    domains: new Set<QualityDomain>(),
  }
  states.set(agent, state)
  return state
}

function needsAutomatedEvidence(domains: ReadonlySet<QualityDomain>): boolean {
  return domains.has('code') || domains.has('web') || domains.has('config')
}

function qualityHint(domains: ReadonlySet<QualityDomain>): string {
  const selected = [...domains]
    .filter(domain => domain !== 'generic')
    .map(domain => DOMAIN_HINTS[domain])
  return selected.length === 0 ? DOMAIN_HINTS.generic : selected.join(' ')
}

function pluginMessage(text: string, summary: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'quality-policy', form: 'notice', summary },
  })
}

function prependContext(context: UserMessage, decision: PostToolDecision): PostToolDecision {
  const additionalContexts = [context, ...decision.additionalContexts ?? []]
  if (decision.kind === 'block') {
    return { kind: 'block', feedback: decision.feedback, additionalContexts }
  }
  if ('value' in decision) {
    return { kind: 'accept', value: decision.value, additionalContexts }
  }
  return {
    kind: 'accept',
    ...decision.content === undefined ? {} : { content: decision.content },
    additionalContexts,
  }
}

function mutationReminder(domains: ReadonlySet<QualityDomain>): UserMessage {
  return pluginMessage(
    'Fresh verification evidence is now stale because the artifact changed. '
      + qualityHint(domains)
      + ' Reuse still-fresh evidence for unchanged inputs, choose cheap deterministic checks before a model judge, '
      + 'and batch independent checks in one command or run them in parallel when possible.',
    'verification invalidated by mutation',
  )
}

function stopReminder(domains: ReadonlySet<QualityDomain>): UserMessage {
  return pluginMessage(
    'This task has successful mutations after its latest accepted verification. Before presenting it as complete, '
      + qualityHint(domains)
      + ' Prefer the existing production/user entrypoint and the smallest high-signal check; do not rerun evidence '
      + 'that is still fresh. If no meaningful automated check exists, inspect the final artifact and state the verification limit.',
    'fresh verification needed',
  )
}

function markMutation(state: QualityState, argumentsValue: unknown): boolean {
  const wasFresh = state.generation === state.verifiedGeneration
  state.generation += 1
  for (const domain of inferQualityDomains(argumentsValue)) state.domains.add(domain)
  return wasFresh
}

function markEvidence(state: QualityState, activity: Extract<QualityActivity, 'verification' | 'inspection'>): void {
  if (activity === 'verification' || !needsAutomatedEvidence(state.domains)) {
    state.verifiedGeneration = state.generation
  }
}

/**
 * Install mutation-aware evidence freshness and bounded completion nudges.
 * @param ctx - plugin context.
 * @param config - validated deployment policy.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const maxStopNudges = config.maxStopNudges ?? 1
  if (!Number.isSafeInteger(maxStopNudges) || maxStopNudges < 0 || maxStopNudges > 3) {
    throw new TypeError('quality-policy: maxStopNudges must be an integer from 0 through 3')
  }

  const states = new WeakMap<Agent, QualityState>()

  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message.source.kind === 'user') states.delete(agent)
  })

  ctx.on('tools/post-execute', async (exec: ToolExecution, result: Readonly<ToolExecutionResult>, next): Promise<PostToolDecision> => {
    const downstream = await next()
    if (exec.agent === undefined) return downstream

    const activity = classifyQualityActivity(exec.name, exec.arguments)
    if (activity === 'other') return downstream
    const state = stateFor(states, exec.agent)

    if (activity === 'mutation') {
      if (result.isError) return downstream
      const wasFresh = markMutation(state, exec.arguments)
      if (!wasFresh || state.reminderGeneration === state.generation) return downstream
      state.reminderGeneration = state.generation
      return prependContext(mutationReminder(state.domains), downstream)
    }

    if (result.isError || downstream.kind === 'block') return downstream
    markEvidence(state, activity)
    return downstream
  })

  ctx.on('agent/turn-stopping', ({ agent }) => {
    if (maxStopNudges === 0) return
    const state = states.get(agent)
    if (state === undefined || state.generation === state.verifiedGeneration) return
    if (state.stopNudges >= maxStopNudges || state.nudgedGeneration === state.generation) return
    state.stopNudges += 1
    state.nudgedGeneration = state.generation
    agent.steer(stopReminder(state.domains))
  })

  ctx.on('agent/disposed', ({ agent }) => {
    states.delete(agent)
  })
}
