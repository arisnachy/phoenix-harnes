/** Independent adversarial verification executed before the final completion judge. */

import type { Agent } from '@phoenix-ai/dsh-agent'
import type { ContentBlock, LlmRuntime } from '@phoenix-ai/dsh-llm'
import { LivingCreationId, livingLevelRank, type LivingRegistry } from '@phoenix-ai/dsh-living'
import type { QualityInnovation, QualityScenario, RiskForecast } from '@phoenix-ai/dsh-quality'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@phoenix-ai/dsh-tools'
import { resolveGoalJudgeAgentOptions } from './judge-route.ts'

/** Machine verdict for one independently checked completion dimension. */
export type CompletionCheckStatus = 'pass' | 'fail' | 'blocked'
/** Requirement-level evidence state used by the completion ledger. */
export type CompletionEvidenceStatus = 'pending' | 'implemented' | 'tested' | 'verified' | 'failed' | 'blocked_external'

/** Six machine-required checks that must all pass before DONE is possible. */
export interface CompletionGateChecks {
  readonly requirements: CompletionCheckStatus
  readonly builderTests: CompletionCheckStatus
  readonly adversarialTests: CompletionCheckStatus
  readonly startup: CompletionCheckStatus
  readonly artifactIntegrity: CompletionCheckStatus
  readonly cleanRoom: CompletionCheckStatus
}

/** One original requirement mapped to independent evidence. */
export interface CompletionEvidenceEntry {
  readonly criterionId: string
  readonly criterion: string
  readonly mandatory: boolean
  readonly status: CompletionEvidenceStatus
  readonly evidence: readonly string[]
}

/** Durable-worthy evidence returned by the adversarial tester. */
export interface GoalCompletionGateResult {
  readonly checks: CompletionGateChecks
  readonly evidenceLedger: readonly CompletionEvidenceEntry[]
  readonly artifactFingerprint: string
  readonly cleanRoomEvidence: string
  readonly findings: readonly string[]
  readonly proceduralLessons: readonly string[]
  /** True when the richer edge-case/forecast/innovation analysis is structurally complete and truthful. */
  readonly foresightComplete: boolean
  readonly realWorldScenarios: readonly QualityScenario[]
  readonly riskForecasts: readonly RiskForecast[]
  readonly innovationOpportunity: QualityInnovation
}

interface AdversarialCase {
  readonly name: string
  readonly purpose: string
}

type CompletionRuntime = Pick<SubagentRuntime, 'getProvider' | 'start'>
  & Partial<Pick<SubagentRuntime, 'list'>>
type LivingReadRuntime = Pick<LivingRegistry, 'inspect' | 'readState'>

const MAX_TEXT = 2_000
const MAX_ITEMS = 32
const EXECUTION_TOOLS = ['bash', 'read', 'read_image', 'glob', 'grep', 'living_inspect_creation', 'living_read_state', 'living_verify_creation'] as const
const EVIDENCE_STATUSES = ['pending', 'implemented', 'tested', 'verified', 'failed', 'blocked_external'] as const
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
const SCENARIO_STATUSES = ['pending', 'pass', 'fail', 'untested', 'accepted-risk'] as const
const EVIDENCE_KINDS = ['static', 'simulated', 'live'] as const
const RISK_LEVELS = ['low', 'medium', 'high'] as const
const FORECAST_STATUSES = ['open', 'mitigated', 'accepted', 'confirmed', 'contradicted', 'unknown'] as const
const INNOVATION_STATUSES = ['pending', 'implemented', 'offered', 'not-applicable'] as const

const DESIGN_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cases: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          purpose: { type: 'string' },
        },
        required: ['name', 'purpose'],
      },
    },
  },
  required: ['cases'],
}

