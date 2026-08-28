import type { Context } from '@deepseek-ai/cordis'
import type { HardnessService } from '@deepseek-ai/dsh-hardness/src/types.ts'
import { indexSkills } from './skill-adapter.ts'
import { indexTools } from './tool-adapter.ts'
import { indexOpenClawExtensions } from './openclaw-adapter.ts'
import {
  createHardnessAcquisition,
  createHardnessMissionRunner,
  installHardnessMissionRuntime,
} from './mission-runtime.ts'
import { installHardnessProtocol, type HardnessPromptRegistrar } from './protocol.ts'
import { createHardnessTool } from './hardness-tool.ts'

export { indexTools } from './tool-adapter.ts'
export type { ToolAtlasIndexOptions, ToolChangeSource } from './tool-adapter.ts'
export { indexSkills } from './skill-adapter.ts'
export { indexOpenClawExtensions } from './openclaw-adapter.ts'
export { VisualToolRuntime } from './visual-runtime.ts'
export type { VisualRenderModel, VisualRenderer } from './visual-runtime.ts'
export { PermissionGate } from './permission-gate.ts'
export type { PermissionDecision } from './permission-gate.ts'
export { PermissionBroker } from './permission-broker.ts'
export type { PermissionApprovalOutcome, PermissionApprovalRequest, PermissionBrokerResult } from './permission-broker.ts'
export { createUserApprovalBroker } from './user-approval-broker.ts'
export type { UserApprovalBroker, UserApprovalContext } from './user-approval-broker.ts'
export { LabMode, SelfImprovementLedger } from './lab-mode.ts'
export type { ImprovementRecord, LabExperiment, LabSnapshot } from './lab-mode.ts'
export { executeCapabilityNeed } from './execution-bridge.ts'
export type { CapabilityApproval, CapabilityExecutionContext, CapabilityExecutionResult } from './execution-bridge.ts'
export { ArtifactRuntime, artifactFromToolResult } from './artifact-runtime.ts'
export type { ArtifactRenderModel, CapabilityArtifact } from './artifact-runtime.ts'
export { AcquisitionRegistry } from './acquisition-registry.ts'
export type { AcquisitionResult, CapabilityBuilder, MissionLearningHooks } from './acquisition-registry.ts'
export { installSandboxCapabilityGuard } from './sandbox-guard.ts'
export type { SandboxPolicyResolver } from './sandbox-guard.ts'
export { runHardnessMission } from './mission-orchestrator.ts'
export type { HardnessMissionInput, HardnessMissionResult } from './mission-orchestrator.ts'
export { createHardnessMissionAudit, replayHardnessMissionAudit } from './mission-audit.ts'
export type { HardnessMissionAuditEntry, HardnessMissionAuditOutcome, HardnessMissionAuditWriter } from './mission-audit.ts'
export { installHardnessMissionRuntime, createHardnessAcquisition, createHardnessMissionRunner } from './mission-runtime.ts'
export type { HardnessMissionRpcPayload, HardnessMissionRunner, HardnessMissionRunnerInput, HardnessMissionRuntimeDependencies } from './mission-runtime.ts'
export { createHardnessTool } from './hardness-tool.ts'
export { installHardnessProtocol } from './protocol.ts'
export type { HardnessPromptRegistrar } from './protocol.ts'

/** Base-composition consumer that projects existing registries into HARDNESS. */
export const name = 'hardness-adapters'
export const inject = ['hardness', 'tools', 'skills', 'connection', 'agents', 'approval', 'systemPrompt']

type Disposer = () => void

function disposeAll(disposers: readonly Disposer[]): void {
  for (let index = disposers.length - 1; index >= 0; index--) disposers[index]?.()
}

function requiredServices(ctx: Context) {
  const hardness = ctx.get('hardness') as HardnessService | undefined
  const tools = ctx.get('tools')
  const skills = ctx.get('skills')
  const connection = ctx.get('connection')
  const agents = ctx.get('agents')
  const approval = ctx.get('approval')
  const systemPrompt = ctx.get('systemPrompt') as HardnessPromptRegistrar | undefined
  if (hardness === undefined || tools === undefined || skills === undefined
    || connection === undefined || agents === undefined || approval === undefined || systemPrompt === undefined) {
    throw new Error('hardness-adapters requires hardness, tools, skills, connection, agents, approval, and systemPrompt services')
  }
  return { hardness, tools, skills, connection, agents, approval, systemPrompt }
}

/**
 * Install the HARDNESS projections and mission runtime.
 * @param ctx - Owning Cordis context with HARDNESS dependencies.
 * @returns Idempotent disposer for every projection installed by this adapter.
 */
export async function apply(ctx: Context): Promise<() => void> {
  const { hardness, tools, skills, connection, agents, approval, systemPrompt } = requiredServices(ctx)
  const disposers: Disposer[] = []
  try {
    disposers.push(installHardnessProtocol(systemPrompt))
    disposers.push(indexOpenClawExtensions(hardness))
    disposers.push(indexTools(tools, hardness, { events: ctx, exclude: ['hardness_run'] }))
    disposers.push(await indexSkills(skills, hardness))
    const acquisition = createHardnessAcquisition(hardness)
    const missionRunner = createHardnessMissionRunner({ hardness, tools, acquisition, approval })
    disposers.push(ctx.tools.register(createHardnessTool({ run: missionRunner.run })))
    const missionDispose = installHardnessMissionRuntime({
      connection,
      agents,
      approval,
      hardness,
      tools,
      acquisition,
    })
    disposers.push(() => { void missionDispose() })
  } catch (error) {
    disposeAll(disposers)
    throw error
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    disposeAll(disposers)
  }
}
