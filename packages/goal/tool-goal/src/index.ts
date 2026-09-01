/**
 * Model-facing `get_goal`, `create_goal`, and `update_goal` tools over the
 * persisted same-session goal domain.
 * @module @phoenix-ai/dsh-tool-goal
 */

import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import { GoalId } from '@phoenix-ai/dsh-goal'
import type {
  ForgeCriterionStatus, ForgeDeliverableKind, ForgeDeliverableStatus, ForgeManagementMode, ForgePhase,
  ForgeResearchKind, ForgeRole, ForgeSourceAuditStatus, ForgeStrategyStatus, ForgeWorkStatus,
  GoalRef, GoalView, OrganizationForgeSnapshot,
} from '@phoenix-ai/dsh-goal'
import { nextOrganizationForgeAction } from '@phoenix-ai/dsh-goal'
import { boundContextSummary, createUserMessage, HarnessError } from '@phoenix-ai/dsh-llm'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type { GenericCallView, JsonValue } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import { judgeGoalCompletion, recordGoalJudge } from './judge.ts'
import type { GoalJudgeResult } from './judge.ts'
import {
  completionAuthority,
  goalToolExecution,
  requireDirectHuman,
} from './authority.ts'
import { renderWrapupContext } from './wrapup.ts'

export const name = 'tool-goal'
export const inject = ['agents', 'goals', 'tools', 'systemPrompt']

/** Model policy and hard lower bounds for goal-state updates. */
export interface Config {
  /** Minimum admitted goal rounds before the model may self-report `blocked`. */
  blockedAfterConsecutiveRounds?: number
  /** Require an independent judge before a goal can enter `complete`. */
  requireJudge?: boolean
  /** Fresh structured subagent provider used for completion review. */
  judgeProvider?: string
}

/** Schemastery config for the goal-tool policy. */
export const Config: z<Config> = z.object({
  blockedAfterConsecutiveRounds: z.number().step(1).min(1).default(3),
  requireJudge: z.boolean().default(true),
  judgeProvider: z.string().default('spawn'),
})

/** Fully materialized tool policy. */
interface ResolvedConfig {
  readonly blockedAfterConsecutiveRounds: number
  readonly requireJudge: boolean
  readonly judgeProvider: string
}

type UpdateAction = 'edit' | 'pause' | 'resume' | 'complete' | 'blocked'

const UPDATE_ACTIONS: UpdateAction[] = ['edit', 'pause', 'resume', 'complete', 'blocked']

const CREATE_DESCRIPTION =
  'Create one persisted same-session completion goal when the current direct human request '
  + 'is a long-running objective that should continue across autonomous goal rounds. You may '
  + 'infer that intent without requiring the user to say "create a goal". Do not use this for '
  + 'trivial single-turn work. Execution rejects non-human and subagent authority.'

const GET_DESCRIPTION =
  'Read the current same-session goal, including its exact id/revision, objective, phase, completed '
  + 'continuation rounds, round limit, blocker reason when present, and whether another continuation is armed. '
  + 'Call this before updating a goal.'

const SPECIALIST_DESCRIPTION =
  'Maintain one persistent, evidence-based specialist laboratory. Start it only for an explicit '
  + 'expertise request, then register traceable sources, falsifiable hypotheses, reproducible '
  + 'experiments, and judge results. A specialist is ready only after a passing evaluation; failed '
  + 'evaluations create an improving checkpoint and are bounded by max_iterations. When the base '
      + 'profile requires judging, evaluate invokes a fresh read-only independent judge automatically.'

const FORGE_DESCRIPTION =
  'Build one organization, business, or system as a durable Organization Forge. Research comparable '
  + 'solutions first, audit every reused asset before and after modification, keep Phoenix IT, Security, '
  + 'and R&D roles active, prefer deterministic automation, and require functional, tested, secure, '
  + 'observable, maintainable, documented evidence plus an independent judge before delivery. Forge is '
  + 'a modular capability over the mission system, not a replacement for it. Start with research; a '
  + 'failed work item or judge result remains active and nextAction points to the next recovery step. '
  + 'The final handoff question is not a completion substitute.'

const FORGE_PHASES: readonly ForgePhase[] = ['researching', 'auditing', 'designing', 'building', 'verifying']
const FORGE_CRITERION_STATUSES: readonly ForgeCriterionStatus[] = ['pending', 'implemented', 'tested', 'verified']
const FORGE_AUDIT_STATUSES: readonly ForgeSourceAuditStatus[] = ['pending', 'passed', 'needs_changes', 'blocked']
const FORGE_AUDIT_STATUS_SET = new Set<string>(FORGE_AUDIT_STATUSES)
const FORGE_ACTIONS = ['start', 'get', 'research', 'source', 'audit', 'blueprint', 'deliverable', 'work', 'strategy', 'revalidate', 'atlas', 'block', 'advance', 'criterion', 'judge', 'management'] as const

function isForgeAuditStatus(value: string): value is ForgeSourceAuditStatus {
  return FORGE_AUDIT_STATUS_SET.has(value)
}

/** Canonical goal-tool output, matching the existing compact Native JSON. */
type GoalToolValue =
  | { goal: null }
  | {
    goal: {
      id: string
      revision: number
      objective: string
      phase: GoalView['phase']
      roundsStarted: number
      maxGoalRounds: number
      blockedReason?: { code: string; message: string }
    }
    activation: GoalView['activation']
    judge?: {
      verdict: GoalJudgeResult['verdict']
      summary: string
      findings: string[]
      requiredChanges: string[]
    }
  }

