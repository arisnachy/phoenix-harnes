/**
 * Agent-scoped model selection shared by runtime entry points.
 * @module @phoenix-ai/dsh-agent/model-selection
 */

import type { Context } from '@phoenix-ai/cordis'
import type { Agent } from './runtime-types.ts'
import type { Session } from '@phoenix-ai/dsh-session'
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

/** Model routing preferences belong to Eclipse, not to visible teammate identities. */
export interface EclipseModelRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Eclipse settings: Kira independently selects planning, execution and
 * teammate routes. Strategy review is evidence-driven without a call quota.
 */
export interface EclipseRoutingSettings {
  readonly mode?: 'automatic' | 'hybrid' | 'manual'
  readonly planner?: EclipseModelRoute
  readonly coordinator?: EclipseModelRoute
  readonly subagent?: EclipseModelRoute
  readonly specialists?: Readonly<Record<string, EclipseModelRoute>>
  readonly maxTeammates?: number
  readonly escalationSensitivity?: 'adaptive' | 'quality' | 'economy'
}

/** Apply a user-selected route at a real dispatch boundary, never to virtual ids.
 * @param profile - Optional saved routing configuration.
 * @param role - Independent planning, coordination or teammate responsibility.
 * @param fallback - Shipped route when the role is not overridden.
 * @param adaptiveEffort - Effort selected from the current request when a
 * hybrid/manual route changes only the model and leaves effort unset.
 * @returns Concrete serving route, with only the selected model's requested effort.
 */
export function resolveEclipseRoleRoute(
  profile: EclipseRoutingSettings | undefined,
  role: 'planner' | 'coordinator' | 'subagent',
  fallback: ModelSelection,
  adaptiveEffort?: string,
): ModelSelection {
  if (profile === undefined || profile.mode === undefined || profile.mode === 'automatic') return fallback
  // Kira's live router selects planner only for strategy steps; execution and
  // teammate routes never inherit that higher-cost planning selection.
  const route = profile[role]
  // Eclipse's catalog and reasoning controls are Codex-only. A stale legacy
  // profile must not bypass that boundary at the dispatch site.
  if (route === undefined || route.provider !== 'openai-codex' || route.model === PHOENIX_CODEX_AUTO_MODEL) return fallback
  return {
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined
      ? adaptiveEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(adaptiveEffort) }
      : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) },
  }
}

/** Optional host-side settings authority; client selections and secrets never enter prompts. */
function configuredEclipse(ctx: Context): EclipseRoutingSettings | undefined {
  const settings = ctx.get('agentDefaultModel') as {
    currentEclipseProfile?: () => EclipseRoutingSettings | undefined
  } | undefined
  return settings?.currentEclipseProfile?.()
}

/** Durable selector intent, independent of the real model serving a request. */
export interface ModelSelectionPreference {
  /** Selected planner/router/provider route. */
  readonly selection: ModelSelection
  /** Whether the preference was captured from a default or explicitly chosen. */
  readonly source: 'explicit' | 'default'
}

declare module '@phoenix-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Durable model-routing preference, hidden from model history. Required on
     * read: dropping it would change future provider/model and cost decisions.
     */
    'agent/model-selection': ModelSelectionPreference
  }
}

/** Read the last durable selector preference without using serving request headers.
 * @param session - Session owning the authoritative event stream.
 * @returns Latest preference, or undefined for sessions predating preference capture.
 */
export function latestModelSelectionPreference(session: Pick<Session, 'events'>): ModelSelectionPreference | undefined {
  return session.events.findLast(event => event.type === 'agent/model-selection')?.data
}

/** Persist a changed selector preference without emitting a model-visible message.
 * @param session - Session owning the selection.
 * @param selection - Selected route, independently of the executing model.
 * @param source - Explicit user choice or a default captured at first dispatch.
 * @returns Whether a new preference event was appended.
 */
