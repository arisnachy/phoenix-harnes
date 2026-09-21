/**
 * Token-efficient independent completion judge bridge for ordinary mutation tasks.
 *
 * The worker performs mutations and deterministic checks. A fresh read-only
 * reviewer receives a compact packet containing the request, exact changed
 * targets, mutation summaries, and verification evidence. Repair rounds are
 * delta reviews: accepted evidence is reused and only the judge's unresolved
 * findings plus subsequent worker changes are reconsidered.
 */

import type { Context } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { createUserMessage, type ContentBlock } from '@phoenix-ai/dsh-llm'
import type { UserMessage } from '@phoenix-ai/dsh-session'
import type {
  ObjectJsonSchema,
  PostToolDecision,
  ToolExecution,
  ToolExecutionResult,
  ToolRestriction,
} from '@phoenix-ai/dsh-tools'
import { resolveStructuredProvider, type SubagentRuntime } from '@phoenix-ai/dsh-subagent'

const MAX_REQUEST_CHARS = 8_000
const MAX_TARGETS = 12
const MAX_MUTATION_SUMMARIES = 12
const MAX_VERIFICATION_EVIDENCE = 8
const MAX_EVIDENCE_CHARS = 1_200
const MAX_TEXT = 2_000
const MAX_ITEMS = 8

const REPAIR_ACTION_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string' },
    issue: { type: 'string' },
    change: { type: 'string' },
    verification: { type: 'string' },
  },
  required: ['path', 'issue', 'change', 'verification'],
}

const OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['pass', 'needs_changes', 'blocked'] },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    required_changes: { type: 'array', items: { type: 'string' } },
    repair_actions: { type: 'array', items: REPAIR_ACTION_SCHEMA },
  },
  required: ['verdict', 'summary', 'evidence', 'required_changes', 'repair_actions'],
}

/** Ordinary local mutation review deliberately excludes session and web rediscovery. */
export const ORDINARY_JUDGE_READ_ONLY_TOOLS = ['read', 'read_image', 'glob', 'grep'] as const

const MUTATION = /^(?:write|edit|str_replace_editor|apply_patch|create_file|update_file|delete_file|move_file|rename_file|upload(?:_.*)?|deploy(?:_.*)?|publish(?:_.*)?)$/
const VERIFY = /^(?:verify(?:_.*)?|check(?:_.*)?|test(?:_.*)?|lint(?:_.*)?|typecheck(?:_.*)?|build(?:_.*)?|smoke(?:_.*)?)$/
const SHELL = /^(?:bash|pwsh|run_code)$/
const SHELL_VERIFY = /\b(?:vitest|pytest|unittest|jest|mocha|tsc|oxlint|eslint|ruff|mypy|cargo\s+test|go\s+test|dotnet\s+test|pnpm\s+(?:run\s+)?(?:test|check|lint|typecheck|build|verify)|npm\s+(?:run\s+)?(?:test|check|lint|build|verify)|yarn\s+(?:test|check|lint|build)|python\s+-m\s+pytest|benchmark|tracemalloc)\b/i
const SHELL_MUTATE = /(?:^|[\s;&|])(?:rm|mv|cp|mkdir|touch|git\s+(?:add|commit|merge|rebase|cherry-pick|reset|checkout|switch)|Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-Item|Rename-Item)\b|(?:>>?|\b(?:sed\s+-i|tee)\b)/i
const SUBSTANTIVE = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|c|cc|cpp|h|hpp|cs|php|rb|swift|html?|css|scss|sass|less|vue|svelte|ya?ml|toml|json)\b/i

const TARGET_KEYS = new Set([
  'path', 'file', 'filename', 'file_path', 'source_path', 'target_path',
  'destination_path', 'container_path', 'old_path', 'new_path',
])

/** One machine-actionable repair proposed by the independent judge. */
export interface OrdinaryRepairAction {
  readonly path: string
  readonly issue: string
  readonly change: string
  readonly verification: string
}

/** Structured outcome returned by one ordinary-task independent completion review. */
export interface OrdinaryCompletionJudgeDecision {
  readonly verdict: 'pass' | 'needs_changes' | 'blocked'
  readonly summary: string
  readonly evidence: readonly string[]
  readonly requiredChanges: readonly string[]
  readonly repairActions: readonly OrdinaryRepairAction[]
}

