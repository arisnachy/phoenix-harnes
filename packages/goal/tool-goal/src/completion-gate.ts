/** Independent adversarial verification executed before the final completion judge. */

import type { Agent } from '@phoenix-ai/dsh-agent'
import type { ContentBlock, LlmRuntime } from '@phoenix-ai/dsh-llm'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@phoenix-ai/dsh-tools'
import { resolveGoalJudgeAgentOptions } from './judge-route.ts'
import { buildVerificationContract, type VerificationContract } from './verification-contract.ts'

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

/** Canonical, bounded completion report preserved through Judge and wrap-up. */
export interface CompletionReport {
  readonly unverifiedItems: readonly string[]
  readonly knownLimitations: readonly string[]
}

/** Durable-worthy evidence returned by the adversarial tester. */
export interface GoalCompletionGateResult {
  readonly checks: CompletionGateChecks
  readonly evidenceLedger: readonly CompletionEvidenceEntry[]
  readonly artifactFingerprint: string
  readonly cleanRoomEvidence: string
  readonly findings: readonly string[]
  readonly proceduralLessons: readonly string[]
  readonly completionReport?: CompletionReport
  readonly verificationIncidents?: readonly string[]
}

interface AdversarialCase {
  readonly name: string
  readonly purpose: string
}

type CompletionRuntime = Pick<SubagentRuntime, 'getProvider' | 'start'>
  & Partial<Pick<SubagentRuntime, 'list'>>

const MAX_TEXT = 2_000
const MAX_ITEMS = 32
const VERIFIER_DESIGN_TIMEOUT_MS = 5 * 60_000
const VERIFIER_EXECUTION_TIMEOUT_MS = 40 * 60_000
const EXECUTION_TOOLS = ['bash', 'read', 'read_image', 'glob', 'grep'] as const
const EVIDENCE_STATUSES = ['pending', 'implemented', 'tested', 'verified', 'failed', 'blocked_external'] as const
const EXPECTED_SOURCES = ['specification', 'reference_oracle', 'standard', 'mathematical_invariant', 'metamorphic_property', 'fixture_or_external_evidence', 'implementation_observed', 'unknown'] as const

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
    builder_test_audit: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          test: { type: 'string' },
          expected_source: { type: 'string', enum: [...EXPECTED_SOURCES] },
          circular: { type: 'boolean' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: ['test', 'expected_source', 'circular', 'evidence'],
      },
    },
    completion_report: {
      type: 'object',
      additionalProperties: false,
      properties: {
        unverified_items: { type: 'array', items: { type: 'string' } },
        known_limitations: { type: 'array', items: { type: 'string' } },
      },
      required: ['unverified_items', 'known_limitations'],
    },
    artifact_fingerprint: { type: 'string' },
    clean_room_evidence: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    procedural_lessons: { type: 'array', items: { type: 'string' } },
  },
  required: ['checks', 'evidence_ledger', 'builder_test_audit', 'completion_report', 'artifact_fingerprint', 'clean_room_evidence', 'findings', 'procedural_lessons'],
}

function normalizedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= MAX_TEXT
}

function normalizedList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_ITEMS && value.every(normalizedText)
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

interface BuilderTestAuditEntry {
  readonly test: string
  readonly expectedSource: typeof EXPECTED_SOURCES[number]
  readonly circular: boolean
  readonly evidence: readonly string[]
}

function readBuilderTestAudit(value: unknown): BuilderTestAuditEntry[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return undefined
  const entries: BuilderTestAuditEntry[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return undefined
    const record = item as Record<string, unknown>
    if (!normalizedText(record.test)
      || typeof record.expected_source !== 'string'
      || !EXPECTED_SOURCES.includes(record.expected_source as typeof EXPECTED_SOURCES[number])
      || typeof record.circular !== 'boolean'
      || !normalizedList(record.evidence)) return undefined
    entries.push({
      test: record.test,
      expectedSource: record.expected_source as typeof EXPECTED_SOURCES[number],
      circular: record.circular,
      evidence: record.evidence,
    })
  }
  return entries
}

