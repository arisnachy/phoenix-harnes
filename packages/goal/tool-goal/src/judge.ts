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
  readonly completionReport?: {
    readonly unverifiedItems: readonly string[]
    readonly knownLimitations: readonly string[]
  }
  readonly verificationIncidents?: readonly string[]
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
const MAX_HISTORY_ROUNDS = 8
const FINAL_JUDGE_TIMEOUT_MS = 10 * 60_000
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

function unavailable(verificationIncidents: readonly string[] = []): GoalJudgeResult {
  return {
    verdict: 'blocked',
    summary: WAITING_SUMMARY,
    findings: [],
    requiredChanges: [],
    ...(verificationIncidents.length === 0 ? {} : { verificationIncidents: [...verificationIncidents].slice(0, MAX_ITEMS) }),
  }
}

async function awaitAbortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('operation aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([operation, aborted])
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

function canReview(runtime: GoalJudgeRuntime, name: string): boolean {
  const provider = runtime.getProvider(name)
  return provider !== undefined
    && provider.capabilities.outputSchema
    && provider.capabilities.toolFilter
}

function reviewProvider(runtime: GoalJudgeRuntime, requested: string, parent: Agent): string | undefined {
  const nonCodex = parent.options.provider !== 'openai-codex'
  const names = [...new Set([requested, ...(runtime.list?.() ?? [])])]
    .filter(name => !(nonCodex && name.toLowerCase() === 'luna'))
    .filter(name => canReview(runtime, name))
  const fresh = names.find((name) => runtime.getProvider(name)?.inheritsParentContext !== true)
  return fresh ?? names[0]
}

/**
 * Build a bounded, secret-free review dossier from durable goal audit events.
 * This is the Judge's memory across rounds: the original mission stays fixed,
 * prior findings stay actionable, and verified executable evidence shows what
 * the Builder actually delivered rather than what it merely claimed.
 */
function durableMissionReviewHistory(parent: Agent, objective: string): object {
  const current = parent.session.events.findLast(event =>
    event.type === 'goal/change' && event.data.operation !== 'clear')
  const sameGoal = current?.type === 'goal/change'
    && current.data.operation !== 'clear'
    && current.data.goal.objective === objective
    ? { goalId: current.data.goal.id, revision: current.data.goal.revision }
    : undefined
  const belongsToCurrentGoal = (data: { goalId: string, revision: number }): boolean => sameGoal === undefined
    || (data.goalId === sameGoal.goalId && data.revision === sameGoal.revision)

  const judgeRounds = parent.session.events
    .filter((event): event is SessionEvent<'goal/judge'> => event.type === 'goal/judge' && belongsToCurrentGoal(event.data))
    .slice(-MAX_HISTORY_ROUNDS)
    .map(event => ({
      round: event.data.round,
      verdict: event.data.verdict,
      summary: event.data.summary,
      findings: [...event.data.findings],
      requiredChanges: [...event.data.requiredChanges],
    }))
  const gateRounds = parent.session.events
    .filter((event): event is SessionEvent<'goal/completion-gate'> => event.type === 'goal/completion-gate' && belongsToCurrentGoal(event.data))
    .slice(-MAX_HISTORY_ROUNDS)
    .map(event => ({
      round: event.data.round,
      checks: { ...event.data.checks },
      artifactFingerprint: event.data.artifactFingerprint,
      evidenceLedger: event.data.evidenceLedger.map(entry => ({
        criterionId: entry.criterionId,
        criterion: entry.criterion,
        mandatory: entry.mandatory,
        status: entry.status,
        evidence: [...entry.evidence],
      })),
      findings: [...event.data.findings],
      proceduralLessons: [...event.data.proceduralLessons],
      completionReport: event.data.completionReport === undefined ? undefined : {
        unverifiedItems: [...event.data.completionReport.unverifiedItems],
        knownLimitations: [...event.data.completionReport.knownLimitations],
      },
      verificationIncidents: [...(event.data.verificationIncidents ?? [])],
    }))
  const falsePasses = parent.session.events
    .filter((event): event is SessionEvent<'goal/false-pass'> => event.type === 'goal/false-pass' && belongsToCurrentGoal(event.data))
    .slice(-MAX_HISTORY_ROUNDS)
    .map(event => ({
      detectedRound: event.data.detectedRound,
      failureFingerprint: event.data.failureFingerprint,
      findings: [...event.data.findings],
      candidateProceduralLessons: [...event.data.candidateProceduralLessons],
    }))

  return {
    objective,
    goalId: sameGoal?.goalId ?? null,
    revision: sameGoal?.revision ?? null,
    judgeRounds,
    gateRounds,
    falsePasses,
  }
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
  const checks = (Object.entries(gate.checks) as [keyof GoalCompletionGateResult['checks'], GoalCompletionGateResult['checks'][keyof GoalCompletionGateResult['checks']]][])
    .flatMap(([key, status]) => status === 'pass' ? [] : [`${labels[key]} = ${status}`])
  const missingMandatory = gate.evidenceLedger.some(entry => entry.mandatory)
    ? []
    : ['evidence ledger has no mandatory criterion from the original requirement']
  const criteria = gate.evidenceLedger
    .filter(entry => entry.mandatory && entry.status !== 'verified')
    .map(entry => `${entry.criterionId} = ${entry.status}: ${entry.criterion}`)
  return [...checks, ...missingMandatory, ...criteria]
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
  const verificationIncidents = [
    ...(result.verificationIncidents ?? []),
    ...(gate.verificationIncidents ?? []),
  ].filter((incident, index, all) => all.indexOf(incident) === index).slice(0, MAX_ITEMS)
  return {
    verdict: result.verdict === 'blocked' ? 'blocked' : 'needs_changes',
    summary: `Adversarial completion workflow failed; DONE is forbidden until the clean-room gate passes. ${result.summary}`.slice(0, MAX_TEXT),
    findings: blockerFindings.length > 0 ? blockerFindings : ['BLOCKER: completion gate did not produce complete passing evidence.'],
    requiredChanges: required.length > 0 ? required : ['Repair the candidate and repeat the complete adversarial gate from the original requirement.'],
    ...(result.completionReport === undefined ? {} : { completionReport: result.completionReport }),
    ...(verificationIncidents.length === 0 ? {} : { verificationIncidents }),
  }
}

function gateIsInfrastructureOnlyBlocked(gate: GoalCompletionGateResult): boolean {
  return Object.values(gate.checks).every(status => status === 'blocked')
    && gate.evidenceLedger.every(entry => entry.status === 'blocked_external')
}

function sessionGatePassed(event: SessionEvent<'goal/completion-gate'>): boolean {
  return Object.values(event.data.checks).every(status => status === 'pass')
    && event.data.evidenceLedger.length > 0
    && event.data.evidenceLedger.some(entry => entry.mandatory)
    && event.data.evidenceLedger.every(entry => !entry.mandatory || (entry.status === 'verified' && entry.evidence.length > 0))
    && (event.data.completionReport === undefined || event.data.completionReport.unverifiedItems.length === 0)
    && event.data.artifactFingerprint.trim().length > 0
}

/** Find a PASS whose semantic review happened after its exact executable gate. */
function settledGoalPass(parent: Agent, objective: string): SettledGoalPass | undefined {
  const current = parent.session.events.findLast(event =>
    event.type === 'goal/change' && event.data.operation !== 'clear')
  if (current?.type !== 'goal/change' || current.data.operation === 'clear'
    || current.data.goal.objective !== objective) return undefined
  const goalId = current.data.goal.id
  const revision = current.data.goal.revision
  const gateIndex = parent.session.events.findLastIndex((event): event is SessionEvent<'goal/completion-gate'> =>
    event.type === 'goal/completion-gate'
      && event.data.goalId === goalId
      && event.data.revision === revision
      && sessionGatePassed(event))
  if (gateIndex < 0) return undefined
  const gate = parent.session.events[gateIndex] as SessionEvent<'goal/completion-gate'>
  const judge = parent.session.events.slice(gateIndex + 1).findLast((event): event is SessionEvent<'goal/judge'> =>
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
      ...(gate.data.completionReport === undefined ? {} : {
        completionReport: {
          unverifiedItems: [...gate.data.completionReport.unverifiedItems],
          knownLimitations: [...gate.data.completionReport.knownLimitations],
        },
      }),
      verificationIncidents: [...(gate.data.verificationIncidents ?? [])],
    },
  }
}

