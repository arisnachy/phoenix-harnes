/** Independent completion judge backed by an adversarial clean-room gate. */

import type { Agent } from '@phoenix-ai/dsh-agent'
import type { ContentBlock, LlmRuntime } from '@phoenix-ai/dsh-llm'
import type { GoalJudgeAuditEntry } from '@phoenix-ai/dsh-goal'
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@phoenix-ai/dsh-tools'
import {
  completionGatePassed,
  runAdversarialCompletionGate,
  type GoalCompletionGateResult,
} from './completion-gate.ts'
import { resolveGoalJudgeAgentOptions } from './judge-route.ts'

export { resolveGoalJudgeAgentOptions } from './judge-route.ts'

/** Structured decision produced by the independent goal judge. */
export interface GoalJudgeResult {
  readonly verdict: 'pass' | 'needs_changes' | 'blocked'
  readonly summary: string
  readonly findings: readonly string[]
  readonly requiredChanges: readonly string[]
}

interface SettledGoalPass {
  readonly result: GoalJudgeResult
  readonly artifactFingerprint: string
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
const MAX_ITEMS = 16
const WAITING_SUMMARY = 'Independent verification is not ready yet; the mission remains active and will continue automatically.'
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

function unavailable(): GoalJudgeResult {
  return { verdict: 'blocked', summary: WAITING_SUMMARY, findings: [], requiredChanges: [] }
}

function canReview(runtime: GoalJudgeRuntime, name: string): boolean {
  const provider = runtime.getProvider(name)
  return provider !== undefined
    && provider.capabilities.outputSchema
    && provider.capabilities.toolFilter
}

/**
 * Resolve an independent subagent transport without ever falling back to a
 * transport named Luna for a non-Codex parent. The child model itself is
 * always resolved independently by resolveGoalJudgeAgentOptions().
 */
function reviewProvider(runtime: GoalJudgeRuntime, requested: string, parent: Agent): string | undefined {
  const nonCodex = parent.options.provider !== 'openai-codex'
  const names = [...new Set([requested, ...(runtime.list?.() ?? [])])]
    .filter(name => !(nonCodex && name.toLowerCase() === 'luna'))
    .filter(name => canReview(runtime, name))
  const fresh = names.find((name) => runtime.getProvider(name)?.inheritsParentContext !== true)
  return fresh ?? names[0]
}

function gateFailures(gate: GoalCompletionGateResult): string[] {
  const labels: Record<keyof GoalCompletionGateResult['checks'], string> = {
    requirements: 'requirements',
    builderTests: 'builder tests',
    adversarialTests: 'adversarial tests',
    startup: 'startup',
    artifactIntegrity: 'artifact integrity',
    cleanRoom: 'clean-room verification',
  }
  return (Object.entries(gate.checks) as [keyof GoalCompletionGateResult['checks'], GoalCompletionGateResult['checks'][keyof GoalCompletionGateResult['checks']]][])
    .flatMap(([key, status]) => status === 'pass' ? [] : [`${labels[key]} = ${status}`])
}

function enforceGate(result: GoalJudgeResult, gate: GoalCompletionGateResult): GoalJudgeResult {
  if (completionGatePassed(gate)) return result
  const failures = gateFailures(gate)
  const blockerFindings = [
    ...failures.map(failure => `BLOCKER: ${failure}`),
    ...gate.findings.map(finding => `BLOCKER: ${finding}`),
    ...gate.proceduralLessons.map(lesson => `Procedural lesson: ${lesson}`),
  ].slice(0, MAX_ITEMS)
  const required = [
    ...failures.map(failure => `Repair and re-run the full adversarial completion gate: ${failure}.`),
    ...result.requiredChanges,
  ].slice(0, MAX_ITEMS)
  return {
    verdict: result.verdict === 'blocked' ? 'blocked' : 'needs_changes',
    summary: `Adversarial completion workflow failed; DONE is forbidden until the clean-room gate passes. ${result.summary}`.slice(0, MAX_TEXT),
    findings: blockerFindings.length > 0 ? blockerFindings : ['BLOCKER: completion gate did not produce six passing checks.'],
    requiredChanges: required.length > 0 ? required : ['Repair the candidate and repeat the complete adversarial gate from the original requirement.'],
  }
}

function gateIsInfrastructureOnlyBlocked(gate: GoalCompletionGateResult): boolean {
  return Object.values(gate.checks).every(status => status === 'blocked')
}

function sessionGatePassed(event: SessionEvent<'goal/completion-gate'>): boolean {
  return Object.values(event.data.checks).every(status => status === 'pass')
    && event.data.artifactFingerprint.trim().length > 0
}

/** Find a PASS whose executable gate certifies the exact same goal revision. */
function settledGoalPass(parent: Agent, objective: string): SettledGoalPass | undefined {
  const current = parent.session.events.findLast(event =>
    event.type === 'goal/change' && event.data.operation !== 'clear')
  if (current?.type !== 'goal/change' || current.data.operation === 'clear'
    || current.data.goal.objective !== objective) return undefined
  const goalId = current.data.goal.id
  const revision = current.data.goal.revision
  const gate = parent.session.events.findLast((event): event is SessionEvent<'goal/completion-gate'> =>
    event.type === 'goal/completion-gate'
      && event.data.goalId === goalId
      && event.data.revision === revision
      && sessionGatePassed(event))
  if (gate === undefined) return undefined
  const judge = parent.session.events.findLast((event): event is SessionEvent<'goal/judge'> =>
    event.type === 'goal/judge'
      && event.data.goalId === goalId
      && event.data.revision === revision
      && event.data.verdict === 'pass')
  if (judge === undefined) return undefined
  return {
    artifactFingerprint: gate.data.artifactFingerprint,
    result: {
      verdict: 'pass',
      summary: judge.data.summary,
      findings: [...judge.data.findings],
      requiredChanges: [],
    },
  }
}

/** Whether an unavailable current review may safely reuse a durable PASS. */
function mayReuseSettledPass(settled: SettledGoalPass | undefined, gate: GoalCompletionGateResult): settled is SettledGoalPass {
  if (settled === undefined) return false
  if (gateIsInfrastructureOnlyBlocked(gate)) return true
  return completionGatePassed(gate)
    && gate.artifactFingerprint === settled.artifactFingerprint
}

/**
 * Persist executable/adversarial evidence only when this review is for the
 * current goal objective. Specialist/Forge reviews reuse this Judge but must
 * not masquerade as goal completion certification.
 *
 * A fully blocked infrastructure attempt is non-destructive after an exact
 * revision already has a passing gate: inability to launch a provider later
 * is not evidence that a previously certified artifact regressed. A real
 * verifier FAIL is still appended and therefore invalidates the older gate.
 */
function recordCompletionGate(parent: Agent, objective: string, round: number, gate: GoalCompletionGateResult): void {
  const current = parent.session.events.findLast(event =>
    event.type === 'goal/change' && event.data.operation !== 'clear')
  if (current?.type !== 'goal/change' || current.data.operation === 'clear') return
  if (current.data.goal.objective !== objective) return

  const goalId = current.data.goal.id
  const revision = current.data.goal.revision
  const settledPass = parent.session.events.some((event): event is SessionEvent<'goal/completion-gate'> =>
    event.type === 'goal/completion-gate'
      && event.data.goalId === goalId
      && event.data.revision === revision
      && sessionGatePassed(event))
  if (settledPass && gateIsInfrastructureOnlyBlocked(gate)) return

  parent.session.append('goal/completion-gate', {
    goalId,
    revision,
    round,
    attemptId: `gate-${goalId}-${revision}-${round}-${parent.session.seq}`,
    checks: { ...gate.checks },
    artifactFingerprint: gate.artifactFingerprint,
    cleanRoomEvidence: gate.cleanRoomEvidence,
    findings: [...gate.findings],
    proceduralLessons: [...gate.proceduralLessons],
  })
}

/**
 * Run the adversarial Tester first, then a fresh read-only Judge. A Judge PASS
 * is accepted only when the six programmatic gate checks also pass.
 * @param input - subagent runtime, active model route, original objective, round, and cancellation signal.
 * @returns the independent semantic verdict after enforcing executable gate evidence.
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
  const settled = settledGoalPass(input.parent, input.objective)
  const subagents = input.subagents
  if (subagents === undefined) return settled?.result ?? unavailable()
  const gate = await runAdversarialCompletionGate({
    subagents,
    ...input.llm === undefined ? {} : { llm: input.llm },
    provider: input.provider,
    parent: input.parent,
    objective: input.objective,
    round: input.round,
    signal: input.signal,
  })
  recordCompletionGate(input.parent, input.objective, input.round, gate)
  if (mayReuseSettledPass(settled, gate) && gateIsInfrastructureOnlyBlocked(gate)) return settled.result
  const provider = reviewProvider(subagents, input.provider, input.parent)
  if (provider === undefined) {
    return mayReuseSettledPass(settled, gate) ? settled.result : enforceGate(unavailable(), gate)
  }

  const prompt: ContentBlock[] = [{
    type: 'text',
    text: '<goal_judge>\n'
      + `Original objective: ${JSON.stringify(input.objective)}\n`
      + `Candidate completion round: ${input.round}\n`
      + `Independent adversarial gate evidence: ${JSON.stringify(gate)}\n\n`
      + 'Act as the final independent completion Judge. Inspect the current workspace and durable session evidence using only read-only tools. '
      + 'Do not edit files, run commands, call other agents, or change goal state. Treat the original requirement as authoritative. '
      + 'Cross-check what the Builder declared, the Builder tests, the independently generated adversarial tests, the packaged artifact fingerprint, '
      + 'startup behavior, and the clean-room evidence. Mark every inconsistency as a BLOCKER finding. Return pass only when the whole objective is '
      + 'literally satisfied, every required gate dimension passed, and the delivered artifact is an excellent real-world solution rather than merely '
      + 'a nominal-case implementation. Consider real-world variability, edge cases, corrupt inputs, alternate supported formats, unexpected conditions, '
      + 'and whether a new user receiving only the final artifact can actually use it. Return needs_changes for repairable implementation/artifact defects. '
      + 'Return blocked only for a concrete external dependency that genuinely prevents verification.\n'
      + '</goal_judge>',
  }]

  let run
  let judged: GoalJudgeResult = unavailable()
  try {
    run = await subagents.start(provider, {
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
    if (result.stopReason === 'completed') judged = readStructured(result.structured) ?? unavailable()
  } catch {
    judged = unavailable()
  } finally {
    if (run !== undefined) await run.dispose()
  }
  if (judged.verdict === 'blocked' && mayReuseSettledPass(settled, gate)) return settled.result
  return enforceGate(judged, gate)
}

/**
 * Append one bounded, secret-free judge result to the owning session log.
 * A settled PASS for one exact goal revision is monotonic: later infrastructure
 * outages or stale blocked reviews cannot shadow that verified decision.
 * @param session - owning durable session log.
 * @param entry - bounded independent judge result for one exact goal revision.
 */
export function recordGoalJudge(session: Session, entry: GoalJudgeAuditEntry): void {
  const settledPass = session.events.some(event => event.type === 'goal/judge'
    && event.data.goalId === entry.goalId
    && event.data.revision === entry.revision
    && event.data.verdict === 'pass')
  if (settledPass && entry.verdict !== 'pass') return
  session.append('goal/judge', {
    ...entry,
    findings: [...entry.findings],
    requiredChanges: [...entry.requiredChanges],
  })
}