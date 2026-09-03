import type {
  CapabilityEvidence,
  CapabilityNeed,
  CapabilitySurface,
  HardnessService,
} from '@phoenix-ai/dsh-hardness'
import type { ToolRuntime } from '@phoenix-ai/dsh-tools'
import type { SessionEvent } from '@phoenix-ai/dsh-session'
import type {
  CapabilityApproval,
  CapabilityExecutionContext,
  CapabilityExecutor,
} from './execution-bridge.ts'
import type { HardnessMissionAuditEntry, HardnessMissionAuditWriter } from './mission-audit.ts'
import { executeCapabilityNeed } from './execution-bridge.ts'
import {
  artifactFromToolResult,
  type ArtifactRenderModel,
  type CapabilityArtifact,
  type ArtifactRuntime,
} from './artifact-runtime.ts'
import type { AcquisitionRegistry } from './acquisition-registry.ts'
import {
  MissionPersistenceKernel,
  createMissionKernelWriter,
  type MissionGoalLock,
  type MissionKernelEvent,
  type MissionKernelState,
  type MissionJudgeDecision,
  type MissionRoute,
} from './mission-kernel.ts'

/** Bounded input supplied to the independent judge after artifact verification. */
export interface HardnessMissionJudgeInput {
  readonly need: CapabilityNeed
  readonly goal: MissionGoalLock
  readonly criteria: MissionKernelState['criteria']
  readonly artifactId: string
  readonly artifactMime: string
  readonly rendered: ArtifactRenderModel
  readonly evidenceId: string
  readonly context: CapabilityExecutionContext
}

/** Independent verifier required before a HARDNESS mission can complete. */
export type HardnessMissionJudge = (input: HardnessMissionJudgeInput) => Promise<MissionJudgeDecision>

/** Dependencies and request data for one governed HARDNESS mission. */
export interface HardnessMissionInput {
  readonly hardness: HardnessService
  readonly acquisition: Pick<AcquisitionRegistry, 'acquireOrBuild'>
  readonly tools: Pick<ToolRuntime, 'execute'>
  readonly approval: CapabilityApproval
  readonly artifacts: Pick<ArtifactRuntime, 'render'>
  readonly audit?: HardnessMissionAuditWriter
  readonly executor?: CapabilityExecutor
  readonly judge?: HardnessMissionJudge
  /** Optional exact objective lock supplied by a higher-level mission supervisor. */
  readonly goal?: MissionGoalLock
  readonly need: CapabilityNeed
  readonly args: unknown
  readonly context: CapabilityExecutionContext
}

/** Durable mission status exposed while a result still needs recovery. */
export type HardnessMissionStatus = 'ACTIVE' | 'RECOVERING' | 'WAITING_EXTERNAL'

/** Mechanical action the model must take after a non-terminal mission result. */
export type HardnessMissionNextAction = 'repair_and_replan' | 'retry_with_alternative' | 'wait_for_dependency'

/** Completed artifact output or a governed non-terminal blocking reason. */
export type HardnessMissionResult =
  | { readonly kind: 'completed'; readonly artifact: CapabilityArtifact; readonly rendered: ArtifactRenderModel }
  | {
    readonly kind: 'blocked'
    readonly reason: string
    readonly retryable?: boolean
    /** Durable kernel status at the point this result was produced. */
    readonly status?: HardnessMissionStatus
    /** Next model action; a blocked result is never a completion signal. */
    readonly nextAction?: HardnessMissionNextAction
  }

/** Fixed safety bound preventing automatic recovery from becoming an unbounded loop. */
const MAX_AUTOMATIC_RECOVERY_ATTEMPTS = 3

function evidenceFor(
  input: HardnessMissionInput,
  surface: CapabilitySurface,
  outcome: CapabilityEvidence['outcome'],
  durationMs: number,
  artifactRefs: readonly string[],
): CapabilityEvidence {
  return {
    id: `mission:${String(input.context.callId)}:${surface.capabilityId}:${outcome}`,
    capabilityId: surface.capabilityId,
    descriptorVersion: surface.capabilityVersion,
    caseId: `need:${input.need.kind ?? 'unknown'}`,
    inputSummary: JSON.stringify(input.need),
    outcome,
    durationMs,
    artifactRefs: [...artifactRefs],
  }
}

