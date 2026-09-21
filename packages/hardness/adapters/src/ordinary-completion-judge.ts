/**
 * Independent completion judge bridge for ordinary mutation tasks.
 *
 * Successful substantive mutations must first have deterministic verification.
 * The bridge then performs a progress-gated read-only semantic review before the turn
 * settles. A needs_changes verdict steers the original worker; the judge never
 * edits files or executes commands.
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

const READ_ONLY_TOOLS = ['read', 'read_image', 'glob', 'grep'] as const

const MUTATION = /^(?:write|edit|str_replace_editor|apply_patch|create_file|update_file|delete_file|move_file|rename_file|upload(?:_.*)?|deploy(?:_.*)?|publish(?:_.*)?)$/
const VERIFY = /^(?:verify(?:_.*)?|check(?:_.*)?|test(?:_.*)?|lint(?:_.*)?|typecheck(?:_.*)?|build(?:_.*)?|smoke(?:_.*)?)$/
const SHELL = /^(?:bash|pwsh|run_code)$/
const SHELL_VERIFY = /\b(?:vitest|pytest|unittest|jest|mocha|tsc|oxlint|eslint|ruff|mypy|cargo\s+test|go\s+test|dotnet\s+test|pnpm\s+(?:run\s+)?(?:test|check|lint|typecheck|build|verify)|npm\s+(?:run\s+)?(?:test|check|lint|build|verify)|yarn\s+(?:test|check|lint|build)|python\s+-m\s+pytest|benchmark|tracemalloc)\b/i
const SHELL_MUTATE = /(?:^|[\s;&|])(?:rm|mv|cp|mkdir|touch|git\s+(?:add|commit|merge|rebase|cherry-pick|reset|checkout|switch)|Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-Item|Rename-Item)\b|(?:>>?|\b(?:sed\s+-i|tee)\b)/i
const SUBSTANTIVE = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|c|cc|cpp|h|hpp|cs|php|rb|swift|html?|css|scss|sass|less|vue|svelte|ya?ml|toml|json)\b/i
const JUDGE_RISK = /\b(?:audit|independent review|security|permission|credential|secret|auth(?:entication|orization)?|payment|billing|migration|data loss|production|deploy|release|public api|breaking change|concurren(?:cy|t)|race condition|performance|latency|throughput|memory|scal(?:e|ing|ability)|complexity|benchmark|stress|load|cycleerror|exception|error message|error contract|robust|high quality)\b/i
const LARGE_CARDINALITY = /\b(?:\d{1,3}(?:[,_]\d{3})+|\d{4,}|10k|100k|million)\b/i
const TARGET_KEYS = /^(?:path|file|file_path|filepath|filename|target|destination_path)$/i

/** Structured outcome returned by one ordinary-task independent completion review. */
export interface OrdinaryCompletionJudgeDecision {
  readonly verdict: 'pass' | 'needs_changes' | 'blocked'
  readonly summary: string
  readonly evidence: readonly string[]
  readonly requiredChanges: readonly string[]
}

type JudgeRuntime = Pick<SubagentRuntime, 'getProvider' | 'start'> & Partial<Pick<SubagentRuntime, 'list'>>

interface BridgeState {
  generation: number
  verifiedGeneration: number
  judgedGeneration: number
  request: string
  mutations: string[]
  mutationTargets: string[]
  verifications: string[]
  sawRelevantFailure: boolean
  needsRejudge: boolean
  judgeInfrastructureBlocked: boolean
  lastJudgedEvidenceKey: string
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
    .slice(0, 6_000)
}

function mutationTargets(value: unknown, limit = 8): string[] {
  const found: string[] = []
  const visit = (current: unknown, depth: number): void => {
    if (found.length >= limit || depth > 3 || current === null || typeof current !== 'object') return
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1)
      return
    }
    for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
      if (found.length >= limit) return
      if (TARGET_KEYS.test(key) && typeof item === 'string' && item.length > 0) {
        const target = item.slice(0, 240)
        if (!found.includes(target)) found.push(target)
        continue
      }
      visit(item, depth + 1)
    }
  }
  visit(value, 0)
  return found
}

function compactVerification(name: string, args: unknown): string {
  const text = argumentText(args).replace(/\s+/g, ' ').slice(0, 160)
  return `${operationName(name)}:${text}`
}