const EXECUTION_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    checks: {
      type: 'object',
      additionalProperties: false,
      properties: {
        requirements: { type: 'string', enum: ['pass', 'fail', 'blocked'] },
        builder_tests: { type: 'string', enum: ['pass', 'fail', 'blocked'] },
        adversarial_tests: { type: 'string', enum: ['pass', 'fail', 'blocked'] },
        startup: { type: 'string', enum: ['pass', 'fail', 'blocked'] },
        artifact_integrity: { type: 'string', enum: ['pass', 'fail', 'blocked'] },
        clean_room: { type: 'string', enum: ['pass', 'fail', 'blocked'] },
      },
      required: ['requirements', 'builder_tests', 'adversarial_tests', 'startup', 'artifact_integrity', 'clean_room'],
    },
    evidence_ledger: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          criterion_id: { type: 'string' },
          criterion: { type: 'string' },
          mandatory: { type: 'boolean' },
          status: { type: 'string', enum: [...EVIDENCE_STATUSES] },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: ['criterion_id', 'criterion', 'mandatory', 'status', 'evidence'],
      },
    },
    artifact_fingerprint: { type: 'string' },
    clean_room_evidence: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    procedural_lessons: { type: 'array', items: { type: 'string' } },
    real_world_scenarios: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' }, title: { type: 'string' },
          severity: { type: 'string', enum: [...SEVERITIES] },
          status: { type: 'string', enum: [...SCENARIO_STATUSES] },
          evidence_kind: { type: 'string', enum: [...EVIDENCE_KINDS] },
          evidence: { type: 'array', items: { type: 'string' } },
          authority_ref: { type: 'string' }, blocker: { type: 'string' },
        },
        required: ['id', 'title', 'severity', 'status', 'evidence_kind', 'evidence'],
      },
    },
    risk_forecasts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' }, scenario: { type: 'string' },
          likelihood: { type: 'string', enum: [...RISK_LEVELS] },
          confidence: { type: 'string', enum: [...RISK_LEVELS] },
          impact: { type: 'string', enum: [...SEVERITIES] },
          evidence: { type: 'array', items: { type: 'string' } },
          mitigation: { type: 'string' }, status: { type: 'string', enum: [...FORECAST_STATUSES] },
        },
        required: ['id', 'scenario', 'likelihood', 'confidence', 'impact', 'evidence', 'mitigation', 'status'],
      },
    },
    innovation: {
      type: 'object', additionalProperties: false,
      properties: {
        status: { type: 'string', enum: [...INNOVATION_STATUSES] },
        rationale: { type: 'string' },
        evidence: { type: 'array', items: { type: 'string' } },
      },
      required: ['status', 'rationale', 'evidence'],
    },
  },
  required: ['checks', 'evidence_ledger', 'artifact_fingerprint', 'clean_room_evidence', 'findings', 'procedural_lessons'],
}

function normalizedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= MAX_TEXT
}

function normalizedMaybeEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length <= MAX_TEXT
}

function normalizedList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_ITEMS && value.every(normalizedText)
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : undefined
}

function readCases(value: unknown): AdversarialCase[] | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const cases = (value as { cases?: unknown }).cases
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > MAX_ITEMS) return undefined
  const parsed: AdversarialCase[] = []
  for (const item of cases) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return undefined
    const record = item as Record<string, unknown>
    if (!normalizedText(record.name) || !normalizedText(record.purpose)) return undefined
    parsed.push({ name: record.name, purpose: record.purpose })
  }
  return parsed
}

function check(value: unknown): CompletionCheckStatus | undefined {
  return value === 'pass' || value === 'fail' || value === 'blocked' ? value : undefined
}

function evidenceStatus(value: unknown): CompletionEvidenceStatus | undefined {
  return typeof value === 'string' && EVIDENCE_STATUSES.includes(value as CompletionEvidenceStatus)
    ? value as CompletionEvidenceStatus
    : undefined
}

function readLedger(value: unknown): CompletionEvidenceEntry[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEMS) return undefined
  const entries: CompletionEvidenceEntry[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return undefined
    const record = item as Record<string, unknown>
    const status = evidenceStatus(record.status)
    if (!normalizedText(record.criterion_id) || !normalizedText(record.criterion)
      || typeof record.mandatory !== 'boolean' || status === undefined || !normalizedList(record.evidence)) return undefined
    entries.push({
      criterionId: record.criterion_id,
      criterion: record.criterion,
      mandatory: record.mandatory,
      status,
      evidence: record.evidence,
    })
  }
  return entries
}

function readScenarios(value: unknown): QualityScenario[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return undefined
  const result: QualityScenario[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return undefined
    const record = item as Record<string, unknown>
    const severity = enumValue(record.severity, SEVERITIES)
    const status = enumValue(record.status, SCENARIO_STATUSES)
    const evidenceKind = enumValue(record.evidence_kind, EVIDENCE_KINDS)
    if (!normalizedText(record.id) || !normalizedText(record.title) || severity === undefined || status === undefined
      || evidenceKind === undefined || !normalizedList(record.evidence)) return undefined
    if (record.authority_ref !== undefined && !normalizedText(record.authority_ref)) return undefined
    if (record.blocker !== undefined && !normalizedText(record.blocker)) return undefined
    result.push({
      id: record.id, title: record.title, severity, status, evidenceKind, evidence: record.evidence,
      ...typeof record.authority_ref === 'string' ? { authorityRef: record.authority_ref } : {},
      ...typeof record.blocker === 'string' ? { blocker: record.blocker } : {},
    })
  }
  return result
}