type JudgeRuntime = Pick<SubagentRuntime, 'getProvider' | 'start'> & Partial<Pick<SubagentRuntime, 'list'>>

interface BridgeState {
  generation: number
  verifiedGeneration: number
  judgedGeneration: number
  judgePasses: number
  request: string
  changedTargets: string[]
  mutationSummaries: string[]
  verificationEvidence: string[]
  priorEvidence: string[]
  priorRequiredChanges: string[]
  priorRepairActions: OrdinaryRepairAction[]
}

function operationName(toolName: string): string {
  const normalized = toolName.toLowerCase().replaceAll('-', '_')
  return normalized.split(/(?:__|[.:/])/).at(-1) || normalized
}

function argumentText(value: unknown): string {
  try { return JSON.stringify(value) ?? 'null' } catch { return String(value) }
}

function compactText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  const tail = Math.min(240, Math.floor(maxChars / 3))
  return normalized.slice(0, maxChars - tail - 16) + ' …[truncated]… ' + normalized.slice(-tail)
}

function contentText(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

function requestText(message: UserMessage): string {
  return message.content
    .filter((block): block is Extract<UserMessage['content'][number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' ')
    .slice(0, MAX_REQUEST_CHARS)
}

function addTarget(targets: string[], candidate: string): void {
  const target = candidate.trim()
  if (target.length === 0 || target.length > 512 || targets.includes(target)) return
  targets.push(target)
}

function extractTargets(value: unknown, key: string | undefined, targets: string[], depth: number): void {
  if (depth > 5 || targets.length >= MAX_TARGETS) return
  if (typeof value === 'string') {
    if (key !== undefined && TARGET_KEYS.has(key.toLowerCase())) addTarget(targets, value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) extractTargets(item, key, targets, depth + 1)
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    extractTargets(child, childKey, targets, depth + 1)
    if (targets.length >= MAX_TARGETS) return
  }
}

/** Exact path-like targets present in one mutation call. */
export function changedTargetsFrom(argumentsValue: unknown): string[] {
  const targets: string[] = []
  extractTargets(argumentsValue, undefined, targets, 0)
  return targets
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

function mutationSummary(
  name: string,
  args: unknown,
  targets: readonly string[],
  content: readonly ContentBlock[],
): string {
  const op = operationName(name)
  const subject = targets.length > 0
    ? `${op}: ${targets.join(', ')}`
    : `${op}: ${compactText(argumentText(args), 500)}`
  const outcome = compactText(contentText(content), 900)
  return compactText(outcome.length > 0 ? `${subject} => ${outcome}` : subject, 1_200)
}

function effectiveContent(result: Readonly<ToolExecutionResult>, decision: PostToolDecision): readonly ContentBlock[] {
  return decision.kind === 'accept' && decision.content !== undefined ? decision.content : result.content
}

/** Compact successful deterministic evidence carried directly into the judge packet. */
export function verificationEvidenceFrom(
  name: string,
  args: unknown,
  content: readonly ContentBlock[],
): string {
  const invocation = compactText(argumentText(args), 320)
  const outcome = compactText(contentText(content), MAX_EVIDENCE_CHARS)
  return compactText(
    `${operationName(name)} ${invocation}${outcome.length > 0 ? ` => ${outcome}` : ' => success'}`,
    MAX_EVIDENCE_CHARS,
  )
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim() && value.length <= MAX_TEXT
}

function validList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_ITEMS && value.every(validText)
}

function repairAction(value: unknown): OrdinaryRepairAction | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!validText(record.path) || !validText(record.issue) || !validText(record.change) || !validText(record.verification)) {
    return undefined
  }
  return {
    path: record.path,
    issue: record.issue,
    change: record.change,
    verification: record.verification,
  }
}

function parseDecision(value: unknown): OrdinaryCompletionJudgeDecision | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!validText(record.verdict) || !['pass', 'needs_changes', 'blocked'].includes(record.verdict)
    || !validText(record.summary) || !validList(record.evidence) || !validList(record.required_changes)
    || !Array.isArray(record.repair_actions) || record.repair_actions.length > MAX_ITEMS
    || !record.repair_actions.every(item => repairAction(item) !== undefined)) return undefined
  const decision: OrdinaryCompletionJudgeDecision = {
    verdict: record.verdict as OrdinaryCompletionJudgeDecision['verdict'],
    summary: record.summary,
    evidence: record.evidence,
    requiredChanges: record.required_changes,
    repairActions: record.repair_actions.map(item => repairAction(item) as OrdinaryRepairAction),
  }
  if (decision.verdict === 'pass' && decision.evidence.length === 0) return undefined
  if (decision.verdict === 'needs_changes'
    && decision.requiredChanges.length === 0 && decision.repairActions.length === 0) return undefined
  return decision
}

