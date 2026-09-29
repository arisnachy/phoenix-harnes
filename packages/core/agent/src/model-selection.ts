/**
 * Agent-scoped model selection shared by runtime entry points.
 * @module @phoenix-ai/dsh-agent/model-selection
 */

import type { Context } from '@phoenix-ai/cordis'
import { ReasoningEffortId, type LlmCallConfig } from '@phoenix-ai/dsh-llm'

/** Complete provider, model, and optional reasoning effort selected for one live Agent. */
export interface ModelSelection {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: ReasoningEffortId
}

/** Concrete OpenAI Codex routes currently backing the synthetic Phoenix Auto selector. */
export interface PhoenixCodexAutoRoutes {
  /** Newest advertised Sol route validated for planning and final review. */
  planner: string
  /** Newest advertised Luna route validated for execution and independent review. */
  worker: string
}

/** Mutable model selection plus the value captured for the current step. */
export interface ModelSelectionRef {
  /** Model selected for the next step that enters prompt assembly. */
  current: ModelSelection | undefined
  /** Selection captured when the current step entered prompt assembly. */
  assembled: ModelSelection | undefined
  /** Number of model-facing tools captured with the same prompt assembly. */
  assembledToolCount?: number
  /** Live concrete Sol/Luna routes behind Phoenix Auto, refreshed from the provider catalog. */
  phoenixAutoRoutes?: PhoenixCodexAutoRoutes
}

/** Route used after the initial diagnosis/plan step of a turn. */
export interface ModelSelectionHandoff {
  /** Last 1-based step that remains on the selected model; execution starts after it. */
  afterStep: number
  /** Model and effort used for subsequent execution steps. */
  selection: ModelSelection
}

/** Re-resolve the execution handoff from the model currently selected for this step. */
type ModelSelectionHandoffResolver = (selection: ModelSelection | undefined) => ModelSelectionHandoff | undefined


/** Synthetic selector row that enables Phoenix's adaptive Codex router. */
export const PHOENIX_CODEX_AUTO_MODEL = 'phoenix-auto'
/** Compatibility fallback when a caller has not yet supplied live catalog routes. */
export const PHOENIX_CODEX_AUTO_PLANNER_MODEL = 'gpt-6-sol'
/** Compatibility fallback when a caller has not yet supplied live catalog routes. */
export const PHOENIX_CODEX_AUTO_WORKER_MODEL = 'gpt-6-luna'
/** Marker required at the start of the independent Luna review workflow prompt. */
export const PHOENIX_CODEX_AUTO_REVIEW_MARKER = 'PHOENIX_AUTO_REVIEW'

const PHOENIX_CODEX_AUTO_GUIDANCE = `
Phoenix Auto routing contract:
- The newest available Sol plans, orchestrates, rescues stalled work, and makes the final acceptance decision.
- The newest available Luna at Max performs substantive execution. The root Luna is the primary executor; add at most one independent Luna executor only when a genuinely independent branch shortens the critical path, so execution uses one or two Luna workers in total.
- Prefer deterministic tests, lint, build, and runtime checks before model review.
- After substantive execution, launch one fresh independent Luna reviewer through workflow. Its prompt must begin exactly with PHOENIX_AUTO_REVIEW. The reviewer audits without editing: original objective, acceptance criteria, changes, outputs, tests, regressions, and risks, and returns a compact PASS/FIX digest with concrete evidence.
- For games, 3D, websites, images, and other visual deliverables, the reviewer must inspect rendered screenshots or the running output when tools permit. A successful compile or build is not evidence of visual quality.
- After a PHOENIX_AUTO_REVIEW result returns, do not finalize from Luna. The router sends the next model step to Sol so Sol can inspect the review evidence and accept the result or order corrections.
- If Sol requests a correction, Luna executes it. Repeat independent review only after material changes. Skip this review cycle for trivial conversation or work where it adds no value.
`.trim()

