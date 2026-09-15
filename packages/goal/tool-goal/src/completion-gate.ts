/** Independent adversarial verification executed before the final completion judge. */

import type { Agent } from '@phoenix-ai/dsh-agent'
import type { ContentBlock, LlmRuntime } from '@phoenix-ai/dsh-llm'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@phoenix-ai/dsh-tools'
import { resolveGoalJudgeAgentOptions } from './judge-route.ts'

/** Machine verdict for one independently checked completion dimension. */
export type CompletionCheckStatus = 'pass' | 'fail' | 'blocked'
/** Requirement-level evidence state used by the completion ledger. */
export type CompletionEvidenceStatus = 'pending' | 'implemented' | 'tested' | 'verified' | 'failed' | 'blocked_external'
/** Provenance class for evidence gathered by the independent tester. */
export type CompletionEvidenceKind = 'static' | 'simulated' | 'live'
/** Risk severity used by concrete real-world challenge scenarios. */
export type CompletionScenarioSeverity = 'low' | 'medium' | 'high' | 'critical'
/** Outcome of one real-world challenge scenario. */
export type CompletionScenarioStatus = 'pending' | 'pass' | 'fail' | 'untested' | 'accepted-risk'
/** Bounded rank used for future likelihood, confidence, and impact. */
export type CompletionRiskBand = 'low' | 'medium' | 'high'
/** Lifecycle of one bounded future-risk forecast. */
export type CompletionRiskStatus = 'open' | 'mitigated' | 'accepted' | 'confirmed' | 'contradicted' | 'unknown'
/** Explicit disposition of the post-completion innovation pass. */
export type CompletionInnovationStatus = 'implemented' | 'offered' | 'not-applicable'

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

/** One concrete life-like condition used to challenge the delivered result. */
export interface CompletionRealWorldScenario {
  readonly id: string
  readonly title: string
  readonly severity: CompletionScenarioSeverity
  readonly status: CompletionScenarioStatus
  readonly evidenceKind: CompletionEvidenceKind
  readonly evidence: readonly string[]
  readonly blocker?: string
}

/** One explicitly hypothetical future failure forecast. */
export interface CompletionRiskForecast {
  readonly id: string
  readonly scenario: string
  readonly likelihood: CompletionRiskBand
  readonly confidence: CompletionRiskBand
  readonly impact: CompletionRiskBand
  readonly evidence: readonly string[]
  readonly mitigation: string
  readonly status: CompletionRiskStatus
}

/** One bounded useful improvement considered only after requested work. */
export interface CompletionInnovationOpportunity {
  readonly status: CompletionInnovationStatus
  readonly rationale: string
  readonly evidence: readonly string[]
}

/** Durable-worthy evidence returned by the adversarial tester. */
export interface GoalCompletionGateResult {
  readonly checks: CompletionGateChecks
  readonly evidenceLedger: readonly CompletionEvidenceEntry[]
  /** Additive foresight evidence; absent on legacy in-memory fixtures and old callers. */
  readonly realWorldScenarios?: readonly CompletionRealWorldScenario[]
  /** Additive future-risk evidence; absent on legacy in-memory fixtures and old callers. */
  readonly riskForecasts?: readonly CompletionRiskForecast[]
  /** Additive innovation disposition; absent on legacy in-memory fixtures and old callers. */
  readonly innovationOpportunity?: CompletionInnovationOpportunity
  readonly artifactFingerprint: string
  readonly cleanRoomEvidence: string
  readonly findings: readonly string[]
  readonly proceduralLessons: readonly string[]
}

interface AdversarialCase {
  readonly name: string
  readonly purpose: string
}

type CompletionRuntime = Pick<SubagentRuntime, 'getProvider' | 'start'>
  & Partial<Pick<SubagentRuntime, 'list'>>