function readForecasts(value: unknown): RiskForecast[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return undefined
  const result: RiskForecast[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return undefined
    const record = item as Record<string, unknown>
    const likelihood = enumValue(record.likelihood, RISK_LEVELS)
    const confidence = enumValue(record.confidence, RISK_LEVELS)
    const impact = enumValue(record.impact, SEVERITIES)
    const status = enumValue(record.status, FORECAST_STATUSES)
    if (!normalizedText(record.id) || !normalizedText(record.scenario) || likelihood === undefined
      || confidence === undefined || impact === undefined || status === undefined || !normalizedList(record.evidence)
      || !normalizedMaybeEmpty(record.mitigation)) return undefined
    result.push({
      id: record.id, scenario: record.scenario, likelihood, confidence, impact,
      evidence: record.evidence, mitigation: record.mitigation, status,
    })
  }
  return result
}

function readInnovation(value: unknown): QualityInnovation | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const status = enumValue(record.status, INNOVATION_STATUSES)
  if (status === undefined || !normalizedText(record.rationale) || !normalizedList(record.evidence)) return undefined
  return { status, rationale: record.rationale, evidence: record.evidence }
}

function readExecution(value: unknown): GoalCompletionGateResult | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const checksValue = record.checks
  if (checksValue === null || typeof checksValue !== 'object' || Array.isArray(checksValue)) return undefined
  const checks = checksValue as Record<string, unknown>
  const requirements = check(checks.requirements)
  const builderTests = check(checks.builder_tests)
  const adversarialTests = check(checks.adversarial_tests)
  const startup = check(checks.startup)
  const artifactIntegrity = check(checks.artifact_integrity)
  const cleanRoom = check(checks.clean_room)
  const evidenceLedger = readLedger(record.evidence_ledger)
  if (requirements === undefined || builderTests === undefined || adversarialTests === undefined
    || startup === undefined || artifactIntegrity === undefined || cleanRoom === undefined
    || evidenceLedger === undefined
    || !normalizedText(record.artifact_fingerprint)
    || !normalizedText(record.clean_room_evidence)
    || !normalizedList(record.findings)
    || !normalizedList(record.procedural_lessons)) return undefined

  const scenarios = record.real_world_scenarios === undefined ? [] : readScenarios(record.real_world_scenarios)
  const forecasts = record.risk_forecasts === undefined ? [] : readForecasts(record.risk_forecasts)
  const innovation = record.innovation === undefined ? undefined : readInnovation(record.innovation)
  if (scenarios === undefined || forecasts === undefined || (record.innovation !== undefined && innovation === undefined)) return undefined

  const liveAuthorityFindings = scenarios
    .filter(item => item.evidenceKind === 'live' && item.status === 'pass' && item.authorityRef === undefined)
    .map(item => `Claimed live evidence for ${item.id} lacks an authoritative runtime authority reference.`)
  const foresightComplete = record.real_world_scenarios !== undefined
    && record.risk_forecasts !== undefined
    && innovation !== undefined
    && liveAuthorityFindings.length === 0

  return {
    checks: { requirements, builderTests, adversarialTests, startup, artifactIntegrity, cleanRoom },
    evidenceLedger,
    artifactFingerprint: record.artifact_fingerprint,
    cleanRoomEvidence: record.clean_room_evidence,
    findings: [...record.findings, ...liveAuthorityFindings],
    proceduralLessons: record.procedural_lessons,
    foresightComplete,
    realWorldScenarios: scenarios,
    riskForecasts: forecasts,
    innovationOpportunity: innovation ?? {
      status: 'pending', rationale: 'Foresight and innovation evidence was not supplied by this verifier.', evidence: [],
    },
  }
}

/**
 * Check whether every legacy required completion dimension has concrete evidence.
 * Rich quality readiness is enforced separately so older sessions remain replayable.
 */
export function completionGatePassed(result: GoalCompletionGateResult): boolean {
  return Object.values(result.checks).every(value => value === 'pass')
    && result.evidenceLedger.length > 0
    && result.evidenceLedger.some(entry => entry.mandatory)
    && result.evidenceLedger.every(entry => !entry.mandatory || entry.status === 'verified')
    && result.artifactFingerprint.length > 0
    && result.cleanRoomEvidence.length > 0
}