function mayReuseSettledPass(settled: SettledGoalPass | undefined, gate: GoalCompletionGateResult): settled is SettledGoalPass {
  if (settled === undefined) return false
  if (gateIsInfrastructureOnlyBlocked(gate)) return true
  return completionGatePassed(gate)
    && gate.artifactFingerprint === settled.artifactFingerprint
}

function fingerprintFailure(gate: GoalCompletionGateResult): string {
  const checkPart = Object.entries(gate.checks)
    .filter(([, status]) => status !== 'pass')
    .map(([key, status]) => `${key}:${status}`)
  const mandatoryPart = gate.evidenceLedger.some(entry => entry.mandatory)
    ? []
    : ['mandatory-evidence:missing']
  const criterionPart = gate.evidenceLedger
    .filter(entry => entry.mandatory && entry.status !== 'verified')
    .map(entry => `${entry.criterionId}:${entry.status}`)
  return [...checkPart, ...mandatoryPart, ...criterionPart, gate.findings[0] ?? 'unknown-failure'].join('|').slice(0, 500)
}

/** Persist executable evidence and record a FALSE_PASS when later valid evidence disproves it. */
function recordCompletionGate(parent: Agent, objective: string, round: number, gate: GoalCompletionGateResult): void {
  const current = parent.session.events.findLast(event =>
    event.type === 'goal/change' && event.data.operation !== 'clear')
  if (current?.type !== 'goal/change' || current.data.operation === 'clear') return
  if (current.data.goal.objective !== objective) return

  const goalId = current.data.goal.id
  const revision = current.data.goal.revision
  const previousPass = parent.session.events.findLast((event): event is SessionEvent<'goal/completion-gate'> =>
    event.type === 'goal/completion-gate'
      && event.data.goalId === goalId
      && event.data.revision === revision
      && sessionGatePassed(event))
  if (previousPass !== undefined && gateIsInfrastructureOnlyBlocked(gate)) return

  if (previousPass !== undefined && !completionGatePassed(gate)) {
    parent.session.append('goal/false-pass', {
      goalId,
      revision,
      detectedRound: round,
      priorArtifactFingerprint: previousPass.data.artifactFingerprint,
      observedArtifactFingerprint: gate.artifactFingerprint,
      failureFingerprint: fingerprintFailure(gate),
      findings: [...gate.findings],
      candidateProceduralLessons: gate.proceduralLessons.length > 0
        ? [...gate.proceduralLessons]
        : ['A previously certified completion failed later executable verification; add the discovered failure class to regression coverage.'],
    })
  }

  parent.session.append('goal/completion-gate', {
    goalId,
    revision,
    round,
    attemptId: `gate-${goalId}-${revision}-${round}-${parent.session.seq}`,
    checks: { ...gate.checks },
    evidenceLedger: gate.evidenceLedger.map(entry => ({ ...entry, evidence: [...entry.evidence] })),
    artifactFingerprint: gate.artifactFingerprint,
    cleanRoomEvidence: gate.cleanRoomEvidence,
    findings: [...gate.findings],
    proceduralLessons: [...gate.proceduralLessons],
    ...(gate.completionReport === undefined ? {} : {
      completionReport: {
        unverifiedItems: [...gate.completionReport.unverifiedItems],
        knownLimitations: [...gate.completionReport.knownLimitations],
      },
    }),
    verificationIncidents: [...(gate.verificationIncidents ?? [])],
  })
}

