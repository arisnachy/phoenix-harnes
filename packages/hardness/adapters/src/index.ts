import { dirname } from 'node:path'
import { installAssistantMail } from './assistant-mail-runtime.ts'
import { AttentionStore } from './proactivity-attention-store.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type { AuthorizationService } from '@phoenix-ai/dsh-authorization'
import { GOOGLE_ACCOUNT_KEY } from '@phoenix-ai/dsh-authorization/google'
import type { HostConnectionHandle } from '@phoenix-ai/dsh-client-connection'
import type { HardnessService } from '@phoenix-ai/dsh-hardness/src/types.ts'
import type {} from '@phoenix-ai/dsh-mcp-registry'
import type {} from '@phoenix-ai/dsh-mcp-connector-registry'
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
import { installWakeProtocol } from './wake-protocol.ts'
import { installHumanPresenceProtocol } from './presence-protocol.ts'
import { installInitiativeContextProjection, type InitiativePromptRegistrar } from './initiative-context.ts'
import { installConnectorProtocol } from './connector-protocol.ts'
import { BinancePaperBroker } from './binance-paper.ts'
import { installBinanceTradingProtocol } from './binance-trading-protocol.ts'
import { createBinanceTradingTools } from './binance-trading-tools.ts'
import type { BinanceAgentOsHostService } from './binance-trading-tools.ts'
import { installCapabilityOperatingProtocol } from './capability-protocol.ts'
import { acquireProactivityEngine } from './proactivity-registry.ts'
import { acquireRealityContext } from './reality-registry.ts'
import { installRealityProtocol } from './reality-protocol.ts'
import { installRealityContextProjection, realityConfigFromEnvironment, type RealityPromptRegistrar } from './reality-context.ts'
import { createRealitySnapshotTool } from './reality-tool.ts'
import { createProactivityExecutor, installProactivityRuntime } from './proactivity-runtime.ts'
import { createProactivityTools } from './proactivity-tools.ts'
import { acquireWakeEngine } from './wake-registry.ts'
import { createWakeExecutor, installWakeRuntime } from './wake-runtime.ts'
import { createWakeTools } from './wake-tools.ts'
import { createRoutineTools } from './routine-tools.ts'
import { installRoutineProtocol } from './routine-protocol.ts'
import { createLearnedSkillTool } from './learned-skill.ts'
import { installConnectorEventBridge } from './connector-event-bridge.ts'
import { createHardnessTool } from './hardness-tool.ts'
import { createPhoenixVisualizerTool } from './visualize-tool.ts'
import { createCognitiveWorkflowTool } from './cognitive-workflow-tool.ts'
import { createConnectorListTool } from './connector-list-tool.ts'
import { createConnectorDiscoverTool } from './connector-discover-tool.ts'
import type { McpRegistryDiscoveryService } from './connector-discover-tool.ts'
import { createConnectorInstallTool, createXMcpActivateTool } from './connector-install-tool.ts'
import type { McpRegistryInstallerService, XMcpHostService } from './connector-install-tool.ts'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import { installOrdinaryCompletionJudgeBridge } from './ordinary-completion-judge.ts'

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
export { installOrdinaryCompletionJudgeBridge, reviewOrdinaryCompletion } from './ordinary-completion-judge.ts'
export type { OrdinaryCompletionJudgeDecision } from './ordinary-completion-judge.ts'
export { createConnectorListTool } from './connector-list-tool.ts'
export { createConnectorDiscoverTool } from './connector-discover-tool.ts'
export { createConnectorInstallTool, createXMcpActivateTool } from './connector-install-tool.ts'
export type { McpRegistryInstallerService, XMcpHostService, XMcpHostSnapshot } from './connector-install-tool.ts'
export { BinancePaperBroker, BinancePublicMarketClient } from './binance-paper.ts'
export type { BinancePaperAccount, BinancePaperState, BinancePaperTrade, BinancePublicMarket } from './binance-paper.ts'
export { BINANCE_TRADING_PROTOCOL, installBinanceTradingProtocol } from './binance-trading-protocol.ts'
export { createBinanceTradingTools } from './binance-trading-tools.ts'
export type { BinanceAgentOsHostService, BinanceAgentOsSnapshot, BinanceTradingToolDependencies } from './binance-trading-tools.ts'
export { installHardnessProtocol } from './protocol.ts'
export type { HardnessPromptRegistrar } from './protocol.ts'
export { CONNECTOR_OPERATING_PROTOCOL, installConnectorProtocol } from './connector-protocol.ts'
export { HUMAN_PRESENCE_PROTOCOL, installHumanPresenceProtocol } from './presence-protocol.ts'
export { WAKE_PROTOCOL, installWakeProtocol } from './wake-protocol.ts'
export { renderInitiativeContext, installInitiativeContextProjection } from './initiative-context.ts'
export { CAPABILITY_OPERATING_PROTOCOL, installCapabilityOperatingProtocol } from './capability-protocol.ts'
export { REALITY_OPERATING_PROTOCOL, installRealityProtocol } from './reality-protocol.ts'
export { RealityContextEngine, installRealityContextProjection, realityConfigFromEnvironment } from './reality-context.ts'
export { createRealitySnapshotTool } from './reality-tool.ts'
export type { RealityContextConfig, RealityPromptRegistrar, RealitySignal, RealitySnapshot } from './reality-context.ts'
export { WakeEngine, JsonWakeStore, MemoryWakeStore, wakeEvent } from './wake-engine.ts'
export type { CreateWakeTriggerInput, WakeDispatchResult, WakeEvent, WakeEventAttribute, WakeExecution, WakeExecutionResult, WakeExecutor, WakeMatcher, WakeMode, WakeTrigger, WakeTriggerHistoryEntry, WakeTriggerStatus } from './wake-engine.ts'
export { createWakeExecutor, installWakeRuntime } from './wake-runtime.ts'
export { createWakeTools, createWakeTriggerTool, createWakeTriggerListTool } from './wake-tools.ts'
export { createRoutineTools } from './routine-tools.ts'
export { ROUTINE_PROTOCOL, installRoutineProtocol } from './routine-protocol.ts'
export { LearnedSkillStore, createLearnedSkillTool } from './learned-skill.ts'
export type { LearnedSkillInput, LearnedSkillReceipt } from './learned-skill.ts'
export { installConnectorEventBridge } from './connector-event-bridge.ts'