function auditEntry(
  input: HardnessMissionInput,
  entry: Omit<HardnessMissionAuditEntry, 'callId' | 'capabilityKind'>,
): boolean {
  if (input.audit === undefined) return true
  try {
    input.audit.record({
      callId: input.context.callId,
      capabilityKind: input.need.kind ?? 'unknown',
      ...entry,
    })
    return true
  } catch {
    return false
  }
}

function auditUnavailable(): HardnessMissionResult {
  return {
    kind: 'blocked',
    reason: 'HARDNESS audit could not be recorded',
    status: 'RECOVERING',
    nextAction: 'retry_with_alternative',
  }
}

function blocked(
  input: HardnessMissionInput,
  step: HardnessMissionAuditEntry['step'],
  reason: string,
  reasonCode: string,
  extras: Omit<HardnessMissionAuditEntry, 'callId' | 'capabilityKind' | 'step' | 'outcome'> = {},
  status: HardnessMissionStatus = 'WAITING_EXTERNAL',
  nextAction: HardnessMissionNextAction = 'wait_for_dependency',
): HardnessMissionResult {
  if (!auditEntry(input, { step, outcome: 'blocked', reasonCode, ...extras })) return auditUnavailable()
  if (!auditEntry(input, { step: 'audit', outcome: 'completed', reasonCode: 'mission-blocked', ...extras })) return auditUnavailable()
  return { kind: 'blocked', reason, status, nextAction, ...(status === 'RECOVERING' ? { retryable: true } : {}) }
}

function quarantine(
  input: HardnessMissionInput,
  surface: CapabilitySurface,
  startedAt: number,
  step: HardnessMissionAuditEntry['step'],
  reason: string,
  artifactRefs: readonly string[] = [],
): HardnessMissionResult {
  const evidence = input.hardness.recordEvidence(evidenceFor(
    input,
    surface,
    'failed',
    Math.max(0, Date.now() - startedAt),
    artifactRefs,
  ))
  if (!auditEntry(input, {
    step,
    outcome: 'blocked',
    reasonCode: 'mission-failed',
    capabilityId: surface.capabilityId,
    descriptorVersion: surface.capabilityVersion,
    ...artifactRefs.length === 0 ? {} : { artifactId: artifactRefs[0] },
    evidenceId: evidence.id,
  })) return auditUnavailable()
  if (!auditEntry(input, {
    step: 'audit',
    outcome: 'completed',
    reasonCode: 'mission-blocked',
    capabilityId: surface.capabilityId,
    descriptorVersion: surface.capabilityVersion,
    ...artifactRefs.length === 0 ? {} : { artifactId: artifactRefs[0] },
    evidenceId: evidence.id,
  })) return auditUnavailable()
  input.hardness.transition(surface.capabilityId, 'quarantined', reason, evidence.id)
  return {
    kind: 'blocked',
    reason,
    retryable: true,
    status: 'RECOVERING',
    nextAction: 'retry_with_alternative',
  }
}

function recoveryRoutes(kind: string): readonly MissionRoute[] {
  return [
    { id: `${kind}:verify-first`, strategy: 'verification-first', rationale: 'revalidate inputs and prerequisites before retrying', priority: 1 },
    { id: `${kind}:alternate-tool`, strategy: 'alternate-tool', rationale: 'select another ATLAS capability with equivalent outputs', priority: 2 },
    { id: `${kind}:minimal-change`, strategy: 'minimal-change', rationale: 'reduce the operation to the smallest independently testable step', priority: 3 },
  ]
}

function missionGoal(input: HardnessMissionInput): MissionGoalLock {
  const kind = input.need.kind ?? 'capability'
  return {
    objective: `Deliver a complete, verified result for the ${kind} request`,
    deliverables: [{ id: 'mission-artifact', description: `The final ${kind} artifact requested by the user` }],
    acceptanceCriteria: [
      { id: 'artifact-produced', description: 'The requested final artifact exists and has the declared output', mandatory: true },
      { id: 'artifact-rendered', description: 'The final artifact can be presented in its declared modality', mandatory: true },
    ],
    qualityRequirements: [
      'The result is complete rather than a scaffold, mock, or partial substitute',
      'The result is reproducible from durable evidence',
      'The structure and presentation meet or exceed the requested quality bar',
    ],
  }
}

