/**
 * Adaptive independent completion judge bridge for ordinary mutation tasks.
 *
 * Deterministic verification and one in-band worker self-review are the cheap
 * default. A fresh read-only subagent is reserved for cases where independence
 * is likely to add information: explicit review requests, high-impact work,
 * failed verification/recovery, unusually broad changes, or a mandatory
 * re-review after a previous judge requested repairs.
 */
import type { Context } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import type { UserMessage } from '@phoenix-ai/dsh-session'
import type {
  ObjectJsonSchema,
  PostToolDecision,
  ToolExecution,
  ToolExecutionResult,
  ToolRestriction,
} from '@phoenix-ai/dsh-tools'
import { resolveStructuredProvider, type SubagentRuntime } from '@phoenix-ai/dsh-subagent'

const OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['pass', 'needs_changes', 'blocked'] },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    required_changes: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'summary', 'evidence', 'required_changes'],
}

const BASE_READ_ONLY_TOOLS = [
  'read',
  'glob',
  'grep',
  'session_search',
  'session_event_search',
] as const
const VISUAL_READ_ONLY_TOOLS = ['read_image'] as const
const WEB_READ_ONLY_TOOLS = ['web_search', 'web_fetch'] as const

const MUTATION = /^(?:write|edit|str_replace_editor|apply_patch|create_file|update_file|delete_file|move_file|rename_file|upload(?:_.*)?|deploy(?:_.*)?|publish(?:_.*)?)$/
const VERIFY = /^(?:verify(?:_.*)?|check(?:_.*)?|test(?:_.*)?|lint(?:_.*)?|typecheck(?:_.*)?|build(?:_.*)?|smoke(?:_.*)?)$/
const SHELL = /^(?:bash|pwsh|run_code)$/
const SHELL_VERIFY = /\b(?:vitest|pytest|unittest|jest|mocha|tsc|oxlint|eslint|ruff|mypy|cargo\s+test|go\s+test|dotnet\s+test|pnpm\s+(?:run\s+)?(?:test|check|lint|typecheck|build|verify)|npm\s+(?:run\s+)?(?:test|check|lint|build|verify)|yarn\s+(?:test|check|lint|build)|python\s+-m\s+pytest|benchmark|tracemalloc)\b/i
const SHELL_MUTATE = /(?:^|[\s;&|])(?:rm|mv|cp|mkdir|touch|git\s+(?:add|commit|merge|rebase|cherry-pick|reset|checkout|switch)|Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-Item|Rename-Item)\b|(?:>>?|\b(?:sed\s+-i|tee)\b)/i
const SUBSTANTIVE = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|c|cc|cpp|h|hpp|cs|php|rb|swift|html?|css|scss|sass|less|vue|svelte|ya?ml|toml|json)\b/i
const ERROR_EVIDENCE = /\b(?:error|exception|cycle|missing|message|diagnostic|failure|invalid|traceback)\b/i
const SCALE_EVIDENCE = /\b(?:benchmark|bench|perf|performance|memory|tracemalloc|scal|stress|load|10_?000|10000|30_?000|30000|big[- ]?o|latency|throughput)\b/i
const EXPLICIT_INDEPENDENT = /\b(?:independent|independiente|judge|juez|critic|cr[ií]tic[oa]|audit|auditor[ií]a|second opinion|segunda opini[oó]n)\b/i
const HIGH_IMPACT = /\b(?:security|seguridad|auth(?:entication|orization)?|autenticaci[oó]n|credential|credencial|password|contrase[nñ]a|payment|pago|billing|facturaci[oó]n|production|producci[oó]n|deploy|deployment|migration|migraci[oó]n|database schema|esquema de base de datos|destructive|destructiv[oa]|encryption|cifrado|privacy|privacidad|permission|permiso|sandbox|updater|actualizador|installer|instalador|scheduler|planificador|race condition|condici[oó]n de carrera)\b/i
const VISUAL_REVIEW = /\b(?:ui|ux|visual|render|screenshot|captura|image|imagen|layout|dise[nñ]o|website|web page|p[aá]gina web)\b/i
const EXTERNAL_REVIEW = /\b(?:current|latest|today|web|online|competitor|competition|market|benchmark against|compare with|actual|hoy|internet|competidor|competencia|mercado|comparar con)\b/i

