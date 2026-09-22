/**
 * Agent-scoped model selection shared by runtime entry points.
 * @module @phoenix-ai/dsh-agent/model-selection
 */

import type { Context } from '@phoenix-ai/cordis'
import { CallId, ReasoningEffortId, type LlmCallConfig } from '@phoenix-ai/dsh-llm'

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

/** Extract only an explicitly selected available candidate from Jev's typed result. */
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
    // Agent-loop steps are 1-based. Preserve the selected model for the first
    // reasoning step; later execution steps use the low-latency Luna route.
    afterStep: 1,
    selection: {
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      reasoningEffort: ReasoningEffortId('high'),
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
 * Low-latency first action for explicit operational Codex turns. The first
 * evidence-gathering step uses Luna/medium; after a tool result the ordinary
 * execution handoff raises the worker to Luna/high.
 */
function defaultToolAcquisitionSelection(selection: ModelSelection | undefined): ModelSelection | undefined {
  if (selection?.provider !== 'openai-codex') return undefined
  return {
    provider: 'openai-codex',
    model: 'gpt-5.6-luna',
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
  const jevRoutes = new Map<string, string>()

  async function routeWithJev(
    payload: JevRoutePayload,
    fallback: LlmCallConfig,
  ): Promise<LlmCallConfig> {
    if (fallback.provider !== 'openai-codex' || payload.signal.aborted) return fallback
    if (Date.now() < jevCircuitOpenUntil) return fallback

    const tools = service<InternalToolRegistry>(agentCtx, 'tools')
    const routeTool = tools?.get(JEV_MODEL_ROUTE_TOOL, payload.agent)
    // Missing/unconfigured Jev is deliberately a zero-cost no-op. Settings
    // exposes its setup card; the task continues on PHOENIX's native route.
    if (routeTool === undefined) return fallback

    const cacheKey = `${payload.turn}:${payload.step}:${fallback.model}`
    const cached = jevRoutes.get(cacheKey)
    if (cached !== undefined) {
      if (cached === fallback.model) return fallback
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
        description: 'Current PHOENIX route; preserves the existing routing decision.',
      })
      for (const model of listed) {
        // Same provider is the hard family boundary for this first rollout.
        if (model.provider !== fallback.provider || candidates.has(model.id)) continue
        candidates.set(model.id, model)
        if (candidates.size >= JEV_MAX_CANDIDATES) break
      }
      if (candidates.size < 2) return fallback

      const task = directUserTextForTurn(payload.agent, payload.turn).slice(0, JEV_MAX_TASK_CHARS)
        || 'Continue the current PHOENIX task.'
      const args = {
        task,
        candidates: [...candidates.values()].map(model => ({
          id: model.id,
          description: model.description ?? model.name,
        })),
        priorities: ['quality', 'latency', 'cost', 'tool_use'],
        constraints: [
          'Select only a candidate supplied by PHOENIX.',
          'Stay inside the openai-codex provider family.',
          'Prefer the current route unless another candidate materially improves the task trade-off.',
        ],
      }
      const callId = CallId(`phoenix-jev-model-route-${payload.turn}-${payload.step}-${jevCallSequence++}`)
      const raw = await routeTool.execute(args, {
        callId,
        rootCallId: callId,
        name: JEV_MODEL_ROUTE_TOOL,
        arguments: args,
        agent: payload.agent,
        signal: payload.signal,
        deferContext() {},
        concludeTurn() {},
      })
      const chosen = jevSelectedModelId(raw, [...candidates.keys()])
      if (chosen === undefined) throw new Error('Jev returned no valid same-family model id')
      jevFailures = 0
      jevRoutes.set(cacheKey, chosen)
      if (chosen === fallback.model) return fallback
      // Reasoning effort is model-specific. On a model switch, let the selected
      // Codex model use its own safe default instead of forwarding an unsupported effort.
      const { reasoningEffort: _effort, ...withoutEffort } = fallback
      return { ...withoutEffort, model: chosen }
    } catch (error: unknown) {
      jevFailures += 1
      if (jevFailures >= JEV_FAILURE_THRESHOLD) {
        jevCircuitOpenUntil = Date.now() + JEV_CIRCUIT_OPEN_MS
        jevFailures = 0
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
      const acquisition = _payload.step === 1
        && (selection.assembledToolCount ?? 0) > 0
        && isToolAcquisitionRequest(directUserTextForTurn(_payload.agent, _payload.turn))
        ? defaultToolAcquisitionSelection(selected)
        : undefined
      const routed = acquisition
        ?? (resolvedHandoff !== undefined && _payload.step > resolvedHandoff.afterStep
          ? resolvedHandoff.selection
          : selected)
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
