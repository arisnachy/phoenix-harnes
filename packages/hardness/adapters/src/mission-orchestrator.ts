import type { HardnessService, CapabilityNeed } from '@deepseek-ai/dsh-hardness'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { CapabilityApproval, CapabilityExecutionContext } from './execution-bridge.ts'
import { executeCapabilityNeed } from './execution-bridge.ts'
import { artifactFromToolResult, type ArtifactRenderModel, type CapabilityArtifact, type ArtifactRuntime } from './artifact-runtime.ts'
import type { AcquisitionRegistry } from './acquisition-registry.ts'

export interface HardnessMissionInput {
  readonly hardness: HardnessService
  readonly acquisition: Pick<AcquisitionRegistry, 'acquireOrBuild'>
  readonly tools: Pick<ToolRuntime, 'execute'>
  readonly approval: CapabilityApproval
  readonly artifacts: Pick<ArtifactRuntime, 'render'>
  readonly need: CapabilityNeed
  readonly args: unknown
  readonly context: CapabilityExecutionContext
}

export type HardnessMissionResult =
  | { readonly kind: 'completed'; readonly artifact: CapabilityArtifact; readonly rendered: ArtifactRenderModel }
  | { readonly kind: 'blocked'; readonly reason: string }

/** Execute one mission through the governed HARDNESS lifecycle. */
export async function runHardnessMission(input: HardnessMissionInput): Promise<HardnessMissionResult> {
  const initial = input.hardness.route(input.need)
  if (initial.kind !== 'route') {
    const acquired = await input.acquisition.acquireOrBuild(input.need)
    if (acquired.kind !== 'built') return { kind: 'blocked', reason: acquired.reasons.join('; ') }
  }
  const execution = await executeCapabilityNeed(input.hardness, input.tools, input.approval, input.need, input.args, input.context)
  if (execution.kind !== 'executed') return { kind: 'blocked', reason: execution.kind === 'denied' || execution.kind === 'unsupported' ? execution.reason : execution.reasons.join('; ') }
  const artifact = artifactFromToolResult(execution.result)
  if (artifact === undefined) return { kind: 'blocked', reason: 'verified mission produced no valid artifact' }
  const rendered = input.artifacts.render(artifact)
  if (rendered === undefined) return { kind: 'blocked', reason: `no renderer registered for ${artifact.mime}` }
  return { kind: 'completed', artifact, rendered }
}
