import type {
  CapabilityEvidence,
  CapabilityNeed,
  CapabilitySurface,
  HardnessService,
} from '@deepseek-ai/dsh-hardness'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
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

/** Dependencies and request data for one governed HARDNESS mission. */
export interface HardnessMissionInput {
  readonly hardness: HardnessService
  readonly acquisition: Pick<AcquisitionRegistry, 'acquireOrBuild'>
  readonly tools: Pick<ToolRuntime, 'execute'>
  readonly approval: CapabilityApproval
  readonly artifacts: Pick<ArtifactRuntime, 'render'>
  readonly audit?: HardnessMissionAuditWriter
  readonly executor?: CapabilityExecutor
  readonly need: CapabilityNeed
  readonly args: unknown
  readonly context: CapabilityExecutionContext
}

/** Completed artifact output or a governed blocking reason. */
export type HardnessMissionResult =
  | { readonly kind: 'completed'; readonly artifact: CapabilityArtifact; readonly rendered: ArtifactRenderModel }
  | { readonly kind: 'blocked'; readonly reason: string }

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
  return { kind: 'blocked', reason: 'HARDNESS audit could not be recorded' }
}

function blocked(
  input: HardnessMissionInput,
  step: HardnessMissionAuditEntry['step'],
  reason: string,
  reasonCode: string,
  extras: Omit<HardnessMissionAuditEntry, 'callId' | 'capabilityKind' | 'step' | 'outcome'> = {},
): HardnessMissionResult {
  if (!auditEntry(input, { step, outcome: 'blocked', reasonCode, ...extras })) return auditUnavailable()
  if (!auditEntry(input, { step: 'audit', outcome: 'completed', reasonCode: 'mission-blocked', ...extras })) return auditUnavailable()
  return { kind: 'blocked', reason }
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
  return { kind: 'blocked', reason }
}

/**
 * Execute one mission through acquisition, approval, real execution, artifact
 * verification, and evidence-backed promotion or quarantine.
 * @param input - Live services, declared need, arguments, and execution context.
 * @returns Completed rendered artifact or the governed reason the mission was blocked.
 */
export async function runHardnessMission(input: HardnessMissionInput): Promise<HardnessMissionResult> {
  if (!auditEntry(input, { step: 'inspect', outcome: 'completed' })) return auditUnavailable()
  const initial = input.hardness.route(input.need)
  if (initial.kind !== 'route') {
    const acquired = await input.acquisition.acquireOrBuild(input.need, input.context.signal)
    if (acquired.kind !== 'built') return blocked(input, 'resolve', acquired.reasons.join('; '), 'capability-unavailable')
  }

  const routed = input.hardness.route(input.need)
  if (routed.kind !== 'route') return blocked(input, 'resolve', routed.reasons.join('; '), 'capability-unavailable')
  const resolvedSurface = input.hardness.surface(routed)
  if (resolvedSurface === undefined) return blocked(input, 'resolve', 'HARDNESS route has no executable surface', 'surface-unavailable')
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
      input.need,
      input.args,
      input.context,
      input.executor,
    )
  } catch {
    return blocked(input, 'execute', 'HARDNESS capability execution failed', 'execution-threw')
  }
  if (execution.kind !== 'executed') {
    if (execution.kind === 'missing') return blocked(input, 'resolve', execution.reasons.join('; '), 'capability-unavailable')
    if (execution.kind === 'denied') return blocked(input, 'approve', execution.reason, 'approval-denied', capability)
    return blocked(input, 'execute', execution.reason, 'executor-unavailable', capability)
  }

  const { surface } = execution
  if (!auditEntry(input, { step: 'approve', outcome: 'completed', ...capability })) return auditUnavailable()
  if (!auditEntry(input, { step: 'execute', outcome: 'completed', ...capability })) return auditUnavailable()

  if (execution.result.isError) {
    return quarantine(input, surface, startedAt, 'execute', execution.result.error.message)
  }

  const artifact = artifactFromToolResult(execution.result)
  if (artifact === undefined) {
    return quarantine(input, surface, startedAt, 'verify', 'mission produced no valid artifact')
  }
  const rendered = input.artifacts.render(artifact)
  if (rendered === undefined) {
    return quarantine(input, surface, startedAt, 'verify', `no renderer registered for ${artifact.mime}`, [artifact.id])
  }

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
  input.hardness.promoteFromEvidence(evidence.id)
  return { kind: 'completed', artifact, rendered }
}
