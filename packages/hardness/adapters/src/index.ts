import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { mailAddress } from './assistant-mail-store.ts'
import { installAssistantMail } from './assistant-mail-runtime.ts'
import type { AssistantMailControl } from './assistant-mail-runtime.ts'
import { createAssistantMailIdentityTool, createAssistantMailSendTool, createAssistantMailInboxTool, createAssistantMailManageTool } from './assistant-mail-tool.ts'
import { installAssistantMailProtocol } from './assistant-mail-protocol.ts'
import { AttentionStore } from './proactivity-attention-store.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type { AuthorizationService } from '@phoenix-ai/dsh-authorization'
import { credentialRef, type CredentialProvider } from '@phoenix-ai/dsh-credentials'
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
import { installHumanOSSelfModel, type HumanOSPromptRegistrar } from './humanos-self-model.ts'
import { installInitiativeContextProjection, type InitiativePromptRegistrar } from './initiative-context.ts'
import { installConnectorProtocol } from './connector-protocol.ts'
import { acquireBinancePaperAutomation } from './binance-paper-automation.ts'
import { mountBinancePaperDashboardRoute } from './binance-paper-route.ts'
import { installBinanceTradingProtocol } from './binance-trading-protocol.ts'
import { createBinanceTradingTools } from './binance-trading-tools.ts'
import { BinanceSpotTestnet, binanceTestnetCredentials } from './binance-spot-testnet.ts'
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
import { wakeEvent } from './wake-engine.ts'
import { createWakeExecutor, installWakeRuntime } from './wake-runtime.ts'
import { createWakeTools } from './wake-tools.ts'
import { createRoutineTools } from './routine-tools.ts'
import { installRoutineProtocol } from './routine-protocol.ts'
import { createLearnedSkillTool } from './learned-skill.ts'
import { installConnectorEventBridge } from './connector-event-bridge.ts'
import { createHardnessTool } from './hardness-tool.ts'
import { createPhoenixVisualizerTool } from './visualize-tool.ts'
import { createPhoenixSceneMapTool } from './scene-map-tool.ts'
import { createPhoenixGeoMapTool } from './geo-map-tool.ts'
import { createPhoenixDiagramTool } from './diagram-tool.ts'
import { createPhoenixCanvasTool } from './canvas-tool.ts'
import { createPhoenixGameTool } from './game-tool.ts'
import { createPhoenixComicTool } from './comic-tool.ts'
import { mountGodotWebRoute, type GameWebRouteHost } from './godot-web-bundle.ts'
import { createPhoenix3DTool } from './scene3d-tool.ts'
import { createResearchPublishTool } from './research-publish-tool.ts'
import { createResearchPlanTool } from './research-plan-tool.ts'
import { createResearchSourceVerifierTool } from './research-source-verifier.ts'
import { createInstitutionRulesTool } from './research-institution-rules.ts'
import { createResearchJournalTool } from './research-journal-profiles.ts'
import { createResearchDeliverTool } from './research-delivery.ts'
import { PHOENIX_3D_ROUTING_PROTOCOL } from './scene3d-routing.ts'
import { createCognitiveWorkflowTool } from './cognitive-workflow-tool.ts'
import { createEvolutionStatusTool } from './evolution-status-tool.ts'
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
export { createPhoenixSceneMapTool, PHOENIX_SCENE_MAP_MIME, admitPhoenixSceneMap, demoIslandMap } from './scene-map-tool.ts'
export { createPhoenixGeoMapTool, PHOENIX_GEO_MAP_MIME, admitPhoenixGeoMap } from './geo-map-tool.ts'
export { createPhoenixDiagramTool, PHOENIX_DIAGRAM_MIME, admitPhoenixDiagram } from './diagram-tool.ts'
export { createPhoenixCanvasTool, PHOENIX_CANVAS_MIME } from './canvas-tool.ts'
export { createPhoenixGameTool, PHOENIX_GAME_MIME } from './game-tool.ts'
export { createPhoenixComicTool, PHOENIX_COMIC_MIME } from './comic-tool.ts'
export { createPhoenix3DTool, PHOENIX_SCENE3D_MIME, tropicalVillaScene } from './scene3d-tool.ts'
export { choosePhoenixDesignMedium, PHOENIX_3D_ROUTING_PROTOCOL } from './scene3d-routing.ts'
export { createCognitiveWorkflowTool } from './cognitive-workflow-tool.ts'
export { createEvolutionStatusTool } from './evolution-status-tool.ts'
export { recoverEvolutionCheckpoint, runEvolutionProbe } from './evolution-runtime.ts'
export type { EvolutionProbeHost, EvolutionProbeResult } from './evolution-runtime.ts'
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
export { inspectHumanOSSelfModel, renderHumanOSSelfModel, installHumanOSSelfModel } from './humanos-self-model.ts'
export type { HumanOSAssemblyContext, HumanOSObservationSources, HumanOSPromptRegistrar, HumanOSSelfModel } from './humanos-self-model.ts'
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
  if (!modelTools) {
    // The HOST, not a scoped agent, owns the HTTP route. Late webServer
    // activation is supported without registering duplicate routes.
    let removeGodotRoute: (() => void) | undefined
    const attachGodotRoute = (): void => {
      if (removeGodotRoute !== undefined) return
      const service = (ctx.get as unknown as (name: string) => unknown)('webServer') as GameWebRouteHost | undefined
      if (service && typeof service.register === 'function') removeGodotRoute = mountGodotWebRoute(service)
    }
    attachGodotRoute()
    disposers.push(ctx.on('internal/service', name => {
      if (name === 'webServer') attachGodotRoute()
    }))
    disposers.push(() => { removeGodotRoute?.() })
  }
  const binance = acquireBinancePaperAutomation(binancePaperLedgerPath())
  const secretProvider = ctx.get('credentials') as CredentialProvider | undefined
  const testnet = new BinanceSpotTestnet(async () => {
    if (secretProvider === undefined) return binanceTestnetCredentials()
    const [key, secret] = await Promise.all([
      secretProvider.resolve(credentialRef('PHOENIX_BINANCE_TESTNET_API_KEY')),
      secretProvider.resolve(credentialRef('PHOENIX_BINANCE_TESTNET_API_SECRET')),
    ])
    return key?.value && secret?.value
      ? { apiKey: key.value, secret: secret.value }
      : undefined
  })
  disposers.push(() => { binance.release() })
  if (!modelTools) {
    // Only the Host publishes PAPER attention events; agent-scoped projections
    // must not create duplicate notifications for the same virtual fill.
    binance.engine.setAttentionSink(event => {
      ctx.emit('phoenix/wake-event', wakeEvent({
        id: 'binance-paper:' + randomUUID(),
        source: 'phoenix-trading',
        eventType: 'paper.attention',
        summary: event.detail,
        attributes: { kind: event.kind, symbol: event.symbol, mode: 'paper' },
      }))
    })
    disposers.push(() => { binance.engine.setAttentionSink(undefined) })
    await binance.engine.restore()
  }
  if (!modelTools) {
    let removeTradingRoute: (() => void) | undefined
    const mountTradingRoute = (): void => {
      if (removeTradingRoute !== undefined) return
      const server = (ctx.get as unknown as (name: string) => unknown)('webServer') as GameWebRouteHost | undefined
      if (server?.register !== undefined) removeTradingRoute = mountBinancePaperDashboardRoute(server, binance.engine, { testnet, ...(secretProvider === undefined ? {} : { credentials: secretProvider }) })
    }
    mountTradingRoute()
    disposers.push(ctx.on('internal/service', name => {
      if (name === 'webServer') mountTradingRoute()
    }))
    disposers.push(() => { removeTradingRoute?.() })
  }
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
      disposers.push(installAssistantMailProtocol(systemPrompt))
      disposers.push(installRoutineProtocol(systemPrompt))
      disposers.push(installWakeProtocol(systemPrompt))
      disposers.push(installHumanPresenceProtocol(systemPrompt))
      disposers.push(installHumanOSSelfModel(
        systemPrompt as HardnessPromptRegistrar & HumanOSPromptRegistrar,
        { hardness, tasks: proactivity.engine },
      ))
      disposers.push(installInitiativeContextProjection(
        systemPrompt as HardnessPromptRegistrar & InitiativePromptRegistrar,
        proactivity.engine,
        ctx,
      ))
      disposers.push(installCapabilityOperatingProtocol(systemPrompt))
      disposers.push(systemPrompt.section({ name: 'phoenix:3d-intent-router', order: 176, text: PHOENIX_3D_ROUTING_PROTOCOL }))
      disposers.push(systemPrompt.section({ name: 'phoenix:map-publication-router', order: 178, text: 'For ALL requests to create or show an imaginary or fictional interactive map, island, fantasy world, game map or Isla Bruma, immediately CALL the phoenix_scene_map tool: demo:true for a requested demonstration, or map:{places:[{id,name,x,y,kind,description}],routes:[]} for custom worlds. This tool publishes a real replayable chat artifact; NEVER merely say you published the map, NEVER open MiniBrowser or an about:blank tab to verify. Tool execution and artifactId prove emission only, not client rendering. AFTER a successful tool result, provide a short final assistant message acknowledging the real artifact ID. Do not claim screen verification without it. Geographic WGS84 real-world tasks must use the geo engine, not the fictional scene tool.' }))
      disposers.push(systemPrompt.section({ name: 'phoenix:geographic-map-publication-router', order: 179, text: 'For requests to CREATE or SHOW real-world geographic interactive maps (provinces, countries, public-health areas, businesses, logistics), call the phoenix_geo_map tool with verified WGS84 coordinates, documented source and data. The tool creates a native chat artifact. NEVER claim publication based only on prose or an empty browser. For local clinical-study evidence, do not claim province-wide prevalence or fabricate a ranking. If comparable regional data or coordinates are absent, state the limitation and do not invent a map. The returned artifactId confirms payload emission only, not visible client rendering. phoenix_scene_map is only for fictional worlds.' }))
      disposers.push(systemPrompt.section({ name: 'phoenix:diagram-publication-router', order: 180, text: 'When the user requests a genogram, flowchart, organization chart, mind map, relationship network or node-based diagram, use phoenix_diagram and produce a native chat artifact. Do not use MiniBrowser, unrendered JSON, or an unsupported claim of screen verification. Respect user-supplied family and clinical facts. For geographic maps use phoenix_geo_map; fictional worlds use phoenix_scene_map.' }))
      disposers.push(systemPrompt.section({ name: 'phoenix:comic-intent-router', order: 177, text: 'When asked to CREATE, SHOW or CONTINUE a comic, manga, illustrated story or webtoon, deliver an actual illustrated comic in the chat via phoenix_comic. For resumed, interrupted or timed-out comic generation, FIRST inspect the durable Comic Studio recovery journal via node scripts/phoenix-comic-recovery.mjs status SERIES ISSUE [workspace], preserve previous assets and plan, record every original tool result via record before retrying, and accept only inspected real files via accept. Never fabricate Canva design_id/image_id/asset_id or retry a rejected ID by guessing another format. Retry only missing slots with an actually available image provider, never restart a whole edition or claim success based on malformed JSON. Use real image-generation for panel art; compile the comic with the durable Comic Studio script and publish its verified release by series_id + issue_id. Never open the Phoenix application itself (127.0.0.1:3080 or localhost) inside MiniBrowser for a creative task. Never claim published unless phoenix_comic succeeded and returned an artifactId. Before each final comic illustration, load the matching project and issue using scripts/phoenix-comic-canon.mjs show and packet; use a locked, explicitly user-approved creative canon. Treat generated artwork and visual examples as distinct evidence, never merge separate comic series, and never silently approve an art direction. Canva is strictly a layout assistant: packet SLOT canva has allowRegeneration:false. Keep exact canonDigest in the image-generation attempt and recovery approvals, and flag pre-lock artwork for visual review rather than assuming it matches the canon. If real artwork cannot be produced, describe that exact blocker instead of claiming success. This rule is specific to comics; it does not interfere with other domains.' }))
      disposers.push(installBinanceTradingProtocol(systemPrompt))
    }
    if (modelTools && (authorization !== undefined || mcpConnectors !== undefined)) {
      disposers.push(installConnectorProtocol(systemPrompt))
    }

    if (!modelTools) {
      // Capability projections and the mission/proactivity runtimes are host-owned.
      // Do not repeat them when several sessions mount full presets in one process.
      disposers.push(indexOpenClawExtensions(hardness))
      disposers.push(indexTools(tools, hardness, { events: ctx, exclude: ['hardness_run', 'hardness_workflow', 'hardness_evolution_status', 'phoenix_visualize', 'phoenix_scene_map', 'phoenix_geo_map', 'phoenix_diagram', 'phoenix_canvas', 'phoenix_game', 'phoenix_comic'] }))
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
      disposers.push(ctx.tools.register(createEvolutionStatusTool()))
      disposers.push(ctx.tools.register(createPhoenixVisualizerTool()))
      disposers.push(ctx.tools.register(createPhoenixSceneMapTool()))
      disposers.push(ctx.tools.register(createPhoenixGeoMapTool()))
      disposers.push(ctx.tools.register(createPhoenixDiagramTool()))
      disposers.push(ctx.tools.register(createPhoenixCanvasTool()))
      disposers.push(ctx.tools.register(createPhoenixGameTool()))
      disposers.push(ctx.tools.register(createPhoenixComicTool()))
      disposers.push(ctx.tools.register(createPhoenix3DTool()))
      disposers.push(ctx.tools.register(createResearchPlanTool()))
      disposers.push(ctx.tools.register(createResearchSourceVerifierTool()))
      disposers.push(ctx.tools.register(createInstitutionRulesTool(approval)))
      disposers.push(ctx.tools.register(createResearchJournalTool()))
      disposers.push(ctx.tools.register(createResearchPublishTool()))
      disposers.push(ctx.tools.register(createResearchDeliverTool({
        ctx, approval,
        mailbox: () => (ctx.get as unknown as (name: string) => unknown)('assistantMail') as AssistantMailControl | undefined,
        mailCredentialRef: config.mailCredentialRef ?? 'PHOENIX_AGENTMAIL_API_KEY',
      })))
      disposers.push(ctx.tools.register(createHardnessTool({ run: missionRunner.run })))
      disposers.push(ctx.tools.register(createRealitySnapshotTool(reality.engine, ctx)))
      const resolveMailbox = () => (ctx.get as unknown as (name: string) => unknown)('assistantMail') as AssistantMailControl | undefined
      disposers.push(ctx.tools.register(createAssistantMailIdentityTool(resolveMailbox)))
      disposers.push(ctx.tools.register(createAssistantMailSendTool(resolveMailbox)))
      disposers.push(ctx.tools.register(createAssistantMailInboxTool(resolveMailbox)))
      disposers.push(ctx.tools.register(createAssistantMailManageTool(resolveMailbox)))
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
      const binancePaper = binance.engine.broker
      for (const tool of createBinanceTradingTools({
        broker: binancePaper,
        automation: binance.engine,
        wake: wake.engine,
        testnet,
        approval,
        ...(pluginInventory === undefined ? {} : { agentOs: pluginInventory }),
      })) {
        disposers.push(ctx.tools.register(tool))
      }
    } else {
      const userMailIdentity = configuredIdentity(config.userMailIdentity)
      const harnessMailIdentity = configuredIdentity(config.harnessMailIdentity)
      const baseRuntimeConfig = {
        pollMs: config.taskPollMs ?? 15_000,
        privateWorkProvider: config.privateWorkProvider?.trim() || 'spawn',
        privateWorkResultChars: config.privateWorkResultChars ?? 12_000,
        ...(userMailIdentity === undefined ? {} : { userMailIdentity }),
        ...(harnessMailIdentity === undefined ? {} : { harnessMailIdentity }),
        resolveDefaultMailRecipient: () => connectedGoogleEmail(authorization),
        composeResumedAgent: (agentCtx: Context) => composeResumedScheduledAgent(ctx, agentCtx),
      }
      const mailbox = installAssistantMail(ctx, {
        directory: config.mailDirectory?.trim() || join(dirname(taskLedgerPath(config)), 'phoenix-mail'),
        credentialRef: config.mailCredentialRef ?? 'PHOENIX_AGENTMAIL_API_KEY',
        pollMs: config.mailPollMs ?? 60_000,
        timeoutMs: config.mailTimeoutMs ?? 30_000,
        workTimeoutMs: config.mailWorkTimeoutMs ?? 600_000,
        resolveOwnerEmail: () => connectedGoogleEmail(authorization),
        authorizeOutgoing: async (ownership) => {
          const task = await proactivity.engine.get(ownership.taskId)
          if (task === undefined || (task.status !== 'scheduled' && task.status !== 'running')
            || task.delivery !== 'email' || task.senderIdentity === 'user') return false
          if (ownership.idempotencyKey !== `${task.id}:deliver:${ownership.scheduledFor}`
            || Date.parse(ownership.scheduledFor) < Date.parse(task.nextRunAt)) return false
          if (task.history.some(row => row.phase === 'deliver' && row.scheduledFor === ownership.scheduledFor && row.status === 'completed')) return false
          return task.recipient === undefined || mailAddress(task.recipient) === ownership.to
        },
      }, baseRuntimeConfig)
      const runtimeConfig = {
        ...baseRuntimeConfig,
        mailReady: (key: string) => mailbox.preflight(key),
        sendMail: async (input: {
          readonly taskId: string
          readonly scheduledFor: string
          readonly to: string
          readonly subject: string
          readonly text: string
          readonly idempotencyKey: string
        }) => { await mailbox.send(input) },
      }
      proactivity.bindExecutor(createProactivityExecutor(agents, subagents, runtimeConfig))
      disposers.push(() => { void mailbox.dispose() })
      disposers.push(installProactivityRuntime(
        ctx,
        proactivity.engine,
        runtimeConfig.pollMs,
        new AttentionStore(`${taskLedgerPath(config)}.attention.json`),
        () => mailbox.attention(),
      ))
      wake.bindExecutor(createWakeExecutor(agents, {
        composeResumedAgent: (agentCtx: Context) => composeResumedScheduledAgent(ctx, agentCtx),
      }))
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

export { GeneralizationReceiptBridge, verifyTrustedMissionReceipt } from './generalization-receipts.ts'
export type { TrustedEvaluationReceipt, GeneralizationReceiptReader, GeneralizationComparison } from './generalization-receipts.ts'