/**
 * Keep one HARDNESS mission identity across automatic goal rounds. A tool call
 * id is unique to one turn, so it cannot be the durable identity when the
 * goal-round driver resumes the same user objective.
 * @param input - Mission request and optional live session context.
 * @returns Stable mission identity for the current goal, or the call identity.
 */
function missionId(input: HardnessMissionInput): string {
  const events = input.context.agent?.session.events as readonly { readonly type: string; readonly data: unknown }[] | undefined
  const goalChange = events?.findLast(event => event.type === 'goal/change') as
    | { readonly type: string
      readonly data: {
        readonly operation?: string
        readonly goal?: { readonly id?: string; readonly phase?: string }
      }
    }
    | undefined
  if (goalChange?.data.operation !== 'clear'
    && goalChange?.data.goal?.id !== undefined
    && goalChange.data.goal.phase !== 'complete') {
    return `goal:${goalChange.data.goal.id}:${input.need.kind ?? 'capability'}`
  }
  return String(input.context.callId)
}

function blockedJudge(summary: string): MissionJudgeDecision {
  return {
    verdict: 'blocked', summary, evidence: [], requiredChanges: [], criteria: [],
    quality: { verdict: 'fail', summary: 'Judge unavailable', evidence: [], findings: [summary] },
  }
}

async function judgeMission(
  input: HardnessMissionInput,
  lockedGoal: MissionGoalLock,
  criteria: MissionKernelState['criteria'],
  artifact: CapabilityArtifact,
  rendered: ArtifactRenderModel,
  evidenceId: string,
): Promise<MissionJudgeDecision> {
  if (input.judge === undefined) {
    return blockedJudge('HARDNESS completion requires an independent judge')
  }
  try {
    return await input.judge({
      need: input.need,
      goal: lockedGoal,
      criteria,
      artifactId: artifact.id,
      artifactMime: artifact.mime,
      rendered,
      evidenceId,
      context: input.context,
    })
  } catch {
    return blockedJudge('HARDNESS independent judge could not complete')
  }
}

function missionKernel(input: HardnessMissionInput, lockedGoal: MissionGoalLock): MissionPersistenceKernel {
  const session = input.context.agent?.session
  const stableMissionId = missionId(input)
  const writer = session === undefined ? { record: (_event: MissionKernelEvent): void => undefined } : createMissionKernelWriter(session)
  const prior = session?.events
    .filter((event): event is SessionEvent<'hardness/kernel'> =>
      event.type === 'hardness/kernel' && event.data.missionId === stableMissionId && event.data.revision === 1,
    )
    .map(event => event.data) ?? []
  return new MissionPersistenceKernel({ missionId: stableMissionId, revision: 1, goal: lockedGoal, writer }, prior)
}

function executionNeedAfterAcquisition(need: CapabilityNeed, preparedStatus: string | undefined): CapabilityNeed {
  if (need.requiredStatus !== 'verified' || preparedStatus !== 'testing') return need
  const { requiredStatus: _requiredStatus, ...executionNeed } = need
  return executionNeed
}

/**
 * Execute one mission through acquisition, approval, real execution, artifact
 * verification, and evidence-backed promotion or quarantine. A capability
 * prepared as `testing` may execute once even when the final need requires
 * `verified`; that execution is the only legitimate way to produce the passed
 * evidence required for promotion.
 * @param input - Live services, declared need, arguments, and execution context.
 * @returns Completed rendered artifact or the governed reason the mission was blocked.
 */