/** Base-composition consumer that projects existing registries into HARDNESS. */
export const name = 'hardness-adapters'
export const inject = ['hardness', 'tools', 'skills', 'agents', 'approval', 'systemPrompt', 'authorization']

/** HARDNESS mission and durable proactivity configuration. */
export interface Config {
  /** Structured subagent provider used for independent completion review. */
  judgeProvider?: string
  /** Register model-facing HARDNESS tools in this scope. */
  modelTools?: boolean
  /** Independently review verified substantive ordinary mutations before turn completion. */
  judgeOrdinaryMutations?: boolean
  /** Maximum independent ordinary-task judge passes before deterministic gates take over. */
  maxOrdinaryJudgePasses?: number
  /** Durable proactive-task ledger. Empty/omitted uses ~/.dsh/phoenix-tasks.json; :memory: is test-only. */
  taskLedgerPath?: string
  /** How often the host checks for due scheduled work. */
  taskPollMs?: number
  /** Durable event-driven wake-trigger ledger. Empty/omitted uses ~/.dsh/phoenix-wake-triggers.json; :memory: is test-only. */
  wakeLedgerPath?: string
  /** One-shot subagent provider used for private preparation and scheduled office work. */
  privateWorkProvider?: string
  /** Maximum retained characters from one private preparation result. */
  privateWorkResultChars?: number
  /** Configured mail identity reference used for office mail sent on the user's behalf. */
  userMailIdentity?: string
  /** Local mailbox settings; no provider activity until an owner enrolls. */
  mailDirectory?: string
  /** Credential service reference for the local AgentMail key; never a secret value. */
  mailCredentialRef?: string
  /** Local mailbox reconciliation interval in milliseconds; defaults to 60,000. */
  mailPollMs?: number
  /** Provider request deadline in milliseconds; defaults to 30,000. */
  mailTimeoutMs?: number
  /** Active mail mission deadline in milliseconds; defaults to 600,000 before owner review. */
  mailWorkTimeoutMs?: number
  /** Configured mail identity reference Phoenix uses when communicating as itself. */
  harnessMailIdentity?: string
}