/** Premium Codex tiers that should spend one step planning before Luna executes. */
const CODEX_PLANNER_MODEL = /^gpt-(\d+(?:\.\d+)*)-(?:sol|astra|terra)(?:$|-)/i
/** Sol ids eligible to back Phoenix Auto's planner/reviewer role. */
const CODEX_SOL_MODEL = /^gpt-(\d+(?:\.\d+)*)-sol(?:$|-)/i
/** Luna worker ids, grouped by the same GPT generation as their planner. */
const CODEX_LUNA_MODEL = /^gpt-(\d+(?:\.\d+)*)-luna(?:$|-)/i

/**
 * Whether the user selected Phoenix's synthetic OpenAI Codex router row.
 * @param selection - Current selector value, when one exists.
 * @returns true only for the virtual Phoenix Auto row under OpenAI Codex.
 */
export function isPhoenixCodexAutoSelection(selection: ModelSelection | undefined): boolean {
  return selection?.provider === 'openai-codex' && selection.model === PHOENIX_CODEX_AUTO_MODEL
}

function generationParts(value: string): readonly number[] {
  return value.split('.').map(part => Number.parseInt(part, 10))
}

function compareGeneration(left: string, right: string): number {
  const a = generationParts(left)
  const b = generationParts(right)
  const width = Math.max(a.length, b.length)
  for (let index = 0; index < width; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

function latestFamilyModel(
  models: readonly { readonly id: string }[],
  pattern: RegExp,
): string | undefined {
  let best: { id: string; generation: string; exact: boolean } | undefined
  for (const model of models) {
    const match = pattern.exec(model.id)
    const generation = match?.[1]
    if (generation === undefined) continue
    const exact = match?.[0]?.toLocaleLowerCase() === model.id.toLocaleLowerCase()
    if (best === undefined
      || compareGeneration(generation, best.generation) > 0
      || (compareGeneration(generation, best.generation) === 0 && exact && !best.exact)) {
      best = { id: model.id, generation, exact }
    }
  }
  return best?.id
}

/**
 * Pick the newest advertised Sol and Luna independently.
 *
 * A newly advertised family generation therefore becomes Phoenix Auto's next
 * concrete route without a code change; an unsuffixed stable alias wins ties
 * inside the same numeric generation.
 * @param models - Provider-owned OpenAI Codex model metadata.
 * @returns concrete planner and worker ids when both families are available.
 */
export function latestPhoenixCodexAutoRoutes(
  models: readonly { readonly id: string }[],
): PhoenixCodexAutoRoutes | undefined {
  const planner = latestFamilyModel(models, CODEX_SOL_MODEL)
  const worker = latestFamilyModel(models, CODEX_LUNA_MODEL)
  return planner === undefined || worker === undefined ? undefined : { planner, worker }
}

function codexPlannerGeneration(model: string): string | undefined {
  return CODEX_PLANNER_MODEL.exec(model)?.[1]
}

function codexLunaGeneration(model: string): string | undefined {
  return CODEX_LUNA_MODEL.exec(model)?.[1]
}

/** GPT-6 Luna is Phoenix's full-power execution worker and must never be downgraded. */
function isGpt6LunaModel(model: string): boolean {
  const generation = codexLunaGeneration(model)
  return generation !== undefined && /^6(?:\.|$)/u.test(generation)
}

/** Pin substantive GPT-6 Luna routes to Max; the explicit conversational fast path stays low-latency. */
function pinGpt6LunaMax(selection: ModelSelection): ModelSelection {
  if (selection.provider !== 'openai-codex' || !isGpt6LunaModel(selection.model)) return selection
  return { ...selection, reasoningEffort: ReasoningEffortId('max') }
}

/**
 * Whether one Codex model is expensive/capable enough to act as planner.
 * The rule is deliberately explicit: unknown future tiers keep the user's
 * normal configuration until Phoenix learns their place in the family.
 * @param model - Codex model identifier to classify.
 * @returns true when the model belongs to a planner tier.
 */
export function isCodexPlannerModel(model: string): boolean {
  return codexPlannerGeneration(model) !== undefined
}

function lunaWorkerFor(model: string): string | undefined {
  const plannerGeneration = codexPlannerGeneration(model)
  if (plannerGeneration !== undefined) return `gpt-${plannerGeneration}-luna`
  return codexLunaGeneration(model) === undefined ? undefined : model
}

function selectedCandidateId(value: unknown, allowed: ReadonlySet<string>): string | undefined {
  if (typeof value === 'string') return allowed.has(value) ? value : undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const selected = selectedCandidateId(item, allowed)
      if (selected !== undefined) return selected
    }
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  for (const key of ['choice', 'decision', 'selected', 'selected_model', 'model_id', 'candidate_id', 'model']) {
    const direct = record[key]
    if (typeof direct === 'string' && allowed.has(direct)) return direct
  }
  // MCP returns REST data under structuredContent. Recurse through likely
  // decision envelopes, never through probabilities (whose keys are candidates).
  for (const key of ['structuredContent', 'data', 'result', 'answer', 'answers']) {
    const nested = record[key]
    if (nested !== undefined) {
      const selected = selectedCandidateId(nested, allowed)
      if (selected !== undefined) return selected
    }
  }
  return undefined
}

/**
 * Extract only an explicitly selected available candidate from Jev's typed result.
 * @param value - Untrusted Jev MCP result envelope.
 * @param candidates - Exact Phoenix-supplied model ids allowed for this routing decision.
 * @returns The explicit allowed model id, or undefined when Jev did not make a valid choice.
 */
export function jevSelectedModelId(value: unknown, candidates: readonly string[]): string | undefined {
  return selectedCandidateId(value, new Set(candidates))
}

/**
 * Resolve the default quality-preserving execution route for OpenAI Codex orchestrators.
 * @param selection - Current model selection, when one has been chosen.
 * @returns execution handoff for OpenAI Codex, or undefined for other providers.
 */
export function defaultExecutionHandoff(selection: ModelSelection | undefined): ModelSelectionHandoff | undefined {
  if (selection?.provider !== 'openai-codex') return undefined
  const worker = lunaWorkerFor(selection.model)
  if (worker === undefined || !isCodexPlannerModel(selection.model)) return undefined
  return {
    // Agent-loop steps are 1-based. Sol/Astra/Terra keep the first reasoning
    // step; the matching Luna generation executes subsequent steps at Max.
    afterStep: 1,
    selection: {
      provider: 'openai-codex',
      model: worker,
      reasoningEffort: ReasoningEffortId('max'),
    },
  }
}

/** Operational verbs that strongly imply the user expects Phoenix to act on an artifact. */
const TOOL_ACTION = /\b(?:fix(?:es|ed|ing)?|repair(?:s|ed|ing)?|debug(?:s|ged|ging)?|implement(?:s|ed|ing)?|edit(?:s|ed|ing)?|modif(?:y|ies|ied|ying)|update(?:s|d|ing)?|create(?:s|d|ing)?|build(?:s|ing|built)?|run(?:s|ning)?|execute(?:s|d|ing)?|test(?:s|ed|ing)?|inspect(?:s|ed|ing)?|review(?:s|ed|ing)?|audit(?:s|ed|ing)?|refactor(?:s|ed|ing)?|deploy(?:s|ed|ing)?|install(?:s|ed|ing)?|remove(?:s|d|ing)?|delete(?:s|d|ing)?|rename(?:s|d|ing)?|commit(?:s|ted|ting)?|merge(?:s|d|ing)?|revert(?:s|ed|ing)?|resolv(?:e|es|ed|ing)|diagnos(?:e|es|ed|ing)|arregl\p{L}*|repar\p{L}*|corrig\p{L}*|implement\p{L}*|modific\p{L}*|actualiz\p{L}*|crea\p{L}*|ejecut\p{L}*|prueb\p{L}*|revis\p{L}*|audit\p{L}*|refactor\p{L}*|despleg\p{L}*|instal\p{L}*|elimin\p{L}*|renombr\p{L}*|fusion\p{L}*|resuelv\p{L}*|diagnostic\p{L}*)\b/iu
/** Artifact/code vocabulary used with {@link TOOL_ACTION} to avoid downgrading pure reasoning turns. */
const TOOL_ARTIFACT = /(?:\b(?:file|files|archivo|archivos|code|c[oó]digo|repo|repository|repositorio|branch|rama|commit|test|tests|prueba|pruebas|script|package|build|cli|api|html|css|python|typescript|javascript|github|main|stable|error|exception|traceback|terminal|powershell|shell)\b|\x60\x60\x60|(?:^|[\s\x60'"(])(?:[A-Za-z]:\\|\.{0,2}\/)?[\w@.-]+(?:[\\/][\w@. -]+)*\.(?:ts|tsx|js|mjs|cjs|py|json|ya?ml|toml|md|html?|css|scss|sql|rs|go|java|kt|cs|cpp|c|h)\b)/iu

/**
 * Detect an explicit operational request whose quality improves after early
 * real-world/tool evidence. This is deliberately deterministic and narrow:
 * pure questions keep the user's selected reasoning effort.
 */
function isToolAcquisitionRequest(text: string): boolean {
  return TOOL_ACTION.test(text) && TOOL_ARTIFACT.test(text)
}

/**
 * Wider action vocabulary for the synthetic Phoenix Auto route. This remains
 * deterministic: the router spends no extra model call merely to decide which
 * GPT-6 tier should handle the next step.
 */
// oxlint-disable-next-line @stylistic/max-len -- Keep the deterministic routing vocabulary auditable as one regex literal.
const AUTO_TASK_ACTION = /\b(?:fix|repair|debug|implement|edit|modify|update|create|build|run|execute|test|inspect|review|audit|refactor|deploy|install|remove|delete|rename|commit|merge|revert|resolve|diagnose|search|research|investigate|browse|compare|fill|submit|schedule|automate|arregl\p{L}*|repar\p{L}*|corrig\p{L}*|implement\p{L}*|modific\p{L}*|actualiz\p{L}*|crea\p{L}*|ejecut\p{L}*|prueb\p{L}*|revis\p{L}*|audit\p{L}*|refactor\p{L}*|despleg\p{L}*|instal\p{L}*|elimin\p{L}*|renombr\p{L}*|fusion\p{L}*|resuelv\p{L}*|diagnostic\p{L}*|busc\p{L}*|investig\p{L}*|compar\p{L}*|llen\p{L}*|envi\p{L}*|program\p{L}*|automatiz\p{L}*)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Compact reply-depth vocabulary is easier to audit in one literal.
const AUTO_DEEP_REPLY = /\b(?:analy[sz]e|analysis|reason|explain\s+in\s+detail|deep|analiz\p{L}*|razon\p{L}*|explic\p{L}*\s+en\s+detalle|profund\p{L}*)\b/iu

const FAST_SOCIAL_ATOM = String.raw`(?:hola|hello|hi|hey|buenas|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|qu[eé]\s+tal|c[oó]mo\s+est[aá]s|c[oó]mo\s+te\s+va|c[oó]mo\s+va\s+todo|qu[eé]\s+cuentas|qu[eé]\s+se\s+cuenta|how\s+are\s+you|how(?:'|’)s\s+it\s+going|what(?:'|’)s\s+up|gracias|thanks|thank\s+you)`
const FAST_SOCIAL_SEQUENCE = new RegExp(`^${FAST_SOCIAL_ATOM}(?:\\s+(?:y\\s+)?${FAST_SOCIAL_ATOM})*$`, 'iu')
const FAST_SOCIAL_OPEN = /^(?:cu[eé]ntame\s+algo(?:\s+bueno)?|dime\s+algo\s+bueno|sorpr[eé]ndeme|tell\s+me\s+something(?:\s+good)?)$/iu
const FAST_CONTEXTUAL_OPEN = /^(?:qu[eé]\s+quieres\s+que\s+hagamos|qu[eé]\s+te\s+gustar[ií]a\s+que\s+hagamos|de\s+qu[eé]\s+hablamos|what\s+do\s+you\s+want\s+to\s+do|what\s+should\s+we\s+talk\s+about)$/iu

function normalizedFastSocialText(value: string): string {
  return value
    .replace(/[¡!¿?.,;:]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Short first-person/social state replies that are clearly small talk, not action approvals. */
const FAST_SOCIAL_REPLY = /^(?:[¡!¿?.,\s]*(?:(?:a\s+m[ií]|yo)\s+(?:estoy\s+)?(?:s[uú]per|muy\s+bien|bien|genial|excelente|fenomenal|tranquil[oa]|mal|regular)|(?:estoy|ando|me\s+siento)\s+(?:s[uú]per|muy\s+bien|bien|genial|excelente|fenomenal|tranquil[oa]|mal|regular)|todo\s+(?:bien|genial|excelente))[¡!¿?.,\s]*)$/iu
/**
 * Bare confirmations/continuations are not self-contained social turns.
 *
 * They resolve against the immediately preceding assistant offer ("dale" means
 * "do what you just proposed") and may require the tools that offer needs.
 * Sending them through the tool-free conversational path can erase the very
 * action the user just approved.
 */
const CONTEXTUAL_CONTINUATION = /^(?:[¡!¿?.,\s]*(?:ok(?:ay)?|perfecto|dale|listo|entendido|bien|s[ií]|no|claro|de\s+acuerdo|adelante|contin[uú]a|sigue|hazlo|vamos|yes|yeah|yep|sure|go\s+ahead|continue|do\s+it)[¡!¿?.,\s]*)$/iu
const FAST_RUNTIME_META = /^(?:[¡!¿?.,\s]*(?:(?:est[aá]s|estas|sigues)\s+(?:usando|utilizando)\s+jev|usas\s+jev|(?:se\s+)?est[aá]\s+usando\s+jev|qu[eé]\s+modelo\s+(?:est[aá]s|estas)\s+usando|cu[aá]l\s+modelo\s+(?:est[aá]s|estas)\s+usando)[¡!¿?.,\s]*)$/iu
/** Short, non-question reactions to the current output; they never need external evidence. */
const FAST_CASUAL_REACTION = /(?:\b(?:jaj+a+|jeje+|jiji+|lol)\b|\b(?:eso|esto)\s+(?:parece|se\s+ve|est[aá])\b|\b(?:qu[eé]\s+)?(?:feo|bonito|lindo|gracioso|raro)\b)/iu

/**
 * Very narrow low-latency conversational classifier.
 *
 * Only social acknowledgements and simple runtime-meta questions enter this
 * path. Factual questions, external-data requests, artifact work, URLs, code,
 * and operational verbs deliberately remain on the normal Phoenix path.
 * @param text - Direct human text for the candidate turn.
 * @returns true when the turn is safe for the tool-free low-latency path.
 */
export function isConversationalFastPathText(text: string): boolean {
  const candidate = text.trim()
  if (candidate.length === 0 || candidate.length > 180) return false
  if (/https?:\/\/|\x60\x60\x60|(?:[A-Za-z]:\\|\.\/|\.\.\/)/u.test(candidate)) return false
  if (isToolAcquisitionRequest(candidate)) return false
  // A one-word approval is a continuation command, not chit-chat. Keep normal
  // history, tool schemas, and the user's selected reasoning route.
  if (CONTEXTUAL_CONTINUATION.test(candidate)) return false
  const socialCandidate = normalizedFastSocialText(candidate)
  if (FAST_SOCIAL_SEQUENCE.test(socialCandidate)
    || FAST_SOCIAL_OPEN.test(socialCandidate)
    || FAST_SOCIAL_REPLY.test(candidate)
    || FAST_RUNTIME_META.test(candidate)) return true
  // Feedback such as "eso parece un pollo ... jaja" should not reload hundreds
  // of tools or a multi-megabyte work transcript. Keep questions on the normal
  // path: even a short "¿eso parece X?" can be a real factual request.
  return !/[?¿]/u.test(candidate) && FAST_CASUAL_REACTION.test(candidate)
}

/**
 * Low-latency conversational opener that still needs project continuity.
 *
 * These phrases are tool-free, but unlike ordinary small talk they ask Phoenix
 * to choose or discuss the next useful direction. They therefore keep runtime
 * context and full text history so memory, pending work, and initiative state
 * can inform the answer.
 *
 * @param text - Candidate user text to classify.
 * @returns Whether the text can use the contextual conversational fast path.
 */
export function isContextualConversationFastPathText(text: string): boolean {
  const candidate = text.trim()
  if (candidate.length === 0 || candidate.length > 180) return false
  if (/https?:\/\/|\x60\x60\x60|(?:[A-Za-z]:\\|\.\/|\.\.\/)/u.test(candidate)) return false
  if (isToolAcquisitionRequest(candidate) || CONTEXTUAL_CONTINUATION.test(candidate)) return false
  return FAST_CONTEXTUAL_OPEN.test(normalizedFastSocialText(candidate))
}

function defaultConversationalSelection(selection: ModelSelection | undefined): ModelSelection | undefined {
  if (selection?.provider !== 'openai-codex') return undefined
  return {
    provider: 'openai-codex',
    model: lunaWorkerFor(selection.model) ?? 'gpt-5.6-luna',
    reasoningEffort: ReasoningEffortId('low'),
  }
}

/**
 * Low-latency first action for explicit operational Codex turns that already
 * selected Luna. Premium Sol/Astra/Terra selections keep their first planning
 * step; Luna-only turns use medium for first evidence and then resume the
 * person's selected effort.
 */
function defaultToolAcquisitionSelection(selection: ModelSelection | undefined): ModelSelection | undefined {
  if (selection?.provider !== 'openai-codex') return undefined
  // Premium selections are planners. Do not steal their first step merely
  // because tools are present; Luna takes over after the plan via handoff.
  if (isCodexPlannerModel(selection.model)) return undefined
  return {
    provider: 'openai-codex',
    model: lunaWorkerFor(selection.model) ?? 'gpt-5.6-luna',
    reasoningEffort: ReasoningEffortId('medium'),
  }
}

function directUserTextForTurn(agent: {
  readonly session: {
    readonly events: readonly { readonly type: string; readonly data: unknown }[]
  }
}, turn: number): string {
  const fragments: string[] = []
  const events = agent.session.events
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'turn/start' && (event.data as { turn?: number }).turn === turn) break
    if (event.type !== 'user/message') continue
    const message = event.data as {
      readonly source?: { readonly kind?: string }
      readonly content?: readonly { readonly type?: string; readonly text?: string }[]
    }
    if (message.source?.kind !== 'user') continue
    const text = message.content
      ?.filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string)
      .join(' ')
      .trim()
    if (text !== undefined && text.length > 0) fragments.push(text)
  }
  return fragments.reverse().join('\n')
}

type PhoenixAutoEvent = { readonly type: string; readonly data: unknown }

function turnEvents(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
): readonly PhoenixAutoEvent[] {
  const events = agent.session.events
  let start = events.length
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/start' && (event.data as { turn?: number }).turn === turn) {
      start = index + 1
      break
    }
  }
  return events.slice(start)
}

function stableFingerprint(value: unknown): string {
  let serialized: string
  try {
    const encoded: unknown = JSON.stringify(value)
    serialized = typeof encoded === 'string' ? encoded : String(value)
  } catch {
    serialized = String(value)
  }
  return serialized
    .toLocaleLowerCase()
    .replace(/\b\d+\b/gu, '#')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 320)
}