async function runHardnessMissionAttempt(input: HardnessMissionInput): Promise<HardnessMissionResult> {
  const lockedGoal = input.goal ?? missionGoal(input)
  const kernel = missionKernel(input, lockedGoal)
  kernel.start()
  if (!auditEntry(input, { step: 'inspect', outcome: 'completed' })) return auditUnavailable()
  const initial = input.hardness.route(input.need)
  let executionNeed = input.need
  if (initial.kind !== 'route') {
    const acquired = await input.acquisition.acquireOrBuild(input.need, input.context.signal)
    if (acquired.kind !== 'built') {
      const reason = acquired.reasons.join('; ')
      kernel.dependencyMissing(input.need.kind ?? 'capability', reason)
      kernel.fail({ scope: 'strategy', strategy: 'baseline', cause: reason, rootCause: reason,
        fingerprint: `capability-unavailable:${input.need.kind ?? 'unknown'}`, blocked: true, routes: recoveryRoutes('capability') })
      return blocked(input, 'resolve', reason, 'capability-unavailable')
    }
    executionNeed = executionNeedAfterAcquisition(input.need, acquired.capability.status)
  }

  const routed = input.hardness.route(executionNeed)
  if (routed.kind !== 'route') {
    const reason = routed.reasons.join('; ')
    kernel.dependencyMissing(input.need.kind ?? 'capability', reason)
    return blocked(input, 'resolve', reason, 'capability-unavailable')
  }
  const resolvedSurface = input.hardness.surface(routed)
  if (resolvedSurface === undefined) {
    const reason = 'HARDNESS route has no executable surface'
    kernel.fail({ scope: 'plan', strategy: 'baseline', cause: reason, rootCause: reason,
      fingerprint: 'surface-unavailable', blocked: true, routes: recoveryRoutes('surface') })
    return blocked(input, 'resolve', reason, 'surface-unavailable')
  }
  const capability = { capabilityId: resolvedSurface.capabilityId, descriptorVersion: resolvedSurface.capabilityVersion }
  if (!auditEntry(input, { step: 'resolve', outcome: 'completed', ...capability })) return auditUnavailable()
  if (!auditEntry(input, { step: 'plan', outcome: 'completed', ...capability })) return auditUnavailable()

  const startedAt = Date.now()
  let execution
  try {
    execution = await executeCapabilityNeed(
      input.hardness,
      input.tools,
      input.approval,
      executionNeed,
      input.args,
      input.context,
      input.executor,
      { beforeExecute: () => auditEntry(input, { step: 'approve', outcome: 'completed', ...capability }) },
    )
  } catch {
    kernel.fail({ scope: 'attempt', strategy: 'baseline', cause: 'capability execution threw', rootCause: 'executor raised an unclassified failure',
      fingerprint: 'execution-threw', blocked: false, routes: recoveryRoutes('execution') })
    return blocked(
      input,
      'execute',
      'HARDNESS capability execution failed',
      'execution-threw',
      {},
      'RECOVERING',
      'retry_with_alternative',
    )
  }
  if (execution.kind !== 'executed') {
    if (execution.kind === 'aborted') return auditUnavailable()
    if (execution.kind === 'missing') {
      const reason = execution.reasons.join('; ')
      kernel.dependencyMissing(input.need.kind ?? 'capability', reason)
      return blocked(input, 'resolve', reason, 'capability-unavailable')
    }
    if (execution.kind === 'denied') {
      kernel.fail({ scope: 'plan', strategy: 'baseline', cause: execution.reason, rootCause: 'approval was not granted',
        fingerprint: 'approval-denied', blocked: true, routes: recoveryRoutes('approval') })
      return blocked(input, 'approve', execution.reason, 'approval-denied', capability)
    }
    kernel.fail({ scope: 'tool', strategy: 'baseline', cause: execution.reason, rootCause: 'no executor owns the routed capability',
      fingerprint: 'executor-unavailable', blocked: true, routes: recoveryRoutes('executor') })
    return blocked(input, 'execute', execution.reason, 'executor-unavailable', capability)
  }

  const { surface } = execution
  if (!auditEntry(input, { step: 'execute', outcome: 'completed', ...capability })) return auditUnavailable()

  if (execution.result.isError) {
    kernel.fail({ scope: 'tool', strategy: 'baseline', cause: execution.result.error.message, rootCause: 'tool returned an error result',
      fingerprint: `tool-result:${surface.capabilityId}`, blocked: false, routes: recoveryRoutes('tool') })
    return quarantine(input, surface, startedAt, 'execute', execution.result.error.message)
  }

  const artifact = artifactFromToolResult(execution.result)
  if (artifact === undefined) {
    kernel.fail({ scope: 'plan', strategy: 'baseline', cause: 'mission produced no valid artifact', rootCause: 'execution output did not satisfy artifact validation',
      fingerprint: 'artifact-invalid', blocked: false, routes: recoveryRoutes('artifact') })
    return quarantine(input, surface, startedAt, 'verify', 'mission produced no valid artifact')
  }
  const rendered = input.artifacts.render(artifact)
  if (rendered === undefined) {
    kernel.fail({ scope: 'strategy', strategy: 'baseline', cause: `no renderer registered for ${artifact.mime}`, rootCause: 'artifact presentation capability is unavailable',
      fingerprint: `renderer-unavailable:${artifact.mime}`, blocked: true, routes: recoveryRoutes('renderer') })
    return quarantine(input, surface, startedAt, 'verify', `no renderer registered for ${artifact.mime}`, [artifact.id])
  }
  kernel.markCriterion('artifact-produced', 'IMPLEMENTED', [artifact.id])
  kernel.markCriterion('artifact-rendered', 'IMPLEMENTED', [artifact.id])

  const evidence = input.hardness.recordEvidence(evidenceFor(
    input,
    execution.surface,
    'passed',
    Math.max(0, Date.now() - startedAt),
    [artifact.id],
  ))
  if (!auditEntry(input, {
    step: 'verify',
    outcome: 'completed',
    ...capability,
    artifactId: artifact.id,
    evidenceId: evidence.id,
  })) return auditUnavailable()
  if (!auditEntry(input, {
    step: 'present',
    outcome: 'completed',
    ...capability,
    artifactId: artifact.id,
  })) return auditUnavailable()
  if (!auditEntry(input, {
    step: 'audit',
    outcome: 'completed',
    ...capability,
    artifactId: artifact.id,
    evidenceId: evidence.id,
    durationMs: Math.max(0, Date.now() - startedAt),
  })) return auditUnavailable()
  kernel.markCriterion('artifact-produced', 'TESTED', [evidence.id])
  kernel.markCriterion('artifact-rendered', 'TESTED', [evidence.id])
  kernel.beginVerification()
  const decision = await judgeMission(input, lockedGoal, kernel.snapshot().criteria, artifact, rendered, evidence.id)
  const judged = kernel.judge(decision)
  if (judged.status !== 'DONE') {
    const reviewed = judged.judge ?? decision
    const changes = reviewed.requiredChanges.length === 0 ? '' : ` Required changes: ${reviewed.requiredChanges.join('; ')}`
    if (!auditEntry(input, {
      step: 'audit',
      outcome: 'blocked',
      reasonCode: `judge-${reviewed.verdict}`,
      ...capability,
      artifactId: artifact.id,
      evidenceId: evidence.id,
    })) return auditUnavailable()
    return {
      kind: 'blocked',
      reason: `JUDGE ${reviewed.verdict}: ${reviewed.summary}.${changes}`,
      status: reviewed.verdict === 'blocked' ? 'WAITING_EXTERNAL' : 'ACTIVE',
      nextAction: reviewed.verdict === 'blocked' ? 'wait_for_dependency' : 'repair_and_replan',
    }
  }
  input.hardness.promoteFromEvidence(evidence.id)
  return { kind: 'completed', artifact, rendered }
}

/**
 * Execute one mission with bounded automatic recovery for disposable tool
 * failures. Each retry re-enters ATLAS, which skips the failed capability and
 * can select a materially different provider. Judge repairs remain active and
 * are continued by the durable goal-round driver rather than silently
 * repeating an unchanged artifact.
 * @param input - Live services, declared need, arguments, and execution context.
 * @returns Completed rendered artifact or the durable mission's current blocker.
 */
export async function runHardnessMission(input: HardnessMissionInput): Promise<HardnessMissionResult> {
  let result = await runHardnessMissionAttempt(input)
  let attempts = 1
  while (result.kind === 'blocked' && result.retryable === true && attempts < MAX_AUTOMATIC_RECOVERY_ATTEMPTS) {
    attempts += 1
    result = await runHardnessMissionAttempt(input)
  }
  if (result.kind === 'blocked' && result.retryable === true) {
    return {
      kind: 'blocked',
      reason: `${result.reason}; automatic recovery limit reached`,
      status: 'RECOVERING',
      nextAction: 'retry_with_alternative',
    }
  }
  return result
}