/** Schemastery validation for mission and durable proactivity settings. */
export const Config: z<Config> = z.object({
  judgeProvider: z.string().default('spawn'),
  modelTools: z.boolean().default(true),
  judgeOrdinaryMutations: z.boolean().default(true),
  maxOrdinaryJudgePasses: z.number().step(1).min(1).max(3).default(2),
  taskLedgerPath: z.string().default(''),
  taskPollMs: z.number().default(15_000),
  wakeLedgerPath: z.string().default(''),
  privateWorkProvider: z.string().default('spawn'),
  privateWorkResultChars: z.number().default(12_000),
  userMailIdentity: z.string().default(''),
  harnessMailIdentity: z.string().default(''),
  mailDirectory: z.string().default(''),
  mailCredentialRef: z.string().default('PHOENIX_AGENTMAIL_API_KEY'),
  mailPollMs: z.number().min(1000).default(60_000),
  mailTimeoutMs: z.number().min(1000).default(30_000),
  mailWorkTimeoutMs: z.number().min(1000).default(600_000),
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
    | (McpRegistryDiscoveryService & Partial<McpRegistryInstallerService & BinanceAgentOsHostService & XMcpHostService>)
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

async function connectedGoogleEmail(authorization: AuthorizationService | undefined): Promise<string | undefined> {
  if (authorization === undefined) return undefined
  try {
    const telemetry = await authorization.inspect(GOOGLE_ACCOUNT_KEY)
    if (telemetry?.kind !== 'account' || typeof telemetry.email !== 'string') return undefined
    const email = telemetry.email.trim()
    return email.length > 0 && email.length <= 320 && email.includes('@') && !/\s/u.test(email)
      ? email
      : undefined
  } catch {
    return undefined
  }
}

interface AgentPresetComposer {
  mount(agentCtx: Context, id?: string): Promise<unknown>
}

function persistedAgentPreset(agentCtx: Context): string | undefined {
  const session = agentCtx.agent?.session
  if (session === undefined) return undefined
  const events = session.events as readonly {
    readonly type?: unknown
    readonly data?: unknown
  }[]
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'agent-preset/selected') continue
    const data = event.data
    if (data === null || typeof data !== 'object' || Array.isArray(data)) continue
    const agentPreset = (data as { readonly agentPreset?: unknown }).agentPreset
    if (typeof agentPreset === 'string' && agentPreset.length > 0) return agentPreset
  }
  return session.header.agentPreset
}

async function composeResumedScheduledAgent(ctx: Context, agentCtx: Context): Promise<void> {
  const value = (ctx.get as unknown as (name: string) => unknown)('agentPresets')
  if (value === null || typeof value !== 'object') return
  const composer = value as Partial<AgentPresetComposer>
  if (typeof composer.mount !== 'function') return
  await composer.mount(agentCtx, persistedAgentPreset(agentCtx))
}

function taskLedgerPath(config: Config): string {
  const configured = config.taskLedgerPath?.trim()
  return configured !== undefined && configured.length > 0
    ? configured
    : join(homedir(), '.dsh', 'phoenix-tasks.json')
}

function wakeLedgerPath(config: Config): string {
  const configured = config.wakeLedgerPath?.trim()
  return configured !== undefined && configured.length > 0
    ? configured
    : join(homedir(), '.dsh', 'phoenix-wake-triggers.json')
}

