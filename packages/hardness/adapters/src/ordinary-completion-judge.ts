/**
 * Independent completion judge bridge for ordinary mutation tasks.
 *
 * Successful substantive mutations must first have deterministic verification.
 * The bridge then performs a bounded read-only semantic review before the turn
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

const READ_ONLY_TOOLS = [
  'read',
  'read_image',
  'glob',
  'grep',
  'session_search',
  'session_event_search',
  'web_search',
  'web_fetch',
] as const

const MUTATION = /^(?:write|edit|str_replace_editor|apply_patch|create_file|update_file|delete_file|move_file|rename_file|upload(?:_.*)?|deploy(?:_.*)?|publish(?:_.*)?)$/
const VERIFY = /^(?:verify(?:_.*)?|check(?:_.*)?|test(?:_.*)?|lint(?:_.*)?|typecheck(?:_.*)?|build(?:_.*)?|smoke(?:_.*)?)$/
const SHELL = /^(?:bash|pwsh|run_code)$/
const SHELL_VERIFY = /\b(?:vitest|pytest|unittest|jest|mocha|tsc|oxlint|eslint|ruff|mypy|cargo\s+test|go\s+test|dotnet\s+test|pnpm\s+(?:run\s+)?(?:test|check|lint|typecheck|build|verify)|npm\s+(?:run\s+)?(?:test|check|lint|build|verify)|yarn\s+(?:test|check|lint|build)|python\s+-m\s+pytest|benchmark|tracemalloc)\b/i
const SHELL_MUTATE = /(?:^|[\s;&|])(?:rm|mv|cp|mkdir|touch|git\s+(?:add|commit|merge|rebase|cherry-pick|reset|checkout|switch)|Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-Item|Rename-Item)\b|(?:>>?|\b(?:sed\s+-i|tee)\b)/i
const SUBSTANTIVE = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|c|cc|cpp|h|hpp|cs|php|rb|swift|html?|css|scss|sass|less|vue|svelte|ya?ml|toml|json)\b/i

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
  hardnessReviewedGeneration: number
  judgeVerdict?: OrdinaryCompletionJudgeDecision['verdict']
  judgePasses: number
  request: string
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

function activeGoalOwnsCompletion(agent: Agent): boolean {
  const latest = agent.session.events.findLast(event => event.type === 'goal/change') as
    | { readonly type: string; readonly data: { readonly operation?: string; readonly goal?: { readonly phase?: string } } }
    | undefined
  return latest?.data.operation !== 'clear'
    && latest?.data.goal?.phase !== undefined
    && latest.data.goal.phase !== 'complete'
}

function isHardnessRun(name: string): boolean {
  return operationName(name) === 'hardness_run'
}

function requestText(message: UserMessage): string {
  return message.content
    .filter((block): block is Extract<UserMessage['content'][number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' ')
    .slice(0, 12_000)
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
          + 'Observed mutation tools: ' + JSON.stringify(input.mutations) + '\n'
          + 'Observed verification tools: ' + JSON.stringify(input.verifications) + '\n\n'
          + 'Act as a fresh, read-only completion judge. Inspect the actual changed artifact and durable session evidence. '
          + 'Map every explicit mandatory requirement in the original request to concrete evidence; passing tests are evidence, not blanket proof. '
          + 'For public errors/exceptions verify the observable type and every required message field, identifier, collection, or diagnostic detail. '
          + 'When scale, large cardinality, performance, latency, depth, concurrency, or memory matters, require evidence that checks growth/resource behavior and inspect for avoidable superlinear time or space. '
          + 'Check the real user/production entrypoint and relevant boundary/failure cases. Do not edit files or run commands. '
          + 'Return pass only with concrete evidence for all material requirements. Return needs_changes with a precise repair list for fixable gaps; blocked only for an external evaluation blocker.\n'
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
 * Install bounded independent review for verified substantive ordinary mutations.
 * @param ctx - scoped Cordis context whose agent/tool events are observed.
 * @param input - structured subagent runtime, provider route, and review-pass bound.
 * @returns disposer that removes every bridge listener.
 */
export function installOrdinaryCompletionJudgeBridge(
  ctx: Context,
  input: { readonly subagents: JudgeRuntime; readonly provider: string; readonly maxPasses?: number },
): () => void {
  const maxPasses = input.maxPasses ?? 2
  const states = new WeakMap<Agent, BridgeState>()
  const disposers: (() => void)[] = []

  disposers.push(ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message.source.kind !== 'user') return
    states.set(agent, {
      generation: 0,
      verifiedGeneration: 0,
      judgedGeneration: 0,
      hardnessReviewedGeneration: 0,
      judgePasses: 0,
      request: requestText(message),
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
    if (exec.agent === undefined || result.isError || downstream.kind === 'block') return downstream
    const state = states.get(exec.agent)
    if (state === undefined) return downstream

    if (isSubstantiveMutation(exec.name, exec.arguments)) {
      state.generation += 1
      state.judgeVerdict = undefined
      state.mutations.push(operationName(exec.name))
      state.mutations = state.mutations.slice(-12)
    } else if (isHardnessRun(exec.name) && state.generation > 0) {
      // HARDNESS already performed its governed verification for everything
      // mutated inside this call. If nothing mutates afterwards, it owns
      // completion review for this generation and the ordinary judge must not
      // duplicate that semantic work.
      state.hardnessReviewedGeneration = state.generation
    } else if (state.generation > 0 && isVerification(exec.name, exec.arguments)) {
      state.verifiedGeneration = state.generation
      // A judge may ask only for missing evidence. New deterministic evidence
      // must therefore reopen this unchanged generation for a fresh review.
      if (state.judgedGeneration === state.generation && state.judgeVerdict !== 'pass') state.judgedGeneration = 0
      state.verifications.push(operationName(exec.name) + ':' + argumentText(exec.arguments).slice(0, 300))
      state.verifications = state.verifications.slice(-12)
    }
    return downstream
  }))

  disposers.push(ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const state = states.get(agent)
    if (state === undefined || state.generation === 0) return
    // Completion authority is hierarchical: an active Goal owns the final
    // semantic review for the whole mission; otherwise a completed HARDNESS
    // run owns the generation it governed. Ordinary review is only the
    // fallback for substantive mutations that have neither authority.
    if (activeGoalOwnsCompletion(agent)) return
    if (state.hardnessReviewedGeneration === state.generation) return
    if (state.verifiedGeneration !== state.generation || state.judgedGeneration === state.generation) return
    if (state.judgePasses >= maxPasses) return

    state.judgePasses += 1
    const decision = await reviewOrdinaryCompletion({
      subagents: input.subagents,
      provider: input.provider,
      parent: agent,
      request: state.request,
      mutations: state.mutations,
      verifications: state.verifications,
      signal,
    })
    state.judgedGeneration = state.generation
    state.judgeVerdict = decision.verdict
    const infrastructureOnlyBlock = decision.verdict === 'blocked'
      && /^Independent completion judge (?:is unavailable|did not complete|returned invalid evidence|failed)\./.test(decision.summary)
    if (decision.verdict === 'needs_changes' || (decision.verdict === 'blocked' && !infrastructureOnlyBlock)) {
      agent.steer(judgeNotice(decision))
    }
  }))

  disposers.push(ctx.on('agent/disposed', ({ agent }) => {
    states.delete(agent)
  }))

  return () => {
    for (let index = disposers.length - 1; index >= 0; index--) disposers[index]?.()
  }
}