/** Structured outcome returned by one ordinary-task independent completion review. */
export interface OrdinaryCompletionJudgeDecision {
  readonly verdict: 'pass' | 'needs_changes' | 'blocked'
  readonly summary: string
  readonly evidence: readonly string[]
  readonly requiredChanges: readonly string[]
}

/** Request features used by the zero-model-cost judge escalation policy. */
export interface OrdinaryJudgeSignals {
  readonly explicitIndependent: boolean
  readonly highImpact: boolean
  readonly errorContract: boolean
  readonly scale: boolean
  readonly visual: boolean
  readonly external: boolean
}

/** Inputs to the deterministic judge escalation score. */
export interface OrdinaryJudgeRiskInput {
  readonly signals: OrdinaryJudgeSignals
  readonly mutationCount: number
  readonly failedToolCount: number
  readonly failedVerificationCount: number
  readonly forceRejudge: boolean
}

type JudgeRuntime = Pick<SubagentRuntime, 'getProvider' | 'start'> & Partial<Pick<SubagentRuntime, 'list'>>

interface BridgeState {
  generation: number
  verifiedGeneration: number
  errorContractVerifiedGeneration: number
  scaleVerifiedGeneration: number
  judgedGeneration: number
  judgePasses: number
  failedToolCount: number
  failedVerificationCount: number
  forceRejudge: boolean
  request: string
  signals: OrdinaryJudgeSignals
  mutations: string[]
  verifications: string[]
}

function operationName(toolName: string): string {
  const normalized = toolName.toLowerCase().replaceAll('-', '_')
  return normalized.split(/(?:__|[.:/])/).at(-1) || normalized
}

function argumentText(value: unknown): string {
  try { return JSON.stringify(value) ?? 'null' } catch { return String(value) }
}

function isSubstantiveMutation(name: string, args: unknown): boolean {
  const op = operationName(name)
  const text = argumentText(args)
  if (MUTATION.test(op)) return SUBSTANTIVE.test(text)
  return SHELL.test(op) && SHELL_MUTATE.test(text) && SUBSTANTIVE.test(text)
}

function isVerification(name: string, args: unknown): boolean {
  const op = operationName(name)
  return VERIFY.test(op) || (SHELL.test(op) && SHELL_VERIFY.test(argumentText(args)))
}