function failedToolFingerprint(event: PhoenixAutoEvent): string | undefined {
  if (event.type !== 'tool/result') return undefined
  const data = event.data as {
    readonly error?: { readonly name?: string; readonly code?: string }
    readonly message?: {
      readonly content?: readonly { readonly type?: string; readonly text?: string }[]
    }
  }
  if (data.error === undefined) return undefined
  const text = data.message?.content
    ?.filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join(' ') ?? ''
  return `${data.error.name ?? ''}:${data.error.code ?? ''}:${stableFingerprint(text)}`
}

function toolCallFingerprint(event: PhoenixAutoEvent): string | undefined {
  if (event.type !== 'tool/call') return undefined
  const data = event.data as { readonly name?: string; readonly arguments?: string }
  if (typeof data.name !== 'string') return undefined
  return `${data.name}:${stableFingerprint(data.arguments ?? '')}`
}

/**
 * Detect a genuine no-progress pattern without another model call.
 *
 * Two identical consecutive tool failures, three identical recent tool calls,
 * or two provider retries in one turn are enough to ask Sol for a fresh plan.
 * @param agent - Agent-like session owner whose current turn events are inspected.
 * @param turn - Current 1-based turn number.
 * @returns true when deterministic evidence shows the current strategy is repeating.
 */
