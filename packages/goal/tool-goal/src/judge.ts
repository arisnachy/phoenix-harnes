/** Independent, read-only completion judge for long-running goals. */

import type { Agent } from '@phoenix-ai/dsh-agent'
import type { ContentBlock } from '@phoenix-ai/dsh-llm'
import type { GoalJudgeAuditEntry } from '@phoenix-ai/dsh-goal'
import type { Session } from '@phoenix-ai/dsh-session'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
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

function unavailable(summary: string): GoalJudgeResult {
  return { verdict: 'blocked', summary, findings: [], requiredChanges: [] }
}

/**
 * Run one fresh, read-only structured judge and always release its child.
 * @param input - Judge provider, parent agent, objective, round, and abort signal.
 * @returns Structured pass, repair, or blocked verdict.
 */
export async function judgeGoalCompletion(input: {
  readonly subagents: Pick<SubagentRuntime, 'getProvider' | 'start'>
  readonly provider: string
  readonly parent: Agent
  readonly objective: string
  readonly round: number
  readonly signal: AbortSignal
}): Promise<GoalJudgeResult> {
  const provider = input.subagents.getProvider(input.provider)
  if (provider === undefined) return unavailable(`goal judge provider "${input.provider}" is not registered`)
  if (!provider.capabilities.outputSchema || !provider.capabilities.toolFilter) {
    return unavailable(`goal judge provider "${input.provider}" lacks structured read-only review capability`)
  }
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
    run = await input.subagents.start(input.provider, {
      label: 'goal-completion-judge',
      prompt,
      parent: input.parent,
      signal: input.signal,
      outputSchema: GOAL_JUDGE_OUTPUT_SCHEMA,
      toolFilter: { allow: [...READ_ONLY_TOOLS] },
    })
    const result = await run.result
    if (result.stopReason !== 'completed') return unavailable('goal judge did not complete its review')
    return readStructured(result.structured) ?? unavailable('goal judge returned an invalid structured verdict')
  } catch {
    return unavailable('goal judge could not be started')
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