const GOAL_VALUE_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        goal: { type: 'null', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        goal: {
          type: 'object',
          additionalProperties: false,
          required: true,
          properties: {
            id: { type: 'string', required: true },
            revision: { type: 'integer', required: true },
            objective: { type: 'string', required: true },
            phase: { type: 'string', required: true, enum: ['active', 'paused', 'blocked', 'complete'] },
            roundsStarted: { type: 'integer', required: true },
            maxGoalRounds: { type: 'integer', required: true },
            blockedReason: {
              type: 'object',
              additionalProperties: false,
              properties: {
                code: { type: 'string', required: true },
                message: { type: 'string', required: true },
              },
            },
          },
        },
        activation: { type: 'string', required: true, enum: ['armed', 'disarmed'] },
        judge: {
          type: 'object',
          additionalProperties: false,
          properties: {
            verdict: { type: 'string', required: true, enum: ['pass', 'needs_changes', 'blocked'] },
            summary: { type: 'string', required: true },
            findings: { type: 'array', items: { type: 'string' }, required: true },
            requiredChanges: { type: 'array', items: { type: 'string' }, required: true },
          },
        },
      },
    },
  ],
} as const

/** Render policy guidance with its deployment-selected blocked threshold. */
function guidance(blockedAfter: number, requireJudge: boolean): string {
  return 'Use goal tools for one long-running completion objective in the current session. '
    + 'create_goal may infer goal intent from a direct human request in any language; do not '
    + 'create a goal for routine single-turn work. Call get_goal before update_goal and copy its '
    + 'exact goal_id and revision. After session resume or fork, the driver restores an active durable '
    + 'goal and continues it automatically; blocked goals wait for their external condition or an '
    + 'explicit resume. Mark complete only when the objective is actually achieved. Mark '
    + `blocked only after the same blocking condition persists for at least ${blockedAfter} `
    + 'consecutive goal rounds, and report that concrete condition in blocked_reason; difficulty, uncertainty, '
    + 'or useful remaining work is not blocked. The goal domain independently rejects completion unless '
    + 'a durable judge has passed the exact current goal revision.'
    + (requireJudge
      ? ' Completion is gated by an independent read-only judge: a self-reported complete result '
        + 'remains active until the judge returns pass; use its required_changes as the next work list. '
        + 'When the exact deliverable is ready, call update_goal with action complete in the same round so '
        + 'the judge activates; never end a supposedly finished round with prose alone. A blocked or rejected '
        + 'judge is a recovery event, not mission completion: continue with a materially improved strategy.'
      : '')
}

/** Validate config even when apply is called directly outside Loader normalization. */
function resolveConfig(config: Config): ResolvedConfig {
  const blockedAfter = config.blockedAfterConsecutiveRounds ?? 3
  const requireJudge = config.requireJudge ?? true
  const judgeProvider = config.judgeProvider ?? 'spawn'
  if (!Number.isSafeInteger(blockedAfter) || blockedAfter < 1) {
    throw new TypeError('blockedAfterConsecutiveRounds must be a positive safe integer')
  }
  if (judgeProvider.length === 0 || judgeProvider !== judgeProvider.trim()) {
    throw new TypeError('judgeProvider must be a non-empty normalized string')
  }
  return { blockedAfterConsecutiveRounds: blockedAfter, requireJudge, judgeProvider }
}

/** Whether optional text is meaningful rather than a strict-schema empty filler. */
function hasText(value: string | undefined): value is string {
  return value !== undefined && value !== ''
}

/** Whether an optional round cap is meaningful rather than a strict-schema zero filler. */
function hasRoundCap(value: number | undefined): value is number {
  return value !== undefined && value !== 0
}

/** Build the exact compare-and-set ref from model arguments. */
function goalRef(goalId: string, revision: number): GoalRef {
  if (goalId.length === 0 || goalId !== goalId.trim()
    || !Number.isSafeInteger(revision) || revision < 1) {
    throw new HarnessError(
      'goal_id must be non-empty and revision must be a positive safe integer',
      'GOAL_TOOL_INVALID_UPDATE',
    )
  }
  return { id: GoalId(goalId), revision }
}

/** Stable compact model result; activation is an observation, not replay state. */
function goalValue(goal: GoalView | undefined, judge?: GoalJudgeResult): GoalToolValue {
  if (goal === undefined) return { goal: null }
  return {
    goal: {
      id: goal.id,
      revision: goal.revision,
      objective: goal.objective,
      phase: goal.phase,
      roundsStarted: goal.roundsStarted,
      maxGoalRounds: goal.maxGoalRounds,
      ...goal.blockedReason === undefined ? {} : {
        blockedReason: { code: goal.blockedReason.code, message: goal.blockedReason.message },
      },
    },
    activation: goal.activation,
    ...judge === undefined ? {} : {
      judge: {
        verdict: judge.verdict,
        summary: judge.summary,
        findings: [...judge.findings],
        requiredChanges: [...judge.requiredChanges],
      },
    },
  }
}

/** Compact model-facing projection of a specialist laboratory. */
function specialistValue(value: unknown): { specialist: Record<string, JsonValue> } {
  return { specialist: JSON.parse(JSON.stringify(value)) as Record<string, JsonValue> }
}

