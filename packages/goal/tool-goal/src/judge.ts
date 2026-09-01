/** Independent, read-only completion judge for long-running goals. */

import type { Agent, AgentOptions } from '@phoenix-ai/dsh-agent'
import { ReasoningEffortId } from '@phoenix-ai/dsh-llm'
import type { ContentBlock, LlmRuntime } from '@phoenix-ai/dsh-llm'
import type { GoalJudgeAuditEntry } from '@phoenix-ai/dsh-goal'
import type { Session } from '@phoenix-ai/dsh-session'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import { resolveStructuredProvider } from '@phoenix-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@phoenix-ai/dsh-tools'

/** Structured decision produced by the independent goal judge. */
export interface GoalJudgeResult {
  readonly verdict: 'pass' | 'needs_changes' | 'blocked'
  readonly summary: string
  readonly findings: readonly string[]
  readonly requiredChanges: readonly string[]
}

/** Deployment-independent judge output schema. */
export const GOAL_JUDGE_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['pass', 'needs_changes', 'blocked'] },
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    required_changes: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'summary', 'findings', 'required_changes'],
}

const READ_ONLY_TOOLS = ['read', 'read_image', 'glob', 'grep', 'session_search', 'session_event_search', 'web_search', 'web_fetch'] as const
const MAX_TEXT = 2_000
const MAX_ITEMS = 12
type GoalJudgeRuntime = Pick<SubagentRuntime, 'getProvider' | 'start'>
  & Partial<Pick<SubagentRuntime, 'list'>>

function normalizedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim() && value.length <= MAX_TEXT
}

function normalizedList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= MAX_ITEMS
    && value.every(normalizedText)
}

function readStructured(value: unknown): GoalJudgeResult | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!normalizedText(record.verdict) || !['pass', 'needs_changes', 'blocked'].includes(record.verdict)
    || !normalizedText(record.summary)
    || !normalizedList(record.findings)
    || !normalizedList(record.required_changes)) return undefined
  const result: GoalJudgeResult = {
    verdict: record.verdict as GoalJudgeResult['verdict'],
    summary: record.summary,
    findings: record.findings,
    requiredChanges: record.required_changes,
  }
  if (result.verdict === 'pass' && result.requiredChanges.length > 0) return undefined
  if (result.verdict === 'needs_changes' && result.requiredChanges.length === 0) return undefined
  return result
}

const WAITING_SUMMARY = 'Independent verification is not ready yet; the mission remains active and will continue automatically.'

const REASONING_RANK = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const

/**
 * Resolve the model route for an independent judge without silently inheriting
 * the worker's route. Codex parents use the dedicated Luna xhigh route; every
 * other provider keeps the exact selected model and effort. When an effort was
 * not persisted, the provider catalog supplies the highest advertised level.
 * @param input - Parent agent, optional LLM capability lookup, and cancellation signal.
 * @returns Explicit child-agent options, or an empty override when the parent has no route yet.
 */
export async function resolveGoalJudgeAgentOptions(input: {
  readonly parent: Agent
  readonly llm?: Pick<LlmRuntime, 'resolveModelInfo'>
  readonly signal: AbortSignal
}): Promise<AgentOptions> {
  const { provider, model, reasoningEffort } = input.parent.options
  if (provider === undefined || model === undefined) return {}
  if (provider === 'openai-codex') {
    return {
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      reasoningEffort: ReasoningEffortId('xhigh'),
    }
  }
  if (reasoningEffort !== undefined) return { provider, model, reasoningEffort }
  if (input.llm !== undefined) {
    try {
      const resolved = await input.llm.resolveModelInfo(provider, model, input.signal)
      const effort = resolved.reasoning?.efforts
        .map(candidate => candidate.id)
        .sort((left, right) => rankReasoningEffort(right) - rankReasoningEffort(left))[0]
      if (effort !== undefined) return { provider, model, reasoningEffort: effort }
    } catch {
      // A capability lookup is advisory; the child can still use the exact
      // provider/model route and let its adapter report a real failure.
    }
  }
  return { provider, model }
}

function rankReasoningEffort(value: string): number {
  const rank = REASONING_RANK.indexOf(value as typeof REASONING_RANK[number])
  return rank === -1 ? -1 : rank
}

function unavailable(): GoalJudgeResult {
  return { verdict: 'blocked', summary: WAITING_SUMMARY, findings: [], requiredChanges: [] }
}

/**
 * Run one fresh, read-only structured judge and always release its child.
 * @param input - Judge provider, parent agent, objective, round, and abort signal.
 * @returns Structured pass, repair, or blocked verdict.
 */
export async function judgeGoalCompletion(input: {
  readonly subagents: GoalJudgeRuntime | undefined
  readonly llm?: Pick<LlmRuntime, 'resolveModelInfo'>
  readonly provider: string
  readonly parent: Agent
  readonly objective: string
  readonly round: number
  readonly signal: AbortSignal
}): Promise<GoalJudgeResult> {
  const subagents = input.subagents
  if (subagents === undefined) return unavailable()
  const resolved = resolveStructuredProvider({
    getProvider: name => subagents.getProvider(name),
    list: () => subagents.list?.() ?? [],
  }, input.provider)
  if (resolved === undefined) return unavailable()
  const prompt: ContentBlock[] = [{
    type: 'text',
    text: '<goal_judge>\n'
      + `Objective: ${JSON.stringify(input.objective)}\n`
      + `Candidate completion round: ${input.round}\n\n`
      + 'Act as an independent completion judge. Inspect the current workspace and durable session evidence '
      + 'using only read-only tools. Do not edit files, run commands, call other agents, or change goal state. '
      + 'Decide whether the whole objective is complete, not whether the latest response sounds confident. '
      + 'Return pass only when concrete evidence covers the entire objective. Return needs_changes with specific '
      + 'required_changes when useful work remains. For product, UI, document, or visual objectives, use web_search '
      + 'and web_fetch to inspect comparable work when available and require evidence that the result meets or exceeds '
      + 'the relevant bar. Return blocked only when review cannot proceed because a '
      + 'concrete external condition prevents evaluation.\n'
      + '</goal_judge>',
  }]
  let run
  try {
    run = await subagents.start(resolved.name, {
      label: 'goal-completion-judge',
      prompt,
      parent: input.parent,
      signal: input.signal,
      agentOptions: await resolveGoalJudgeAgentOptions({
        parent: input.parent,
        ...input.llm === undefined ? {} : { llm: input.llm },
        signal: input.signal,
      }),
      outputSchema: GOAL_JUDGE_OUTPUT_SCHEMA,
      toolFilter: { allow: [...READ_ONLY_TOOLS] },
    })
    const result = await run.result
    if (result.stopReason !== 'completed') return unavailable()
    return readStructured(result.structured) ?? unavailable()
  } catch {
    return unavailable()
  } finally {
    if (run !== undefined) await run.dispose()
  }
}

/**
 * Append one bounded, secret-free judge result to the owning session log.
 * @param session - Session that owns the goal audit trail.
 * @param entry - Structured verdict and bounded review details.
 */
export function recordGoalJudge(session: Session, entry: GoalJudgeAuditEntry): void {
  session.append('goal/judge', {
    ...entry,
    findings: [...entry.findings],
    requiredChanges: [...entry.requiredChanges],
  })
}