interface ParsedCompletionReport extends CompletionReport {
  readonly duplicateItems: readonly string[]
}

function normalizedReportKey(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase()
}

function readCompletionReport(value: unknown): ParsedCompletionReport | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!normalizedList(record.unverified_items) || !normalizedList(record.known_limitations)) return undefined

  const duplicates: string[] = []
  const seen = new Set<string>()
  const unique = (items: readonly string[]): string[] => items.filter((item) => {
    const key = normalizedReportKey(item)
    if (seen.has(key)) {
      duplicates.push(item)
      return false
    }
    seen.add(key)
    return true
  })

  const unverifiedItems = unique(record.unverified_items)
  const knownLimitations = unique(record.known_limitations)
  return { unverifiedItems, knownLimitations, duplicateItems: duplicates }
}

function reconcileContract(
  raw: readonly CompletionEvidenceEntry[],
  contract: VerificationContract,
): { ledger: CompletionEvidenceEntry[]; findings: string[]; requiredVerified: boolean; edgesVerified: boolean } {
  const findings: string[] = []
  const requiredIds = new Set(contract.criteria.map(item => item.id))
  const byId = new Map<string, CompletionEvidenceEntry[]>()
  for (const entry of raw) {
    const current = byId.get(entry.criterionId) ?? []
    current.push(entry)
    byId.set(entry.criterionId, current)
  }

  const ledger: CompletionEvidenceEntry[] = []
  let requiredVerified = true
  let edgesVerified = true
  for (const criterion of contract.criteria) {
    const matches = byId.get(criterion.id) ?? []
    const original = matches.length === 1 ? matches[0] : undefined
    let status: CompletionEvidenceStatus = original?.status ?? 'failed'
    let evidence = original === undefined ? [] : [...original.evidence]
    if (matches.length !== 1 || original === undefined) {
      status = 'failed'
      evidence = []
      findings.push(matches.length === 0 || original === undefined
        ? 'Locked criterion ' + criterion.id + ' is missing from the evidence ledger.'
        : 'Locked criterion ' + criterion.id + ' appears more than once in the evidence ledger.')
    } else if (original.criterion !== criterion.criterion || original.mandatory !== true) {
      status = 'failed'
      findings.push('Locked criterion ' + criterion.id + ' was rewritten or downgraded by the verifier.')
    }
    if (status !== 'verified') {
      requiredVerified = false
      if (criterion.source === 'edge') edgesVerified = false
    }
    ledger.push({
      criterionId: criterion.id,
      criterion: criterion.criterion,
      mandatory: true,
      status,
      evidence,
    })
  }

  for (const entry of raw) {
    if (!requiredIds.has(entry.criterionId)) ledger.push(entry)
  }
  return { ledger, findings, requiredVerified, edgesVerified }
}