function requestText(message: UserMessage): string {
  return message.content
    .filter((block): block is Extract<UserMessage['content'][number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' ')
    .slice(0, 8_000)
}

/**
 * Infer escalation features locally without another model/tool call.
 * @param request - bounded original user request used only for deterministic signal detection.
 * @returns local review-risk signals; no model or external work is performed.
 */
export function inferOrdinaryJudgeSignals(request: string): OrdinaryJudgeSignals {
  const lower = request.toLowerCase()
  const errorSubject = /\b(?:error|exception|throw|failure|cycle|missing dependency|missing dependencies|traceback)\b/u.test(lower)
  const errorObservable = /\b(?:message|include|contain|list|identify|show|detail|field|code|which|exact|mensaje|inclu|lista|identific|detalle|campo|exact)\b/u.test(lower)
  const scale = /\b(?:performance|memory|latency|throughput|scal(?:e|ing|ability)|complexity|big[- ]?o|benchmark|stress|load|depth|concurren(?:cy|t)|10k|100k|million|rendimiento|memoria|latencia|escalabilidad|complejidad|carga|profundidad|concurrencia|mill[oó]n)\b/u.test(lower)
    || /\b(?:\d{1,3}(?:[,_]\d{3})+|\d{4,})\b/u.test(lower)
  return {
    explicitIndependent: EXPLICIT_INDEPENDENT.test(request),
    highImpact: HIGH_IMPACT.test(request),
    errorContract: errorSubject && errorObservable,
    scale,
    visual: VISUAL_REVIEW.test(request),
    external: EXTERNAL_REVIEW.test(request),
  }
}

/**
 * Score whether a separate model is likely to add enough information to justify
 * its token/time cost. Error-contract and scale requests alone deliberately stay
 * below the default threshold because deterministic evidence + worker self-review
 * are cheaper and stronger first-line gates.
 * @param input - local task signals and observed execution/recovery facts.
 * @returns deterministic risk score used to decide whether a separate judge is worth its cost.
 */
export function ordinaryJudgeRiskScore(input: OrdinaryJudgeRiskInput): number {
  if (input.forceRejudge) return 100
  let score = 0
  if (input.signals.explicitIndependent) score += 5
  if (input.signals.highImpact) score += 5
  if (input.failedVerificationCount > 0) score += 4
  else if (input.failedToolCount > 0) score += 1
  if (input.mutationCount >= 8) score += 4
  else if (input.mutationCount >= 4) score += 1
  if (input.signals.errorContract) score += 1
  if (input.signals.scale) score += 1
  if (input.signals.external) score += 1
  return score
}

/** True when the local verification ledger is complete enough to justify semantic review. */
function deterministicEvidenceReady(state: BridgeState): boolean {
  if (state.generation === 0 || state.verifiedGeneration !== state.generation) return false
  if (state.signals.errorContract && state.errorContractVerifiedGeneration !== state.generation) return false
  if (state.signals.scale && state.scaleVerifiedGeneration !== state.generation) return false
  return true
}

function judgeTools(signals: OrdinaryJudgeSignals): ToolRestriction {
  const allow = [
    ...BASE_READ_ONLY_TOOLS,
    ...(signals.visual ? VISUAL_READ_ONLY_TOOLS : []),
    ...(signals.external ? WEB_READ_ONLY_TOOLS : []),
  ]
  return { allow: [...new Set(allow)] }
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4_000
}

function validList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 12 && value.every(validText)
}

function parseDecision(value: unknown): OrdinaryCompletionJudgeDecision | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!validText(record.verdict) || !['pass', 'needs_changes', 'blocked'].includes(record.verdict)
    || !validText(record.summary) || !validList(record.evidence) || !validList(record.required_changes)) return undefined
  if (record.verdict === 'pass' && record.evidence.length === 0) return undefined
  if (record.verdict === 'needs_changes' && record.required_changes.length === 0) return undefined
  return {
    verdict: record.verdict as OrdinaryCompletionJudgeDecision['verdict'],
    summary: record.summary,
    evidence: record.evidence,
    requiredChanges: record.required_changes,
  }
}

/**
 * Run one fresh read-only semantic completion review.
 * @param input - judge runtime, compact evidence capsule, route, and token cap.
 * @returns validated independent verdict; malformed or unavailable review fails closed as blocked.
 */