function unavailable(summary: string): OrdinaryCompletionJudgeDecision {
  return { verdict: 'blocked', summary, evidence: [], requiredChanges: [], repairActions: [] }
}

/**
 * Run one fresh read-only semantic review over a compact evidence packet.
 * A repair pass receives accepted evidence plus only the worker delta since the
 * previous review, so unchanged requirements are not re-audited.
 */
export async function reviewOrdinaryCompletion(input: {
  readonly subagents: JudgeRuntime
  readonly provider: string
  readonly parent: Agent
  readonly request: string
  readonly changedTargets: readonly string[]
  readonly mutationSummaries: readonly string[]
  readonly verificationEvidence: readonly string[]
  readonly priorEvidence?: readonly string[]
  readonly priorRequiredChanges?: readonly string[]
  readonly priorRepairActions?: readonly OrdinaryRepairAction[]
  readonly maxTokens?: number
  readonly signal: AbortSignal
}): Promise<OrdinaryCompletionJudgeDecision> {
  const resolved = resolveStructuredProvider({
    getProvider: name => input.subagents.getProvider(name),
    list: () => input.subagents.list?.() ?? [],
  }, input.provider)
  if (resolved === undefined) return unavailable('Independent completion judge is unavailable.')

  const toolFilter: ToolRestriction = { allow: [...ORDINARY_JUDGE_READ_ONLY_TOOLS] }
  const delta = (input.priorRequiredChanges?.length ?? 0) > 0 || (input.priorRepairActions?.length ?? 0) > 0
  const packet = {
    mode: delta ? 'delta_repair_review' : 'initial_review',
    request: input.request,
    changedTargets: input.changedTargets,
    mutationDelta: input.mutationSummaries,
    verificationDelta: input.verificationEvidence,
    priorAcceptedEvidence: input.priorEvidence ?? [],
    priorRequiredChanges: input.priorRequiredChanges ?? [],
    priorRepairActions: input.priorRepairActions ?? [],
  }

  let run: Awaited<ReturnType<JudgeRuntime['start']>> | undefined
  try {
    run = await input.subagents.start(resolved.name, {
      label: 'ordinary-completion-judge',
      parent: input.parent,
      signal: input.signal,
      outputSchema: OUTPUT_SCHEMA,
      toolFilter,
      ...(input.maxTokens === undefined ? {} : { agentOptions: { maxTokens: input.maxTokens } }),
      prompt: [{
        type: 'text',
        text: '<judge_packet>\n' + JSON.stringify(packet) + '\n</judge_packet>\n'
          + (delta
            ? 'Delta review: verify the listed prior repairs and regression risk using the new mutation/evidence delta. '
              + 'Reuse priorAcceptedEvidence for unchanged requirements; do not re-audit already accepted work. '
            : 'Initial review: map explicit requirements to the packet evidence. ')
          + 'Decide from this packet first. If it is sufficient, call structured_output immediately without inspection tools. '
          + 'If a material claim is still uncertain, read exact changedTargets first; use grep/glob only when an exact target cannot answer it. '
          + 'For needs_changes, return the smallest machine-actionable repair_actions with exact path when known, plus targeted verification. '
          + 'Never edit files or run commands.',
      }],
    })
    const result = await run.result
    if (result.stopReason !== 'completed') return unavailable('Independent completion judge did not complete.')
    return parseDecision(result.structured)
      ?? unavailable('Independent completion judge returned invalid evidence.')
  } catch {
    return unavailable('Independent completion judge failed.')
  } finally {
    if (run !== undefined) await run.dispose()
  }
}