export function persistModelSelectionPreference(
  session: Session,
  selection: ModelSelection,
  source: ModelSelectionPreference['source'],
): boolean {
  const prior = latestModelSelectionPreference(session)
  if (prior?.source === source && prior.selection.provider === selection.provider
    && prior.selection.model === selection.model && prior.selection.reasoningEffort === selection.reasoningEffort) return false
  session.append('agent/model-selection', {
    selection: {
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
    },
    source,
  })
  return true
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
/** Native Codex worker whose permission escalations are reviewed by Codex Auto-review. */
export const PHOENIX_CODEX_AUTO_REVIEW_TOOL = 'codex_auto_review'

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

/**
 * Phoenix Auto keeps one Kira coordinator identity across planning, execution
 * and rescue. Explicitly selected other Codex models and other providers stay
 * on the user's exact model; Team children never reopen a planning phase.
 * @param selection - the selected provider/model.
 * @param agent - session owner, when one is available.
 * @returns whether the Lead uses the Phoenix coordinator route.
 */
export function isKiraCodexAutoLead(
  selection: ModelSelection | undefined,
  agent: { readonly session: { readonly header?: { readonly agentPreset?: string; readonly origin?: string } } } | undefined,
): boolean {
  // Child specialists execute their assigned Luna route; they must never
  // trigger the Lead-only Sol planning stage even on a replayed auto selector.
  if (agent?.session?.header?.origin === 'subagent') return false
  return isPhoenixCodexAutoSelection(selection)
    || (selection?.provider === 'openai-codex'
      && selection.model === PHOENIX_CODEX_AUTO_WORKER_MODEL
      && agent?.session?.header?.agentPreset === 'kira-max')
}

function codexPlannerGeneration(model: string): string | undefined {
  return CODEX_PLANNER_MODEL.exec(model)?.[1]
}

function codexLunaGeneration(model: string): string | undefined {
  return CODEX_LUNA_MODEL.exec(model)?.[1]
}

/** Resolve a concrete selection's conversational worker; Phoenix Auto routes before this helper. */
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
  return {
    // The selected Codex route remains the user's coordinator choice. The
    // handoff only moves execution to the current Luna worker when a caller
    // still uses the legacy adaptive entry point; it does not spend Max by
    // default. Exceptional tasks can request Max through Eclipse explicitly.
    afterStep: 1,
    selection: {
      provider: 'openai-codex',
      model: PHOENIX_CODEX_AUTO_WORKER_MODEL,
      reasoningEffort: ReasoningEffortId('high'),
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
const AUTO_TASK_ACTION = /\b(?:fix|repair|debug|implement|edit|modify|update|create|build|run|execute|test|inspect|review|audit|refactor|deploy|install|remove|delete|rename|commit|merge|revert|resolve|diagnose|search|research|investigate|browse|compare|fill|submit|schedule|automate|check|verify|confirm|arregl\p{L}*|repar\p{L}*|corrig\p{L}*|implement\p{L}*|modific\p{L}*|actualiz\p{L}*|crea\p{L}*|ejecut\p{L}*|prueb\p{L}*|revis\p{L}*|audit\p{L}*|refactor\p{L}*|despleg\p{L}*|instal\p{L}*|elimin\p{L}*|renombr\p{L}*|fusion\p{L}*|resuelv\p{L}*|diagnostic\p{L}*|busc\p{L}*|investig\p{L}*|compar\p{L}*|llen\p{L}*|envi\p{L}*|program\p{L}*|automatiz\p{L}*|comprob\p{L}*|comprueb\p{L}*|verific\p{L}*|confirm\p{L}*|consult\p{L}*|inspeccion\p{L}*|cheque\p{L}*|averigu\p{L}*)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Compact reply-depth vocabulary is easier to audit in one literal.
const AUTO_DEEP_REPLY = /\b(?:analy[sz]e|analysis|reason|explain\s+in\s+detail|deep|analiz\p{L}*|razon\p{L}*|explic\p{L}*\s+en\s+detalle|profund\p{L}*)\b/iu
/** High-cost work is opt-in through observable task language, never a model call. */
// oxlint-disable-next-line @stylistic/max-len -- Keep the deterministic risk vocabulary auditable in one literal.
const AUTO_EXCEPTIONAL_TASK = /\b(?:exceptional|critical|urgent|emergency|irreversible|security\s+(?:incident|breach)|production\s+outage|incident(?:e)?\s+de\s+seguridad|m[eé]dico|cl[ií]nico|legal|jur[ií]dico|financial|financiero|cr[ií]tico|urgente|emergencia)\b/iu
/** Multi-step or high-context work merits xhigh while ordinary operations stay high. */
// oxlint-disable-next-line @stylistic/max-len -- Keep the deterministic complexity vocabulary auditable in one literal.
const AUTO_COMPLEX_TASK = /\b(?:complex|complicated|multi[-\s]?step|end[-\s]?to[-\s]?end|architecture|architectural|comprehensive|exhaustive|several|multiple|varios|varias|m[uú]ltiples|complej[oa]|arquitectura|integral|exhaustiv[oa]|profund[oa])\b/iu

/**
 * Choose an effort tier from the already available user request. This keeps
 * routing deterministic and cheap: no classifier request or hidden model call
 * is made merely to choose a reasoning budget.
 * @param text - Direct user request for the current turn.
 * @returns Low is reserved for non-operational fast paths; operational work
 * defaults to high, complex work to xhigh and exceptional work to max.
 */
export function adaptiveCodexReasoningEffort(text: string): ReasoningEffortId {
  if (AUTO_EXCEPTIONAL_TASK.test(text)) return ReasoningEffortId('max')
  if (AUTO_COMPLEX_TASK.test(text) || AUTO_DEEP_REPLY.test(text) || text.length > 480)
    return ReasoningEffortId('xhigh')
  return ReasoningEffortId('high')
}

/** Keep the visible strategy pass cheap; substantive execution gets the adaptive tier. */
function adaptiveCodexPlanningEffort(text: string): ReasoningEffortId {
  if (AUTO_EXCEPTIONAL_TASK.test(text)) return ReasoningEffortId('max')
  if (AUTO_COMPLEX_TASK.test(text) || AUTO_DEEP_REPLY.test(text) || text.length > 480)
    return ReasoningEffortId('medium')
  return ReasoningEffortId('low')
}
/** A stopped operational reply that still announces the next action rather than performing it. */
// oxlint-disable-next-line @stylistic/max-len -- Keep the bilingual unfinished-action matcher auditable as one literal.
const AUTO_UNFINISHED_ACTION = /(?:\b(?:ahora|a\s+continuaci[oó]n|enseguida|para\s+ir\s+m[aá]s\s+r[aá]pido)\b.{0,180}\b(?:voy\s+a|usar[eé]|har[eé]|comprobar[eé]|revisar[eé]|abrir[eé]|ejecutar[eé]|probar[eé]|verificar[eé]|continuar[eé]|seguir[eé])|\bvoy\s+a\s+(?:comprobar|revisar|abrir|ejecutar|probar|verificar|usar|hacer|continuar|seguir|navegar|inspeccionar)|\b(?:i(?:'|’)ll|i\s+will|i(?:'|’)m\s+going\s+to|let\s+me|next\s+i(?:'|’)ll)\s+(?:check|review|open|run|test|verify|use|continue|inspect|try|fix|update|change|browse|navigate))/isu
/** Short explicit promises are not final answers either. */
const AUTO_SHORT_PENDING_PROMISE = /\b(?:lo|la)\s+(?:har[eé]|revisar[eé]|probar[eé]|verificar[eé])\s+(?:ahora|enseguida)\b/iu
/** Bare future-tense commitments (without "voy a") still promise pending action. */
// oxlint-disable-next-line @stylistic/max-len -- One bounded pattern for outstanding first-person commitments.
const AUTO_FUTURE_ACTION = /\b(?:comprobar[eé]|verificar[eé]|confirmar[eé]|consultar[eé]|inspeccionar[eé]|revisar[eé]|probar[eé]|buscar[eé]|ejecutar[eé])(?=$|[^\p{L}\p{N}_])/iu
function phoenixAutoUnfinishedAction(text: string): boolean {
  return AUTO_UNFINISHED_ACTION.test(text)
    || AUTO_SHORT_PENDING_PROMISE.test(text)
    || AUTO_FUTURE_ACTION.test(text)
}

/** Kira can request a focused strategy pass when her approach is unclear. */
// oxlint-disable-next-line @stylistic/max-len -- Narrow bilingual consultation trigger.
const AUTO_SOL_REQUEST = /\b(?:necesito|debo|voy\s+a|conviene|quiero)\s+(?:(?:volver\s+a|primero)\s+)?(?:revisar\s+la\s+estrategia|consultar|preguntar|pedir(?:le)?\s+(?:ayuda|una\s+estrategia))\b|\b(?:no\s+(?:encuentro|logro|consigo)\s+(?:c[oó]mo|una\s+forma\s+de)|no\s+s[eé]\s+c[oó]mo\s+resolver)\b|\b(?:need\s+to|should|will)\s+(?:review\s+the\s+strategy|consult|ask)\b/iu

function kiraNeedsSolStrategy(text: string): boolean {
  return AUTO_SOL_REQUEST.test(text)
}

/** Bound generic self-healing prose continuation, not fresh-evidence strategy consultations. */
// Preserve recovery headroom for real implementation work, while capping tiny
// conversational demonstrations at two total automatic continuations.
const AUTO_CONTINUATION_LIMIT = 4
const BRIEF_TEAM_CONTINUATION_LIMIT = 2
const AUTO_EXECUTION_CONTINUATION =
  'Planning or describing the next action is not task completion. ' +
  'Continue the current user request now with the available tools. ' +
  'Execute the next concrete action instead of only saying what you will do, ' +
  'and keep working until the requested task is actually complete or a concrete external blocker requires user action.'

const AUTO_VISIBLE_PLAN_POLICY =
  'Phoenix Auto is a real two-stage workflow, not hidden role-play. ' +
  'For an actionable multi-step user request, you are Kira herself, preparing the execution brief in this FIRST step. ' +
  'Kira is the single Lead identity; her planning model owns this first step and her execution model continues afterward. ' +
  'Speak as Kira to the user in first person; never address Kira as another person or write "Kira, ...". ' +
  'Write a SHORT, natural user-visible message beginning exactly with "**Plan:**", followed by 2–4 specific ' +
  'actions in the user\'s language, the expected deliverable and how it will be verified. ' +
  'Be proportionate: a tiny team demonstration deserves a tiny plan, not a technical audit. ' +
  'Show decisions, not private chain-of-thought, model names, ceremonial talk or fabricated completion. ' +
  'Do not execute tools or assign coworkers in this first planning step; stop after displaying the plan. ' +
  'On the very next step Kira uses her configured execution coordinator model and executes this plan without asking for routine approval. ' +
  'If the user only wants a greeting, explanation, answer or standalone preview, respond normally with no planning stage.'

const AUTO_SOL_STRATEGY_POLICY =
  'You are Kira herself using the configured planning model for one REAL focused strategy pass. ' +
  'The coordinator is not a separate teammate, speaker or consultant; the Lead identity and ongoing conversation remain Kira. ' +
  'Speak directly to the user in your own first-person voice. Never address yourself as "Kira, ...", ' +
  'give instructions to Kira in second person, or narrate what Kira should do as if she were someone else. ' +
  'Examine the latest evidence and unresolved obstacle, then state one materially different feasible strategy ' +
  'within the current mission and permissions. Do not delegate, run tools or declare work completed. ' +
  'Stop after a concise actionable strategy; continue as Kira on her execution coordinator route immediately afterward.'

const AUTO_LUNA_COORDINATION_POLICY =
  'You are still Kira, coordinating and executing through the configured execution coordinator route. ' +
  'This is one coordinator role across planning, execution and rescue, not a change of speaker; speak in first person and never address Kira as another person. ' +
  'If a user-visible **Plan:** was written earlier in THIS turn, ' +
  'treat that text as the already-approved execution brief; do not rewrite, replan, recite or re-announce it. ' +
  'Start the first permitted real action promptly, supervise the critical path and choose a genuine teammate ' +
  'for actionable multi-step missions, delegate at least one real bounded scope with spawn_teammate; otherwise delegate only when materially helpful. Address teammates naturally by name, accept their real evidence, ' +
  'and speak to the user in concise, warm Spanish when that is their language. ' +
  'Never simulate coworker messages or claim a tool ran before its real result. ' +
  'If you genuinely need a new strategy, state "Necesito revisar la estrategia" and end that step: ' +
  'the router makes a focused planning-model strategy pass whenever new evidence supports it, then returns to execution. ' +
  'Respect the hard limit of three simultaneous specialists; reuse existing agents and rotate assignments instead of creating more. Report meaningful changes and final verified output; skip filler and repetitive stage narration.'

const AUTO_SOL_RESCUE_HANDOFF =
  'You are Kira: you just completed your own focused strategy review, not advice from a different teammate. ' +
  'Resume the SAME unfinished mission in your own first-person voice on the coordinator route; never address Kira as another person. ' +
  'apply the correction only if it respects the original user request and permissions, ' +
  'execute the next tool action and stop when verified. Do not reopen completed work.'

const AUTO_VISIBLE_PLAN_HANDOFF =
  'You are Kira. The visible **Plan:** you authored is your own authoritative execution plan. ' +
  'Continue the current user request as the SAME Kira on the coordinator route, without addressing yourself as another speaker; execute the next concrete action now, ' +
  'without re-planning, re-reading the same brief or asking permission for already authorized safe work. ' +
  'If this is a requested team demonstration, call spawn_teammate once with a small verifiable assignment, ' +
  'wait for genuine evidence and complete the demonstration. The actual Team conversation must be real, ' +
  'natural, concise and useful, not a scripted imitation.'

const FAST_SOCIAL_ATOM = String.raw`(?:hola|hello|hi|hey|buenas|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|qu[eé]\s+tal|c[oó]mo\s+est[aá]s|c[oó]mo\s+te\s+va|c[oó]mo\s+va\s+todo|qu[eé]\s+cuentas|qu[eé]\s+se\s+cuenta|how\s+are\s+you|how(?:'|’)s\s+it\s+going|what(?:'|’)s\s+up|gracias|thanks|thank\s+you)`
const FAST_SOCIAL_SEQUENCE = new RegExp(`^${FAST_SOCIAL_ATOM}(?:\\s+(?:y\\s+)?${FAST_SOCIAL_ATOM})*/**
 * Agent-scoped model selection shared by runtime entry points.
 * @module @phoenix-ai/dsh-agent/model-selection
 */

import type { Context } from '@phoenix-ai/cordis'
import type { Agent } from './runtime-types.ts'
import type { Session } from '@phoenix-ai/dsh-session'
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

/** Model routing preferences belong to Eclipse, not to visible teammate identities. */
export interface EclipseModelRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Eclipse settings: Kira independently selects planning, execution and
 * teammate routes. Strategy review is evidence-driven without a call quota.
 */
export interface EclipseRoutingSettings {
  readonly mode?: 'automatic' | 'hybrid' | 'manual'
  readonly planner?: EclipseModelRoute
  readonly coordinator?: EclipseModelRoute
  readonly subagent?: EclipseModelRoute
  readonly specialists?: Readonly<Record<string, EclipseModelRoute>>
  readonly maxTeammates?: number
  readonly escalationSensitivity?: 'adaptive' | 'quality' | 'economy'
}

/** Apply a user-selected route at a real dispatch boundary, never to virtual ids.
 * @param profile - Optional saved routing configuration.
 * @param role - Independent planning, coordination or teammate responsibility.
 * @param fallback - Shipped route when the role is not overridden.
 * @param adaptiveEffort - Effort selected from the current request when a
 * hybrid/manual route changes only the model and leaves effort unset.
 * @returns Concrete serving route, with only the selected model's requested effort.
 */
export function resolveEclipseRoleRoute(
  profile: EclipseRoutingSettings | undefined,
  role: 'planner' | 'coordinator' | 'subagent',
  fallback: ModelSelection,
  adaptiveEffort?: string,
): ModelSelection {
  if (profile === undefined || profile.mode === undefined || profile.mode === 'automatic') return fallback
  // Kira's live router selects planner only for strategy steps; execution and
  // teammate routes never inherit that higher-cost planning selection.
  const route = profile[role]
  // Eclipse's catalog and reasoning controls are Codex-only. A stale legacy
  // profile must not bypass that boundary at the dispatch site.
  if (route === undefined || route.provider !== 'openai-codex' || route.model === PHOENIX_CODEX_AUTO_MODEL) return fallback
  return {
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined
      ? adaptiveEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(adaptiveEffort) }
      : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) },
  }
}

/** Optional host-side settings authority; client selections and secrets never enter prompts. */
function configuredEclipse(ctx: Context): EclipseRoutingSettings | undefined {
  const settings = ctx.get('agentDefaultModel') as {
    currentEclipseProfile?: () => EclipseRoutingSettings | undefined
  } | undefined
  return settings?.currentEclipseProfile?.()
}

/** Durable selector intent, independent of the real model serving a request. */
export interface ModelSelectionPreference {
  /** Selected planner/router/provider route. */
  readonly selection: ModelSelection
  /** Whether the preference was captured from a default or explicitly chosen. */
  readonly source: 'explicit' | 'default'
}

declare module '@phoenix-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Durable model-routing preference, hidden from model history. Required on
     * read: dropping it would change future provider/model and cost decisions.
     */
    'agent/model-selection': ModelSelectionPreference
  }
}

/** Read the last durable selector preference without using serving request headers.
 * @param session - Session owning the authoritative event stream.
 * @returns Latest preference, or undefined for sessions predating preference capture.
 */
export function latestModelSelectionPreference(session: Pick<Session, 'events'>): ModelSelectionPreference | undefined {
  return session.events.findLast(event => event.type === 'agent/model-selection')?.data
}

/** Persist a changed selector preference without emitting a model-visible message.
 * @param session - Session owning the selection.
 * @param selection - Selected route, independently of the executing model.
 * @param source - Explicit user choice or a default captured at first dispatch.
 * @returns Whether a new preference event was appended.
 */
export function persistModelSelectionPreference(
  session: Session,
  selection: ModelSelection,
  source: ModelSelectionPreference['source'],
): boolean {
  const prior = latestModelSelectionPreference(session)
  if (prior?.source === source && prior.selection.provider === selection.provider
    && prior.selection.model === selection.model && prior.selection.reasoningEffort === selection.reasoningEffort) return false
  session.append('agent/model-selection', {
    selection: {
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
    },
    source,
  })
  return true
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
/** Native Codex worker whose permission escalations are reviewed by Codex Auto-review. */
export const PHOENIX_CODEX_AUTO_REVIEW_TOOL = 'codex_auto_review'

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

/**
 * Phoenix Auto keeps one Kira coordinator identity across planning, execution
 * and rescue. Explicitly selected other Codex models and other providers stay
 * on the user's exact model; Team children never reopen a planning phase.
 * @param selection - the selected provider/model.
 * @param agent - session owner, when one is available.
 * @returns whether the Lead uses the Phoenix coordinator route.
 */
export function isKiraCodexAutoLead(
  selection: ModelSelection | undefined,
  agent: { readonly session: { readonly header?: { readonly agentPreset?: string; readonly origin?: string } } } | undefined,
): boolean {
  // Child specialists execute their assigned Luna route; they must never
  // trigger the Lead-only Sol planning stage even on a replayed auto selector.
  if (agent?.session?.header?.origin === 'subagent') return false
  return isPhoenixCodexAutoSelection(selection)
    || (selection?.provider === 'openai-codex'
      && selection.model === PHOENIX_CODEX_AUTO_WORKER_MODEL
      && agent?.session?.header?.agentPreset === 'kira-max')
}

function codexPlannerGeneration(model: string): string | undefined {
  return CODEX_PLANNER_MODEL.exec(model)?.[1]
}

function codexLunaGeneration(model: string): string | undefined {
  return CODEX_LUNA_MODEL.exec(model)?.[1]
}

/** Resolve a concrete selection's conversational worker; Phoenix Auto routes before this helper. */
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
  return {
    // The selected Codex route remains the user's coordinator choice. The
    // handoff only moves execution to the current Luna worker when a caller
    // still uses the legacy adaptive entry point; it does not spend Max by
    // default. Exceptional tasks can request Max through Eclipse explicitly.
    afterStep: 1,
    selection: {
      provider: 'openai-codex',
      model: PHOENIX_CODEX_AUTO_WORKER_MODEL,
      reasoningEffort: ReasoningEffortId('high'),
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
const AUTO_TASK_ACTION = /\b(?:fix|repair|debug|implement|edit|modify|update|create|build|run|execute|test|inspect|review|audit|refactor|deploy|install|remove|delete|rename|commit|merge|revert|resolve|diagnose|search|research|investigate|browse|compare|fill|submit|schedule|automate|check|verify|confirm|arregl\p{L}*|repar\p{L}*|corrig\p{L}*|implement\p{L}*|modific\p{L}*|actualiz\p{L}*|crea\p{L}*|ejecut\p{L}*|prueb\p{L}*|revis\p{L}*|audit\p{L}*|refactor\p{L}*|despleg\p{L}*|instal\p{L}*|elimin\p{L}*|renombr\p{L}*|fusion\p{L}*|resuelv\p{L}*|diagnostic\p{L}*|busc\p{L}*|investig\p{L}*|compar\p{L}*|llen\p{L}*|envi\p{L}*|program\p{L}*|automatiz\p{L}*|comprob\p{L}*|comprueb\p{L}*|verific\p{L}*|confirm\p{L}*|consult\p{L}*|inspeccion\p{L}*|cheque\p{L}*|averigu\p{L}*)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Compact reply-depth vocabulary is easier to audit in one literal.
const AUTO_DEEP_REPLY = /\b(?:analy[sz]e|analysis|reason|explain\s+in\s+detail|deep|analiz\p{L}*|razon\p{L}*|explic\p{L}*\s+en\s+detalle|profund\p{L}*)\b/iu
/** High-cost work is opt-in through observable task language, never a model call. */
// oxlint-disable-next-line @stylistic/max-len -- Keep the deterministic risk vocabulary auditable in one literal.
const AUTO_EXCEPTIONAL_TASK = /\b(?:exceptional|critical|urgent|emergency|irreversible|security\s+(?:incident|breach)|production\s+outage|incident(?:e)?\s+de\s+seguridad|m[eé]dico|cl[ií]nico|legal|jur[ií]dico|financial|financiero|cr[ií]tico|urgente|emergencia)\b/iu
/** Multi-step or high-context work merits xhigh while ordinary operations stay high. */
// oxlint-disable-next-line @stylistic/max-len -- Keep the deterministic complexity vocabulary auditable in one literal.
const AUTO_COMPLEX_TASK = /\b(?:complex|complicated|multi[-\s]?step|end[-\s]?to[-\s]?end|architecture|architectural|comprehensive|exhaustive|several|multiple|varios|varias|m[uú]ltiples|complej[oa]|arquitectura|integral|exhaustiv[oa]|profund[oa])\b/iu

/**
 * Choose an effort tier from the already available user request. This keeps
 * routing deterministic and cheap: no classifier request or hidden model call
 * is made merely to choose a reasoning budget.
 * @param text - Direct user request for the current turn.
 * @returns Low is reserved for non-operational fast paths; operational work
 * defaults to high, complex work to xhigh and exceptional work to max.
 */
export function adaptiveCodexReasoningEffort(text: string): ReasoningEffortId {
  if (AUTO_EXCEPTIONAL_TASK.test(text)) return ReasoningEffortId('max')
  if (AUTO_COMPLEX_TASK.test(text) || AUTO_DEEP_REPLY.test(text) || text.length > 480)
    return ReasoningEffortId('xhigh')
  return ReasoningEffortId('high')
}

/** Keep the visible strategy pass cheap; substantive execution gets the adaptive tier. */
function adaptiveCodexPlanningEffort(text: string): ReasoningEffortId {
  if (AUTO_EXCEPTIONAL_TASK.test(text)) return ReasoningEffortId('max')
  if (AUTO_COMPLEX_TASK.test(text) || AUTO_DEEP_REPLY.test(text) || text.length > 480)
    return ReasoningEffortId('medium')
  return ReasoningEffortId('low')
}
/** A stopped operational reply that still announces the next action rather than performing it. */
// oxlint-disable-next-line @stylistic/max-len -- Keep the bilingual unfinished-action matcher auditable as one literal.
const AUTO_UNFINISHED_ACTION = /(?:\b(?:ahora|a\s+continuaci[oó]n|enseguida|para\s+ir\s+m[aá]s\s+r[aá]pido)\b.{0,180}\b(?:voy\s+a|usar[eé]|har[eé]|comprobar[eé]|revisar[eé]|abrir[eé]|ejecutar[eé]|probar[eé]|verificar[eé]|continuar[eé]|seguir[eé])|\bvoy\s+a\s+(?:comprobar|revisar|abrir|ejecutar|probar|verificar|usar|hacer|continuar|seguir|navegar|inspeccionar)|\b(?:i(?:'|’)ll|i\s+will|i(?:'|’)m\s+going\s+to|let\s+me|next\s+i(?:'|’)ll)\s+(?:check|review|open|run|test|verify|use|continue|inspect|try|fix|update|change|browse|navigate))/isu
/** Short explicit promises are not final answers either. */
const AUTO_SHORT_PENDING_PROMISE = /\b(?:lo|la)\s+(?:har[eé]|revisar[eé]|probar[eé]|verificar[eé])\s+(?:ahora|enseguida)\b/iu
/** Bare future-tense commitments (without "voy a") still promise pending action. */
// oxlint-disable-next-line @stylistic/max-len -- One bounded pattern for outstanding first-person commitments.
const AUTO_FUTURE_ACTION = /\b(?:comprobar[eé]|verificar[eé]|confirmar[eé]|consultar[eé]|inspeccionar[eé]|revisar[eé]|probar[eé]|buscar[eé]|ejecutar[eé])(?=$|[^\p{L}\p{N}_])/iu
function phoenixAutoUnfinishedAction(text: string): boolean {
  return AUTO_UNFINISHED_ACTION.test(text)
    || AUTO_SHORT_PENDING_PROMISE.test(text)
    || AUTO_FUTURE_ACTION.test(text)
}

/** Kira can request a focused strategy pass when her approach is unclear. */
// oxlint-disable-next-line @stylistic/max-len -- Narrow bilingual consultation trigger.
const AUTO_SOL_REQUEST = /\b(?:necesito|debo|voy\s+a|conviene|quiero)\s+(?:(?:volver\s+a|primero)\s+)?(?:revisar\s+la\s+estrategia|consultar|preguntar|pedir(?:le)?\s+(?:ayuda|una\s+estrategia))\b|\b(?:no\s+(?:encuentro|logro|consigo)\s+(?:c[oó]mo|una\s+forma\s+de)|no\s+s[eé]\s+c[oó]mo\s+resolver)\b|\b(?:need\s+to|should|will)\s+(?:review\s+the\s+strategy|consult|ask)\b/iu

function kiraNeedsSolStrategy(text: string): boolean {
  return AUTO_SOL_REQUEST.test(text)
}

/** Bound generic self-healing prose continuation, not fresh-evidence strategy consultations. */
// Preserve recovery headroom for real implementation work, while capping tiny
// conversational demonstrations at two total automatic continuations.
const AUTO_CONTINUATION_LIMIT = 4
const BRIEF_TEAM_CONTINUATION_LIMIT = 2
const AUTO_EXECUTION_CONTINUATION =
  'Planning or describing the next action is not task completion. ' +
  'Continue the current user request now with the available tools. ' +
  'Execute the next concrete action instead of only saying what you will do, ' +
  'and keep working until the requested task is actually complete or a concrete external blocker requires user action.'

const AUTO_VISIBLE_PLAN_POLICY =
  'Phoenix Auto is a real two-stage workflow, not hidden role-play. ' +
  'For an actionable multi-step user request, you are Kira herself, preparing the execution brief in this FIRST step. ' +
  'Kira is the single Lead identity; her planning model owns this first step and her execution model continues afterward. ' +
  'Speak as Kira to the user in first person; never address Kira as another person or write "Kira, ...". ' +
  'Write a SHORT, natural user-visible message beginning exactly with "**Plan:**", followed by 2–4 specific ' +
  'actions in the user\'s language, the expected deliverable and how it will be verified. ' +
  'Be proportionate: a tiny team demonstration deserves a tiny plan, not a technical audit. ' +
  'Show decisions, not private chain-of-thought, model names, ceremonial talk or fabricated completion. ' +
  'Do not execute tools or assign coworkers in this first planning step; stop after displaying the plan. ' +
  'On the very next step Kira uses her configured execution coordinator model and executes this plan without asking for routine approval. ' +
  'If the user only wants a greeting, explanation, answer or standalone preview, respond normally with no planning stage.'

const AUTO_SOL_STRATEGY_POLICY =
  'You are Kira herself using the configured planning model for one REAL focused strategy pass. ' +
  'The coordinator is not a separate teammate, speaker or consultant; the Lead identity and ongoing conversation remain Kira. ' +
  'Speak directly to the user in your own first-person voice. Never address yourself as "Kira, ...", ' +
  'give instructions to Kira in second person, or narrate what Kira should do as if she were someone else. ' +
  'Examine the latest evidence and unresolved obstacle, then state one materially different feasible strategy ' +
  'within the current mission and permissions. Do not delegate, run tools or declare work completed. ' +
  'Stop after a concise actionable strategy; continue as Kira on her execution coordinator route immediately afterward.'

const AUTO_LUNA_COORDINATION_POLICY =
  'You are still Kira, coordinating and executing through the configured execution coordinator route. ' +
  'This is one coordinator role across planning, execution and rescue, not a change of speaker; speak in first person and never address Kira as another person. ' +
  'If a user-visible **Plan:** was written earlier in THIS turn, ' +
  'treat that text as the already-approved execution brief; do not rewrite, replan, recite or re-announce it. ' +
  'Start the first permitted real action promptly, supervise the critical path and choose a genuine teammate ' +
  'for actionable multi-step missions, delegate at least one real bounded scope with spawn_teammate; otherwise delegate only when materially helpful. Address teammates naturally by name, accept their real evidence, ' +
  'and speak to the user in concise, warm Spanish when that is their language. ' +
  'Never simulate coworker messages or claim a tool ran before its real result. ' +
  'If you genuinely need a new strategy, state "Necesito revisar la estrategia" and end that step: ' +
  'the router makes a focused planning-model strategy pass whenever new evidence supports it, then returns to execution. ' +
  'Respect the hard limit of three simultaneous specialists; reuse existing agents and rotate assignments instead of creating more. Report meaningful changes and final verified output; skip filler and repetitive stage narration.'

const AUTO_SOL_RESCUE_HANDOFF =
  'You are Kira: you just completed your own focused strategy review, not advice from a different teammate. ' +
  'Resume the SAME unfinished mission in your own first-person voice on the coordinator route; never address Kira as another person. ' +
  'apply the correction only if it respects the original user request and permissions, ' +
  'execute the next tool action and stop when verified. Do not reopen completed work.'

const AUTO_VISIBLE_PLAN_HANDOFF =
  'You are Kira. The visible **Plan:** you authored is your own authoritative execution plan. ' +
  'Continue the current user request as the SAME Kira on the coordinator route, without addressing yourself as another speaker; execute the next concrete action now, ' +
  'without re-planning, re-reading the same brief or asking permission for already authorized safe work. ' +
  'If this is a requested team demonstration, call spawn_teammate once with a small verifiable assignment, ' +
  'wait for genuine evidence and complete the demonstration. The actual Team conversation must be real, ' +
  'natural, concise and useful, not a scripted imitation.'

const FAST_SOCIAL_ATOM = String.raw`(?:hola|hello|hi|hey|buenas|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|qu[eé]\s+tal|c[oó]mo\s+est[aá]s|c[oó]mo\s+te\s+va|c[oó]mo\s+va\s+todo|qu[eé]\s+cuentas|qu[eé]\s+se\s+cuenta|how\s+are\s+you|how(?:'|’)s\s+it\s+going|what(?:'|’)s\s+up|gracias|thanks|thank\s+you)`
, 'iu')
/** Kira is the default Lead name; a vocative must not turn tool requests into small talk. */
const FAST_KIRA_VOCATIVE = /^(?:kira|f[eé]nix)\s+|\s+(?:kira|f[eé]nix)$/giu
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
  const addressedGreeting = socialCandidate.replace(FAST_KIRA_VOCATIVE, '').trim()
  if (FAST_SOCIAL_SEQUENCE.test(socialCandidate)
    || (addressedGreeting !== socialCandidate && FAST_SOCIAL_SEQUENCE.test(addressedGreeting))
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

/** Resolve a concrete Eclipse turn after task classification.
 * Conversational turns deliberately use Luna Max in every Eclipse mode:
 * planner/coordinator pins apply to operational tasks, not short greetings.
 * An explicit provider/model selection outside Phoenix Auto never calls this.
 * @param profile - User's Eclipse routing preferences.
 * @param automatic - Task-aware concrete plan or execution route.
 * @param directText - Current human utterance.
 * @param step - 1-based step index.
 * @param hasTeamSignal - Whether a peer question/blocker is admitted in this turn.
 * @returns The model and reasoning budget for the current serving request.
 */
export function resolveEclipseTurnRoute(
  profile: EclipseRoutingSettings | undefined,
  automatic: ModelSelection,
  directText: string,
  step: number,
  hasTeamSignal: boolean,
): ModelSelection {
  if (step === 1 && !hasTeamSignal && automatic.model === PHOENIX_CODEX_AUTO_WORKER_MODEL
    && (isConversationalFastPathText(directText) || isContextualConversationFastPathText(directText))) {
    return { provider: 'openai-codex', model: PHOENIX_CODEX_AUTO_WORKER_MODEL,
      reasoningEffort: ReasoningEffortId('max') }
  }
  const role = automatic.model === PHOENIX_CODEX_AUTO_PLANNER_MODEL ? 'planner' : 'coordinator'
  return resolveEclipseRoleRoute(profile, role, automatic,
    profile?.mode === 'hybrid' ? automatic.reasoningEffort : undefined)
}

function defaultConversationalSelection(selection: ModelSelection | undefined): ModelSelection | undefined {
  if (selection?.provider !== 'openai-codex') return undefined
  return {
    provider: 'openai-codex',
    model: lunaWorkerFor(selection.model) ?? PHOENIX_CODEX_AUTO_WORKER_MODEL,
    reasoningEffort: ReasoningEffortId('low'),
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
    // Session journals are dense; this bounded synchronous read cannot lose its entry.
    const event = events[index] as (typeof events)[number]
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
  readonly text: string
}

/** Presentation-only choices can be decided cheaply; technical, clinical,
 * security and implementation questions always retain the normal Max route.
 */
function isTinyTeamFormatQuestion(signal: PhoenixAutoTeamSignal): boolean {
  return signal.purpose === 'question'
    && signal.text.length <= 260
    && /(?:formato|viñetas|vinetas|una frase|dos frases|breve o|bullets|one sentence|two bullets)/iu.test(signal.text)
    && !/(?:c[oó]digo|error|seguridad|riesgo|arquitectura|paciente|clinica|cl[ií]nica|implementaci[oó]n|fallo|bug)/iu.test(signal.text)
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
      readonly content?: readonly { readonly type?: string; readonly text?: string }[]
    }
    if (data.source?.kind !== 'team-message'
      || typeof data.source.messageId !== 'string'
      || typeof data.source.purpose !== 'string') continue
    return {
      messageId: data.source.messageId,
      purpose: data.source.purpose,
      text: data.content?.filter(block => block.type === 'text')
        .map(block => block.text ?? '').join(' ').trim() ?? '',
    }
  }
  return undefined
}

function stableFingerprint(value: string): string {
  return JSON.stringify(value)
    .toLocaleLowerCase()
    .replace(/\b\d+\b/gu, '#')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 320)
}

function failedToolFingerprint(event: PhoenixAutoEvent): string | undefined {
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
  const data = event.data as { readonly name?: string; readonly arguments?: string }
  if (typeof data.name !== 'string') return undefined
  return `${data.name}:${stableFingerprint(data.arguments ?? '')}`
}

interface PhoenixAutoAssistantStop {
  readonly step: number
  readonly text: string
  readonly sourceModel: string | undefined
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
        readonly source?: { readonly model?: string }
      }
    }
    if (data.turn !== turn || typeof data.step !== 'number') continue
    const text = data.message?.content
      ?.filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string)
      .join(' ')
      .trim() ?? ''
    return { step: data.step, text, sourceModel: data.message?.source?.model }
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

/**
 * Classify a standalone fictional/demo visual without downgrading real work.
 * @param text - Direct user request in the current turn.
 * @returns True only for a bounded, one-shot visual presentation.
 */
function isStandaloneVisualPreviewRequest(text: string): boolean {
  const request = text.trim()
  if (request.length === 0 || request.length > 160 || request.includes('\n')) return false
  const normalized = request.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
  // oxlint-disable-next-line @stylistic/max-len -- Auditable bilingual task classifier.
  if (!/^(?:crea|crear|genera|generar|haz|hacer|dame|muestra|muestrame|dibuja|create|generate|make|show|draw)\b/u.test(normalized)) return false
  if (!/\b(?:grafico|grafica|graph|chart|tabla|table|escala|scale|formulario|form|tarjeta|card)\b/u.test(normalized)) return false
  // oxlint-disable-next-line @stylistic/max-len -- Auditable preview intent vocabulary.
  if (!/\b(?:fictici[oa]s?|simulad[oa]s?|ejemplos?|demo|demostracion|sample|fictional|simulated|preview|vista\s+previa|para\s+verlo)\b/u.test(normalized)) return false
  // Additional work, real-world data, or external side effects keep ordinary
  // review and team admission intact.
  // oxlint-disable-next-line @stylistic/max-len -- Conservatively exclude consequential workflows.
  return !/\b(?:y\s+(?:despues|luego|tambien|envia|envialo|publica|guarda|implementa|despliega)|and\s+(?:then|also|send|deploy|publish|save)|pacient\w*|produccion|production|real(?:es)?|correo|email|database|base\s+de\s+datos|api|github|repo|main|stable)\b/u.test(normalized)
}

/**
 * Require the actual successful tool receipt from THIS turn rather than
 * accepting an assistant claim or an artifact left over from a prior turn.
 */
function phoenixAutoHasInlineVisualReceiptForTurn(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
): boolean {
  const callIds = new Set<string>()
  for (const event of turnEvents(agent, turn)) {
    if (event.type === 'tool/call') {
      const call = event.data as { readonly name?: string; readonly callId?: string }
      if ((call.name === 'phoenix_visualize' || call.name === 'phoenix_canvas')
        && typeof call.callId === 'string') callIds.add(call.callId)
      continue
    }
    if (event.type !== 'tool/result') continue
    const result = event.data as {
      readonly error?: unknown
      readonly message?: {
        readonly source?: { readonly kind?: string; readonly callId?: string }
        readonly content?: readonly {
          readonly type?: string
          readonly toolCallId?: string
          readonly isError?: boolean
          readonly content?: readonly { readonly type?: string; readonly text?: string }[]
        }[]
      }
    }
    if (result.error !== undefined || result.message?.source?.kind !== 'tool') continue
    for (const block of result.message.content ?? []) {
      if (block.type !== 'tool-result' || block.isError !== false
        || block.toolCallId !== result.message.source.callId
        || !callIds.has(block.toolCallId ?? '')) continue
      if (block.content?.some(item => item.type === 'text'
        && (item.text?.includes('Rich visual ready:') === true
          || item.text?.includes('Canvas ready in Phoenix:') === true))) return true
    }
  }
  return false
}

/** A final response is a stop, not a new implicit delegation request. */
function phoenixAutoExplicitlyClosed(text: string): boolean {
  const normalized = text.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
  // This protects finished first-step answers without treating generic
  // progress such as "tests completed; now deploy" as terminal.
  if (phoenixAutoUnfinishedAction(text)) return false
  // oxlint-disable-next-line @stylistic/max-len -- Auditable bilingual completion vocabulary.
  return /\b(?:tarea\s+(?:ya\s+)?(?:terminada|completada|finalizada)|(?:ya\s+)?(?:termine|finalice|complete|terminado|completado|finalizado)|no\s+(?:queda|hay)\s+(?:trabajo|nada|tareas?)\s+pendiente|sin\s+(?:trabajo|tareas?)\s+pendientes?|done|finished|completed|nothing\s+(?:else\s+)?(?:left|pending))\b/u.test(normalized)
}

/** Once a human stops the turn, no continuation or Team gate may revive it. */
function phoenixAutoTurnWasUserStopped(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
): boolean {
  return turnEvents(agent, turn).some((event) => {
    if (event.type !== 'turn/end') return false
    const data = event.data as {
      readonly reason?: { readonly kind?: string; readonly reason?: { readonly kind?: string } }
    }
    return data.reason?.kind === 'aborted' && data.reason.reason?.kind === 'user'
  })
}

/** Stop automatic continuation on an explicit, durable Team admission denial.
 * A closed mission cannot be repaired by sending more assistant or tool calls.
 */
function phoenixAutoTerminalTeamFailure(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
): boolean {
  const events = turnEvents(agent, turn)
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const result = event.data as { readonly error?: { readonly code?: string; readonly message?: string }
      readonly message?: { readonly content?: readonly { readonly text?: string
        readonly content?: readonly { readonly text?: string }[] }[] } }
    if (result.error?.code === 'TEAM_MISSION_CLOSED') return true
    const detail = result.error?.message
      ?? result.message?.content?.flatMap(block => [
        block.text ?? '', ...(block.content?.map(child => child.text ?? '') ?? []),
      ]).join(' ') ?? ''
    if (/TEAM_MISSION_CLOSED|Kira already closed this (?:Team )?mission/iu.test(detail.slice(0,4096))) return true
  }
  return false
}

/**
 * The durable Goal service already authorized this source. Continuation
 * rounds have no NEW human user/message; do not interpret that as permission
 * to end an unfinished mission. Reject stale/completed or cleared goals.
 */
function authorizedPhoenixAutoGoalTurn(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
): boolean {
  const admitted = turnEvents(agent, turn).findLast(event => event.type === 'user/message'
    && (event.data as { readonly source?: { readonly kind?: string } }).source?.kind === 'goal')
  const source = (admitted?.data as { readonly source?: {
    readonly kind?: string
    readonly goalId?: string
  } } | undefined)?.source
  if (source?.kind !== 'goal' || typeof source.goalId !== 'string') return false
  const change = agent.session.events.findLast(event => event.type === 'goal/change')
  const data = change?.data as { readonly operation?: string
    readonly goal?: {
      readonly id?: string
      readonly phase?: string
    } } | undefined
  return data?.operation !== 'clear' && data?.goal?.id === source.goalId
    && data.goal.phase === 'active'
}

/** A tiny requested Team showcase gets one bounded, genuine peer exchange.
 * @param text - The direct user request being classified.
 * @returns Whether the request is a tiny team demonstration rather than implementation work.
 */
export function isBriefTeamDemonstration(text: string): boolean {
  const request = text.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().trim()
  if (request.length < 8 || request.length > 240 || request.includes('\n')) return false
  if (!/\b(?:equipo|team|teammates|companeros|agentes)\b/u.test(request)) return false
  if (!/\b(?:demo|demostracion|prueba|ejemplo|accion|action|showcase|show)\b/u.test(request)) return false
  // Real coding, research and external side effects retain deliberate xhigh planning.
  // oxlint-disable-next-line @stylistic/max-len -- Auditable consequential-work vocabulary.
  return !/(?:https?:\/\/|[a-z]:\\|\b(?:github|repo|codigo|script|archivo\w*|implementa|despliega|production|produccion|email|correo|compra|borra|elimina|contrato|paciente|sql|api|web|sitio|site|investigacion|research)\b)/u.test(request)
}

function phoenixAutoTaskRequest(text: string): boolean {
  const candidate = text.trim()
  return CONTEXTUAL_CONTINUATION.test(candidate)
    || isToolAcquisitionRequest(candidate)
    || AUTO_TASK_ACTION.test(candidate)
}

/** Look at the live turn boundary: assembly happens before step/start is logged. */
function nextPhoenixAutoAssemblyStep(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
): number | undefined {
  const events = agent.session.events
  const start = events.findLastIndex(event => event.type === 'turn/start')
  if (start < 0) return undefined
  const turn = (events[start]?.data as { readonly turn?: number } | undefined)?.turn
  if (typeof turn !== 'number') return undefined
  const steps = events.slice(start + 1)
    .filter(event => event.type === 'step/start'
      && (event.data as { readonly turn?: number }).turn === turn)
  const last = steps.at(-1)
  return last === undefined ? 1 : ((last.data as { readonly step: number }).step + 1)
}

/** A plan is evidence only if Sol actually published text, not if it thought privately. */
function hasVisibleSolPlan(text: string): boolean {
  return /^(?:#{1,3}\s*)?(?:\*\*)?plan(?:\s+de\s+trabajo)?\s*:(?:\*\*)?/iu.test(text.trim())
}

interface PhoenixAutoRouterState {
  turn: number
  lastRescueStep: number
  lastRescueEvidenceVersion: number
  lastRescueEvidenceSignature: string | undefined
  continuationCount: number
  lastContinuationStep: number
  forcePlannerNext: boolean
  lastTeamEscalationMessageId: string | undefined
}

function resetPhoenixAutoTurnState(state: PhoenixAutoRouterState, turn: number): void {
  if (state.turn === turn) return
  state.turn = turn
  state.lastRescueStep = 0
  state.lastRescueEvidenceVersion = 0
  state.lastRescueEvidenceSignature = undefined
  state.continuationCount = 0
  state.lastContinuationStep = 0
  state.forcePlannerNext = false
  state.lastTeamEscalationMessageId = undefined
}


/** Tool results and provider retries are new execution evidence, unlike repeated prose. */
function phoenixAutoEvidenceVersion(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
): number {
  return turnEvents(agent, turn).filter(event => event.type === 'tool/result' || event.type === 'llm/retry').length
}

/** Compare substantive tool outcomes, not volatile call identifiers, before another review. */
function phoenixAutoEvidenceSignature(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
): string | undefined {
  const latest = turnEvents(agent, turn).findLast(event => event.type === 'tool/result' || event.type === 'llm/retry')
  if (latest === undefined) return undefined
  if (latest.type === 'llm/retry') {
    const data = latest.data as { readonly error?: { readonly code?: string; readonly message?: string } }
    return `retry:${data.error?.code ?? ''}:${stableFingerprint(data.error?.message ?? '')}`
  }
  const result = latest.data as { readonly error?: { readonly code?: string; readonly message?: string }
    readonly message?: { readonly content?: readonly {
      readonly text?: string
      readonly content?: readonly { readonly text?: string }[]
    }[] } }
  const text = result.message?.content?.flatMap(block => [
    block.text ?? '', ...(block.content?.map(child => child.text ?? '') ?? []),
  ]).filter(Boolean).join(' ') ?? ''
  return text.length === 0 && result.error === undefined ? undefined
    : `tool:${result.error?.code ?? ''}:${stableFingerprint(text || result.error?.message || '')}`
}

/** A strategy review needs new execution evidence or a different Team blocker. */
function phoenixAutoHasFreshStrategyEvidence(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
  state: PhoenixAutoRouterState,
): boolean {
  const signal = phoenixAutoTeamSignalForTurn(agent, turn)
  if (signal?.purpose === 'blocker' && signal.messageId !== state.lastTeamEscalationMessageId) return true
  if (state.lastRescueStep === 0) return true
  if (phoenixAutoEvidenceVersion(agent, turn) <= state.lastRescueEvidenceVersion) return false
  const signature = phoenixAutoEvidenceSignature(agent, turn)
  return signature === undefined || signature !== state.lastRescueEvidenceSignature
}

function recordPhoenixAutoStrategyReview(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
  step: number,
  state: PhoenixAutoRouterState,
): void {
  state.lastRescueStep = step
  state.lastRescueEvidenceVersion = phoenixAutoEvidenceVersion(agent, turn)
  state.lastRescueEvidenceSignature = phoenixAutoEvidenceSignature(agent, turn)
  const signal = phoenixAutoTeamSignalForTurn(agent, turn)
  if (signal?.purpose === 'blocker') state.lastTeamEscalationMessageId = signal.messageId
}

/** Higher quality mode proactively reviews a first complex-task tool failure. */
function phoenixAutoNeedsStallStrategy(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
  directText: string,
  sensitivity: EclipseRoutingSettings['escalationSensitivity'],
): boolean {
  if (sensitivity === 'economy') return false
  if (isPhoenixCodexAutoStalled(agent, turn)) return true
  if (sensitivity !== 'quality' || !AUTO_COMPLEX_TASK.test(directText)) return false
  const latestResult = turnEvents(agent, turn).findLast(event => event.type === 'tool/result')
  return latestResult !== undefined && failedToolFingerprint(latestResult) !== undefined
}

function directCodexPlannerRescue(
  selection: ModelSelection,
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
  step: number,
  state: PhoenixAutoRouterState,
): ModelSelection | undefined {
  if (selection.provider !== 'openai-codex' || step <= 1) return undefined
  resetPhoenixAutoTurnState(state, turn)
  const teamSignal = phoenixAutoTeamSignalForTurn(agent, turn)
  if (!phoenixAutoHasFreshStrategyEvidence(agent, turn, state)) return undefined
  if (teamSignal?.purpose === 'blocker' && teamSignal.messageId !== state.lastTeamEscalationMessageId
    || isPhoenixCodexAutoStalled(agent, turn)) {
    recordPhoenixAutoStrategyReview(agent, turn, step, state)
    return selection
  }
  return undefined
}

function phoenixAutoRoute(
  agent: { readonly session: { readonly events: readonly PhoenixAutoEvent[] } },
  turn: number,
  step: number,
  directText: string,
  state: PhoenixAutoRouterState,
  sensitivity: EclipseRoutingSettings['escalationSensitivity'] = 'adaptive',
): ModelSelection & { reasoningEffort: ReasoningEffortId } {
  resetPhoenixAutoTurnState(state, turn)
  const teamSignal = phoenixAutoTeamSignalForTurn(agent, turn)
  if (teamSignal?.purpose === 'blocker' && teamSignal.messageId !== state.lastTeamEscalationMessageId) {
    recordPhoenixAutoStrategyReview(agent, turn, step, state)
    return {
      provider: 'openai-codex',
      model: PHOENIX_CODEX_AUTO_PLANNER_MODEL,
      reasoningEffort: adaptiveCodexPlanningEffort(directText),
    }
  }
  if (step <= 1) {
    // A real Team wakeup belongs to Kira's operational loop. Never route peer
    // results/questions through the low-effort social fast path.
    if (teamSignal !== undefined) {
      return {
        provider: 'openai-codex',
        model: PHOENIX_CODEX_AUTO_WORKER_MODEL,
        reasoningEffort: isTinyTeamFormatQuestion(teamSignal)
          ? ReasoningEffortId('low') : adaptiveCodexReasoningEffort(directText),
      }
    }
    if (isConversationalFastPathText(directText) || isContextualConversationFastPathText(directText)) {
      return {
        provider: 'openai-codex',
        model: PHOENIX_CODEX_AUTO_WORKER_MODEL,
        reasoningEffort: ReasoningEffortId('max'),
      }
    }
    if (isStandaloneVisualPreviewRequest(directText)) {
      return {
        provider: 'openai-codex',
        model: PHOENIX_CODEX_AUTO_WORKER_MODEL,
        reasoningEffort: ReasoningEffortId('low'),
      }
    }
    if (isBriefTeamDemonstration(directText)) {
      // A tiny requested team chat check needs one real peer, not a separate
      // Keep a bounded demonstration cheap instead of adding strategy and
      // orchestration rounds that do not improve its result.
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
        reasoningEffort: adaptiveCodexPlanningEffort(directText),
      }
    }
    return {
      provider: 'openai-codex',
      model: PHOENIX_CODEX_AUTO_WORKER_MODEL,
      reasoningEffort: ReasoningEffortId(AUTO_DEEP_REPLY.test(directText) ? 'medium' : 'low'),
    }
  }

  if (state.forcePlannerNext && phoenixAutoHasFreshStrategyEvidence(agent, turn, state)) {
    state.forcePlannerNext = false
    recordPhoenixAutoStrategyReview(agent, turn, step, state)
    return {
      provider: 'openai-codex',
      model: PHOENIX_CODEX_AUTO_PLANNER_MODEL,
      reasoningEffort: adaptiveCodexPlanningEffort(directText),
    }
  }

  const canRescue = phoenixAutoNeedsStallStrategy(agent, turn, directText, sensitivity)
    && phoenixAutoHasFreshStrategyEvidence(agent, turn, state)
  if (canRescue) {
    recordPhoenixAutoStrategyReview(agent, turn, step, state)
    return {
      provider: 'openai-codex',
      model: PHOENIX_CODEX_AUTO_PLANNER_MODEL,
      reasoningEffort: adaptiveCodexPlanningEffort(directText),
    }
  }

  if (isBriefTeamDemonstration(directText)) {
    // Keep a bounded conversational demo lightweight until the coordinator
    // has actually published a plan. A visible plan is an execution brief,
    // so its next step uses the substantive coordinator route.
    const latestPlan = latestPhoenixAutoAssistantStop(agent, turn)
    if (latestPlan !== undefined && hasVisibleSolPlan(latestPlan.text)) {
      return {
        provider: 'openai-codex',
        model: PHOENIX_CODEX_AUTO_WORKER_MODEL,
        reasoningEffort: adaptiveCodexReasoningEffort(directText),
      }
    }
    return {
      provider: 'openai-codex',
      model: PHOENIX_CODEX_AUTO_WORKER_MODEL,
      reasoningEffort: ReasoningEffortId('low'),
    }
  }

  return {
    provider: 'openai-codex',
    model: PHOENIX_CODEX_AUTO_WORKER_MODEL,
    reasoningEffort: adaptiveCodexReasoningEffort(directText),
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
    lastRescueEvidenceVersion: 0,
    lastRescueEvidenceSignature: undefined,
    continuationCount: 0,
    lastContinuationStep: 0,
    forcePlannerNext: false,
    lastTeamEscalationMessageId: undefined,
  }
  // A rehydrated Phoenix session can temporarily display an empty selector.
  // Reuse only its own durable Auto or Kira coordinator preference, never
  // infer an Auto route from the last serving model or override a live choice.
  function effectiveSelection(agent: Agent | undefined): ModelSelection | undefined {
    if (selection.current !== undefined) return selection.current
    if (agent === undefined) return undefined
    const preference = latestModelSelectionPreference(agent.session)
    return isKiraCodexAutoLead(preference?.selection, agent) ? preference?.selection : undefined
  }

  const disposeAssembly = agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const selected = effectiveSelection(agentCtx.agent)
    // The selector is the authority for the next assembled step. Reused blank
    // sessions can otherwise retain creation-time AgentOptions from a previous
    // provider, which makes delegators spawn teammates on the wrong route.
    const scopedAgent = agentCtx.agent
    if (selected !== undefined && scopedAgent !== undefined) {
      // Provider identity is always safe to synchronize and is also the hard
      // capability gate used by provider-specific tools such as Codex Auto-review.
      scopedAgent.options.provider = selected.provider
      // Phoenix Auto and Kira Max's Codex seat use the adaptive coordinator
      // router. Keep the existing
      // concrete model/effort while synchronizing only the provider identity.
      if (!isKiraCodexAutoLead(selected, scopedAgent)) {
        scopedAgent.options.model = selected.model
        if (selected.reasoningEffort === undefined) delete scopedAgent.options.reasoningEffort
        else scopedAgent.options.reasoningEffort = selected.reasoningEffort
      }
    }
    const assembled = await next()
    selection.assembled = selected
    // Native Auto-review is a Codex runtime capability, not a generic Phoenix
    // reviewer. Hide it entirely from DeepSeek, Claude, OpenRouter and local
    // selections; the provider backend also enforces the same boundary.
    const providerTools = selected?.provider === 'openai-codex'
      ? assembled.tools
      : assembled.tools.filter(tool => tool.name !== PHOENIX_CODEX_AUTO_REVIEW_TOOL)
    const hasKiraTeam = providerTools.some(tool => tool.name === 'spawn_teammate')
    // Agent Teams is Phoenix's single visible delegation path. Keeping legacy
    // subagent tools beside it lets provider models bypass Kira identities,
    // shared chat, reactions and lifecycle state unpredictably.
    const tools = hasKiraTeam
      ? providerTools.filter(tool => tool.name !== 'subagent' && tool.name !== 'subagent_fork')
      : providerTools
    selection.assembledToolCount = tools.length
    if (selected === undefined) return assembled
    const autoStep = isKiraCodexAutoLead(selected, scopedAgent) && scopedAgent !== undefined
      ? nextPhoenixAutoAssemblyStep(scopedAgent)
      : undefined
    const currentTurn = scopedAgent?.session?.events.findLast(event => event.type === 'turn/start')
    const currentTurnNumber = (currentTurn?.data as { readonly turn?: number } | undefined)?.turn
    const currentRequest = scopedAgent?.session !== undefined && currentTurnNumber !== undefined
      ? directUserTextForTurn(scopedAgent, currentTurnNumber) : ''
    // Never inject a "stop after the plan" instruction into a quick-answer
    // route whose request was not classified as an operational task. Otherwise
    // the model can emit a plan that the turn-stopping gate never resumes.
    // Assembly happens before model routing, so it must pick the same
    // strategy-only phase when a real blocker, stall or voluntary consult is next.
    if (currentTurnNumber !== undefined) resetPhoenixAutoTurnState(phoenixAutoState, currentTurnNumber)
    const teamSignal = scopedAgent !== undefined && currentTurnNumber !== undefined
      ? phoenixAutoTeamSignalForTurn(scopedAgent, currentTurnNumber) : undefined
    const needsTeamRescue = teamSignal?.purpose === 'blocker'
      && teamSignal.messageId !== phoenixAutoState.lastTeamEscalationMessageId
    const needsStallRescue = scopedAgent !== undefined && currentTurnNumber !== undefined
      && phoenixAutoNeedsStallStrategy(scopedAgent, currentTurnNumber, currentRequest,
        configuredEclipse(agentCtx)?.escalationSensitivity)
    const strategyRescueStep = autoStep !== undefined && scopedAgent !== undefined && currentTurnNumber !== undefined
      && phoenixAutoHasFreshStrategyEvidence(scopedAgent, currentTurnNumber, phoenixAutoState)
      && (needsTeamRescue || (autoStep > 1 && (phoenixAutoState.forcePlannerNext || needsStallRescue)))
    const autoPolicy = strategyRescueStep ? AUTO_SOL_STRATEGY_POLICY
      : autoStep === 1
        && phoenixAutoTaskRequest(currentRequest)
        && !isStandaloneVisualPreviewRequest(currentRequest)
        && !isBriefTeamDemonstration(currentRequest) ? AUTO_VISIBLE_PLAN_POLICY
        : autoStep !== undefined && autoStep > 1 ? AUTO_LUNA_COORDINATION_POLICY : undefined
    return {
      ...assembled,
      ...autoPolicy === undefined ? {} : {
        sections: [...assembled.sections, {
          name: 'phoenix:auto-visible-handoff',
          text: autoPolicy,
        }],
      },
      // The initial coordinator plan cannot execute tools. The coordinator
      // receives regular tools on the next step, and the continuation gate
      // still knows that real tools are available after the plan.
      tools: autoPolicy === AUTO_VISIBLE_PLAN_POLICY || autoPolicy === AUTO_SOL_STRATEGY_POLICY ? [] : tools,
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
      const selected = selection.assembled ?? effectiveSelection(agentCtx.agent)
      if (selected === undefined) return resolved
      const scopedAgent = agentCtx.agent
      if (scopedAgent !== undefined && latestModelSelectionPreference(scopedAgent.session) === undefined) {
        persistModelSelectionPreference(scopedAgent.session, selected, 'default')
      }
      // Explicit user model choices are the Lead's orchestration brain, even
      // when an older composition still installs a generic Codex handoff.
      // Phoenix Auto uses the adaptive coordinator route for planning and
      // execution. Other explicit model choices stay exact.
      const exactUserChoice = scopedAgent === undefined ? false
        : latestModelSelectionPreference(scopedAgent.session)?.source === 'explicit'
      if (!isKiraCodexAutoLead(selected, scopedAgent) && (handoff === undefined || exactUserChoice)) {
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
      if (isKiraCodexAutoLead(selected, scopedAgent)) {
        const eclipseProfile = isPhoenixCodexAutoSelection(selected) ? configuredEclipse(agentCtx) : undefined
        const automatic = phoenixAutoRoute(
          _payload.agent,
          _payload.turn,
          _payload.step,
          directText,
          phoenixAutoState,
          eclipseProfile?.escalationSensitivity,
        )
        // The planner serves initial strategy and evidence-based rescues; Kira
        // immediately returns to the independently configured execution model.
        const routed = resolveEclipseTurnRoute(
          eclipseProfile, automatic, directText, _payload.step,
          phoenixAutoTeamSignalForTurn(_payload.agent, _payload.turn) !== undefined,
        )
        const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
        return {
          ...withoutInheritedEffort,
          provider: routed.provider,
          model: routed.model,
          ...routed.reasoningEffort === undefined ? {} : { reasoningEffort: routed.reasoningEffort },
        }
      }
      const resolvedHandoff = typeof handoff === 'function' ? handoff(selected) : handoff
      const conversation = _payload.step === 1
        && (isConversationalFastPathText(directText) || isContextualConversationFastPathText(directText))
        ? defaultConversationalSelection(selected)
        : undefined
      const plannerRescue = resolvedHandoff === undefined ? undefined : directCodexPlannerRescue(
        selected,
        _payload.agent,
        _payload.turn,
        _payload.step,
        phoenixAutoState,
      )
      const candidateRoute = plannerRescue
        ?? conversation
        ?? (resolvedHandoff !== undefined && _payload.step > resolvedHandoff.afterStep
          ? resolvedHandoff.selection
          : selected)
      // The social fast path deliberately trades unnecessary reasoning for
      // latency. Do not let GPT-6 Luna's substantive-task Max pin overwrite it.
      // Respect the selected effort. Automatic task budgets are decided by
      // phoenixAutoRoute; an explicit model choice must never be silently
      // upgraded to Max.
      const routed = conversation ?? candidateRoute
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
    if (!isKiraCodexAutoLead(effectiveSelection(agent), agent)) return
    if ((selection.assembledToolCount ?? 0) === 0) return

    const directText = directUserTextForTurn(agent, turn)
    const continuationLimit = isBriefTeamDemonstration(directText)
      ? BRIEF_TEAM_CONTINUATION_LIMIT : AUTO_CONTINUATION_LIMIT
    // Team blockers have their own authorized continuation; they need not
    // coincide with a fresh human message in the same turn.
    const realTeamBlocker = phoenixAutoTeamSignalForTurn(agent, turn)?.purpose === 'blocker'
    const authorizedGoal = authorizedPhoenixAutoGoalTurn(agent, turn)
    if ((!phoenixAutoTaskRequest(directText) && !realTeamBlocker && !authorizedGoal)
      || phoenixAutoTurnWasUserStopped(agent, turn)
      || phoenixAutoTerminalTeamFailure(agent, turn)) return
    // A tool-verified one-shot visual meets the original request. Do not
    // resurrect it with a mandatory team-admission notice.
    if (isStandaloneVisualPreviewRequest(directText)
      && phoenixAutoHasInlineVisualReceiptForTurn(agent, turn)) return
    resetPhoenixAutoTurnState(phoenixAutoState, turn)

    const latest = latestPhoenixAutoAssistantStop(agent, turn)
    if (latest === undefined) return

    const events = turnEvents(agent, turn)
    const latestStepHasToolActivity = events.some((event) => {
      if (event.type !== 'tool/call' && event.type !== 'tool/result') return false
      return (event.data as { readonly step?: number }).step === latest.step
    })
    // The actual visible assistant text is the coordinator handoff. A persisted
    // assistant source may omit the model: the explicit visible plan plus the
    // active Phoenix Auto route is authoritative; never silently stop here.
    if (latest.step === 1 && !latestStepHasToolActivity
      && hasVisibleSolPlan(latest.text) && !phoenixAutoExplicitlyClosed(latest.text)) {
      // Once the plan was handed off, do not re-enter Team admission for the
      // exact same stopping step. It would manufacture a second coordination turn.
      if (phoenixAutoState.lastContinuationStep === latest.step) return
      phoenixAutoState.continuationCount += 1
      phoenixAutoState.lastContinuationStep = latest.step
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: AUTO_VISIBLE_PLAN_HANDOFF }],
        source: {
          kind: 'plugin', plugin: 'model-selection', form: 'notice',
          summary: 'Phoenix Auto visible coordinator handoff',
        },
      }))
      return
    }

    if (phoenixAutoState.lastContinuationStep === latest.step) return
    // The serving model receipt is stronger than an ephemeral step counter.
    // On rehydrated Goal turns that counter may be lost even though the
    // coordinator completed its strategy. Every actual strategy rescue hands
    // control back to execution, even when the ordinary prose budget is exhausted.
    const actualStrategyRescue = !latestStepHasToolActivity
      && (authorizedGoal || latest.step === phoenixAutoState.lastRescueStep)
      && (latest.sourceModel === PHOENIX_CODEX_AUTO_PLANNER_MODEL
        || latest.sourceModel === configuredEclipse(agentCtx)?.planner?.model
        || (latest.sourceModel === undefined && latest.step === phoenixAutoState.lastRescueStep))
    if (actualStrategyRescue && !phoenixAutoExplicitlyClosed(latest.text)) {
      phoenixAutoState.lastRescueStep = latest.step
      phoenixAutoState.lastContinuationStep = latest.step
      phoenixAutoState.continuationCount += 1
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: AUTO_SOL_RESCUE_HANDOFF }],
        source: { kind: 'plugin', plugin: 'model-selection', form: 'notice',
          summary: 'Kira resumes coordinator execution after strategy rescue' },
      }))
      return
    }
    // The coordinator can ask for a strategy when stuck without repeating a doomed tool.
    if (latest.step > 1
      && !phoenixAutoExplicitlyClosed(latest.text) && kiraNeedsSolStrategy(latest.text)
      && phoenixAutoHasFreshStrategyEvidence(agent, turn, phoenixAutoState)) {
      phoenixAutoState.lastContinuationStep = latest.step
      phoenixAutoState.continuationCount += 1
      phoenixAutoState.forcePlannerNext = true
      agent.steer(createUserMessage({
        content: [{ type: 'text', text:
          'Review ONE focused strategy for the current unresolved issue, ' +
          'then return to the coordinator route to execute and verify it.' }],
        source: { kind: 'plugin', plugin: 'model-selection', form: 'notice',
          summary: 'Kira requests coordinator strategy review' },
      }))
      return
    }
    // Kira's normal final answer is terminal. Team availability is never
    // evidence of unfinished work. Only a visible, unexecuted action or the
    // explicitly visible coordinator planning handoff can request another step.
    const plannerStoppedBeforeActing = latest.step === 1 && !latestStepHasToolActivity
      && (latest.sourceModel === PHOENIX_CODEX_AUTO_PLANNER_MODEL
        || (isPhoenixCodexAutoSelection(effectiveSelection(agentCtx.agent))
          && latest.sourceModel === configuredEclipse(agentCtx)?.planner?.model))
      && !phoenixAutoExplicitlyClosed(latest.text)
    // A first-step plan that returned no usable assistant text still has not
    // executed anything. Missing content must not silently terminate real work.
    const emptyPlannerStop = latest.step === 1 && !latestStepHasToolActivity
      && latest.text.length === 0
    // A teammate's real question is unresolved until Kira makes a substantive
    // decision or acts. A bare "Done" and an unmatched tool/result event are
    // not evidence of quality or completion.
    const teamQuestion = phoenixAutoTeamSignalForTurn(agent, turn)?.purpose === 'question'
    const teamStillNeedsDecision = teamQuestion
      && !events.some(event => event.type === 'tool/call')
      && /^(?:done|finished|completed|listo|hecho|terminado)\.?$/iu.test(latest.text)
    const announcedNextAction = !latestStepHasToolActivity
      && latest.text.length > 0
      && phoenixAutoUnfinishedAction(latest.text)
    if (!plannerStoppedBeforeActing && !emptyPlannerStop && !teamStillNeedsDecision && !announcedNextAction) return
    if (phoenixAutoState.continuationCount >= continuationLimit) return

    phoenixAutoState.continuationCount += 1
    phoenixAutoState.lastContinuationStep = latest.step
    // The normal coordinator transition gets one chance to execute. If it then
    // stops on another promise, make the next step a strategy rescue.
    if (phoenixAutoState.continuationCount >= 2 && continuationLimit > BRIEF_TEAM_CONTINUATION_LIMIT)
      phoenixAutoState.forcePlannerNext = true
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
