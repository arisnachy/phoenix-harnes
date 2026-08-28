import type { Context } from '@deepseek-ai/cordis'
import type { HardnessService } from '@deepseek-ai/dsh-hardness/src/types.ts'
import { indexSkills } from './skill-adapter.ts'
import { indexTools } from './tool-adapter.ts'
import { indexOpenClawExtensions } from './openclaw-adapter.ts'
import { createHardnessAcquisition, installHardnessMissionRuntime } from './mission-runtime.ts'

export { indexTools } from './tool-adapter.ts'
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
export { installHardnessMissionRuntime, createHardnessAcquisition } from './mission-runtime.ts'
export type { HardnessMissionRpcPayload, HardnessMissionRuntimeDependencies } from './mission-runtime.ts'
export * from './openclaw/index.ts'

/** Base-composition consumer that projects existing registries into HARDNESS. */
export const name = 'hardness-adapters'
export const inject = ['hardness', 'tools', 'skills', 'connection', 'agents', 'approval']

export async function apply(ctx: Context): Promise<() => void> {
  const hardness = ctx.get('hardness') as HardnessService | undefined
  const tools = ctx.get('tools')
  const skills = ctx.get('skills')
  const connection = ctx.get('connection')
  const agents = ctx.get('agents')
  const approval = ctx.get('approval')
  if (hardness === undefined || tools === undefined || skills === undefined
    || connection === undefined || agents === undefined || approval === undefined) {
    throw new Error('hardness-adapters requires hardness, tools, skills, connection, agents, and approval services')
  }

  const disposeOpenClaw = indexOpenClawExtensions(hardness)
  let disposeTools: (() => void) | undefined
  try {
    disposeTools = indexTools(tools, hardness)
    const disposeSkills = await indexSkills(skills, hardness)
    const missionDispose = installHardnessMissionRuntime({
      connection,
      agents,
      approval,
      hardness,
      tools,
      acquisition: createHardnessAcquisition(hardness),
    })
    return () => {
      disposeSkills()
      disposeTools?.()
      disposeOpenClaw()
      void missionDispose()
    }
  } catch (error) {
    disposeTools?.()
    disposeOpenClaw()
    throw error
  }
}