const MAX_TEXT = 2_000
const MAX_ITEMS = 32
const EXECUTION_TOOLS = ['bash', 'read', 'read_image', 'glob', 'grep'] as const
const EVIDENCE_STATUSES = ['pending', 'implemented', 'tested', 'verified', 'failed', 'blocked_external'] as const
const EVIDENCE_KINDS = ['static', 'simulated', 'live'] as const
const SCENARIO_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
const SCENARIO_STATUSES = ['pending', 'pass', 'fail', 'untested', 'accepted-risk'] as const
const RISK_BANDS = ['low', 'medium', 'high'] as const
const RISK_STATUSES = ['open', 'mitigated', 'accepted', 'confirmed', 'contradicted', 'unknown'] as const
const INNOVATION_STATUSES = ['implemented', 'offered', 'not-applicable'] as const

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
    real_world_scenarios: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          severity: { type: 'string', enum: [...SCENARIO_SEVERITIES] },
          status: { type: 'string', enum: [...SCENARIO_STATUSES] },
          evidence_kind: { type: 'string', enum: [...EVIDENCE_KINDS] },
          evidence: { type: 'array', items: { type: 'string' } },
          blocker: { type: 'string' },
        },
        required: ['id', 'title', 'severity', 'status', 'evidence_kind', 'evidence', 'blocker'],
      },
    },
    risk_forecasts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          scenario: { type: 'string' },
          likelihood: { type: 'string', enum: [...RISK_BANDS] },
          confidence: { type: 'string', enum: [...RISK_BANDS] },
          impact: { type: 'string', enum: [...RISK_BANDS] },
          evidence: { type: 'array', items: { type: 'string' } },
          mitigation: { type: 'string' },
          status: { type: 'string', enum: [...RISK_STATUSES] },
        },
        required: ['id', 'scenario', 'likelihood', 'confidence', 'impact', 'evidence', 'mitigation', 'status'],
      },
    },
    innovation_opportunity: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', enum: [...INNOVATION_STATUSES] },
        rationale: { type: 'string' },
        evidence: { type: 'array', items: { type: 'string' } },
      },
      required: ['status', 'rationale', 'evidence'],
    },
    artifact_fingerprint: { type: 'string' },
    clean_room_evidence: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    procedural_lessons: { type: 'array', items: { type: 'string' } },
  },
  required: ['checks', 'evidence_ledger', 'artifact_fingerprint', 'clean_room_evidence', 'findings', 'procedural_lessons'],
}

function normalizedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= MAX_TEXT
}

function normalizedOptionalText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length <= MAX_TEXT
}

function normalizedList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_ITEMS && value.every(normalizedText)
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === 'string' && allowed.includes(value) ? value as T[number] : undefined
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

function readRealWorldScenarios(value: unknown): CompletionRealWorldScenario[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return undefined
  const scenarios: CompletionRealWorldScenario[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return undefined
    const record = item as Record<string, unknown>
    const severity = enumValue(record.severity, SCENARIO_SEVERITIES)
    const status = enumValue(record.status, SCENARIO_STATUSES)
    const evidenceKind = enumValue(record.evidence_kind, EVIDENCE_KINDS)
    if (!normalizedText(record.id) || !normalizedText(record.title) || severity === undefined
      || status === undefined || evidenceKind === undefined || !normalizedList(record.evidence)
      || !normalizedOptionalText(record.blocker ?? '')) return undefined
    scenarios.push({
      id: record.id,
      title: record.title,
      severity,
      status,
      evidenceKind,
      evidence: record.evidence,
      ...record.blocker === '' || record.blocker === undefined ? {} : { blocker: record.blocker as string },
    })
  }
  return scenarios
}

function readRiskForecasts(value: unknown): CompletionRiskForecast[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return undefined
  const forecasts: CompletionRiskForecast[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return undefined
    const record = item as Record<string, unknown>
    const likelihood = enumValue(record.likelihood, RISK_BANDS)
    const confidence = enumValue(record.confidence, RISK_BANDS)
    const impact = enumValue(record.impact, RISK_BANDS)
    const status = enumValue(record.status, RISK_STATUSES)
    if (!normalizedText(record.id) || !normalizedText(record.scenario) || likelihood === undefined
      || confidence === undefined || impact === undefined || status === undefined
      || !normalizedList(record.evidence) || !normalizedOptionalText(record.mitigation)) return undefined
    forecasts.push({
      id: record.id,
      scenario: record.scenario,
      likelihood,
      confidence,
      impact,
      evidence: record.evidence,
      mitigation: record.mitigation,
      status,
    })
  }
  return forecasts
}

function readInnovation(value: unknown): CompletionInnovationOpportunity | undefined {
  if (value === undefined) {
    return {
      status: 'not-applicable',
      rationale: 'No explicit innovation assessment was returned by this verifier.',
      evidence: [],
    }
  }
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
  const realWorldScenarios = readRealWorldScenarios(record.real_world_scenarios)
  const riskForecasts = readRiskForecasts(record.risk_forecasts)
  const innovationOpportunity = readInnovation(record.innovation_opportunity)
  if (requirements === undefined || builderTests === undefined || adversarialTests === undefined
    || startup === undefined || artifactIntegrity === undefined || cleanRoom === undefined
    || evidenceLedger === undefined || realWorldScenarios === undefined || riskForecasts === undefined
    || innovationOpportunity === undefined
    || !normalizedText(record.artifact_fingerprint)
    || !normalizedText(record.clean_room_evidence)
    || !normalizedList(record.findings)
    || !normalizedList(record.procedural_lessons)) return undefined
  return {
    checks: { requirements, builderTests, adversarialTests, startup, artifactIntegrity, cleanRoom },
    evidenceLedger,
    realWorldScenarios,
    riskForecasts,
    innovationOpportunity,
    artifactFingerprint: record.artifact_fingerprint,
    cleanRoomEvidence: record.clean_room_evidence,
    findings: record.findings,
    proceduralLessons: record.procedural_lessons,
  }
}