function readExecution(value: unknown, contract: VerificationContract): GoalCompletionGateResult | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const checksValue = record.checks
  if (checksValue === null || typeof checksValue !== 'object' || Array.isArray(checksValue)) return undefined
  const checks = checksValue as Record<string, unknown>
  let requirements = check(checks.requirements)
  let builderTests = check(checks.builder_tests)
  let adversarialTests = check(checks.adversarial_tests)
  const startup = check(checks.startup)
  const artifactIntegrity = check(checks.artifact_integrity)
  const cleanRoom = check(checks.clean_room)
  const rawLedger = readLedger(record.evidence_ledger)
  const builderAudit = readBuilderTestAudit(record.builder_test_audit)
  const completionReport = readCompletionReport(record.completion_report)
  if (requirements === undefined || builderTests === undefined || adversarialTests === undefined
    || startup === undefined || artifactIntegrity === undefined || cleanRoom === undefined
    || rawLedger === undefined || builderAudit === undefined || completionReport === undefined
    || !normalizedText(record.artifact_fingerprint)
    || !normalizedText(record.clean_room_evidence)
    || !normalizedList(record.findings)
    || !normalizedList(record.procedural_lessons)) return undefined

  const reconciled = reconcileContract(rawLedger, contract)
  const contractFindings = [...reconciled.findings]
  if (!reconciled.requiredVerified || completionReport.unverifiedItems.length > 0) {
    requirements = 'fail'
    if (completionReport.unverifiedItems.length > 0) {
      contractFindings.push('Completion report still has unverified items: ' + completionReport.unverifiedItems.join('; '))
    }
  }
  if (completionReport.duplicateItems.length > 0) {
    requirements = 'fail'
    contractFindings.push('Completion report contains duplicate claims: ' + completionReport.duplicateItems.join('; '))
  }
  const limitationAudit = reconciled.ledger.find(entry => entry.criterionId === 'RISK-LIMITATIONS')
  if (completionReport.knownLimitations.length === 0
    && (limitationAudit?.status !== 'verified' || limitationAudit.evidence.length === 0)) {
    requirements = 'fail'
    contractFindings.push('No-known-limitations claim lacks explicit limitation-search evidence.')
  }
  if (!reconciled.edgesVerified) adversarialTests = 'fail'

  if (contract.requiresBuilderTestAudit) {
    const unsafe = builderAudit.filter(item =>
      item.circular || item.expectedSource === 'implementation_observed' || item.expectedSource === 'unknown')
    if (builderAudit.length === 0) {
      builderTests = 'fail'
      contractFindings.push('Builder tests were not audited for expected-value provenance.')
    } else if (unsafe.length > 0) {
      builderTests = 'fail'
      contractFindings.push('Builder test expected values are circular or lack independent provenance: '
        + unsafe.map(item => item.test).join(', '))
    }
  }

  const proceduralLessons = [...record.procedural_lessons as string[]]
  if (contractFindings.some(item => /provenance|circular/iu.test(item))) {
    proceduralLessons.push('Never certify a test whose expected value was copied from the implementation under test.')
  }

  return {
    checks: { requirements, builderTests, adversarialTests, startup, artifactIntegrity, cleanRoom },
    evidenceLedger: reconciled.ledger,
    artifactFingerprint: record.artifact_fingerprint as string,
    cleanRoomEvidence: record.clean_room_evidence as string,
    findings: [...record.findings as string[], ...contractFindings].slice(0, MAX_ITEMS),
    proceduralLessons: [...new Set(proceduralLessons)].slice(0, MAX_ITEMS),
    completionReport: {
      unverifiedItems: completionReport.unverifiedItems,
      knownLimitations: completionReport.knownLimitations,
    },
    verificationIncidents: [],
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
    && result.evidenceLedger.every(entry => !entry.mandatory || (entry.status === 'verified' && entry.evidence.length > 0))
    && (result.completionReport === undefined || result.completionReport.unverifiedItems.length === 0)
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
    artifactFingerprint: 'unavailable',
    cleanRoomEvidence: reason,
    findings: [reason],
    proceduralLessons: [`Completion verification workflow failed: ${reason}`],
    completionReport: { unverifiedItems: [reason], knownLimitations: [] },
    verificationIncidents: [reason],
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

interface StructuredRunOutcome {
  readonly structured?: unknown
  readonly incident?: string
}

async function awaitAbortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('operation aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([operation, aborted])
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

async function runStructured(
  runtime: CompletionRuntime,
  provider: string,
  request: Parameters<CompletionRuntime['start']>[1],
): Promise<StructuredRunOutcome> {
  const label = typeof request.label === 'string' && request.label.length > 0
    ? request.label
    : 'completion-verifier'
  const timeoutMs = label === 'goal-adversarial-test-design'
    ? VERIFIER_DESIGN_TIMEOUT_MS
    : VERIFIER_EXECUTION_TIMEOUT_MS
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = AbortSignal.any([request.signal, timeout])
  let run
  let startPromise: ReturnType<CompletionRuntime['start']> | undefined
  let outcome: StructuredRunOutcome = {}
  try {
    startPromise = runtime.start(provider, { ...request, signal })
    run = await awaitAbortable(startPromise, signal)
    const result = await awaitAbortable(run.result, signal)
    outcome = result.stopReason === 'completed'
      ? { structured: result.structured }
      : { incident: `${label}:stop-${result.stopReason}` }
  } catch (error) {
    const phase = run === undefined ? 'start' : 'result'
    if (run === undefined && signal.aborted && startPromise !== undefined) {
      void startPromise.then(
        lateRun => lateRun.dispose().catch(() => undefined),
        () => undefined,
      )
    }
    const kind = timeout.aborted && !request.signal.aborted
      ? 'timeout'
      : error instanceof Error && error.name.length > 0 ? error.name : 'runtime-error'
    outcome = { incident: `${label}:${phase}-${kind}` }
  } finally {
    if (run !== undefined) {
      try {
        await run.dispose()
      } catch (error) {
        const kind = error instanceof Error && error.name.length > 0 ? error.name : 'runtime-error'
        const disposal = `${label}:dispose-${kind}`
        outcome = {
          ...outcome,
          incident: outcome.incident === undefined ? disposal : `${outcome.incident};${disposal}`,
        }
      }
    }
  }
  return outcome
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
  const contract = buildVerificationContract(input.objective)
  const routeTimeout = AbortSignal.timeout(60_000)
  const routeSignal = AbortSignal.any([input.signal, routeTimeout])
  let agentOptions
  try {
    agentOptions = await awaitAbortable(resolveGoalJudgeAgentOptions({
      parent: input.parent,
      ...input.llm === undefined ? {} : { llm: input.llm },
      signal: routeSignal,
    }), routeSignal)
  } catch (error) {
    const kind = routeTimeout.aborted && !input.signal.aborted
      ? 'timeout'
      : error instanceof Error && error.name.length > 0 ? error.name : 'runtime-error'
    return unavailable(`Independent verifier route resolution failed. Incident: goal-verifier-route:${kind}.`)
  }
  const designPrompt: ContentBlock[] = [{
    type: 'text',
    text: '<adversarial_test_design>\n'
      + `Original requirement only: ${JSON.stringify(input.objective)}\n`
      + `Locked verifier-owned criteria: ${JSON.stringify(contract.criteria)}\n\n`
      + 'You are an independent tester. You cannot inspect the Builder workspace, Builder tests, implementation, or prior review. '
      + 'Generate genuinely new failure-oriented test ideas strictly from the original requirement and the verifier-owned criteria. '
      + 'The locked criteria are immutable: every one is mandatory and must receive an independent attempt at evidence. '
      + 'Cover applicable empty/single/boundary cases, Unicode outside the BMP, zero-progress loop termination, malformed inputs, and exact diagnostics. '
      + 'When a trustworthy standard-library or reference oracle exists, include differential generated cases; otherwise use property/metamorphic invariants. '
      + 'Think about real-world variability, ambiguous representations or conventions, alternate formats, normalization, locale/timezone/encoding, missing resources, '
      + 'unexpected environment/state, restart behavior, partial files, stale data, packaging mistakes, and cases where a technically literal result would still be a poor real-world solution. '
      + 'Before concluding that no limitations are known, generate plausible failure classes that were not suggested by the Builder and attack or explicitly bound them. Each case must state what it tries to break. '
      + 'Do not assume the Builder tests are sufficient.\n'
      + '</adversarial_test_design>',
  }]
  const designRun = await runStructured(input.subagents, provider, {
    label: 'goal-adversarial-test-design',
    prompt: designPrompt,
    parent: input.parent,
    signal: input.signal,
    agentOptions,
    outputSchema: DESIGN_SCHEMA,
    toolFilter: { allow: [] },
  })
  const cases = readCases(designRun.structured)
  if (cases === undefined) {
    const incident = designRun.incident === undefined ? '' : ' Incident: ' + designRun.incident + '.'
    return unavailable('Independent adversarial test design did not produce valid fresh cases.' + incident)
  }

  const executePrompt: ContentBlock[] = [{
    type: 'text',
    text: '<adversarial_completion_gate>\n'
      + `Original requirement: ${JSON.stringify(input.objective)}\n`
      + `Candidate completion round: ${input.round}\n`
      + `Fresh adversarial cases designed without workspace access: ${JSON.stringify(cases)}\n`
      + `Locked verifier-owned criteria: ${JSON.stringify(contract.criteria)}\n\n`
      + 'Act as the independent completion Tester, not the Builder. Inspect the implementation only now. Verify all six dimensions separately: '
      + 'requirements, Builder-owned tests, fresh adversarial tests, startup, artifact integrity, and clean-room verification. '
      + 'The evidence_ledger MUST include every locked criterion_id exactly once with the exact criterion text and mandatory=true. '
      + 'You may add extra criteria, but you may not omit, rewrite, merge, or downgrade locked criteria. A locked criterion is verified only with current reproducible evidence. '
      + 'Audit Builder assertions in builder_test_audit for expected-value provenance. For every material expected value, identify whether it came from the specification, a reference oracle/standard, '
      + 'a mathematical or metamorphic invariant, an external fixture, or the implementation itself. Mark circular=true whenever the expected result was copied or derived '
      + 'from the candidate implementation; such a test cannot certify correctness. Builder prose and a green aggregate suite are never blanket evidence. '
      + 'For adversarial tests, turn the supplied cases into genuinely new executable checks; do not merely rerun or rename existing Builder tests. '
      + 'Actively try to break the solution with edge conditions, corrupt/partial input, supported alternate representations, and unexpected real-world conditions. '
      + 'Then create the final deliverable exactly as a user would receive it. Compute a stable fingerprint for that packaged artifact. '
      + 'Create a brand-new OS temporary directory outside the workspace, copy/extract only the packaged deliverable into it, and run startup plus the relevant '
      + 'verification against that clean copy. Do not use workspace-only files, caches, installed links, or unshipped dependencies to make clean-room pass. '
      + 'Compare the original requirement, Builder claims/tests, actual artifact contents, and clean-room behavior. Any inconsistency is a failure/blocker. '
      + 'Ask three final questions: Did the mission do everything requested? Did it comply literally? Even if literal, is it an excellent solution under real-world variability? '
      + 'Populate completion_report every time. unverified_items must explicitly list anything not proven; known_limitations must be decided explicitly even when it is empty. '
      + 'An empty known_limitations list is itself a claim: support RISK-LIMITATIONS with concrete evidence showing which plausible failure classes were actively considered and how they were tested or bounded. '
      + 'Keep the report canonical: no duplicate claims, conflicting counts, mixed run states, or repeated review narratives. '
      + 'Record concise procedural_lessons as generalized failure classes rather than task-specific anecdotes so PHOENIX can reuse them.\n'
      + '</adversarial_completion_gate>',
  }]
  const executionRun = await runStructured(input.subagents, provider, {
    label: 'goal-adversarial-tester',
    prompt: executePrompt,
    parent: input.parent,
    signal: input.signal,
    agentOptions,
    outputSchema: EXECUTION_SCHEMA,
    toolFilter: { allow: [...EXECUTION_TOOLS] },
  })
  const executed = readExecution(executionRun.structured, contract)
  if (executed !== undefined) {
    const incidents = [designRun.incident, executionRun.incident]
      .filter((incident): incident is string => incident !== undefined)
    return incidents.length === 0
      ? executed
      : {
        ...executed,
        verificationIncidents: [
          ...(executed.verificationIncidents ?? []),
          ...incidents,
        ].slice(0, MAX_ITEMS),
      }
  }
  const incident = executionRun.incident === undefined ? '' : ' Incident: ' + executionRun.incident + '.'
  return unavailable('Independent adversarial execution did not return valid clean-room evidence.' + incident)
}