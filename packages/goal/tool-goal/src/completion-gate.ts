/** Independent adversarial verification executed before the final completion judge. */

import type { Agent } from '@phoenix-ai/dsh-agent'
import type { ContentBlock, LlmRuntime } from '@phoenix-ai/dsh-llm'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@phoenix-ai/dsh-tools'
import { resolveGoalJudgeAgentOptions } from './judge-route.ts'

export type CompletionCheckStatus = 'pass' | 'fail' | 'blocked'

/** Six machine-required checks that must all pass before DONE is possible. */
export interface CompletionGateChecks {
  readonly requirements: CompletionCheckStatus
  readonly builderTests: CompletionCheckStatus
  readonly adversarialTests: CompletionCheckStatus
  readonly startup: CompletionCheckStatus
  readonly artifactIntegrity: CompletionCheckStatus
  readonly cleanRoom: CompletionCheckStatus
}

/** Durable-worthy evidence returned by the adversarial tester. */
export interface GoalCompletionGateResult {
  readonly checks: CompletionGateChecks
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
const MAX_ITEMS = 16
const EXECUTION_TOOLS = ['bash', 'read', 'read_image', 'glob', 'grep'] as const

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
    artifact_fingerprint: { type: 'string' },
    clean_room_evidence: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    procedural_lessons: { type: 'array', items: { type: 'string' } },
  },
  required: ['checks', 'artifact_fingerprint', 'clean_room_evidence', 'findings', 'procedural_lessons'],
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
  if (requirements === undefined || builderTests === undefined || adversarialTests === undefined
    || startup === undefined || artifactIntegrity === undefined || cleanRoom === undefined
    || !normalizedText(record.artifact_fingerprint)
    || !normalizedText(record.clean_room_evidence)
    || !normalizedList(record.findings)
    || !normalizedList(record.procedural_lessons)) return undefined
  return {
    checks: { requirements, builderTests, adversarialTests, startup, artifactIntegrity, cleanRoom },
    artifactFingerprint: record.artifact_fingerprint,
    cleanRoomEvidence: record.clean_room_evidence,
    findings: record.findings,
    proceduralLessons: record.procedural_lessons,
  }
}

/** True only when every completion dimension has concrete passing evidence. */
export function completionGatePassed(result: GoalCompletionGateResult): boolean {
  return Object.values(result.checks).every(value => value === 'pass')
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
      + 'For adversarial tests, turn the supplied cases into new executable checks; do not merely rerun or rename existing Builder tests. '
      + 'Actively try to break the solution with edge conditions, corrupt/partial input, supported alternate representations, and unexpected real-world conditions. '
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