/**
 * Check whether every required completion dimension has concrete evidence.
 * @param result - structured evidence returned by the independent tester.
 * @returns true only when all six checks, mandatory criteria, artifact identity, and clean-room evidence pass.
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
      requirements: 'blocked',
      builderTests: 'blocked',
      adversarialTests: 'blocked',
      startup: 'blocked',
      artifactIntegrity: 'blocked',
      cleanRoom: 'blocked',
    },
    evidenceLedger: [{
      criterionId: 'VERIFIER-INFRA',
      criterion: 'Independent verifier infrastructure is available.',
      mandatory: true,
      status: 'blocked_external',
      evidence: [reason],
    }],
    realWorldScenarios: [],
    riskForecasts: [],
    innovationOpportunity: {
      status: 'not-applicable',
      rationale: 'Innovation assessment is unavailable until independent verification can run.',
      evidence: [],
    },
    artifactFingerprint: 'unavailable',
    cleanRoomEvidence: reason,
    findings: [reason],
    proceduralLessons: [`Completion verification workflow failed: ${reason}`],
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

/**
 * Run a two-stage independent completion test. Stage one sees only the original
 * requirement and invents fresh attacks. Stage two executes those attacks,
 * packages the deliverable, verifies a clean extracted copy, and reports all
 * six completion dimensions.
 * @param input - verifier runtime, active model route, original objective, round, and cancellation signal.
 * @returns structured independent evidence for the exact completion attempt.
 */
export async function runAdversarialCompletionGate(input: {
  readonly subagents: CompletionRuntime | undefined
  readonly llm?: Pick<LlmRuntime, 'resolveModelInfo'>
  readonly provider: string
  readonly parent: Agent
  readonly objective: string
  readonly round: number
  readonly signal: AbortSignal
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
    label: 'goal-adversarial-test-design',
    prompt: designPrompt,
    parent: input.parent,
    signal: input.signal,
    agentOptions,
    outputSchema: DESIGN_SCHEMA,
    toolFilter: { allow: [] },
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
      + 'Build an evidence_ledger from the original requirement. Give every acceptance criterion a stable criterion_id, literal criterion text, mandatory flag, '
      + 'status, and concrete evidence references. At least one criterion must be mandatory; never classify every original requirement as optional. '
      + 'Mandatory criteria are verified only when current reproducible evidence demonstrates them; Builder prose is not evidence. '
      + 'For adversarial tests, turn the supplied cases into new executable checks; do not merely rerun or rename existing Builder tests. '
      + 'Actively try to break the solution with edge conditions, corrupt/partial input, supported alternate representations, and unexpected real-world conditions. '
      + 'Record real_world_scenarios for the relevant conditions you exercised. Label evidence_kind as static, simulated, or live truthfully: simulated tests are never live evidence, '
      + 'and live evidence requires an authoritative runtime or operational observation rather than Builder prose. '
      + 'Forecast future risk after delivery: identify plausible failures, their trigger/evidence, likelihood, confidence, impact, mitigation, and current status. '
      + 'Treat every forecast as a hypothesis rather than a fact, and call out what should be repaired now when a material risk is supported by evidence. '
      + 'After requested work is satisfied, evaluate one bounded innovation opportunity that improves utility, resilience, automation, observability, simplicity, accessibility, or delight. '
      + 'Use not-applicable when no responsible addition has positive net value; innovation must never hide unfinished requested work. '
      + 'Then create the final deliverable exactly as a user would receive it. Compute a stable fingerprint for that packaged artifact. '
      + 'Create a brand-new OS temporary directory outside the workspace, copy/extract only the packaged deliverable into it, and run startup plus the relevant '
      + 'verification against that clean copy. Do not use workspace-only files, caches, installed links, or unshipped dependencies to make clean-room pass. '
      + 'Compare the original requirement, Builder claims/tests, actual artifact contents, and clean-room behavior. Any inconsistency is a failure/blocker. '
      + 'Ask three final questions: Did the mission do everything requested? Did it comply literally? Even if literal, is it an excellent solution under real-world variability? '
      + 'Record concise procedural_lessons for every discovered failure pattern so PHOENIX can avoid repeating it.\n'
      + '</adversarial_completion_gate>',
  }]
  const executed = await runStructured(input.subagents, provider, {
    label: 'goal-adversarial-tester',
    prompt: executePrompt,
    parent: input.parent,
    signal: input.signal,
    agentOptions,
    outputSchema: EXECUTION_SCHEMA,
    toolFilter: { allow: [...EXECUTION_TOOLS] },
  })
  return readExecution(executed) ?? unavailable('Independent adversarial execution did not return valid clean-room evidence.')
}