function unavailable(reason: string): GoalCompletionGateResult {
  return {
    checks: {
      requirements: 'blocked', builderTests: 'blocked', adversarialTests: 'blocked',
      startup: 'blocked', artifactIntegrity: 'blocked', cleanRoom: 'blocked',
    },
    evidenceLedger: [{
      criterionId: 'VERIFIER-INFRA',
      criterion: 'Independent verifier infrastructure is available.',
      mandatory: true,
      status: 'blocked_external',
      evidence: [reason],
    }],
    artifactFingerprint: 'unavailable',
    cleanRoomEvidence: reason,
    findings: [reason],
    proceduralLessons: [`Completion verification workflow failed: ${reason}`],
    foresightComplete: false,
    realWorldScenarios: [],
    riskForecasts: [],
    innovationOpportunity: { status: 'pending', rationale: 'Independent verifier is unavailable.', evidence: [] },
  }
}

function reviewProvider(runtime: CompletionRuntime, requested: string, parent: Agent): string | undefined {
  const nonCodex = parent.options.provider !== 'openai-codex'
  const names = [...new Set([requested, ...(runtime.list?.() ?? [])])]
  const candidates = names.flatMap((name) => {
    if (nonCodex && name.toLowerCase() === 'luna') return []
    const provider = runtime.getProvider(name)
    if (provider === undefined || !provider.capabilities.outputSchema || !provider.capabilities.toolFilter) return []
    return [{ name, inheritsParentContext: provider.inheritsParentContext }]
  })
  return candidates.find(candidate => !candidate.inheritsParentContext)?.name ?? candidates[0]?.name
}

async function runStructured(
  runtime: CompletionRuntime,
  provider: string,
  request: Parameters<CompletionRuntime['start']>[1],
): Promise<unknown | undefined> {
  let run
  try {
    run = await runtime.start(provider, request)
    const result = await run.result
    return result.stopReason === 'completed' ? result.structured : undefined
  } catch {
    return undefined
  } finally {
    if (run !== undefined) await run.dispose()
  }
}

async function verifyLivingEvidence(
  result: GoalCompletionGateResult,
  living: LivingReadRuntime | undefined,
): Promise<GoalCompletionGateResult> {
  const scenarios: QualityScenario[] = []
  const findings = [...result.findings]
  let valid = true
  for (const scenario of result.realWorldScenarios) {
    if (scenario.evidenceKind !== 'live' || scenario.status !== 'pass') {
      scenarios.push(scenario)
      continue
    }
    const reference = scenario.authorityRef
    if (reference === undefined || !reference.startsWith('living:') || reference.slice('living:'.length).trim().length === 0) {
      valid = false
      const blocker = `Live scenario ${scenario.id} does not name a valid living:<creation-id> authority.`
      findings.push(blocker)
      scenarios.push({ ...scenario, status: 'untested', blocker })
      continue
    }
    if (living === undefined) {
      valid = false
      const blocker = `Live scenario ${scenario.id} cannot be verified because the living registry is unavailable.`
      findings.push(blocker)
      scenarios.push({ ...scenario, status: 'untested', blocker })
      continue
    }
    const rawId = reference.slice('living:'.length)
    try {
      const id = LivingCreationId(rawId)
      const snapshot = living.inspect(id)
      if (!snapshot.connected) throw new Error(`living creation ${rawId} is offline`)
      if (livingLevelRank(snapshot.achievedLevel) < livingLevelRank(snapshot.manifest.targetLevel)) {
        throw new Error(`living creation ${rawId} achieves ${snapshot.achievedLevel}, below target ${snapshot.manifest.targetLevel}`)
      }
      if (snapshot.manifest.state.length > 0) await living.readState(id)
      scenarios.push(scenario)
    } catch (error) {
      valid = false
      const detail = error instanceof Error ? error.message : String(error)
      const blocker = `Live authority ${reference} failed verification: ${detail}`.slice(0, MAX_TEXT)
      findings.push(blocker)
      scenarios.push({ ...scenario, status: 'untested', blocker })
    }
  }
  return {
    ...result,
    foresightComplete: result.foresightComplete && valid,
    realWorldScenarios: scenarios,
    findings: findings.slice(0, MAX_ITEMS),
  }
}