export function isPhoenixCodexAutoStalled(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
): boolean {
  const events = turnEvents(agent, turn)
  const results = events.filter(event => event.type === 'tool/result').slice(-2)
  const [leftResult, rightResult] = results
  if (leftResult !== undefined && rightResult !== undefined) {
    const left = failedToolFingerprint(leftResult)
    const right = failedToolFingerprint(rightResult)
    if (left !== undefined && left === right) return true
  }

  const calls = events.filter(event => event.type === 'tool/call').slice(-6)
  const latestCall = calls.at(-1)
  const latestFingerprint = latestCall === undefined ? undefined : toolCallFingerprint(latestCall)
  if (latestFingerprint !== undefined) {
    const repeats = calls.reduce(
      (count, event) => count + (toolCallFingerprint(event) === latestFingerprint ? 1 : 0),
      0,
    )
    if (repeats >= 3) return true
  }

  return events.filter(event => event.type === 'llm/retry').length >= 2
}

function phoenixAutoTaskRequest(text: string): boolean {
  const candidate = text.trim()
  return CONTEXTUAL_CONTINUATION.test(candidate)
    || isToolAcquisitionRequest(candidate)
    || AUTO_TASK_ACTION.test(candidate)
}

function completedPhoenixAutoReviews(events: readonly PhoenixAutoEvent[]): number {
  let awaitingReview = false
  let completed = 0
  for (const event of events) {
    if (event.type === 'tool/call') {
      const data = event.data as { readonly arguments?: string }
      if (typeof data.arguments === 'string' && data.arguments.includes(PHOENIX_CODEX_AUTO_REVIEW_MARKER)) {
        awaitingReview = true
      }
      continue
    }
    if (awaitingReview && event.type === 'tool/result') {
      completed += 1
      awaitingReview = false
    }
  }
  return completed
}

