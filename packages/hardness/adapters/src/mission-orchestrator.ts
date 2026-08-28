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
import { executeCapabilityNeed } from './execution-bridge.ts'
import {
  artifactFromCapabilityResult,
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
  readonly executor?: CapabilityExecutor
  readonly need: CapabilityNeed
  readonly args: unknown
  readonly context: CapabilityExecutionContext
}

/** Completed artifact output or a governed blocking reason. */
export type HardnessMissionResult =
  | { readonly kind: 'completed'; readonly artifact: CapabilityArtifact; readonly rendered: ArtifactRenderModel }
  | { readonly kind: 'blocked'; readonly reason: string }

type BlockedHardnessMissionResult = Extract<HardnessMissionResult, { readonly kind: 'blocked' }>

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

function quarantine(
  input: HardnessMissionInput,
  surface: CapabilitySurface,
  startedAt: number,
  reason: string,
  artifactRefs: readonly string[] = [],
): BlockedHardnessMissionResult {
  const evidence = input.hardness.recordEvidence(evidenceFor(
    input,
    surface,
    'failed',
    Math.max(0, Date.now() - startedAt),
    artifactRefs,
  ))
  input.hardness.transition(surface.capabilityId, 'quarantined', reason, evidence.id)
  return { kind: 'blocked', reason }
}

function blockedReason(failures: readonly string[], terminal: readonly string[]): string {
  return [...failures, ...terminal].filter(Boolean).join('; ')
}

/**
 * Execute one mission through acquisition, approval, real execution, artifact
 * verification, and evidence-backed promotion or quarantine. Deterministically
 * broken candidates are quarantined and the same bounded mission continues to
 * another already-known or acquirable candidate instead of restarting from
 * scratch. Approval denial and policy/executor blocks remain terminal.
 * @param input - Live services, declared need, arguments, and execution context.
 * @returns Completed rendered artifact or the governed reason the mission was blocked.
 */
export async function runHardnessMission(input: HardnessMissionInput): Promise<HardnessMissionResult> {
  const failures: string[] = []
  const attemptBudget = Math.max(1, input.hardness.list().length + 1)

  for (let attempt = 0; attempt < attemptBudget; attempt += 1) {
    if (input.context.signal.aborted) return { kind: 'blocked', reason: blockedReason(failures, ['capability mission cancelled']) }

    const initial = input.hardness.route(input.need)
    if (initial.kind !== 'route') {
      const acquired = await input.acquisition.acquireOrBuild(input.need, input.context.signal)
      if (acquired.kind !== 'built') {
        return { kind: 'blocked', reason: blockedReason(failures, acquired.reasons) }
      }
    }

    const startedAt = Date.now()
    const execution = await executeCapabilityNeed(
      input.hardness,
      input.tools,
      input.approval,
      input.need,
      input.args,
      input.context,
      input.executor,
    )
    if (execution.kind !== 'executed') {
      return {
        kind: 'blocked',
        reason: blockedReason(failures, [
          execution.kind === 'denied' || execution.kind === 'unsupported'
            ? execution.reason
            : execution.reasons.join('; '),
        ]),
      }
    }

    if (execution.result.isError) {
      const result = quarantine(input, execution.surface, startedAt, execution.result.error.message)
      failures.push(`${execution.surface.capabilityId}: ${result.reason}`)
      continue
    }

    const artifact = artifactFromCapabilityResult(
      execution.result,
      `mission:${String(input.context.callId)}:${execution.surface.capabilityId}`,
    )
    if (artifact === undefined) {
      const result = quarantine(input, execution.surface, startedAt, 'mission produced no valid artifact')
      failures.push(`${execution.surface.capabilityId}: ${result.reason}`)
      continue
    }
    const rendered = input.artifacts.render(artifact)
    if (rendered === undefined) {
      const result = quarantine(
        input,
        execution.surface,
        startedAt,
        `no renderer registered for ${artifact.mime}`,
        [artifact.id],
      )
      failures.push(`${execution.surface.capabilityId}: ${result.reason}`)
      continue
    }

    const evidence = input.hardness.recordEvidence(evidenceFor(
      input,
      execution.surface,
      'passed',
      Math.max(0, Date.now() - startedAt),
      [artifact.id],
    ))
    input.hardness.promoteFromEvidence(evidence.id)
    return { kind: 'completed', artifact, rendered }
  }

  return {
    kind: 'blocked',
    reason: blockedReason(failures, ['capability mission exhausted its bounded candidate budget']),
  }
}