function binancePaperLedgerPath(): string {
  return join(homedir(), '.dsh', 'phoenix-binance-paper.json')
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
  disposers.push(() =>{  proactivity.release() })
  const wake = acquireWakeEngine(wakeLedgerPath(config))
  disposers.push(() =>{  wake.release() })
  const reality = acquireRealityContext(realityConfigFromEnvironment())
  disposers.push(() =>{  reality.release() })

  try {
    disposers.push(installHardnessProtocol(systemPrompt))
    disposers.push(installRealityContextProjection(
      systemPrompt as HardnessPromptRegistrar & RealityPromptRegistrar,
      reality.engine,
      ctx,
    ))
    if (modelTools) {
      disposers.push(installRealityProtocol(systemPrompt))
      disposers.push(installProactivityProtocol(systemPrompt))
      disposers.push(installRoutineProtocol(systemPrompt))
      disposers.push(installWakeProtocol(systemPrompt))
      disposers.push(installHumanPresenceProtocol(systemPrompt))
      disposers.push(installInitiativeContextProjection(
        systemPrompt as HardnessPromptRegistrar & InitiativePromptRegistrar,
        proactivity.engine,
        ctx,
      ))
      disposers.push(installCapabilityOperatingProtocol(systemPrompt))
      disposers.push(installBinanceTradingProtocol(systemPrompt))
    }
    if (modelTools && (authorization !== undefined || mcpConnectors !== undefined)) {
      disposers.push(installConnectorProtocol(systemPrompt))
    }

    if (!modelTools) {
      // Capability projections and the mission/proactivity runtimes are host-owned.
      // Do not repeat them when several sessions mount full presets in one process.
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
      disposers.push(ctx.tools.register(createXMcpActivateTool(approval, pluginInventory)))
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
      if (subagents !== undefined && (config.judgeOrdinaryMutations ?? true)) {
        disposers.push(installOrdinaryCompletionJudgeBridge(ctx, {
          subagents,
          provider: config.judgeProvider?.trim() || 'spawn',
          maxPasses: config.maxOrdinaryJudgePasses ?? 2,
        }))
      }
      disposers.push(ctx.tools.register(createCognitiveWorkflowTool()))
      disposers.push(ctx.tools.register(createPhoenixVisualizerTool()))
      disposers.push(ctx.tools.register(createHardnessTool({ run: missionRunner.run })))
      disposers.push(ctx.tools.register(createRealitySnapshotTool(reality.engine, ctx)))
      for (const tool of createProactivityTools(proactivity.engine, {
        resolveDefaultEmailRecipient: () => connectedGoogleEmail(authorization),
      })) {
        disposers.push(ctx.tools.register(tool))
      }
      for (const tool of createWakeTools(wake.engine)) {
        disposers.push(ctx.tools.register(tool))
      }
      for (const tool of createRoutineTools(proactivity.engine, wake.engine)) {
        disposers.push(ctx.tools.register(tool))
      }
      disposers.push(ctx.tools.register(createLearnedSkillTool()))
      const binancePaper = new BinancePaperBroker(binancePaperLedgerPath())
      for (const tool of createBinanceTradingTools({
        broker: binancePaper,
        approval,
        ...(pluginInventory === undefined ? {} : { agentOs: pluginInventory }),
      })) {
        disposers.push(ctx.tools.register(tool))
      }
    } else {
      const userMailIdentity = configuredIdentity(config.userMailIdentity)
      const harnessMailIdentity = configuredIdentity(config.harnessMailIdentity)
      const runtimeConfig = {
        pollMs: config.taskPollMs ?? 15_000,
        privateWorkProvider: config.privateWorkProvider?.trim() || 'spawn',
        privateWorkResultChars: config.privateWorkResultChars ?? 12_000,
        ...(userMailIdentity === undefined ? {} : { userMailIdentity }),
        ...(harnessMailIdentity === undefined ? {} : { harnessMailIdentity }),
        resolveDefaultMailRecipient: () => connectedGoogleEmail(authorization),
        composeResumedAgent: (agentCtx: Context) => composeResumedScheduledAgent(ctx, agentCtx),
      }
      proactivity.bindExecutor(createProactivityExecutor(agents, subagents, runtimeConfig))
      const mailbox = installAssistantMail(ctx, { directory: config.mailDirectory?.trim() || join(dirname(taskLedgerPath(config)), 'phoenix-mail'), credentialRef: config.mailCredentialRef ?? 'PHOENIX_AGENTMAIL_API_KEY', pollMs: config.mailPollMs ?? 60_000, timeoutMs: config.mailTimeoutMs ?? 30_000, workTimeoutMs: config.mailWorkTimeoutMs ?? 600_000 }, runtimeConfig)
      disposers.push(() => { void mailbox.dispose() })
      disposers.push(installProactivityRuntime(ctx, proactivity.engine, runtimeConfig.pollMs, new AttentionStore(`${taskLedgerPath(config)}.attention.json`), () => mailbox.attention()))
      wake.bindExecutor(createWakeExecutor(agents))
      disposers.push(installWakeRuntime(ctx, wake.engine))
      disposers.push(installConnectorEventBridge(ctx, mcpConnectors))
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
