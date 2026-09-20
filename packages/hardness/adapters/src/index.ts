import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type { HostConnectionHandle } from '@phoenix-ai/dsh-client-connection'
import type { HardnessService } from '@phoenix-ai/dsh-hardness/src/types.ts'
import type {} from '@phoenix-ai/dsh-mcp-registry'
import type { CodeRuntime } from '@phoenix-ai/dsh-code-runtime'
import { indexSkills } from './skill-adapter.ts'
import { indexTools } from './tool-adapter.ts'
import { indexOpenClawExtensions } from './openclaw-adapter.ts'
import {
  createHardnessAcquisition,
  createHardnessMissionRunner,
  installHardnessMissionRuntime,
} from './mission-runtime.ts'
import { installHardnessProtocol, type HardnessPromptRegistrar } from './protocol.ts'
import { installProactivityProtocol } from './proactivity-protocol.ts'
import { installHumanPresenceProtocol } from './presence-protocol.ts'
import { installConnectorProtocol } from './connector-protocol.ts'
import { installCapabilityOperatingProtocol } from './capability-protocol.ts'
import { acquireProactivityEngine } from './proactivity-registry.ts'
import { createProactivityExecutor, installProactivityRuntime } from './proactivity-runtime.ts'
import { createProactivityTools } from './proactivity-tools.ts'
import { createHardnessTool } from './hardness-tool.ts'
import { createPhoenixVisualizerTool } from './visualize-tool.ts'
import { createCognitiveWorkflowTool } from './cognitive-workflow-tool.ts'
import { createConnectorListTool } from './connector-list-tool.ts'
import { createConnectorDiscoverTool } from './connector-discover-tool.ts'
import type { McpRegistryDiscoveryService } from './connector-discover-tool.ts'
import { createConnectorInstallTool } from './connector-install-tool.ts'
import type { McpRegistryInstallerService } from './connector-install-tool.ts'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import { installResponseHygiene } from './response-hygiene.ts'

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
export type { CapabilityApproval, CapabilityExecutionContext, CapabilityExecutionHooks, CapabilityExecutionResult } from './execution-bridge.ts'
export { ArtifactRuntime, artifactFromToolResult } from './artifact-runtime.ts'
export type { ArtifactRenderModel, CapabilityArtifact, HardnessArtifactExecutionEvent } from './artifact-runtime.ts'
export { AcquisitionRegistry } from './acquisition-registry.ts'
export type { AcquisitionResult, CapabilityBuilder, MissionLearningHooks } from './acquisition-registry.ts'
export { installSandboxCapabilityGuard } from './sandbox-guard.ts'
export type { SandboxPolicyResolver } from './sandbox-guard.ts'
export { runHardnessMission } from './mission-orchestrator.ts'
export type {
  HardnessMissionInput,
  HardnessMissionJudge,
  HardnessMissionJudgeInput,
  HardnessMissionNextAction,
  HardnessMissionResult,
  HardnessMissionStatus,
} from './mission-orchestrator.ts'
export { createDeterministicMissionJudge } from './mission-local-judge.ts'
export { createSubagentMissionJudge, MISSION_JUDGE_OUTPUT_SCHEMA, MISSION_JUDGE_READ_ONLY_TOOLS } from './mission-judge.ts'
export { createHardnessMissionAudit, replayHardnessMissionAudit } from './mission-audit.ts'
export type { HardnessMissionAuditEntry, HardnessMissionAuditOutcome, HardnessMissionAuditWriter } from './mission-audit.ts'
export { createHardnessMissionTelemetry, replayHardnessMissionTelemetry } from './mission-telemetry.ts'
export type { HardnessMissionStepTelemetry, HardnessMissionTelemetry, HardnessMissionTelemetrySnapshot } from './mission-telemetry.ts'
export {
  MISSION_AUTHORITY_PRECEDENCE,
  MissionPersistenceKernel,
  createMissionKernelWriter,
  replayMissionKernel,
  resolveMissionAuthorityConflict,
  replayMissionKernelSession,
} from './mission-kernel.ts'
export type {
  MissionAuthority,
  MissionAuthorityConflict,
  MissionFailureScope,
  MissionCriterion,
  MissionCriterionReview,
  MissionCriterionStatus,
  MissionDeliverable,
  MissionGoalLock,
  MissionJudgeDecision,
  MissionKernelEvent,
  MissionKernelState,
  MissionKernelWriter,
  MissionLearning,
  MissionQualityGate,
  MissionRoute,
  MissionStatus,
  MissionTerminalReason,
} from './mission-kernel.ts'
export { installHardnessMissionRuntime, createHardnessAcquisition, createHardnessMissionRunner } from './mission-runtime.ts'
export type { HardnessMissionRpcPayload, HardnessMissionRunner, HardnessMissionRunnerInput, HardnessMissionRuntimeDependencies } from './mission-runtime.ts'
export { createHardnessTool } from './hardness-tool.ts'
export { createPhoenixVisualizerTool } from './visualize-tool.ts'
export { createCognitiveWorkflowTool } from './cognitive-workflow-tool.ts'
export { createConnectorListTool } from './connector-list-tool.ts'
export { createConnectorDiscoverTool } from './connector-discover-tool.ts'
export { createConnectorInstallTool } from './connector-install-tool.ts'
export type { McpRegistryInstallerService } from './connector-install-tool.ts'
export { installHardnessProtocol } from './protocol.ts'
export type { HardnessPromptRegistrar } from './protocol.ts'
export { CONNECTOR_OPERATING_PROTOCOL, installConnectorProtocol } from './connector-protocol.ts'
export { HUMAN_PRESENCE_PROTOCOL, installHumanPresenceProtocol } from './presence-protocol.ts'
export { CAPABILITY_OPERATING_PROTOCOL, installCapabilityOperatingProtocol } from './capability-protocol.ts'