function judgeNotice(decision: OrdinaryCompletionJudgeDecision): UserMessage {
  const actions = decision.repairActions.map((repair, index) =>
    `${index + 1}. ${repair.path}: ${repair.change} (issue: ${repair.issue}; verify: ${repair.verification})`)
  const fallback = decision.requiredChanges.map((change, index) => `${index + 1}. ${change}`)
  const repairs = actions.length > 0 ? actions : fallback
  return createUserMessage({
    content: [{
      type: 'text',
      text: decision.verdict === 'needs_changes'
        ? 'Independent review found fixable gaps. Apply only the repairs below; do not re-audit unchanged work. '
          + repairs.join(' ')
          + ' Run only the listed/nearest targeted verification, then let the fresh judge review the delta.'
        : 'Independent completion review could not verify completion: ' + decision.summary
          + ' Resolve the blocker with the cheapest deterministic evidence; do not claim completion yet.',
    }],
    source: { kind: 'plugin', plugin: 'ordinary-completion-judge', form: 'notice', summary: 'independent completion review' },
  })
}

/** Install bounded independent review for verified substantive ordinary mutations. */
export function installOrdinaryCompletionJudgeBridge(
  ctx: Context,
  input: {
    readonly subagents: JudgeRuntime
    readonly provider: string
    readonly maxPasses?: number
    readonly maxTokens?: number
  },
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
      judgePasses: 0,
      request: requestText(message),
      changedTargets: [],
      mutationSummaries: [],
      verificationEvidence: [],
      priorEvidence: [],
      priorRequiredChanges: [],
      priorRepairActions: [],
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
      const targets = changedTargetsFrom(exec.arguments)
      for (const target of targets) {
        if (!state.changedTargets.includes(target) && state.changedTargets.length < MAX_TARGETS) state.changedTargets.push(target)
      }
      state.mutationSummaries.push(
        mutationSummary(exec.name, exec.arguments, targets, effectiveContent(result, downstream)),
      )
      state.mutationSummaries = state.mutationSummaries.slice(-MAX_MUTATION_SUMMARIES)
    } else if (state.generation > 0 && isVerification(exec.name, exec.arguments)) {
      state.verifiedGeneration = state.generation
      if (state.judgedGeneration === state.generation) state.judgedGeneration = 0
      state.verificationEvidence.push(
        verificationEvidenceFrom(exec.name, exec.arguments, effectiveContent(result, downstream)),
      )
      state.verificationEvidence = state.verificationEvidence.slice(-MAX_VERIFICATION_EVIDENCE)
    }
    return downstream
  }))

  disposers.push(ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const state = states.get(agent)
    if (state === undefined || state.generation === 0) return
    if (state.verifiedGeneration !== state.generation || state.judgedGeneration === state.generation) return
    if (state.judgePasses >= maxPasses) return

    state.judgePasses += 1
    const mutationDelta = [...state.mutationSummaries]
    const verificationDelta = [...state.verificationEvidence]
    const decision = await reviewOrdinaryCompletion({
      subagents: input.subagents,
      provider: input.provider,
      parent: agent,
      request: state.request,
      changedTargets: state.changedTargets,
      mutationSummaries: mutationDelta,
      verificationEvidence: verificationDelta,
      priorEvidence: state.priorEvidence,
      priorRequiredChanges: state.priorRequiredChanges,
      priorRepairActions: state.priorRepairActions,
      ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
      signal,
    })

    state.judgedGeneration = state.generation
    // The next independent review receives only work performed after this
    // verdict; accepted evidence is carried separately as a compact summary.
    state.mutationSummaries = []
    state.verificationEvidence = []

    if (decision.verdict === 'pass') {
      state.priorEvidence = []
      state.priorRequiredChanges = []
      state.priorRepairActions = []
      return
    }
    if (decision.verdict === 'needs_changes') {
      state.priorEvidence = decision.evidence.slice(0, 6).map(item => compactText(item, 600))
      state.priorRequiredChanges = decision.requiredChanges.slice(0, 6).map(item => compactText(item, 700))
      state.priorRepairActions = decision.repairActions.slice(0, 6).map(repair => ({
        path: compactText(repair.path, 512),
        issue: compactText(repair.issue, 600),
        change: compactText(repair.change, 700),
        verification: compactText(repair.verification, 600),
      }))
    }
    agent.steer(judgeNotice(decision))
  }))

  disposers.push(ctx.on('agent/disposed', ({ agent }) => {
    states.delete(agent)
  }))

  return () => {
    for (let index = disposers.length - 1; index >= 0; index--) disposers[index]?.()
  }
}