/** Compact model-facing projection of one Organization Forge build. */
function forgeValue(value: OrganizationForgeSnapshot, includeHandoff = false): Record<string, JsonValue> {
  const activeView = {
    ...value,
    work: value.work.filter(item => item.status === 'active'),
  }
  return {
    forge: JSON.parse(JSON.stringify(activeView)) as JsonValue,
    nextAction: nextOrganizationForgeAction(value),
    ...includeHandoff ? {
      handoffQuestion: '¿Quieres que Phoenix gestione también este negocio/sistema?',
      managementOptions: ['Entregar', 'Gestión asistida', 'Gestión autónoma'],
    } : {},
  }
}

/** Give the independent judge bounded durable laboratory evidence to review. */
function specialistReviewObjective(profile: {
  readonly topic: string
  readonly objective: string
  readonly successCriteria: readonly string[]
  readonly sources: readonly unknown[]
  readonly hypotheses: readonly string[]
  readonly experiments: readonly unknown[]
}): string {
  return `Specialist laboratory review for ${profile.topic}: ${JSON.stringify({
    objective: profile.objective,
    successCriteria: profile.successCriteria,
    sources: profile.sources,
    hypotheses: profile.hypotheses,
    experiments: profile.experiments,
  })}`.slice(0, 8_000)
}