/** Base-composition consumer that projects existing registries into HARDNESS. */
export const name = 'hardness-adapters'
export const inject = ['hardness', 'tools', 'skills', 'agents', 'approval', 'systemPrompt', 'authorization']

/** HARDNESS mission and durable proactivity configuration. */
export interface Config {
  /** Structured subagent provider used for independent completion review. */
  judgeProvider?: string
  /** Register model-facing HARDNESS tools in this scope. */
  modelTools?: boolean
  /** Durable proactive-task ledger. Empty/omitted uses ~/.dsh/phoenix-tasks.json; :memory: is test-only. */
  taskLedgerPath?: string
  /** How often the host checks for due scheduled work. */
  taskPollMs?: number
  /** One-shot subagent provider used for private preparation and scheduled office work. */
  privateWorkProvider?: string
  /** Maximum retained characters from one private preparation result. */
  privateWorkResultChars?: number
  /** Configured mail identity reference used for office mail sent on the user's behalf. */
  userMailIdentity?: string
  /** Configured mail identity reference Phoenix uses when communicating as itself. */
  harnessMailIdentity?: string
}

/** Schemastery validation for mission and durable proactivity settings. */
export const Config: z<Config> = z.object({
  judgeProvider: z.string().default('spawn'),
  modelTools: z.boolean().default(true),
  taskLedgerPath: z.string().default(''),
  taskPollMs: z.number().default(15_000),
  privateWorkProvider: z.string().default('spawn'),
  privateWorkResultChars: z.number().default(12_000),
  userMailIdentity: z.string().default(''),
  harnessMailIdentity: z.string().default(''),
})

type Disposer = () => void

function disposeAll(disposers: readonly Disposer[]): void {
  for (let index = disposers.length - 1; index >= 0; index--) disposers[index]?.()
}

function requiredServices(ctx: Context) {
  const hardness = ctx.get('hardness') as HardnessService | undefined
  const tools = ctx.get('tools')
  const skills = ctx.get('skills')
  const agents = ctx.get('agents')
  const approval = ctx.get('approval')
  const systemPrompt = ctx.get('systemPrompt') as HardnessPromptRegistrar | undefined
  const authorization = ctx.get('authorization')
  const mcpConnectors = ctx.get('mcpConnectors')
  const pluginInventory = (ctx.get as (name: string) => unknown)('pluginInventory') as
    | (McpRegistryDiscoveryService & Partial<McpRegistryInstallerService>)
    | undefined
  if (hardness === undefined || tools === undefined || skills === undefined
    || agents === undefined || approval === undefined || systemPrompt === undefined) {
    throw new Error('hardness-adapters requires hardness, tools, skills, agents, approval, and systemPrompt services')
  }
  return { hardness, tools, skills, agents, approval, systemPrompt, authorization, mcpConnectors, pluginInventory }
}