export async function reviewOrdinaryCompletion(input: {
  readonly subagents: JudgeRuntime
  readonly provider: string
  readonly parent: Agent
  readonly request: string
  readonly mutations: readonly string[]
  readonly verifications: readonly string[]
  readonly signal: AbortSignal
  readonly maxTokens?: number
}): Promise<OrdinaryCompletionJudgeDecision> {
  const resolved = resolveStructuredProvider({
    getProvider: name => input.subagents.getProvider(name),
    list: () => input.subagents.list?.() ?? [],
  }, input.provider)
  if (resolved === undefined) {
    return { verdict: 'blocked', summary: 'Independent completion judge is unavailable.', evidence: [], requiredChanges: [] }
  }

  const signals = inferOrdinaryJudgeSignals(input.request)
  const toolFilter = judgeTools(signals)
  const configuredMax = input.maxTokens ?? 2_048
  const parentMax = input.parent.options?.maxTokens
  const maxTokens = Math.min(parentMax ?? configuredMax, configuredMax)
  let run: Awaited<ReturnType<JudgeRuntime['start']>> | undefined
  try {
    run = await input.subagents.start(resolved.name, {
      label: 'ordinary-completion-judge',
      parent: input.parent,
      signal: input.signal,
      outputSchema: OUTPUT_SCHEMA,
      toolFilter,
      ...(resolved.provider.capabilities.persona
        ? { persona: 'You are a concise, skeptical, read-only completion judge. Inspect only what is needed to decide the stated requirements.' }
        : {}),
      ...(resolved.name === 'spawn' || resolved.name === 'judge-spawn' ? { agentOptions: { maxTokens } } : {}),
      prompt: [{
        type: 'text',
        text: '<phoenix_ordinary_completion_judge>\n'
          + 'Original request: ' + JSON.stringify(input.request.slice(0, 8_000)) + '\n'
          + 'Mutation summary: ' + JSON.stringify(input.mutations.slice(-8)) + '\n'
          + 'Verification summary: ' + JSON.stringify(input.verifications.slice(-6)) + '\n\n'
          + 'Perform a concise independent review only for material gaps that deterministic checks may miss. '
          + 'Map explicit mandatory requirements to concrete evidence. Passing tests are evidence, not blanket proof. '
          + 'For public errors/exceptions verify observable type and required message/details. '
          + 'When scale/performance/memory matters, require bounded growth/resource evidence and inspect for avoidable superlinear behavior. '
          + 'Use read-only tools only as needed; do not rediscover known paths, rerun commands, edit files, or call agents. '
          + 'Return pass with concrete evidence, needs_changes with only actionable material repairs, or blocked only for a real external evaluation blocker.\n'
          + '</phoenix_ordinary_completion_judge>',
      }],
    })
    const result = await run.result
    if (result.stopReason !== 'completed') {
      return { verdict: 'blocked', summary: 'Independent completion judge did not complete.', evidence: [], requiredChanges: [] }
    }
    return parseDecision(result.structured)
      ?? { verdict: 'blocked', summary: 'Independent completion judge returned invalid evidence.', evidence: [], requiredChanges: [] }
  } catch {
    return { verdict: 'blocked', summary: 'Independent completion judge failed.', evidence: [], requiredChanges: [] }
  } finally {
    if (run !== undefined) await run.dispose()
  }
}

function judgeNotice(decision: OrdinaryCompletionJudgeDecision): UserMessage {
  const repairs = decision.requiredChanges.length > 0
    ? ' Required changes: ' + decision.requiredChanges.map((item, index) => `${index + 1}. ${item}`).join(' ')
    : ''
  return createUserMessage({
    content: [{
      type: 'text',
      text: decision.verdict === 'needs_changes'
        ? 'Independent completion review found material fixable gaps. Repair only these gaps, rerun the smallest affected checks, then continue.' + repairs
        : 'Independent completion review could not verify completion: ' + decision.summary
          + ' Resolve the concrete blocker with the cheapest available evidence; do not repeat already-fresh checks.',
    }],
    source: { kind: 'plugin', plugin: 'ordinary-completion-judge', form: 'notice', summary: 'adaptive independent completion review' },
  })
}

/**
 * Install adaptive independent review for verified substantive ordinary mutations.
 * @param ctx - scoped Cordis context whose agent/tool events are observed.
 * @param input - structured subagent route plus deterministic escalation budgets.
 * @returns disposer that removes every bridge listener.
 */
