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

const MUTATION_NAME = new RegExp(
  '^(?:write|edit|str_replace_editor|apply_patch|create_file|update_file|delete_fil'
      + 'e|move_file|rename_file|upload(?:_.*)?|deploy(?:_.*)?|publish(?:_.*)?)$',
)
const VERIFICATION_NAME = /^(?:verify(?:_.*)?|check(?:_.*)?|test(?:_.*)?|lint(?:_.*)?|typecheck(?:_.*)?|build(?:_.*)?|smoke(?:_.*)?)$/
const INSPECTION_NAME = /^(?:read|grep|glob|search|find|fetch|web_fetch|screenshot(?:_.*)?)$/
const SHELL_NAME = /^(?:bash|pwsh|run_code)$/
const SHELL_VERIFY = new RegExp(
  '\\b(?:vitest|pytest|unittest|jest|mocha|tsc|oxlint|eslint|ruff|mypy|cargo\\s+test|'
      + 'go\\s+test|dotnet\\s+test|pnpm\\s+(?:run\\s+)?(?:test|check|lint|typecheck|build|ver'
      + 'ify)|npm\\s+(?:run\\s+)?(?:test|check|lint|build|verify)|yarn\\s+(?:test|check|lint'
      + '|build)|python\\s+-m\\s+pytest)\\b', 'i',
)
const SHELL_MUTATE = new RegExp(
  '(?:^|[\\s;&|])(?:rm|mv|cp|mkdir|touch|git\\s+(?:add|commit|merge|rebase|cherry-pic'
      + 'k|reset|checkout|switch)|npm\\s+(?:install|i)|pnpm\\s+(?:install|add|remove)|pip\\s'
      + '+install|Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-It'
      + 'em|Rename-Item)\\b|(?:>>?|\\b(?:sed\\s+-i|tee)\\b)', 'i',
)

const DOMAIN_PATTERNS: ReadonlyArray<readonly [QualityDomain, RegExp]> = [
  ['web', /\.(?:html?|css|scss|sass|less|tsx|jsx|vue|svelte)\b/i],
  ['code', /\.(?:tsx?|jsx?|mjs|cjs|py|rs|go|java|kt|kts|c|cc|cpp|h|hpp|cs|php|rb|swift)\b/i],
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
  const args = argumentsValue !== null && typeof argumentsValue === 'object'
    ? argumentsValue as Record<string, unknown> : undefined
  const command = normalized === 'run_code' ? args?.code : args?.command
  const text = typeof command === 'string' ? command : argumentText(argumentsValue)
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
  unicodeBoundary: boolean
  zeroProgress: boolean
  differentialOracle: boolean
}

interface QualityState {
  generation: number
  verifiedGeneration: number
  errorContractVerifiedGeneration: number
  scaleVerifiedGeneration: number
  nudgedGeneration: number
  stopNudges: number
  failedTool: string | undefined
  failureNudged: boolean
  handoffNudged: boolean
  toolAttempts: number
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
  const scale = new RegExp(
    '\\b(?:performance|memory|latency|throughput|scal(?:e|ing|ability)|complexity|big['
      + '- ]?o|benchmark|stress|load|depth|concurren(?:cy|t)|10k|100k|million)\\b', 'u',
  ).test(normalized)
    || /\b(?:\d{1,3}(?:[,_]\d{3})+|\d{4,})\b/u.test(normalized)
  const unicodeBoundary = new RegExp(
    '\\b(?:unicode|utf|surrogate|non[- ]?bmp|character|escape|json|string|text|parser|'
      + 'regex|regexp)\\b', 'u',
  ).test(normalized)
  const zeroProgress = new RegExp(
    '\\b(?:loop|while|iterator|iteration|parser|parse|regex|regexp|match|token|lexer|s'
      + 'canner|consume|cursor|stream)\\b', 'u',
  ).test(normalized)
  const differentialOracle = new RegExp(
    '\\b(?:json|regex|regexp|url|uri|base64|csv|parser|compatible|standard|reference|o'
      + 'racle|math|expression)\\b', 'u',
  ).test(normalized)
  return { errorContract: errorSubject && errorObservable, scale, unicodeBoundary, zeroProgress, differentialOracle }
}