export function ordinaryJudgeRequired(input: {
  readonly request: string
  readonly generation: number
  readonly mutationTargets: readonly string[]
  readonly sawRelevantFailure: boolean
  readonly needsRejudge: boolean
}): boolean {
  if (input.needsRejudge || input.sawRelevantFailure) return true
  if (JUDGE_RISK.test(input.request) || LARGE_CARDINALITY.test(input.request)) return true
  return input.generation >= 4 || input.mutationTargets.length >= 4
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
 * @param input - judge runtime, provider, parent task, evidence summary, and cancellation signal.
 * @returns validated independent verdict; malformed or unavailable review fails closed as blocked.
 */
export async function reviewOrdinaryCompletion(input: {
  readonly subagents: JudgeRuntime
  readonly provider: string
  readonly parent: Agent
  readonly request: string
  readonly mutations: readonly string[]
  readonly mutationTargets: readonly string[]
  readonly verifications: readonly string[]
  readonly signal: AbortSignal
}): Promise<OrdinaryCompletionJudgeDecision> {
  const resolved = resolveStructuredProvider({
    getProvider: name => input.subagents.getProvider(name),
    list: () => input.subagents.list?.() ?? [],
  }, input.provider)
  if (resolved === undefined) {
    return { verdict: 'blocked', summary: 'Independent completion judge is unavailable.', evidence: [], requiredChanges: [] }
  }

  const toolFilter: ToolRestriction = { allow: [...READ_ONLY_TOOLS] }
  let run: Awaited<ReturnType<JudgeRuntime['start']>> | undefined
  try {
    run = await input.subagents.start(resolved.name, {
      label: 'ordinary-completion-judge',
      parent: input.parent,
      signal: input.signal,
      outputSchema: OUTPUT_SCHEMA,
      toolFilter,
      prompt: [{
        type: 'text',
        text: '<phoenix_ordinary_completion_judge>\n'
          + 'Original request: ' + JSON.stringify(input.request) + '\n'
          + 'Changed targets: ' + JSON.stringify(input.mutationTargets) + '\n'
          + 'Verification receipts: ' + JSON.stringify(input.verifications) + '\n\n'
          + 'Fresh read-only review. Inspect changed targets directly. Map mandatory requirements to concrete evidence; tests are evidence, not blanket proof. '
          + 'Check observable error contracts and scale/resource behavior only when requested. Check the real entrypoint and material failure cases. '
          + 'Do not rerun tests, browse the web, search session history, edit files, or execute commands. '
          + 'Pass only with concrete evidence. For fixable gaps return needs_changes with a short repair list; use blocked only for unavailable evidence/infrastructure.\n'
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
        ? 'Independent completion review found fixable gaps. Do not present the task as complete yet.' + repairs
        : 'Independent completion review could not verify completion: ' + decision.summary
          + ' Continue with the cheapest deterministic inspection/verification that resolves the blocker; do not claim completion without evidence.',
    }],
    source: { kind: 'plugin', plugin: 'ordinary-completion-judge', form: 'notice', summary: 'independent completion review' },
  })
}

/**
 * Install progress-gated independent review for verified substantive ordinary mutations.
 * @param ctx - scoped Cordis context whose agent/tool events are observed.
 * @param input - structured subagent runtime and provider route.
 * @returns disposer that removes every bridge listener.
 */
export function installOrdinaryCompletionJudgeBridge(
  ctx: Context,
  input: {
    readonly subagents: JudgeRuntime
    readonly provider: string
  },
): () => void {
  const states = new WeakMap<Agent, BridgeState>()
  const disposers: (() => void)[] = []

  disposers.push(ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message.source.kind !== 'user') return
    states.set(agent, {
      generation: 0,
      verifiedGeneration: 0,
      judgedGeneration: 0,
      request: requestText(message),
      mutations: [],
      mutationTargets: [],
      verifications: [],
      sawRelevantFailure: false,
      needsRejudge: false,
      judgeInfrastructureBlocked: false,
      lastJudgedEvidenceKey: '',
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

    const mutates = isSubstantiveMutation(exec.name, exec.arguments)
    const verifies = isVerification(exec.name, exec.arguments)
    if (result.isError || downstream.kind === 'block') {
      if (mutates || verifies) state.sawRelevantFailure = true
      return downstream
    }

    if (mutates) {
      state.generation += 1
      state.mutations.push(operationName(exec.name))
      state.mutations = state.mutations.slice(-8)
      for (const target of mutationTargets(exec.arguments)) {
        if (!state.mutationTargets.includes(target)) state.mutationTargets.push(target)
      }
      state.mutationTargets = state.mutationTargets.slice(-8)
    } else if (state.generation > 0 && verifies) {
      state.verifiedGeneration = state.generation
      const receipt = compactVerification(exec.name, exec.arguments)
      const isNewEvidence = !state.verifications.includes(receipt)
      if (isNewEvidence) {
        state.verifications.push(receipt)
        state.verifications = state.verifications.slice(-6)
        if (state.needsRejudge && state.judgedGeneration === state.generation) state.judgedGeneration = 0
      }
    }
    return downstream
  }))

  disposers.push(ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const state = states.get(agent)
    if (state === undefined || state.generation === 0) return
    if (state.verifiedGeneration !== state.generation || state.judgedGeneration === state.generation) return
    if (state.judgeInfrastructureBlocked) return
    if (!ordinaryJudgeRequired({
      request: state.request,
      generation: state.generation,
      mutationTargets: state.mutationTargets,
      sawRelevantFailure: state.sawRelevantFailure,
      needsRejudge: state.needsRejudge,
    })) return

    const evidenceKey = JSON.stringify({
      generation: state.generation,
      targets: state.mutationTargets,
      verifications: state.verifications,
    })
    if (evidenceKey === state.lastJudgedEvidenceKey) return
    state.lastJudgedEvidenceKey = evidenceKey

    const decision = await reviewOrdinaryCompletion({
      subagents: input.subagents,
      provider: input.provider,
      parent: agent,
      request: state.request,
      mutations: state.mutations,
      mutationTargets: state.mutationTargets,
      verifications: state.verifications,
      signal,
    })
    state.judgedGeneration = state.generation
    if (decision.verdict === 'pass') {
      state.needsRejudge = false
      return
    }
    if (decision.verdict === 'blocked') {
      // Ordinary semantic review is an optional quality accelerator. When its
      // infrastructure is unavailable, deterministic gates remain authoritative
      // and this task does not spend another model round retrying the same route.
      state.judgeInfrastructureBlocked = true
      state.needsRejudge = false
      return
    }
    state.needsRejudge = true
    agent.steer(judgeNotice(decision))
  }))

  disposers.push(ctx.on('agent/disposed', ({ agent }) => {
    states.delete(agent)
  }))

  return () => {
    for (let index = disposers.length - 1; index >= 0; index--) disposers[index]?.()
  }
}