export function installOrdinaryCompletionJudgeBridge(
  ctx: Context,
  input: {
    readonly subagents: JudgeRuntime
    readonly provider: string
    readonly maxPasses?: number
    readonly minRiskScore?: number
    readonly maxTokens?: number
  },
): () => void {
  const maxPasses = input.maxPasses ?? 2
  const minRiskScore = input.minRiskScore ?? 4
  const states = new WeakMap<Agent, BridgeState>()
  const disposers: (() => void)[] = []

  disposers.push(ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    // Durable goal rounds already own an independent completion judge. Disable
    // the ordinary bridge for that round so one generation never pays twice.
    if ((message.source as { kind: string }).kind === 'goal') {
      states.delete(agent)
      return
    }
    if (message.source.kind !== 'user') return
    const request = requestText(message)
    states.set(agent, {
      generation: 0,
      verifiedGeneration: 0,
      errorContractVerifiedGeneration: 0,
      scaleVerifiedGeneration: 0,
      judgedGeneration: 0,
      judgePasses: 0,
      failedToolCount: 0,
      failedVerificationCount: 0,
      forceRejudge: false,
      request,
      signals: inferOrdinaryJudgeSignals(request),
      mutations: [],
      verifications: [],
    })
  }))

  disposers.push(ctx.on('tools/post-execute', async (
    exec: ToolExecution,
    result: Readonly<ToolExecutionResult>,
    next,
  ): Promise<PostToolDecision> => {
    const downstream = await next()
    if (exec.agent === undefined) return downstream
    const state = states.get(exec.agent)
    if (state === undefined) return downstream

    const mutation = isSubstantiveMutation(exec.name, exec.arguments)
    const verification = isVerification(exec.name, exec.arguments)
    if (result.isError || downstream.kind === 'block') {
      if (state.generation > 0) state.failedToolCount += 1
      if (verification) state.failedVerificationCount += 1
      return downstream
    }

    if (mutation) {
      state.generation += 1
      state.mutations.push(operationName(exec.name) + ':' + argumentText(exec.arguments).slice(0, 180))
      state.mutations = state.mutations.slice(-8)
      return downstream
    }

    if (state.generation > 0 && verification) {
      state.verifiedGeneration = state.generation
      const evidenceText = argumentText(exec.arguments)
      if (ERROR_EVIDENCE.test(evidenceText)) state.errorContractVerifiedGeneration = state.generation
      if (SCALE_EVIDENCE.test(evidenceText)) state.scaleVerifiedGeneration = state.generation
      if (state.judgedGeneration === state.generation) state.judgedGeneration = 0
      state.verifications.push(operationName(exec.name) + ':' + evidenceText.slice(0, 220))
      state.verifications = state.verifications.slice(-6)
    }
    return downstream
  }))

  disposers.push(ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const state = states.get(agent)
    if (state === undefined || !deterministicEvidenceReady(state)) return
    if (state.judgedGeneration === state.generation || state.judgePasses >= maxPasses) return

    const risk = ordinaryJudgeRiskScore({
      signals: state.signals,
      mutationCount: state.mutations.length,
      failedToolCount: state.failedToolCount,
      failedVerificationCount: state.failedVerificationCount,
      forceRejudge: state.forceRejudge,
    })
    if (risk < minRiskScore) {
      // Same-worker self-review + deterministic evidence is the completion path
      // for low-risk work. Remember the decision for this unchanged generation.
      state.judgedGeneration = state.generation
      return
    }

    state.judgePasses += 1
    const decision = await reviewOrdinaryCompletion({
      subagents: input.subagents,
      provider: input.provider,
      parent: agent,
      request: state.request,
      mutations: state.mutations,
      verifications: state.verifications,
      signal,
      ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
    })
    state.judgedGeneration = state.generation
    state.forceRejudge = decision.verdict === 'needs_changes'
    if (decision.verdict !== 'pass') agent.steer(judgeNotice(decision))
  }))

  disposers.push(ctx.on('agent/disposed', ({ agent }) => {
    states.delete(agent)
  }))

  return () => {
    for (let index = disposers.length - 1; index >= 0; index--) disposers[index]?.()
  }
}