/** Run fresh independent adversarial and foresight verification for one completion attempt. */
export async function runAdversarialCompletionGate(input: {
  readonly subagents: CompletionRuntime | undefined
  readonly llm?: Pick<LlmRuntime, 'resolveModelInfo'>
  readonly provider: string
  readonly parent: Agent
  readonly objective: string
  readonly round: number
  readonly signal: AbortSignal
  readonly living?: LivingReadRuntime
}): Promise<GoalCompletionGateResult> {
  if (input.subagents === undefined) return unavailable('No independent tester runtime is mounted.')
  const provider = reviewProvider(input.subagents, input.provider, input.parent)
  if (provider === undefined) {
    return unavailable(input.parent.options.provider === 'openai-codex'
      ? 'No structured completion tester provider is available.'
      : 'No independent tester provider is available for the active non-Codex model; Luna fallback is forbidden.')
  }
  const agentOptions = await resolveGoalJudgeAgentOptions({
    parent: input.parent,
    ...input.llm === undefined ? {} : { llm: input.llm },
    signal: input.signal,
  })
  const designPrompt: ContentBlock[] = [{
    type: 'text',
    text: '<adversarial_test_design>\n'
      + `Original requirement only: ${JSON.stringify(input.objective)}\n\n`
      + 'You are an independent tester. You cannot inspect the Builder workspace, Builder tests, implementation, or prior review. '
      + 'Generate genuinely new failure-oriented test ideas strictly from the original requirement. Think about literal requirement gaps, '
      + 'real-world variability, edge cases, corrupt inputs, alternate formats, missing resources, unexpected environment/state, restart behavior, '
      + 'partial files, stale data, packaging mistakes, and cases where a technically literal result would still be a poor real-world solution. '
      + 'Each case must state what it tries to break. Do not assume the Builder tests are sufficient.\n'
      + '</adversarial_test_design>',
  }]
  const designed = await runStructured(input.subagents, provider, {
    label: 'goal-adversarial-test-design', prompt: designPrompt, parent: input.parent, signal: input.signal,
    agentOptions, outputSchema: DESIGN_SCHEMA, toolFilter: { allow: [] },
  })
  const cases = readCases(designed)
  if (cases === undefined) return unavailable('Independent adversarial test design did not produce valid fresh cases.')

  const executePrompt: ContentBlock[] = [{
    type: 'text',
    text: '<adversarial_completion_gate>\n'
      + `Original requirement: ${JSON.stringify(input.objective)}\n`
      + `Candidate completion round: ${input.round}\n`
      + `Fresh adversarial cases designed without workspace access: ${JSON.stringify(cases)}\n\n`
      + 'Act as the independent completion Tester, not the Builder. Inspect the implementation only now. Verify all six dimensions separately: '
      + 'requirements, Builder-owned tests, fresh adversarial tests, startup, artifact integrity, and clean-room verification. '
      + 'Build an evidence_ledger from the original requirement. At least one original criterion must be mandatory and current reproducible evidence is required for verified. '
      + 'Turn the supplied adversarial cases into genuinely new executable checks and actively try corrupt/partial input, alternate supported representations, unexpected state, restart behavior, dependency failure, concurrency/load, and realistic human or agent mistakes when relevant. '
      + 'Create the final deliverable exactly as the user would receive it, fingerprint it, extract/copy only that package into a brand-new OS temporary directory, and verify startup plus relevant behavior there without workspace-only files or caches. '
      + 'Also return real_world_scenarios describing the materially relevant edge cases you actually checked. Label evidence_kind strictly as static, simulated, or live. '
      + 'A live PASS is allowed only when an authoritative runtime/tool path was actually observed; for Phoenix-created systems use authority_ref exactly as living:<creation-id> after inspecting/verifying it with the read-only living tools. Never call a mock, unit test, synthetic fixture, screenshot, or inference live evidence. '
      + 'After observing the artifact, forecast plausible failures that may occur after delivery. For each risk_forecast separate likelihood from confidence, state impact, evidence, mitigation, and status. Forecasts are hypotheses, not facts. Ask what triggers the failure, how it would be detected, and what should be repaired now. '
      + 'Finally perform one bounded innovation evaluation only after requested work is satisfied. Return implemented, offered, or not-applicable (pending only when the evaluation itself cannot be completed). Innovation must never hide unfinished requested work or add unjustified permissions/dependencies. '
      + 'Compare requirement, claims, tests, packaged artifact, clean-room behavior, edge-case evidence, and forecasts. Any inconsistency is a finding. '
      + 'Record concise procedural_lessons for discovered failure patterns.\n'
      + '</adversarial_completion_gate>',
  }]
  const executed = await runStructured(input.subagents, provider, {
    label: 'goal-adversarial-tester', prompt: executePrompt, parent: input.parent, signal: input.signal,
    agentOptions, outputSchema: EXECUTION_SCHEMA, toolFilter: { allow: [...EXECUTION_TOOLS] },
  })
  const parsed = readExecution(executed)
  if (parsed === undefined) return unavailable('Independent adversarial execution did not return valid clean-room evidence.')
  return verifyLivingEvidence(parsed, input.living)
}