/** Reusable canonical output declaration for all three goal controls. */
const GOAL_OUTPUT = {
  schema: GOAL_VALUE_SCHEMA,
  render: (_args: unknown, value: GoalToolValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

/** Generic, args-only pending presentation shared by the goal tools. */
function present(title: string, kind: 'read' | 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

/** Register the three Codex-shaped goal tools and their shared policy section. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  ctx.systemPrompt.section({
    name: 'tool:goal',
    order: 114,
    text: guidance(resolved.blockedAfterConsecutiveRounds, resolved.requireJudge),
  })

  ctx.tools.register(defineTool({
    name: 'get_goal',
    description: GET_DESCRIPTION,
    parameters: {},
    output: GOAL_OUTPUT,
    execute(_args, exec) {
      const execution = goalToolExecution(ctx, exec)
      return Promise.resolve(goalValue(ctx.goals.get(execution.agent)))
    },
    presentCall: () => present('Read current goal', 'read'),
  }))

  ctx.tools.register(defineTool({
    name: 'create_goal',
    description: CREATE_DESCRIPTION,
    parameters: {
      objective: {
        type: 'string',
        required: true,
        description: 'The concrete completion objective inferred from the direct human request.',
      },
      max_goal_rounds: {
        type: 'number',
        description: 'Optional positive safe-integer limit on automatic continuation rounds.',
      },
    },
    output: GOAL_OUTPUT,
    async execute(args, exec) {
      const execution = goalToolExecution(ctx, exec)
      requireDirectHuman(ctx, execution)
      const goal = ctx.goals.create(execution.agent, {
        objective: args.objective,
        ...args.max_goal_rounds === undefined ? {} : { maxGoalRounds: args.max_goal_rounds },
      })
      return Promise.resolve(goalValue(goal))
    },
    presentCall: args => present('Create goal', 'other', args.objective),
  }))

  ctx.tools.register(defineTool({
    name: 'update_goal',
    description: 'Update the exact current goal revision. edit, pause, and resume require a direct '
      + 'top-level human request. During an automatic continuation of the current goal, complete '
      + 'and blocked are also allowed. blocked is rejected before the configured minimum round count; the model remains '
      + 'responsible for judging that the same condition persisted across those rounds and must explain it in blocked_reason.',
    parameters: {
      goal_id: { type: 'string', required: true, description: 'Exact id returned by get_goal.' },
      revision: { type: 'number', required: true, description: 'Exact positive revision returned by get_goal.' },
      action: {
        type: 'string',
        required: true,
        enum: UPDATE_ACTIONS,
        description: 'edit | pause | resume | complete | blocked',
      },
      objective: { type: 'string', description: 'Replacement objective; valid only with action edit.' },
      max_goal_rounds: { type: 'number', description: 'Replacement cap; valid only with action edit.' },
      blocked_reason: {
        type: 'string',
        description: 'Concrete blocking condition; required only with action blocked.',
      },
    },
    output: GOAL_OUTPUT,
    async execute(args, exec) {
      const execution = goalToolExecution(ctx, exec)
      const ref = goalRef(args.goal_id, args.revision)
      const replacements = {
        ...hasText(args.objective) ? { objective: args.objective } : {},
        ...hasRoundCap(args.max_goal_rounds) ? { maxGoalRounds: args.max_goal_rounds } : {},
      }
      if (args.action === 'edit') {
        requireDirectHuman(ctx, execution)
        if (hasText(args.blocked_reason)) {
          throw new HarnessError('blocked_reason is valid only with action blocked', 'GOAL_TOOL_INVALID_UPDATE')
        }
        const goal = ctx.goals.edit(execution.agent, ref, replacements)
        return Promise.resolve(goalValue(goal))
      }
      if (args.action === 'pause' || args.action === 'resume') {
        requireDirectHuman(ctx, execution)
        if (hasText(args.objective) || hasRoundCap(args.max_goal_rounds) || hasText(args.blocked_reason)) {
          throw new HarnessError(
            'objective and max_goal_rounds are valid only with action edit; blocked_reason is valid only with action blocked',
            'GOAL_TOOL_INVALID_UPDATE',
          )
        }
        const goal = args.action === 'pause'
          ? ctx.goals.pause(execution.agent, ref)
          : ctx.goals.resume(execution.agent, ref)
        return Promise.resolve(goalValue(goal))
      }
      const authority = completionAuthority(ctx, execution)
      if (hasText(args.objective) || hasRoundCap(args.max_goal_rounds)) {
        throw new HarnessError(
          'objective and max_goal_rounds are valid only with action edit',
          'GOAL_TOOL_INVALID_UPDATE',
        )
      }
      if (args.action === 'complete' && hasText(args.blocked_reason)) {
        throw new HarnessError('blocked_reason is valid only with action blocked', 'GOAL_TOOL_INVALID_UPDATE')
      }
      if (args.action === 'blocked'
        && (args.blocked_reason === undefined || args.blocked_reason.trim().length === 0)) {
        throw new HarnessError('blocked_reason is required with action blocked', 'GOAL_TOOL_INVALID_UPDATE')
      }
      if (args.action === 'blocked' && authority.kind === 'goal-round'
        && authority.goal.roundsStarted < resolved.blockedAfterConsecutiveRounds) {
        throw new HarnessError(
          `blocked requires at least ${resolved.blockedAfterConsecutiveRounds} consecutive goal rounds; `
          + `current round is ${authority.goal.roundsStarted}`,
          'GOAL_TOOL_BLOCK_THRESHOLD',
        )
      }
      let judge: GoalJudgeResult | undefined
      if (args.action === 'complete' && resolved.requireJudge) {
        const subagents = ctx.get('subagents')
        const llm = ctx.get('llm', false)
        const currentGoal = ctx.goals.get(execution.agent)
        if (currentGoal === undefined || currentGoal.id !== ref.id || currentGoal.revision !== ref.revision) {
          throw new HarnessError('goal completion judge requires the current goal revision', 'GOAL_TOOL_STALE_REVISION')
        }
        judge = await judgeGoalCompletion({
          subagents,
          ...llm === undefined ? {} : { llm },
          provider: resolved.judgeProvider,
          parent: execution.agent,
          objective: currentGoal.objective,
          round: currentGoal.roundsStarted,
          signal: exec.signal,
        })
        recordGoalJudge(execution.agent.session, {
          callId: exec.callId,
          goalId: currentGoal.id,
          revision: currentGoal.revision,
          round: currentGoal.roundsStarted,
          verdict: judge.verdict,
          summary: judge.summary,
          findings: judge.findings,
          requiredChanges: judge.requiredChanges,
        })
        if (judge.verdict !== 'pass') {
          exec.deferContext(createUserMessage({
            content: [{
              type: 'text',
              text: '<goal_judge_result>\n'
                + `Verdict: ${judge.verdict}\n`
                + `Summary: ${judge.summary}\n`
                + `Required changes: ${JSON.stringify(judge.requiredChanges)}\n`
                + 'Keep the goal active, address these changes with a materially different or improved strategy, '
                + 'and request another independent review only after verifying the result.\n'
                + '</goal_judge_result>',
            }],
            source: {
              kind: 'plugin',
              plugin: 'tool-goal',
              form: 'notice',
              summary: boundContextSummary(`judge ${judge.verdict}: ${currentGoal.objective}`),
            },
          }))
          return goalValue(ctx.goals.get(execution.agent), judge)
        }
      }
      const goal = args.action === 'complete'
        ? ctx.goals.complete(execution.agent, ref)
        : ctx.goals.block(execution.agent, ref, {
          code: 'model-reported',
          message: args.blocked_reason as string,
        })
      if (authority.kind === 'goal-round') {
        exec.deferContext(createUserMessage({
          content: args.action === 'complete'
            ? renderWrapupContext(goal.objective)
            : renderWrapupContext(goal.objective, args.blocked_reason as string),
          source: {
            kind: 'plugin',
            plugin: 'tool-goal',
            form: 'notice',
            summary: boundContextSummary(`${args.action as string}: ${goal.objective}`),
          },
        }))
      }
      return goalValue(goal, judge)
    },
    presentCall: args => present(
      `${args.action === 'blocked' ? 'Mark' : args.action.charAt(0).toUpperCase() + args.action.slice(1)} goal`,
      'other',
      hasText(args.blocked_reason)
        ? args.blocked_reason
        : hasText(args.objective)
          ? args.objective
          : hasRoundCap(args.max_goal_rounds) ? args.max_goal_rounds : args.goal_id,
    ),
  }))

  ctx.tools.register(defineTool({
    name: 'organization_forge',
    description: FORGE_DESCRIPTION,
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: FORGE_ACTIONS,
        description: 'start, get, research, source, audit, blueprint, deliverable, work, strategy, revalidate, atlas, block, advance, criterion, judge, or management',
      },
      forge_id: { type: 'string', description: 'Existing Forge build id for non-start actions.' },
      objective: { type: 'string', description: 'Business, organization, or system objective for start.' },
      criteria: { type: 'array', items: { type: 'string' }, description: 'Required delivery criteria for start.' },
      research_kind: { type: 'string', enum: ['product', 'repository', 'tool', 'component', 'pattern'], description: 'Comparable solution kind.' },
      research_title: { type: 'string', description: 'Comparable solution title.' },
      research_summary: { type: 'string', description: 'Secret-free comparable solution summary.' },
      research_relevance: { type: 'string', description: 'Why the comparable solution matters.' },
      research_evidence: { type: 'array', items: { type: 'string' }, description: 'Research evidence references.' },
      title: { type: 'string', description: 'Public source title.' },
      locator: { type: 'string', description: 'Public https, atlas, or local source reference without credentials.' },
      license: { type: 'string', description: 'Detected license identifier or policy result.' },
      stage: { type: 'string', enum: ['pre-reuse', 'post-modification'], description: 'Audit stage.' },
      source_id: { type: 'string', description: 'Source id being audited.' },
      dependencies: { type: 'string', enum: FORGE_AUDIT_STATUSES, description: 'Dependency audit result.' },
      secrets: { type: 'string', enum: FORGE_AUDIT_STATUSES, description: 'Secret scan result.' },
      vulnerabilities: { type: 'string', enum: FORGE_AUDIT_STATUSES, description: 'Vulnerability audit result.' },
      findings: { type: 'array', items: { type: 'string' }, description: 'Bounded audit or judge findings.' },
      components: { type: 'array', items: { type: 'string' }, description: 'Blueprint components.' },
      infrastructure: { type: 'array', items: { type: 'string' }, description: 'Blueprint infrastructure.' },
      automations: { type: 'array', items: { type: 'string' }, description: 'Blueprint automations.' },
      workflows: { type: 'array', items: { type: 'string' }, description: 'Blueprint workflows.' },
      metrics: { type: 'array', items: { type: 'string' }, description: 'Blueprint metrics.' },
      cost_controls: { type: 'array', items: { type: 'string' }, description: 'Blueprint cost controls.' },
      quality_targets: { type: 'array', items: { type: 'string' }, description: 'Blueprint quality targets.' },
      deliverable_id: { type: 'string', description: 'Existing deliverable id when updating evidence status.' },
      deliverable_name: { type: 'string', description: 'Concrete output name.' },
      deliverable_kind: { type: 'string', enum: ['software', 'web', 'infrastructure', 'automation', 'workflow', 'agent', 'documentation', 'other'], description: 'Concrete output kind.' },
      artifact_ref: { type: 'string', description: 'Durable artifact reference.' },
      deliverable_status: { type: 'string', enum: FORGE_CRITERION_STATUSES, description: 'Deliverable evidence state.' },
      role: { type: 'string', enum: ['it', 'security', 'rd'], description: 'Phoenix team role for work.' },
      work_title: { type: 'string', description: 'Durable work item title.' },
      work_status: { type: 'string', enum: ['active', 'completed', 'failed'], description: 'Recoverable work status.' },
      strategy_id: { type: 'string', description: 'Strategy referenced by a work item.' },
      failure_fingerprint: { type: 'string', description: 'Stable failure fingerprint used to prevent repeated approaches.' },
      strategy_name: { type: 'string', description: 'Alternative strategy name.' },
      strategy_status: { type: 'string', enum: ['proposed', 'active', 'completed', 'failed'], description: 'Alternative strategy status.' },
      strategy_summary: { type: 'string', description: 'Alternative strategy summary.' },
      revalidation_evidence: { type: 'array', items: { type: 'string' }, description: 'Current source revalidation evidence.' },
      atlas_name: { type: 'string', description: 'Reusable Atlas entry name.' },
      atlas_summary: { type: 'string', description: 'Secret-free reusable Atlas summary.' },
      reusable_pattern: { type: 'string', description: 'Secret-free reusable pattern.' },
      dependency: { type: 'string', description: 'External dependency that blocks progress.' },
      blocker_reason: { type: 'string', description: 'Why the dependency blocks progress.' },
      resume_condition: { type: 'string', description: 'Condition that allows the next attempt.' },
      phase: { type: 'string', enum: FORGE_PHASES, description: 'Next Forge lifecycle phase.' },
      criterion_id: { type: 'string', description: 'Criterion id returned by start or get.' },
      criterion_status: { type: 'string', enum: FORGE_CRITERION_STATUSES, description: 'Evidence state.' },
      evidence: { type: 'array', items: { type: 'string' }, description: 'Evidence references; required for verified.' },
      verdict: { type: 'string', enum: ['pass', 'needs_changes', 'blocked'], description: 'Optional manual verdict when judging is disabled.' },
      summary: { type: 'string', description: 'Judge summary.' },
      required_changes: { type: 'array', items: { type: 'string' }, description: 'Required changes before approval.' },
      management_mode: { type: 'string', enum: ['handoff', 'assisted', 'autonomous'], description: 'Post-build management choice.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value: Record<string, JsonValue>) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const execution = goalToolExecution(ctx, exec)
      const ledger = ctx.goals.organizationForge
      if (args.action === 'start') {
        requireDirectHuman(ctx, execution)
        if (typeof args.objective !== 'string') throw new HarnessError('start requires objective', 'FORGE_INVALID_REQUEST')
        if (args.criteria !== undefined && !Array.isArray(args.criteria)) throw new HarnessError('criteria must be an array', 'FORGE_INVALID_REQUEST')
        const currentGoal = ctx.goals.get(execution.agent)
        return forgeValue(ledger.start(execution.agent, {
          objective: args.objective,
          ...(args.criteria === undefined ? {} : { criteria: args.criteria }),
          ...(currentGoal === undefined ? {} : { goalRef: { id: currentGoal.id, revision: currentGoal.revision } }),
        }))
      }
      if (args.action === 'get') {
        if (typeof args.forge_id === 'string') {
          const forge = ledger.get(execution.agent, args.forge_id)
          if (forge === undefined) throw new HarnessError(`Forge not found: ${args.forge_id}`, 'FORGE_NOT_FOUND')
          return forgeValue(forge, forge.phase === 'ready')
        }
        return { forges: ledger.list(execution.agent).map(forge => forgeValue(forge, forge.phase === 'ready')) }
      }
      if (typeof args.forge_id !== 'string') throw new HarnessError('forge_id is required for this action', 'FORGE_INVALID_REQUEST')
      const forgeId = args.forge_id
      if (args.action === 'research') {
        if (!['product', 'repository', 'tool', 'component', 'pattern'].includes(args.research_kind as string)
          || typeof args.research_title !== 'string' || typeof args.locator !== 'string'
          || typeof args.research_summary !== 'string' || typeof args.research_relevance !== 'string') {
          throw new HarnessError('research requires research_kind, research_title, locator, research_summary, and research_relevance', 'FORGE_INVALID_REQUEST')
        }
        return forgeValue(ledger.addResearch(execution.agent, forgeId, {
          kind: args.research_kind as ForgeResearchKind,
          title: args.research_title,
          locator: args.locator,
          summary: args.research_summary,
          relevance: args.research_relevance,
          evidence: args.research_evidence ?? [],
        }))
      }
      if (args.action === 'source') {
        if (typeof args.title !== 'string' || typeof args.locator !== 'string' || typeof args.license !== 'string') {
          throw new HarnessError('source requires title, locator, and license', 'FORGE_INVALID_REQUEST')
        }
        return forgeValue(ledger.addSource(execution.agent, forgeId, {
          title: args.title, locator: args.locator, license: args.license,
        }))
      }
      if (args.action === 'audit') {
        if (args.stage !== 'pre-reuse' && args.stage !== 'post-modification'
          || typeof args.license !== 'string' || !isForgeAuditStatus(args.license)
          || typeof args.dependencies !== 'string' || !isForgeAuditStatus(args.dependencies)
          || typeof args.secrets !== 'string' || !isForgeAuditStatus(args.secrets)
          || typeof args.vulnerabilities !== 'string' || !isForgeAuditStatus(args.vulnerabilities)) {
          throw new HarnessError('audit requires stage, license, dependencies, secrets, and vulnerabilities', 'FORGE_INVALID_REQUEST')
        }
        return forgeValue(ledger.addAudit(execution.agent, forgeId, {
          stage: args.stage,
          ...args.source_id === undefined ? {} : { sourceId: args.source_id },
          license: args.license,
          dependencies: args.dependencies,
          secrets: args.secrets,
          vulnerabilities: args.vulnerabilities,
          findings: args.findings ?? [],
          evidence: args.evidence ?? [],
        }))
      }
      if (args.action === 'blueprint') {
        if (!Array.isArray(args.components) || !Array.isArray(args.infrastructure) || !Array.isArray(args.automations)
          || !Array.isArray(args.workflows) || !Array.isArray(args.metrics) || !Array.isArray(args.cost_controls)
          || !Array.isArray(args.quality_targets)) {
          throw new HarnessError('blueprint requires components, infrastructure, automations, workflows, metrics, cost_controls, and quality_targets', 'FORGE_INVALID_REQUEST')
        }
        return forgeValue(ledger.setBlueprint(execution.agent, forgeId, {
          components: args.components,
          infrastructure: args.infrastructure,
          automations: args.automations,
          workflows: args.workflows,
          metrics: args.metrics,
          costControls: args.cost_controls,
          qualityTargets: args.quality_targets,
        }))
      }
      if (args.action === 'deliverable') {
        if (typeof args.deliverable_id === 'string') {
          if (!FORGE_CRITERION_STATUSES.includes(args.deliverable_status as ForgeDeliverableStatus) || !Array.isArray(args.evidence)) {
            throw new HarnessError('deliverable update requires deliverable_id, deliverable_status, and evidence', 'FORGE_INVALID_REQUEST')
          }
          return forgeValue(ledger.markDeliverable(execution.agent, forgeId, args.deliverable_id,
            args.deliverable_status as ForgeDeliverableStatus, args.evidence))
        }
        if (typeof args.deliverable_name !== 'string' || !['software', 'web', 'infrastructure', 'automation', 'workflow', 'agent', 'documentation', 'other'].includes(args.deliverable_kind as string)
          || typeof args.artifact_ref !== 'string') {
          throw new HarnessError('deliverable requires deliverable_name, deliverable_kind, and artifact_ref', 'FORGE_INVALID_REQUEST')
        }
        return forgeValue(ledger.addDeliverable(execution.agent, forgeId, {
          name: args.deliverable_name,
          kind: args.deliverable_kind as ForgeDeliverableKind,
          artifactRef: args.artifact_ref,
        }))
      }
      if (args.action === 'work') {
        if (!['it', 'security', 'rd'].includes(args.role as string) || typeof args.work_title !== 'string'
          || !['active', 'completed', 'failed'].includes(args.work_status as string)) {
          throw new HarnessError('work requires role, work_title, and work_status', 'FORGE_INVALID_REQUEST')
        }
        return forgeValue(ledger.addWork(execution.agent, forgeId, {
          role: args.role as ForgeRole,
          title: args.work_title,
          status: args.work_status as ForgeWorkStatus,
          ...args.strategy_id === undefined ? {} : { strategyId: args.strategy_id },
          ...args.failure_fingerprint === undefined ? {} : { failureFingerprint: args.failure_fingerprint },
          evidence: args.evidence ?? [],
        }))
      }
      if (args.action === 'strategy') {
        if (typeof args.strategy_name !== 'string' || !['proposed', 'active', 'completed', 'failed'].includes(args.strategy_status as string)
          || typeof args.strategy_summary !== 'string') {
          throw new HarnessError('strategy requires strategy_name, strategy_status, and strategy_summary', 'FORGE_INVALID_REQUEST')
        }
        return forgeValue(ledger.recordStrategy(execution.agent, forgeId, {
          name: args.strategy_name,
          status: args.strategy_status as ForgeStrategyStatus,
          ...args.failure_fingerprint === undefined ? {} : { failureFingerprint: args.failure_fingerprint },
          summary: args.strategy_summary,
          evidence: args.evidence ?? [],
        }))
      }
      if (args.action === 'revalidate') {
        const revalidationEvidence = args.revalidation_evidence ?? args.evidence
        if (typeof args.source_id !== 'string' || !Array.isArray(revalidationEvidence)) {
          throw new HarnessError('revalidate requires source_id and revalidation_evidence', 'FORGE_INVALID_REQUEST')
        }
        return forgeValue(ledger.revalidateSource(execution.agent, forgeId, {
          sourceId: args.source_id,
          evidence: revalidationEvidence,
        }))
      }
      if (args.action === 'atlas') {
        if (typeof args.atlas_name !== 'string' || typeof args.atlas_summary !== 'string' || typeof args.reusable_pattern !== 'string') {
          throw new HarnessError('atlas requires atlas_name, atlas_summary, and reusable_pattern', 'FORGE_INVALID_REQUEST')
        }
        return forgeValue(ledger.publishAtlasEntry(execution.agent, forgeId, {
          name: args.atlas_name,
          summary: args.atlas_summary,
          reusablePattern: args.reusable_pattern,
          ...args.source_id === undefined ? {} : { sourceId: args.source_id },
        }))
      }
      if (args.action === 'block') {
        if (typeof args.dependency !== 'string' || typeof args.blocker_reason !== 'string' || typeof args.resume_condition !== 'string') {
          throw new HarnessError('block requires dependency, blocker_reason, and resume_condition', 'FORGE_INVALID_REQUEST')
        }
        return forgeValue(ledger.setBlocker(execution.agent, forgeId, {
          dependency: args.dependency,
          reason: args.blocker_reason,
          resumeCondition: args.resume_condition,
        }))
      }
      if (args.action === 'advance') {
        if (!FORGE_PHASES.includes(args.phase as ForgePhase)) throw new HarnessError('advance requires a valid phase', 'FORGE_INVALID_REQUEST')
        return forgeValue(ledger.advance(execution.agent, forgeId, args.phase as Exclude<ForgePhase, 'ready' | 'blocked'>))
      }
      if (args.action === 'criterion') {
        if (typeof args.criterion_id !== 'string' || !FORGE_CRITERION_STATUSES.includes(args.criterion_status as ForgeCriterionStatus)
          || !Array.isArray(args.evidence)) throw new HarnessError('criterion requires criterion_id, criterion_status, and evidence', 'FORGE_INVALID_REQUEST')
        return forgeValue(ledger.markCriterion(execution.agent, forgeId, args.criterion_id,
          args.criterion_status as ForgeCriterionStatus, args.evidence))
      }
      if (args.action === 'judge') {
        const forge = ledger.get(execution.agent, forgeId)
        if (forge === undefined) throw new HarnessError(`Forge not found: ${forgeId}`, 'FORGE_NOT_FOUND')
        const subagents = ctx.get('subagents')
        const llm = ctx.get('llm', false)
        const judge = await judgeGoalCompletion({
          subagents,
          ...llm === undefined ? {} : { llm },
          provider: resolved.judgeProvider,
          parent: execution.agent,
          objective: `Organization Forge review: ${forge.objective}\n${JSON.stringify({
            revision: forge.revision,
            research: forge.research,
            blueprint: forge.blueprint,
            work: ledger.activeWork(forge),
            strategies: forge.strategies,
            deliverables: forge.deliverables,
            criteria: forge.criteria,
            sources: forge.sources,
            audits: forge.audits,
            atlasEntries: forge.atlasEntries,
          }).slice(0, 12_000)}`,
          round: forge.revision,
          signal: exec.signal,
        })
        const result = ledger.judge(execution.agent, forgeId, {
          ...judge,
          reviewedAt: Date.now(),
        })
        return forgeValue(result, result.phase === 'ready')
      }
      requireDirectHuman(ctx, execution)
      if (!['handoff', 'assisted', 'autonomous'].includes(args.management_mode as ForgeManagementMode)) {
        throw new HarnessError('management requires handoff, assisted, or autonomous', 'FORGE_INVALID_REQUEST')
      }
      const result = ledger.setManagementMode(execution.agent, forgeId, args.management_mode as ForgeManagementMode)
      return forgeValue(result)
    },
    presentCall: args => present(`Organization Forge: ${args.action}`, 'other', args.forge_id ?? args.objective),
  }))

  ctx.tools.register(defineTool({
    name: 'specialist_lab',
    description: SPECIALIST_DESCRIPTION,
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'start, source, hypothesis, experiment, or evaluate',
        enum: ['start', 'source', 'hypothesis', 'experiment', 'evaluate'],
      },
      specialist_id: { type: 'string', description: 'Existing specialist laboratory id for non-start actions.' },
      topic: { type: 'string', description: 'Research topic for start.' },
      objective: { type: 'string', description: 'Concrete expertise objective for start.' },
      success_criteria: { type: 'array', items: { type: 'string' }, description: 'Evidence-based readiness criteria for start.' },
      max_iterations: { type: 'number', description: 'Positive bounded improvement-loop cap.' },
      title: { type: 'string', description: 'Source title.' },
      locator: { type: 'string', description: 'Source URL or stable locator.' },
      hypothesis: { type: 'string', description: 'Falsifiable hypothesis.' },
      experiment_name: { type: 'string', description: 'Reproducible experiment name.' },
      dataset: { type: 'string', description: 'Dataset used by the experiment.' },
      score: { type: 'number', description: 'Judge score from 0 to 1.' },
      passed: { type: 'boolean', description: 'Whether all success criteria passed when no independent judge is configured.' },
      summary: { type: 'string', description: 'Judge summary.' },
      required_changes: { type: 'array', items: { type: 'string' }, description: 'Changes required before the next evaluation.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { specialist: { type: 'object', additionalProperties: true, required: true } },
      },
      render: (_args, value: Record<string, JsonValue>) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const execution = goalToolExecution(ctx, exec)
      if (args.action === 'start') {
        requireDirectHuman(ctx, execution)
        if (typeof args.topic !== 'string' || typeof args.objective !== 'string' || !Array.isArray(args.success_criteria)) {
          throw new HarnessError('start requires topic, objective, and success_criteria', 'SPECIALIST_INVALID_REQUEST')
        }
        const profile = ctx.goals.specialists.start(execution.agent, {
          topic: args.topic,
          objective: args.objective,
          successCriteria: args.success_criteria,
          ...(args.max_iterations === undefined ? {} : { maxIterations: args.max_iterations }),
        })
        return specialistValue(profile)
      }
      if (typeof args.specialist_id !== 'string') throw new HarnessError('specialist_id is required for this action', 'SPECIALIST_INVALID_REQUEST')
      const id = args.specialist_id
      const ledger = ctx.goals.specialists
      if (args.action === 'source') {
        if (typeof args.title !== 'string' || typeof args.locator !== 'string') {
          throw new HarnessError('source requires title and locator', 'SPECIALIST_INVALID_REQUEST')
        }
        return specialistValue(ledger.addSource(execution.agent, id, { title: args.title, locator: args.locator }))
      }
      if (args.action === 'hypothesis') {
        if (typeof args.hypothesis !== 'string') throw new HarnessError('hypothesis requires hypothesis', 'SPECIALIST_INVALID_REQUEST')
        return specialistValue(ledger.addHypothesis(execution.agent, id, args.hypothesis))
      }
      if (args.action === 'experiment') {
        if (typeof args.experiment_name !== 'string' || typeof args.dataset !== 'string') {
          throw new HarnessError('experiment requires experiment_name and dataset', 'SPECIALIST_INVALID_REQUEST')
        }
        return specialistValue(ledger.addExperiment(execution.agent, id, { name: args.experiment_name, dataset: args.dataset }))
      }
      const current = ledger.get(execution.agent, id)
      if (current === undefined) throw new HarnessError(`specialist not found: ${id}`, 'SPECIALIST_INVALID_REQUEST')
      if (resolved.requireJudge) {
        const subagents = ctx.get('subagents')
        const llm = ctx.get('llm', false)
        const judge = await judgeGoalCompletion({
          subagents,
          ...llm === undefined ? {} : { llm },
          provider: resolved.judgeProvider,
          parent: execution.agent,
          objective: specialistReviewObjective(current),
          round: current.iterations + 1,
          signal: exec.signal,
        })
        const profile = ledger.evaluate(execution.agent, id, {
          score: judge.verdict === 'pass' ? 1 : 0,
          passed: judge.verdict === 'pass',
          blocked: judge.verdict === 'blocked',
          summary: judge.summary,
          requiredChanges: judge.requiredChanges,
        })
        if (judge.verdict !== 'pass') {
          exec.deferContext(createUserMessage({
            content: [{
              type: 'text',
              text: '<specialist_judge_result>\n'
                + `Verdict: ${judge.verdict}\n`
                + `Summary: ${judge.summary}\n`
                + `Required changes: ${JSON.stringify(judge.requiredChanges)}\n`
                + 'Keep the specialist active, address these changes, and evaluate again only after verifying the improved evidence.\n'
                + '</specialist_judge_result>',
            }],
            source: {
              kind: 'plugin', plugin: 'tool-goal', form: 'notice',
              summary: boundContextSummary(`specialist judge ${judge.verdict}: ${current.topic}`),
            },
          }))
        }
        return specialistValue(profile)
      }
      if (typeof args.score !== 'number' || typeof args.passed !== 'boolean' || typeof args.summary !== 'string') {
        throw new HarnessError('evaluate requires score, passed, and summary', 'SPECIALIST_INVALID_REQUEST')
      }
      return specialistValue(ledger.evaluate(execution.agent, id, {
        score: args.score, passed: args.passed, summary: args.summary,
        ...(args.required_changes === undefined ? {} : { requiredChanges: args.required_changes }),
      }))
    },
    presentCall: args => present(`Specialist lab: ${args.action}`, 'other', args.specialist_id ?? args.topic),
  }))
}