function newState(signals: QualitySignals = {
  errorContract: false,
  scale: false,
  unicodeBoundary: false,
  zeroProgress: false,
  differentialOracle: false,
}): QualityState {
  return {
    generation: 0,
    verifiedGeneration: 0,
    errorContractVerifiedGeneration: 0,
    scaleVerifiedGeneration: 0,
    nudgedGeneration: 0,
    stopNudges: 0,
    failedTool: undefined,
    failureNudged: false,
    handoffNudged: false,
    toolAttempts: 0,
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
  if (state.signals.unicodeBoundary) missing.push('Cover empty/single/boundary text plus Unicode outside the BMP or surrogate behavior when applicable.')
  if (state.signals.zeroProgress) missing.push('Prove loop/iterator termination when an inner match or consume step advances zero units.')
  if (state.signals.differentialOracle) missing.push('Prefer differential generated/fuzz checks against a trustworthy oracle; otherwise use property/metamorphic invariants.')
  return missing.join(' ')
}

function stopReminder(state: QualityState): UserMessage {
  return pluginMessage(
    'This task has successful mutations after its latest accepted verification. Before presenting it as complete, '
      + qualityHint(state.domains)
      + ' ' + missingSignalHint(state)
      + ' Mechanically re-check every literal named requirement from the original request. Audit important test expected values so they come from the spec/oracle/invariant, never from the implementation under test. '
      + 'Prefer the existing production/user entrypoint and the smallest high-signal check; do not rerun evidence that is still fresh. '
      + 'Before final completion, explicitly decide known limitations even when none remain. If no meaningful automated check exists, inspect the final artifact and state the verification limit.',
    'fresh requirement-aware verification needed',
  )
}

/** A single stop-bound recovery chance after an unresolved tool error, even without file mutations. */
function failureReminder(): UserMessage {
  return pluginMessage(
    'The last tool attempt failed or was blocked, and no successful alternative has been observed since. '
      + 'Do not end the task merely because this route failed. Inspect the failure, then use a materially different, '
      + 'relevant and permitted tool or source. Do not create unrelated accounts or financial side effects. '
      + 'If only optional evidence is missing, provide the best truthful, useful result with clearly marked assumptions. '
      + 'If credentials, permission, quota or another genuine external dependency prevent completion, state the exact '
      + 'blocker and what was completed; never fabricate success or retry indefinitely.',
    'unresolved tool failure: change strategy',
  )
}

/** Detect a premature handoff after an unsuccessful lookup, without penalizing ordinary uncertainty.
 * @param text - Last assistant message in the turn.
 * @returns Whether the model transferred routine research back to the user without a usable output.
 */
export function isUnfinishedResearchHandoff(text: string): boolean {
  const missing = new RegExp(
    '(?:no encontr[eé]|no consegu[ií]|no (?:pude|puedo) (?:encontrar|obtener|verifica'
      + 'r|acceder)|could not find|couldn\'t find|unable to find|did not find)', 'iu',
  )
  const asksUserToResearch = new RegExp(
    '(?:si (?:me |nos )?(?:compartes|env[ií]as|proporcionas|facilitas)|(?:comparte|en'
      + 'v[ií]ame|facil[ií]tame) (?:una? |los? |las? )?(?:captura|lista|datos|cuotas|resu'
      + 'ltados)|if you (?:send|share|provide)|please (?:send|share|provide))', 'iu',
  )
  return missing.test(text) && asksUserToResearch.test(text)
}

/**
 * Detect a premature categorical refusal of an otherwise ongoing authorized task.
 * A single refusal is not evidence the user objective was completed, but this
 * nudge never overrides actual tool permissions, site terms or transaction consent.
 * @param text - Observed text to classify or present.
 * @returns Whether the requested condition holds.
 */
export function isPrematureAuthorizedTaskRefusal(text: string): boolean {
  const refusal = new RegExp(
    '(?:no (?:puedo|podr[eé]|es posible) (?:armar|preparar|completar|rellenar|crear|c'
      + 'onfigurar|terminar|continuar|hacer|realizar|enviar|colocar)|i (?:can\'t|cannot|wo'
      + 'n\'t|am unable to) (?:prepare|complete|fill|create|finish|continue|make|place|sub'
      + 'mit))', 'iu',
  )
  const unfinished = new RegExp(
    '(?:no (?:qued[oó]|est[aá]) (?:list[oa]|terminad[oa])|no (?:hay|existe) (?:un[ao]'
      + '? )?(?:recibo|confirmaci[oó]n)|(?:no puedo|can\'t|cannot)|(?:sigo|still) (?:sin|w'
      + 'ithout))', 'iu',
  )
  const prepared = new RegExp(
    '(?:aqu[ií] (?:tienes|est[aá]) (?:el|la|tu) (?:borrador|cup[oó]n|formulario)|(?:b'
      + 'orrador|cup[oó]n|formulario) (?:preparado|listo|completado)|(?:draft|form) (?:is'
      + ' )?(?:ready|prepared))', 'iu',
  )
  return refusal.test(text) && unfinished.test(text) && !prepared.test(text)
}



function assistantTextInTurn(agent: Agent, turn: number): string {
  const last = agent.session.events.findLast(event =>
    event.type === 'assistant/message' && event.data.turn === turn)
  if (last?.type !== 'assistant/message') return ''
  return last.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join(' ')
}

function handoffReminder(): UserMessage {
  return pluginMessage(
    'You found no useful information on one search route, then asked the user to supply routine research inputs. '
      + 'That is not completion. Keep the original objective and any as-of knowledge cutoff. '
      + 'Try a materially different authoritative source or a bounded offline route. '
      + 'If precise historical odds are unavailable, offer a usable conditional or hypothetical deliverable '
      + 'with plainly marked unknowns, without inventing real games, data, or guaranteed outcomes. '
      + 'Do not move funds or activate unrelated services. A truly indispensable credential, permission '
      + 'or unknown user preference may still require a focused clarification.',
    'research handoff before delivering result',
  )
}

/** One bounded continuation after an unsupported, categorical early refusal. */
function prematureRefusalReminder(): UserMessage {
  return pluginMessage(
    'The previous response stopped with a categorical inability statement although the user had asked for task execution. '
      + 'Do not repeat the refusal. Identify the most specific unavailable final action and perform any remaining authorized preparation with the existing browser or tools. '
      + 'For example, preparing a selection and leaving a betting slip unsubmitted are distinct from placing a money wager; finish permissible drafting and request transaction-specific confirmation before any monetary commitment. '
      + 'Keep the user informed about what is prepared, what remains, and the exact missing authorization or capability. '
      + 'Do not claim success, a booked transaction or a receipt without direct external evidence, and never bypass policy, site restrictions, or a mandatory approval.',
    'premature task refusal: continue authorized preparation',
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

    const state = stateFor(states, exec.agent)
    state.toolAttempts += 1
    if (result.isError || downstream.kind === 'block') {
      state.failedTool = exec.name
      state.failureNudged = false
    } else {
      state.failedTool = undefined
    }

    const activity = classifyQualityActivity(exec.name, exec.arguments)
    if (activity === 'other') return downstream

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

  ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    if (maxStopNudges === 0) return
    const state = states.get(agent)
    if (state === undefined || state.stopNudges >= maxStopNudges) return
    if (!evidenceFresh(state)) {
      if (state.nudgedGeneration === state.generation) return
      state.stopNudges += 1
      state.nudgedGeneration = state.generation
      agent.steer(stopReminder(state))
      return
    }
    if (state.failedTool !== undefined && !state.failureNudged) {
      state.stopNudges += 1
      state.failureNudged = true
      agent.steer(failureReminder())
      return
    }
    if (state.handoffNudged) return
    const answer = assistantTextInTurn(agent, turn)
    if (isPrematureAuthorizedTaskRefusal(answer)) {
      state.stopNudges += 1
      state.handoffNudged = true
      agent.steer(prematureRefusalReminder())
      return
    }
    if (state.toolAttempts === 0 || !isUnfinishedResearchHandoff(answer)) return
    state.stopNudges += 1
    state.handoffNudged = true
    agent.steer(handoffReminder())
  })

  ctx.on('agent/disposed', ({ agent }) => {
    states.delete(agent)
  })
}