interface PhoenixAutoRouterState {
  turn: number
  lastRescueStep: number
  rescueCount: number
  reviewCompletions: number
}

function phoenixAutoRoute(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
  step: number,
  directText: string,
  state: PhoenixAutoRouterState,
  routes: PhoenixCodexAutoRoutes,
): ModelSelection {
  if (step <= 1) {
    if (isConversationalFastPathText(directText) || isContextualConversationFastPathText(directText)) {
      return {
        provider: 'openai-codex',
        model: routes.worker,
        reasoningEffort: ReasoningEffortId('low'),
      }
    }
    if (phoenixAutoTaskRequest(directText)) {
      return {
        provider: 'openai-codex',
        model: routes.planner,
        reasoningEffort: ReasoningEffortId('medium'),
      }
    }
    return {
      provider: 'openai-codex',
      model: routes.worker,
      reasoningEffort: ReasoningEffortId(AUTO_DEEP_REPLY.test(directText) ? 'medium' : 'low'),
    }
  }

  if (state.turn !== turn) {
    state.turn = turn
    state.lastRescueStep = 0
    state.rescueCount = 0
    state.reviewCompletions = 0
  }

  const reviewCompletions = completedPhoenixAutoReviews(turnEvents(agent, turn))
  if (reviewCompletions > state.reviewCompletions) {
    state.reviewCompletions = reviewCompletions
    return {
      provider: 'openai-codex',
      model: routes.planner,
      reasoningEffort: ReasoningEffortId(reviewCompletions > 1 ? 'high' : 'medium'),
    }
  }

  const repeatedStall = isPhoenixCodexAutoStalled(agent, turn)
  const canRescue = repeatedStall
    && (state.lastRescueStep === 0 || step - state.lastRescueStep >= 2)
  if (canRescue) {
    state.lastRescueStep = step
    state.rescueCount += 1
    return {
      provider: 'openai-codex',
      model: routes.planner,
      reasoningEffort: ReasoningEffortId(state.rescueCount > 1 ? 'high' : 'medium'),
    }
  }

  return {
    provider: 'openai-codex',
    model: routes.worker,
    reasoningEffort: ReasoningEffortId('max'),
  }
}

