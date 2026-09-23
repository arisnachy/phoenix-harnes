/**
 * Agent-scoped model selection shared by runtime entry points.
 * @module @phoenix-ai/dsh-agent/model-selection
 */

import type { Context } from '@phoenix-ai/cordis'
import { CallId, ReasoningEffortId, type LlmCallConfig } from '@phoenix-ai/dsh-llm'
import type { Agent } from './runtime-types.ts'

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


const JEV_MODEL_ROUTE_TOOL = 'mcp__jev__jev_route_model'
const JEV_FAILURE_THRESHOLD = 3
const JEV_CIRCUIT_OPEN_MS = 5 * 60_000
const JEV_MAX_TASK_CHARS = 4_000
const JEV_MAX_CANDIDATES = 10
// Automatic routing must stay cheap even though explicit Jev review tools may
// legitimately need the full remote-tool timeout.
const JEV_ROUTE_BUDGET_MS = 3_000

/** Premium Codex tiers that should spend one step planning before Luna executes. */
const CODEX_PLANNER_MODEL = /^gpt-(\d+(?:\.\d+)?)-(?:sol|astra|terra)(?:$|-)/i
/** Luna worker ids, grouped by the same GPT generation as their planner. */
const CODEX_LUNA_MODEL = /^gpt-(\d+(?:\.\d+)?)-luna(?:$|-)/i

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
 */
export function isCodexPlannerModel(model: string): boolean {
  return codexPlannerGeneration(model) !== undefined
}

function lunaWorkerFor(model: string): string | undefined {
  const plannerGeneration = codexPlannerGeneration(model)
  if (plannerGeneration !== undefined) return `gpt-${plannerGeneration}-luna`
  return codexLunaGeneration(model) === undefined ? undefined : model
}

function isJevAvailabilityFailure(error: unknown): boolean {
  const message = String(error).toLowerCase()
  return /(?:\b(?:401|402|403|429)\b|api\s*key|auth(?:entication|orization)?|credit|quota|rate[-\s]?limit|insufficient|payment)/i.test(message)
}

interface SameFamilyModelInfo {
  readonly provider: string
  readonly id: string
  readonly name: string
  readonly description?: string
}

interface SameFamilyCatalog {
  listModels(provider: string): Promise<readonly SameFamilyModelInfo[]>
}

interface InternalRoutingTool {
  execute(args: unknown, exec: {
    readonly callId: ReturnType<typeof CallId>
    readonly rootCallId: ReturnType<typeof CallId>
    readonly name: string
    readonly arguments: unknown
    readonly agent: Agent
    readonly signal: AbortSignal
    deferContext(context: never): void
    concludeTurn(): void
  }): Promise<unknown>
}

interface InternalToolRegistry {
  get(name: string, scope?: Agent): InternalRoutingTool | undefined
}

interface JevRoutePayload {
  readonly agent: Agent
  readonly turn: number
  readonly step: number
  readonly signal: AbortSignal
}

