/**
 * Agent-scoped model selection shared by runtime entry points.
 * @module @phoenix-ai/dsh-agent/model-selection
 */

import type { Context } from '@phoenix-ai/cordis'
import { ReasoningEffortId, createUserMessage, type LlmCallConfig } from '@phoenix-ai/dsh-llm'

/** Complete provider, model, and optional reasoning effort selected for one live Agent. */
export interface ModelSelection {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: ReasoningEffortId
}

/** Mutable model selection plus the value captured for the current step. */
export interface ModelSelectionRef {
  /** Model selected for the next step that enters prompt assembly. */
  current: ModelSelection | undefined
  /** Selection captured when the current step entered prompt assembly. */
  assembled: ModelSelection | undefined
  /** Number of model-facing tools captured with the same prompt assembly. */
  assembledToolCount?: number
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


/** Synthetic selector row that enables Phoenix's adaptive GPT-6 Codex router. */
export const PHOENIX_CODEX_AUTO_MODEL = 'phoenix-auto'
/** GPT-6.1 planner/rescue route used by Phoenix Auto. */
export const PHOENIX_CODEX_AUTO_PLANNER_MODEL = 'gpt-6.1-sol'
/** GPT-6 execution route used by Phoenix Auto. */
export const PHOENIX_CODEX_AUTO_WORKER_MODEL = 'gpt-6-luna'

/** Premium Codex tiers that should spend one step planning before Luna executes. */
const CODEX_PLANNER_MODEL = /^gpt-(\d+(?:\.\d+)?)-(?:sol|astra|terra)(?:$|-)/i
/** Luna worker ids, grouped by the same GPT generation as their planner. */
const CODEX_LUNA_MODEL = /^gpt-(\d+(?:\.\d+)?)-luna(?:$|-)/i

/**
 * Whether the user selected Phoenix's synthetic OpenAI Codex router row.
 * @param selection - Current selector value, when one exists.
 * @returns true only for the virtual Phoenix Auto row under OpenAI Codex.
 */
export function isPhoenixCodexAutoSelection(selection: ModelSelection | undefined): boolean {
  return selection?.provider === 'openai-codex' && selection.model === PHOENIX_CODEX_AUTO_MODEL
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
  if (model === PHOENIX_CODEX_AUTO_PLANNER_MODEL) return PHOENIX_CODEX_AUTO_WORKER_MODEL
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
// oxlint-disable-next-line @stylistic/max-len -- Keep the deterministic bilingual matcher auditable as one regex literal.
const TOOL_ACTION = /\b(?:fix(?:es|ed|ing)?|repair(?:s|ed|ing)?|debug(?:s|ged|ging)?|implement(?:s|ed|ing)?|edit(?:s|ed|ing)?|modif(?:y|ies|ied|ying)|update(?:s|d|ing)?|create(?:s|d|ing)?|build(?:s|ing|built)?|run(?:s|ning)?|execute(?:s|d|ing)?|test(?:s|ed|ing)?|inspect(?:s|ed|ing)?|review(?:s|ed|ing)?|audit(?:s|ed|ing)?|refactor(?:s|ed|ing)?|deploy(?:s|ed|ing)?|install(?:s|ed|ing)?|remove(?:s|d|ing)?|delete(?:s|d|ing)?|rename(?:s|d|ing)?|commit(?:s|ted|ting)?|merge(?:s|d|ing)?|revert(?:s|ed|ing)?|resolv(?:e|es|ed|ing)|diagnos(?:e|es|ed|ing)|arregl\p{L}*|repar\p{L}*|corrig\p{L}*|implement\p{L}*|modific\p{L}*|actualiz\p{L}*|crea\p{L}*|ejecut\p{L}*|prueb\p{L}*|revis\p{L}*|audit\p{L}*|refactor\p{L}*|despleg\p{L}*|instal\p{L}*|elimin\p{L}*|renombr\p{L}*|fusion\p{L}*|resuelv\p{L}*|diagnostic\p{L}*)\b/iu
/** Artifact/code vocabulary used with {@link TOOL_ACTION} to avoid downgrading pure reasoning turns. */
// oxlint-disable-next-line @stylistic/max-len -- Keep the deterministic bilingual matcher auditable as one regex literal.
const TOOL_ARTIFACT = /(?:\b(?:file|files|archivo|archivos|code|c[oó]digo|repo|repository|repositorio|branch|rama|commit|test|tests|prueba|pruebas|script|package|build|cli|api|html|css|python|typescript|javascript|github|main|stable|error|exception|traceback|terminal|powershell|shell)\b|\x60\x60\x60|(?:^|[\s\x60'"(])(?:[a-z]:\\|\.{0,2}\/)?[\w@.-]+(?:[\\/][\w@. -]+)*\.(?:ts|tsx|js|mjs|cjs|py|json|ya?ml|toml|md|html?|css|scss|sql|rs|go|java|kt|cs|cpp|c|h)\b)/iu

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
/** A stopped operational reply that still announces the next action rather than performing it. */
// oxlint-disable-next-line @stylistic/max-len -- Keep the bilingual unfinished-action matcher auditable as one literal.
const AUTO_UNFINISHED_ACTION = /(?:\b(?:ahora|a\s+continuaci[oó]n|enseguida|para\s+ir\s+m[aá]s\s+r[aá]pido)\b.{0,180}\b(?:voy\s+a|usar[eé]|har[eé]|comprobar[eé]|revisar[eé]|abrir[eé]|ejecutar[eé]|probar[eé]|verificar[eé]|continuar[eé]|seguir[eé])|\bvoy\s+a\s+(?:comprobar|revisar|abrir|ejecutar|probar|verificar|usar|hacer|continuar|seguir|navegar|inspeccionar)|\b(?:i(?:'|’)ll|i\s+will|i(?:'|’)m\s+going\s+to|let\s+me|next\s+i(?:'|’)ll)\s+(?:check|review|open|run|test|verify|use|continue|inspect|try|fix|update|change|browse|navigate))/isu
/** Bound self-healing continuation so a pathological provider cannot create an endless promise loop. */
const AUTO_CONTINUATION_LIMIT = 4
const AUTO_EXECUTION_CONTINUATION =
  'Planning or describing the next action is not task completion. ' +
  'Continue the current user request now with the available tools. ' +
  'Execute the next concrete action instead of only saying what you will do, ' +
  'and keep working until the requested task is actually complete or a concrete external blocker requires user action.'

const FAST_SOCIAL_ATOM = String.raw`(?:hola|hello|hi|hey|buenas|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|qu[eé]\s+tal|c[oó]mo\s+est[aá]s|c[oó]mo\s+te\s+va|c[oó]mo\s+va\s+todo|qu[eé]\s+cuentas|qu[eé]\s+se\s+cuenta|how\s+are\s+you|how(?:'|’)s\s+it\s+going|what(?:'|’)s\s+up|gracias|thanks|thank\s+you)`
const FAST_SOCIAL_SEQUENCE = new RegExp(`^${FAST_SOCIAL_ATOM}(?:\\s+(?:y\\s+)?${FAST_SOCIAL_ATOM})*$`, 'iu')
const FAST_SOCIAL_OPEN = /^(?:cu[eé]ntame\s+algo(?:\s+bueno)?|dime\s+algo\s+bueno|sorpr[eé]ndeme|tell\s+me\s+something(?:\s+good)?)$/iu
// oxlint-disable-next-line @stylistic/max-len -- Keep the deterministic bilingual matcher auditable as one regex literal.
const FAST_CONTEXTUAL_OPEN = /^(?:qu[eé]\s+quieres\s+que\s+hagamos|qu[eé]\s+te\s+gustar[ií]a\s+que\s+hagamos|de\s+qu[eé]\s+hablamos|what\s+do\s+you\s+want\s+to\s+do|what\s+should\s+we\s+talk\s+about)$/iu

function normalizedFastSocialText(value: string): string {
  return value
    .replace(/[¡!¿?.,;:]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Short first-person/social state replies that are clearly small talk, not action approvals. */
// oxlint-disable-next-line @stylistic/max-len -- Keep the deterministic bilingual matcher auditable as one regex literal.
const FAST_SOCIAL_REPLY = /^(?:[¡!¿?.,\s]*(?:(?:a\s+m[ií]|yo)\s+(?:estoy\s+)?(?:s[uú]per|muy\s+bien|bien|genial|excelente|fenomenal|tranquil[oa]|mal|regular)|(?:estoy|ando|me\s+siento)\s+(?:s[uú]per|muy\s+bien|bien|genial|excelente|fenomenal|tranquil[oa]|mal|regular)|todo\s+(?:bien|genial|excelente))[¡!¿?.,\s]*)$/iu
/**
 * Bare confirmations/continuations are not self-contained social turns.
 *
 * They resolve against the immediately preceding assistant offer ("dale" means
 * "do what you just proposed") and may require the tools that offer needs.
 * Sending them through the tool-free conversational path can erase the very
 * action the user just approved.
 */
// oxlint-disable-next-line @stylistic/max-len -- Keep the deterministic bilingual matcher auditable as one regex literal.
const CONTEXTUAL_CONTINUATION = /^(?:[¡!¿?.,\s]*(?:ok(?:ay)?|perfecto|dale|listo|entendido|bien|s[ií]|no|claro|de\s+acuerdo|adelante|contin[uú]a|sigue|hazlo|vamos|yes|yeah|yep|sure|go\s+ahead|continue|do\s+it)[¡!¿?.,\s]*)$/iu
// oxlint-disable-next-line @stylistic/max-len -- Keep the deterministic bilingual matcher auditable as one regex literal.
const FAST_RUNTIME_META = /^(?:[¡!¿?.,\s]*(?:(?:est[aá]s|estas|sigues)\s+(?:usando|utilizando)\s+jev|usas\s+jev|(?:se\s+)?est[aá]\s+usando\s+jev|qu[eé]\s+modelo\s+(?:est[aá]s|estas)\s+usando|cu[aá]l\s+modelo\s+(?:est[aá]s|estas)\s+usando)[¡!¿?.,\s]*)$/iu
/** Short, non-question reactions to the current output; they never need external evidence. */
// oxlint-disable-next-line @stylistic/max-len -- Keep the deterministic bilingual matcher auditable as one regex literal.
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
    model: lunaWorkerFor(selection.model) ?? PHOENIX_CODEX_AUTO_WORKER_MODEL,
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
    model: lunaWorkerFor(selection.model) ?? PHOENIX_CODEX_AUTO_WORKER_MODEL,
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

interface PhoenixAutoTeamSignal {
  readonly messageId: string
  readonly purpose: string
}

/** Read the newest real Team message admitted into this turn without another classifier call. */
function phoenixAutoTeamSignalForTurn(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
): PhoenixAutoTeamSignal | undefined {
  const events = turnEvents(agent, turn)
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message') continue
    const data = event.data as {
      readonly source?: {
        readonly kind?: string
        readonly messageId?: string
        readonly purpose?: string
      }
    }
    if (data.source?.kind !== 'team-message'
      || typeof data.source.messageId !== 'string'
      || typeof data.source.purpose !== 'string') continue
    return { messageId: data.source.messageId, purpose: data.source.purpose }
  }
  return undefined
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

interface PhoenixAutoAssistantStop {
  readonly step: number
  readonly text: string
}

/** Read the latest text-only stopping reply from the current turn. */
function latestPhoenixAutoAssistantStop(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
): PhoenixAutoAssistantStop | undefined {
  const events = turnEvents(agent, turn)
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    const data = event.data as {
      readonly turn?: number
      readonly step?: number
      readonly message?: {
        readonly content?: readonly { readonly type?: string; readonly text?: string }[]
      }
    }
    if (data.turn !== turn || typeof data.step !== 'number') continue
    const text = data.message?.content
      ?.filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string)
      .join(' ')
      .trim() ?? ''
    return { step: data.step, text }
  }
  return undefined
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

interface PhoenixAutoRouterState {
  turn: number
  lastRescueStep: number
  rescueCount: number
  continuationCount: number
  lastContinuationStep: number
  forcePlannerNext: boolean
  lastTeamEscalationMessageId: string | undefined
}

function resetPhoenixAutoTurnState(state: PhoenixAutoRouterState, turn: number): void {
  if (state.turn === turn) return
  state.turn = turn
  state.lastRescueStep = 0
  state.rescueCount = 0
  state.continuationCount = 0
  state.lastContinuationStep = 0
  state.forcePlannerNext = false
  state.lastTeamEscalationMessageId = undefined
}

function phoenixAutoRoute(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
  step: number,
  directText: string,
  state: PhoenixAutoRouterState,
): ModelSelection {
  resetPhoenixAutoTurnState(state, turn)
  const teamSignal = phoenixAutoTeamSignalForTurn(agent, turn)
  if (teamSignal?.purpose === 'blocker' && teamSignal.messageId !== state.lastTeamEscalationMessageId) {
    state.lastTeamEscalationMessageId = teamSignal.messageId
    state.lastRescueStep = step
    state.rescueCount += 1
    return {
      provider: 'openai-codex',
      model: PHOENIX_CODEX_AUTO_PLANNER_MODEL,
      reasoningEffort: ReasoningEffortId('xhigh'),
    }
  }
  if (step <= 1) {
    // A real Team wakeup belongs to Kira's operational loop. Never route peer
    // results/questions through the low-effort social fast path.
    if (teamSignal !== undefined) {
      return {
        provider: 'openai-codex',
        model: PHOENIX_CODEX_AUTO_WORKER_MODEL,
        reasoningEffort: ReasoningEffortId('max'),
      }
    }
    if (isConversationalFastPathText(directText) || isContextualConversationFastPathText(directText)) {
      return {
        provider: 'openai-codex',
        model: PHOENIX_CODEX_AUTO_WORKER_MODEL,
        reasoningEffort: ReasoningEffortId('low'),
      }
    }
    if (phoenixAutoTaskRequest(directText)) {
      return {
        provider: 'openai-codex',
        model: PHOENIX_CODEX_AUTO_PLANNER_MODEL,
        reasoningEffort: ReasoningEffortId('xhigh'),
      }
    }
    return {
      provider: 'openai-codex',
      model: PHOENIX_CODEX_AUTO_WORKER_MODEL,
      reasoningEffort: ReasoningEffortId(AUTO_DEEP_REPLY.test(directText) ? 'medium' : 'low'),
    }
  }

  if (state.forcePlannerNext) {
    state.forcePlannerNext = false
    state.lastRescueStep = step
    state.rescueCount += 1
    return {
      provider: 'openai-codex',
      model: PHOENIX_CODEX_AUTO_PLANNER_MODEL,
      reasoningEffort: ReasoningEffortId('xhigh'),
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
      model: PHOENIX_CODEX_AUTO_PLANNER_MODEL,
      reasoningEffort: ReasoningEffortId('xhigh'),
    }
  }

  return {
    provider: 'openai-codex',
    model: PHOENIX_CODEX_AUTO_WORKER_MODEL,
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
 * @param handoff - Optional adaptive route for internal callers. When omitted,
 * an explicit user selection is dispatched exactly as selected; only Phoenix
 * Auto may change models or reasoning effort on its own.
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
    continuationCount: 0,
    lastContinuationStep: 0,
    forcePlannerNext: false,
    lastTeamEscalationMessageId: undefined,
  }
  const disposeAssembly = agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const selected = selection.current
    const assembled = await next()
    selection.assembled = selected
    const hasKiraTeam = assembled.tools.some(tool => tool.name === 'spawn_teammate')
    const tools = isPhoenixCodexAutoSelection(selected) && hasKiraTeam
      ? assembled.tools.filter(tool => tool.name !== 'subagent' && tool.name !== 'subagent_fork')
      : assembled.tools
    selection.assembledToolCount = tools.length
    if (selected === undefined) return assembled
    return {
      ...assembled,
      tools,
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
      // A concrete picker choice with no adaptive handoff is authoritative.
      // Resolve this before reading turn text so an exact route is also the
      // lowest-latency path; only Phoenix Auto needs to inspect the request.
      if (!isPhoenixCodexAutoSelection(selected) && handoff === undefined) {
        const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
        return {
          ...withoutInheritedEffort,
          provider: selected.provider,
          model: selected.model,
          ...selected.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: selected.reasoningEffort },
        }
      }
      const directText = directUserTextForTurn(_payload.agent, _payload.turn)
      if (isPhoenixCodexAutoSelection(selected)) {
        const routed = phoenixAutoRoute(
          _payload.agent,
          _payload.turn,
          _payload.step,
          directText,
          phoenixAutoState,
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
      const resolvedHandoff = typeof handoff === 'function' ? handoff(selected) : handoff
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
  const disposeAutoContinuation = agentCtx.on('agent/turn-stopping', ({ agent, turn, signal }) => {
    signal.throwIfAborted()
    if (!isPhoenixCodexAutoSelection(selection.current)) return
    if ((selection.assembledToolCount ?? 0) === 0) return

    const directText = directUserTextForTurn(agent, turn)
    if (!phoenixAutoTaskRequest(directText)) return
    resetPhoenixAutoTurnState(phoenixAutoState, turn)

    const latest = latestPhoenixAutoAssistantStop(agent, turn)
    if (latest === undefined || phoenixAutoState.lastContinuationStep === latest.step) return
    const events = turnEvents(agent, turn)
    const latestStepHasToolActivity = events.some((event) => {
      if (event.type !== 'tool/call' && event.type !== 'tool/result') return false
      return (event.data as { readonly step?: number }).step === latest.step
    })
    const plannerStoppedBeforeActing = latest.step === 1 && !latestStepHasToolActivity
    const announcedNextAction = !latestStepHasToolActivity
      && latest.text.length > 0
      && AUTO_UNFINISHED_ACTION.test(latest.text)
    if (!plannerStoppedBeforeActing && !announcedNextAction) return
    if (phoenixAutoState.continuationCount >= AUTO_CONTINUATION_LIMIT) return

    phoenixAutoState.continuationCount += 1
    phoenixAutoState.lastContinuationStep = latest.step
    // The normal Sol→Luna transition gets one chance to execute. If Luna then
    // stops on another promise, make the next step a high-effort Sol rescue.
    if (phoenixAutoState.continuationCount >= 2) phoenixAutoState.forcePlannerNext = true
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: AUTO_EXECUTION_CONTINUATION }],
      source: {
        kind: 'plugin',
        plugin: 'model-selection',
        form: 'notice',
        summary: 'Phoenix Auto execution continuation',
      },
    }))
  })

  return () => {
    disposeAssembly()
    disposeRequest()
    disposeAutoContinuation()
  }
}