/**
 * Couple one mutable selection to Agent-scoped prompt assembly and request routing.
 * Prompt assembly snapshots the selected model before delegating, then applies
 * its provider/model pair and effort to request config so a
 * concurrent switch takes effect on a later step instead of splitting the two
 * surfaces. An absent selected effort clears any inherited effort, restoring
 * the selected model's provider/default behavior.
 *
 * @param agentCtx - The selected Agent's scoped context.
 * @param selection - Mutable selection owned by the calling entry point.
 * @param handoff - Optional route for steps after the initial plan step.
 * @returns Disposer for both scoped waterfall listeners.
 */
export function installModelSelection(
  agentCtx: Context,
  selection: ModelSelectionRef,
  handoff?: ModelSelectionHandoff | ModelSelectionHandoffResolver,
): () => void {
  const phoenixAutoState: PhoenixAutoRouterState = {
    turn: 0,
    lastRescueStep: 0,
    rescueCount: 0,
    reviewCompletions: 0,
  }
  const disposeAssembly = agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const selected = selection.current
    const assembled = await next()
    selection.assembled = selected
    selection.assembledToolCount = assembled.tools.length
    if (selected === undefined) return assembled
    return {
      ...assembled,
      sections: isPhoenixCodexAutoSelection(selected)
        ? [...assembled.sections, { name: 'phoenix-auto:routing', text: PHOENIX_CODEX_AUTO_GUIDANCE }]
        : assembled.sections,
      variables: {
        ...assembled.variables,
        provider: selected.provider,
        model: selected.model,
      },
    }
  })
  const disposeRequest = agentCtx.on(
    'agent/request',
    async (_payload, next): Promise<LlmCallConfig> => {
      const resolved = await next()
      const selected = selection.assembled
      if (selected === undefined) return resolved
      const resolvedHandoff = typeof handoff === 'function' ? handoff(selected) : handoff
      const directText = directUserTextForTurn(_payload.agent, _payload.turn)
      if (isPhoenixCodexAutoSelection(selected)) {
        const routed = phoenixAutoRoute(
          _payload.agent,
          _payload.turn,
          _payload.step,
          directText,
          phoenixAutoState,
          selection.phoenixAutoRoutes ?? {
            planner: PHOENIX_CODEX_AUTO_PLANNER_MODEL,
            worker: PHOENIX_CODEX_AUTO_WORKER_MODEL,
          },
        )
        const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
        return {
          ...withoutInheritedEffort,
          provider: routed.provider,
          model: routed.model,
          ...routed.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: routed.reasoningEffort },
        }
      }
      const conversation = _payload.step === 1
        && (isConversationalFastPathText(directText) || isContextualConversationFastPathText(directText))
        ? defaultConversationalSelection(selected)
        : undefined
      const acquisition = _payload.step === 1
        && (selection.assembledToolCount ?? 0) > 0
        && isToolAcquisitionRequest(directText)
        ? defaultToolAcquisitionSelection(selected)
        : undefined
      const candidateRoute = conversation
        ?? acquisition
        ?? (resolvedHandoff !== undefined && _payload.step > resolvedHandoff.afterStep
          ? resolvedHandoff.selection
          : selected)
      // The social fast path deliberately trades unnecessary reasoning for
      // latency. Do not let GPT-6 Luna's substantive-task Max pin overwrite it.
      const routed = conversation ?? pinGpt6LunaMax(candidateRoute)
      const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
      const nativeRoute: LlmCallConfig = {
        ...withoutInheritedEffort,
        provider: routed.provider,
        model: routed.model,
        ...routed.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: routed.reasoningEffort },
      }
      return nativeRoute
    },
  )
  return () => {
    disposeAssembly()
    disposeRequest()
  }
}
