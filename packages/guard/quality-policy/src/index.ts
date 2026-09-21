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
const SHELL_MUTATE = /(?:^|[\s;&|])(?:rm|mv|cp|mkdir|touch|git\s+(?:add|commit|merge|rebase|cherry-pick|reset|checkout|switch)|npm\s+(?:install|i)|pnpm\s+(?:install|add|remove)|pip\s+install|Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-Item|Rename-Item)\b|(?:>>?|\b(?:sed\s+-i|tee)\b)/i

const DOMAIN_PATTERNS: ReadonlyArray<readonly [QualityDomain, RegExp]> = [
  ['web', /\.(?:html?|css|scss|sass|less|tsx|jsx|vue|svelte)\b/i],
  ['code', /\.(?:ts|js|mjs|cjs|py|rs|go|java|kt|kts|c|cc|cpp|h|hpp|cs|php|rb|swift)\b/i],
  ['docs', /\.(?:md|mdx|txt|rst|docx|pdf|pptx)\b/i],
  ['data', /\.(?:csv|tsv|xlsx|xls|parquet|arrow|sql|sqlite|db)\b/i],
  ['config', /(?:^|[\\/"])(?:package\.json|tsconfig[^\\/\"]*\.json|\.env|[^\\/\"]+\.(?:ya?ml|toml|ini|env))\b/i],
]

const AUTOMATED_EVIDENCE_DOMAINS = new Set<QualityDomain>(['code', 'web', 'config'])

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
  return JSON.stringify(argumentsValue) ?? 'null'
}

/**
 * Strip transport/provider namespaces while preserving the operation name.
 * Examples: `mcp__GitHub__update_file` -> `update_file`,
 * `github.update_file` -> `update_file`, and `shell:bash` -> `bash`.
 */
function operationName(toolName: string): string {
  const normalized = toolName.toLowerCase().replaceAll('-', '_')
  const parts = normalized.split(/(?:__|[.:/])/)
  return parts.at(-1) || normalized
}

/**
 * Classify one tool call without network, filesystem, or model work.
 * @param toolName - registered tool name.
 * @param argumentsValue - already-materialized tool arguments.
 * @returns the quality-relevant activity class.
 */
export function classifyQualityActivity(toolName: string, argumentsValue: unknown): QualityActivity {
  const normalized = operationName(toolName)
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

interface QualitySignals {
  errorContract: boolean
  scale: boolean
}

interface QualityState {
  generation: number
  verifiedGeneration: number
  errorContractVerifiedGeneration: number
  scaleVerifiedGeneration: number
  nudgedGeneration: number
  stopNudges: number
  domains: Set<QualityDomain>
  signals: QualitySignals
}

function messageText(message: UserMessage): string {
  return message.content
    .filter((block): block is Extract<UserMessage['content'][number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' ')
}

/**
 * Infer task-local evidence obligations from the direct human request.
 * @param text - user request text for the current task.
 * @returns requirement signals that need targeted post-mutation evidence.
 */
export function inferQualitySignals(text: string): QualitySignals {
  const normalized = text.toLowerCase()
  const errorSubject = /\b(?:error|exception|throw|failure|cycle|missing dependency|missing dependencies|traceback)\b/u.test(normalized)
  const errorObservable = /\b(?:message|include|contain|list|identify|show|detail|field|code|which|exact)\b/u.test(normalized)
  const scale = /\b(?:performance|memory|latency|throughput|scal(?:e|ing|ability)|complexity|big[- ]?o|benchmark|stress|load|depth|concurren(?:cy|t)|10k|100k|million)\b/u.test(normalized)
    || /\b(?:\d{1,3}(?:[,_]\d{3})+|\d{4,})\b/u.test(normalized)
  return { errorContract: errorSubject && errorObservable, scale }
}

function newState(signals: QualitySignals = { errorContract: false, scale: false }): QualityState {
  return {
    generation: 0,
    verifiedGeneration: 0,
    errorContractVerifiedGeneration: 0,
    scaleVerifiedGeneration: 0,
    nudgedGeneration: 0,
    stopNudges: 0,
    domains: new Set<QualityDomain>(),
    signals,
  }
}

function stateFor(states: WeakMap<Agent, QualityState>, agent: Agent): QualityState {
  let state = states.get(agent)
  if (state !== undefined) return state
  state = newState()
  states.set(agent, state)
  return state
}

function needsAutomatedEvidence(domains: ReadonlySet<QualityDomain>): boolean {
  return [...domains].some(domain => AUTOMATED_EVIDENCE_DOMAINS.has(domain))
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
  return { ...decision, additionalContexts: [context, ...decision.additionalContexts ?? []] }
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

function missingSignalHint(state: QualityState): string {
  const missing: string[] = []
  if (state.signals.errorContract && state.errorContractVerifiedGeneration !== state.generation) {
    missing.push('Run a targeted check for the observable error contract: type plus required message/fields/details.')
  }
  if (state.signals.scale && state.scaleVerifiedGeneration !== state.generation) {
    missing.push('Run a bounded scale/resource check (time and/or memory as applicable) and inspect for avoidable superlinear growth.')
  }
  return missing.join(' ')
}

function stopReminder(state: QualityState): UserMessage {
  return pluginMessage(
    'This task has successful mutations after its latest accepted verification. Before presenting it as complete, '
      + qualityHint(state.domains)
      + ' ' + missingSignalHint(state)
      + ' Prefer the existing production/user entrypoint and the smallest high-signal check; do not rerun evidence '
      + 'that is still fresh. If no meaningful automated check exists, inspect the final artifact and state the verification limit.',
    'fresh requirement-aware verification needed',
  )
}

function markMutation(state: QualityState, argumentsValue: unknown): boolean {
  const wasFresh = state.generation === state.verifiedGeneration
  state.generation += 1
  for (const domain of inferQualityDomains(argumentsValue)) state.domains.add(domain)
  return wasFresh
}

function markEvidence(
  state: QualityState,
  activity: Extract<QualityActivity, 'verification' | 'inspection'>,
  argumentsValue: unknown,
): void {
  if (activity !== 'verification' && needsAutomatedEvidence(state.domains)) return
  state.verifiedGeneration = state.generation
  if (activity !== 'verification') return
  const text = argumentText(argumentsValue).toLowerCase()
  if (/\b(?:error|exception|cycle|missing|message|diagnostic|failure|invalid)\b/u.test(text)) {
    state.errorContractVerifiedGeneration = state.generation
  }
  if (/\b(?:benchmark|bench|perf|performance|memory|tracemalloc|scal|stress|load|10_?000|10000|30_?000|30000|big[- ]?o)\b/u.test(text)) {
    state.scaleVerifiedGeneration = state.generation
  }
}

function evidenceFresh(state: QualityState): boolean {
  if (state.generation !== state.verifiedGeneration) return false
  if (state.signals.errorContract && state.errorContractVerifiedGeneration !== state.generation) return false
  if (state.signals.scale && state.scaleVerifiedGeneration !== state.generation) return false
  return true
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
    if (message.source.kind === 'user') states.set(agent, newState(inferQualitySignals(messageText(message))))
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
      if (!wasFresh) return downstream
      return prependContext(mutationReminder(state.domains), downstream)
    }

    if (result.isError || downstream.kind === 'block') return downstream
    markEvidence(state, activity, exec.arguments)
    return downstream
  })

  ctx.on('agent/turn-stopping', ({ agent }) => {
    if (maxStopNudges === 0) return
    const state = states.get(agent)
    if (state === undefined || evidenceFresh(state)) return
    if (state.stopNudges >= maxStopNudges || state.nudgedGeneration === state.generation) return
    state.stopNudges += 1
    state.nudgedGeneration = state.generation
    agent.steer(stopReminder(state))
  })

  ctx.on('agent/disposed', ({ agent }) => {
    states.delete(agent)
  })
}