/**
 * Run the adversarial Tester first, then a fresh read-only Judge. A Judge PASS
 * is accepted only when the programmatic gate and requirement ledger pass.
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
  if (subagents === undefined) {
    return settled?.result ?? unavailable(['goal-completion-judge:runtime-unavailable'])
  }
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
    return mayReuseSettledPass(settled, gate)
      ? settled.result
      : enforceGate({
        ...unavailable([
          ...(gate.verificationIncidents ?? []),
          'goal-completion-judge:provider-unavailable',
        ]),
        ...(gate.completionReport === undefined ? {} : { completionReport: gate.completionReport }),
      }, gate)
  }
  const history = durableMissionReviewHistory(input.parent, input.objective)

  const prompt: ContentBlock[] = [{
    type: 'text',
    text: '<goal_judge>\n'
      + `Original objective: ${JSON.stringify(input.objective)}\n`
      + `Candidate completion round: ${input.round}\n`
      + `Durable mission review history: ${JSON.stringify(history)}\n`
      + `Independent adversarial gate evidence: ${JSON.stringify(gate)}\n\n`
      + 'Act as the final independent completion Judge. Inspect the current workspace and durable session evidence using only read-only tools. '
      + 'Do not edit files, run commands, call other agents, or change goal state. Treat the original requirement as authoritative. '
      + 'The durable mission review history is cumulative: do not forget earlier findings, required corrections, false passes, or verified evidence merely because a new round started. '
      + 'Confirm that every previously required correction was actually addressed, and use the current workspace plus session evidence to determine what the Builder really changed. '
      + 'Cross-check the Evidence Ledger, Builder tests, independently generated adversarial tests, packaged artifact fingerprint, startup behavior, '
      + 'and clean-room evidence. Builder prose such as “all tests pass” is never evidence by itself. Mark every inconsistency as a BLOCKER finding. '
      + 'Return pass only when the whole objective is literally satisfied, every mandatory criterion is verified, every gate dimension passed, and the '
      + 'delivered artifact is an excellent real-world solution rather than merely a nominal-case implementation. Consider real-world variability, edge cases, '
      + 'corrupt inputs, alternate supported formats, unexpected conditions, and whether a new user receiving only the final artifact can actually use it. '
      + 'Return needs_changes for repairable implementation/artifact defects. Return blocked only for a concrete external dependency that genuinely prevents verification.\n'
      + '</goal_judge>',
  }]

  const timeout = AbortSignal.timeout(FINAL_JUDGE_TIMEOUT_MS)
  const signal = AbortSignal.any([input.signal, timeout])
  let run
  let startPromise: ReturnType<GoalJudgeRuntime['start']> | undefined
  let judged: GoalJudgeResult = unavailable()
  const judgeIncidents: string[] = []
  try {
    const agentOptions = await awaitAbortable(resolveGoalJudgeAgentOptions({
      parent: input.parent,
      ...input.llm === undefined ? {} : { llm: input.llm },
      signal,
    }), signal)
    startPromise = subagents.start(provider, {
      label: 'goal-completion-judge',
      prompt,
      parent: input.parent,
      signal,
      agentOptions,
      outputSchema: GOAL_JUDGE_OUTPUT_SCHEMA,
      toolFilter: { allow: [...READ_ONLY_TOOLS] },
    })
    run = await awaitAbortable(startPromise, signal)
    const result = await awaitAbortable(run.result, signal)
    if (result.stopReason === 'completed') {
      const structured = readStructured(result.structured)
      if (structured === undefined) {
        judgeIncidents.push('goal-completion-judge:invalid-output')
      } else {
        judged = structured
      }
    } else {
      judgeIncidents.push(`goal-completion-judge:stop-${result.stopReason}`)
    }
  } catch (error) {
    const phase = run === undefined ? 'start' : 'result'
    if (run === undefined && signal.aborted && startPromise !== undefined) {
      void startPromise.then(
        lateRun => lateRun.dispose().catch(() => undefined),
        () => undefined,
      )
    }
    const kind = timeout.aborted && !input.signal.aborted
      ? 'timeout'
      : error instanceof Error && error.name.length > 0 ? error.name : 'runtime-error'
    judgeIncidents.push(`goal-completion-judge:${phase}-${kind}`)
  } finally {
    if (run !== undefined) {
      try {
        await run.dispose()
      } catch (error) {
        const kind = error instanceof Error && error.name.length > 0 ? error.name : 'runtime-error'
        judgeIncidents.push(`goal-completion-judge:dispose-${kind}`)
      }
    }
  }
  if (judged.verdict === 'blocked' && judgeIncidents.length > 0) {
    judged = unavailable(judgeIncidents)
  } else if (judgeIncidents.length > 0) {
    judged = { ...judged, verificationIncidents: [...judgeIncidents] }
  }
  if (judged.verdict === 'blocked' && mayReuseSettledPass(settled, gate)) return settled.result
  const verificationIncidents = [
    ...(gate.verificationIncidents ?? []),
    ...(judged.verificationIncidents ?? []),
  ].filter((incident, index, all) => all.indexOf(incident) === index).slice(0, MAX_ITEMS)
  return enforceGate({
    ...judged,
    ...(gate.completionReport === undefined ? {} : { completionReport: gate.completionReport }),
    ...(verificationIncidents.length === 0 ? {} : { verificationIncidents }),
  }, gate)
}

/**
 * Append one bounded, secret-free judge result to the owning session log.
 * A later infrastructure-only BLOCKED cannot shadow an already settled PASS;
 * real `needs_changes` remains durable for repair/replay.
 * @param session - owning durable session log.
 * @param entry - bounded independent judge result for one exact goal revision.
 */
export function recordGoalJudge(session: Session, entry: GoalJudgeAuditEntry): void {
  const settledPass = session.events.some(event => event.type === 'goal/judge'
    && event.data.goalId === entry.goalId
    && event.data.revision === entry.revision
    && event.data.verdict === 'pass')
  if (settledPass && entry.verdict === 'blocked') return
  session.append('goal/judge', {
    ...entry,
    findings: [...entry.findings],
    requiredChanges: [...entry.requiredChanges],
  })
}