function configuredIdentity(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

function taskLedgerPath(config: Config): string {
  const configured = config.taskLedgerPath?.trim()
  return configured !== undefined && configured.length > 0
    ? configured
    : join(homedir(), '.dsh', 'phoenix-tasks.json')
}

/**
 * Install the HARDNESS projections, mission runtime, and durable proactive task system.
 * @param ctx - Owning Cordis context with HARDNESS dependencies.
 * @returns Idempotent disposer for every projection installed by this adapter.
 */
export async function apply(ctx: Context, config: Config): Promise<() => void> {
  const {
    hardness, tools, skills, agents, approval, systemPrompt, authorization, mcpConnectors, pluginInventory,
  } = requiredServices(ctx)
  const modelTools = config.modelTools ?? true
  const disposers: Disposer[] = []
  const proactivity = acquireProactivityEngine(taskLedgerPath(config))
  disposers.push(() => proactivity.release())

  try {
    disposers.push(installHardnessProtocol(systemPrompt))
    if (modelTools) {
      disposers.push(installProactivityProtocol(systemPrompt))
      disposers.push(installHumanPresenceProtocol(systemPrompt))
      disposers.push(installCapabilityOperatingProtocol(systemPrompt))
    }
    if (modelTools && (authorization !== undefined || mcpConnectors !== undefined)) {
      disposers.push(installConnectorProtocol(systemPrompt))
    }

    if (!modelTools) {
      // Capability projections and the mission/proactivity runtimes are host-owned.
      // Do not repeat them when several sessions mount full presets in one process.
      disposers.push(installResponseHygiene(ctx))
      disposers.push(indexOpenClawExtensions(hardness))
      disposers.push(indexTools(tools, hardness, { events: ctx, exclude: ['hardness_run', 'hardness_workflow', 'phoenix_visualize'] }))
      disposers.push(await indexSkills(skills, hardness))
    } else if (authorization !== undefined || mcpConnectors !== undefined) {
      // A preset contributes only its scoped connector inventory/discovery
      // tools; the host remains the sole owner of the HARDNESS capability index.
      disposers.push(ctx.tools.register(createConnectorListTool(authorization, mcpConnectors)))
      disposers.push(ctx.tools.register(createConnectorDiscoverTool(mcpConnectors, pluginInventory)))
      if (pluginInventory?.installMcpRegistryServer !== undefined) {
        disposers.push(ctx.tools.register(createConnectorInstallTool(approval, pluginInventory as McpRegistryInstallerService)))
      }
    }

    const acquisition = createHardnessAcquisition(hardness)
    const codeRuntime = ctx.get('codeRuntime')
    const pythonCodeRuntime = ctx.get('pythonCodeRuntime') as CodeRuntime | undefined
    const subagents = ctx.get('subagents') as Pick<SubagentRuntime, 'getProvider' | 'start'> | undefined
    const missionRunner = createHardnessMissionRunner({
      hardness, tools, acquisition, approval,
      ...(subagents === undefined ? {} : { subagents }),
      ...(config.judgeProvider === undefined ? {} : { judgeProvider: config.judgeProvider }),
      ...(codeRuntime === undefined ? {} : { codeRuntime }),
      ...(pythonCodeRuntime === undefined ? {} : { pythonCodeRuntime }),
    })

    if (modelTools) {
      disposers.push(ctx.tools.register(createCognitiveWorkflowTool()))
      disposers.push(ctx.tools.register(createPhoenixVisualizerTool()))
      disposers.push(ctx.tools.register(createHardnessTool({ run: missionRunner.run })))
      for (const tool of createProactivityTools(proactivity.engine)) {
        disposers.push(ctx.tools.register(tool))
      }
    } else {
      const runtimeConfig = {
        pollMs: config.taskPollMs ?? 15_000,
        privateWorkProvider: config.privateWorkProvider?.trim() || 'spawn',
        privateWorkResultChars: config.privateWorkResultChars ?? 12_000,
        ...(configuredIdentity(config.userMailIdentity) === undefined ? {} : { userMailIdentity: configuredIdentity(config.userMailIdentity)! }),
        ...(configuredIdentity(config.harnessMailIdentity) === undefined ? {} : { harnessMailIdentity: configuredIdentity(config.harnessMailIdentity)! }),
      }
      proactivity.bindExecutor(createProactivityExecutor(agents, subagents, runtimeConfig))
      disposers.push(installProactivityRuntime(ctx, proactivity.engine, runtimeConfig.pollMs))
    }

    if (!modelTools) {
      let activeConnection: HostConnectionHandle | undefined
      let missionDispose: (() => Promise<void>) | undefined
      const syncMissionRuntime = (): void => {
        const connection = ctx.get('connection')
        if (connection === activeConnection) return
        const previousDispose = missionDispose
        activeConnection = undefined
        missionDispose = undefined
        if (previousDispose !== undefined) void previousDispose()
        if (connection === undefined) return
        activeConnection = connection
        missionDispose = installHardnessMissionRuntime({
          connection,
          agents,
          approval,
          hardness,
          tools,
          acquisition,
          ...(codeRuntime === undefined ? {} : { codeRuntime }),
          ...(pythonCodeRuntime === undefined ? {} : { pythonCodeRuntime }),
          ...(subagents === undefined ? {} : { subagents }),
          ...(config.judgeProvider === undefined ? {} : { judgeProvider: config.judgeProvider }),
        })
      }
      syncMissionRuntime()
      disposers.push(ctx.on('internal/service', (serviceName) => {
        if (serviceName === 'connection') syncMissionRuntime()
      }))
      disposers.push(() => {
        const disposeMission = missionDispose
        activeConnection = undefined
        missionDispose = undefined
        if (disposeMission !== undefined) void disposeMission()
      })
    }
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