function service<T>(ctx: Context, name: string): T | undefined {
  return (ctx.get as unknown as (key: string) => T | undefined)(name)
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

const FAST_SOCIAL_TURN = /^(?:[¡!¿?.,\s]*(?:hola|hello|hi|hey|buenas|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|qu[eé]\s+tal|c[oó]mo\s+est[aá]s|gracias|thanks|thank\s+you)[¡!¿?.,\s]*)$/iu
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
 */
export function isConversationalFastPathText(text: string): boolean {
  const candidate = text.trim()
  if (candidate.length === 0 || candidate.length > 180) return false
  if (/https?:\/\/|\x60\x60\x60|(?:[A-Za-z]:\\|\.\/|\.\.\/)/u.test(candidate)) return false
  if (isToolAcquisitionRequest(candidate)) return false
  // A one-word approval is a continuation command, not chit-chat. Keep normal
  // history, tool schemas, and the user's selected reasoning route.
  if (CONTEXTUAL_CONTINUATION.test(candidate)) return false
  if (FAST_SOCIAL_TURN.test(candidate) || FAST_RUNTIME_META.test(candidate)) return true
  // Feedback such as "eso parece un pollo ... jaja" should not reload hundreds
  // of tools or a multi-megabyte work transcript. Keep questions on the normal
  // path: even a short "¿eso parece X?" can be a real factual request.
  return !/[?¿]/u.test(candidate) && FAST_CASUAL_REACTION.test(candidate)
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
  let jevFailures = 0
  let jevCircuitOpenUntil = 0
  let jevCallSequence = 0
  let jevTurn = -1
  const jevRoutes = new Map<string, string>()

  async function routeWithJev(
    payload: JevRoutePayload,
    fallback: LlmCallConfig,
  ): Promise<LlmCallConfig> {
    if (fallback.provider !== 'openai-codex' || payload.signal.aborted) return fallback
    const directText = directUserTextForTurn(payload.agent, payload.turn)
    // Social/meta turns already have a deterministic cheap route. Calling an
    // external router here would add network latency without improving quality.
    if (isConversationalFastPathText(directText)) return fallback
    // Respect the user's premium planner choice. Jev participates after the
    // plan, where it can optimize the Luna worker without turning execution
    // back into an expensive planner loop.
    if (payload.step === 1 && isCodexPlannerModel(fallback.model)) return fallback
    if (Date.now() < jevCircuitOpenUntil) return fallback

    const tools = service<InternalToolRegistry>(agentCtx, 'tools')
    const routeTool = tools?.get(JEV_MODEL_ROUTE_TOOL, payload.agent)
    // Missing/unconfigured Jev is deliberately a zero-cost no-op. Settings
    // exposes its setup card; the task continues on PHOENIX's native route.
    if (routeTool === undefined) return fallback

    // One Jev decision per native route per turn. Reusing it across later
    // steps keeps latency, quota use, and token overhead bounded while still
    // allowing a second decision when Phoenix intentionally changes phase/model.
    if (payload.turn !== jevTurn) {
      jevTurn = payload.turn
      jevRoutes.clear()
    }
    const workerGeneration = String(fallback.reasoningEffort) === 'max'
      ? codexLunaGeneration(fallback.model)
      : undefined
    const cacheKey = fallback.model
    const cached = jevRoutes.get(cacheKey)
    if (cached !== undefined) {
      if (cached === fallback.model) return fallback
      if (workerGeneration !== undefined) return { ...fallback, model: cached }
      const { reasoningEffort: _effort, ...withoutEffort } = fallback
      return { ...withoutEffort, model: cached }
    }

    const catalog = service<SameFamilyCatalog>(agentCtx, 'llm')
    if (catalog === undefined) return fallback
    try {
      const listed = await catalog.listModels(fallback.provider)
      const candidates = new Map<string, SameFamilyModelInfo>()
      candidates.set(fallback.model, {
        provider: fallback.provider,
        id: fallback.model,
        name: fallback.model,
        description: workerGeneration === undefined
          ? 'Current PHOENIX route; preserves the existing routing decision.'
          : 'Current PHOENIX Luna execution worker.',
      })
      for (const model of listed) {
        // Same provider is the hard family boundary. During the execution
        // phase Jev is additionally constrained to the matching Luna
        // generation so it cannot spend Sol/Astra tokens after planning.
        if (model.provider !== fallback.provider || candidates.has(model.id)) continue
        if (workerGeneration !== undefined && codexLunaGeneration(model.id) !== workerGeneration) continue
        candidates.set(model.id, model)
        if (candidates.size >= JEV_MAX_CANDIDATES) break
      }
      // One candidate means there is no routing decision to buy from Jev.
      if (candidates.size < 2) return fallback

      const task = directUserTextForTurn(payload.agent, payload.turn).slice(0, JEV_MAX_TASK_CHARS)
        || 'Continue the current PHOENIX task.'
      const args = {
        task,
        candidates: [...candidates.values()].map(model => ({
          id: model.id,
          description: model.description ?? model.name,
        })),
        priorities: workerGeneration === undefined
          ? ['quality', 'latency', 'cost', 'tool_use']
          : ['latency', 'cost', 'quality', 'tool_use'],
        constraints: [
          'Select only a candidate supplied by PHOENIX.',
          'Stay inside the openai-codex provider family.',
          ...(workerGeneration === undefined
            ? ['Prefer the current route unless another candidate materially improves the task trade-off.']
            : [
                `Execution phase: stay on Luna generation ${workerGeneration}; do not select Sol/Astra/Terra.`,
                'Prefer the fastest worker that preserves output quality for the concrete execution step.',
              ]),
        ],
      }
      const callId = CallId(`phoenix-jev-model-route-${payload.turn}-${payload.step}-${jevCallSequence++}`)
      const routeController = new AbortController()
      const abortRoute = (): void => { routeController.abort() }
      payload.signal.addEventListener('abort', abortRoute, { once: true })
      const routeTimer = setTimeout(() => { routeController.abort() }, JEV_ROUTE_BUDGET_MS)
      routeTimer.unref?.()
      let raw: unknown
      try {
        raw = await routeTool.execute(args, {
          callId,
          rootCallId: callId,
          name: JEV_MODEL_ROUTE_TOOL,
          arguments: args,
          agent: payload.agent,
          signal: routeController.signal,
          deferContext() {},
          concludeTurn() {},
        })
      } finally {
        clearTimeout(routeTimer)
        payload.signal.removeEventListener('abort', abortRoute)
      }
      const chosen = jevSelectedModelId(raw, [...candidates.keys()])
      if (chosen === undefined) throw new Error('Jev returned no valid same-family model id')
      jevFailures = 0
      jevRoutes.set(cacheKey, chosen)
      if (chosen === fallback.model) return fallback
      if (workerGeneration !== undefined) {
        // Luna workers in this phase intentionally run at the selected Max
        // effort even when Jev picks another same-generation Luna variant.
        return { ...fallback, model: chosen }
      }
      // Outside the worker phase, reasoning effort is model-specific. Let a
      // Jev-selected model use its own safe default instead of forwarding an
      // unsupported effort.
      const { reasoningEffort: _effort, ...withoutEffort } = fallback
      return { ...withoutEffort, model: chosen }
    } catch (error: unknown) {
      if (isJevAvailabilityFailure(error)) {
        // Missing credits, auth, or rate limit: do not burn two more attempts.
        // Open the circuit immediately and continue on Phoenix's native route.
        jevCircuitOpenUntil = Date.now() + JEV_CIRCUIT_OPEN_MS
        jevFailures = 0
      } else {
        jevFailures += 1
        if (jevFailures >= JEV_FAILURE_THRESHOLD) {
          jevCircuitOpenUntil = Date.now() + JEV_CIRCUIT_OPEN_MS
          jevFailures = 0
        }
      }
      agentCtx.logger.warn(`Jev model routing degraded; keeping PHOENIX native route: ${String(error)}`)
      return fallback
    }
  }

  const disposeAssembly = agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const selected = selection.current
    const assembled = await next()
    selection.assembled = selected
    selection.assembledToolCount = assembled.tools.length
    if (selected === undefined) return assembled
    return {
      ...assembled,
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
      const conversation = _payload.step === 1 && isConversationalFastPathText(directText)
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
      // The conversational fast path is a one-request latency override. It must
      // not mutate the selector or inherit GPT-6 Luna's substantive-task Max pin.
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
      return routeWithJev(_payload, nativeRoute)
    },
  )
  return () => {
    disposeAssembly()
    disposeRequest()
  }
}
