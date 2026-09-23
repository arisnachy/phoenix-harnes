/** Model-facing quality and foresight controls over the durable goal-session ledger. */

import type { Context } from '@phoenix-ai/cordis'
import type {
  QualityAssessmentId,
  QualityAssessmentSnapshot,
  QualityConfidence,
  QualityCriterionStatus,
  QualityCriterionTier,
  QualityEvidenceKind,
  QualityImpact,
  QualityInnovationStatus,
  QualityLikelihood,
  QualityScenarioSeverity,
  QualityScenarioStatus,
  QualityTaskClass,
  RiskForecastStatus,
} from '@phoenix-ai/dsh-goal/src/quality.ts'
import { goalQualityLedger, qualityReadiness } from '@phoenix-ai/dsh-goal/src/quality.ts'
import { HarnessError } from '@phoenix-ai/dsh-llm'
import type {} from '@phoenix-ai/dsh-system-prompt'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type { GenericCallView, JsonValue } from '@phoenix-ai/dsh-tools'
import { completionAuthority, goalToolExecution, requireDirectHuman } from './authority.ts'

const TASK_CLASSES = ['conversational', 'bounded', 'substantial', 'living'] as const
const CRITERION_TIERS = ['requested', 'professional', 'excellent'] as const
const CRITERION_STATUSES = ['pending', 'implemented', 'tested', 'verified', 'failed', 'blocked_external'] as const
const SCENARIO_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
const SCENARIO_STATUSES = ['pending', 'pass', 'fail', 'untested', 'accepted-risk'] as const
const EVIDENCE_KINDS = ['static', 'simulated', 'live'] as const
const LEVELS = ['low', 'medium', 'high'] as const
const IMPACTS = ['low', 'medium', 'high', 'critical'] as const
const FORECAST_STATUSES = ['open', 'mitigated', 'accepted', 'confirmed', 'contradicted', 'unknown'] as const
const INNOVATION_STATUSES = ['pending', 'implemented', 'offered', 'not-applicable'] as const
const ACTIONS = ['start', 'criterion', 'scenario', 'forecast', 'required_change', 'innovation'] as const

const QUALITY_GUIDANCE =
  'For substantial or living work, maintain a durable quality assessment before claiming completion. '
  + 'Verify every requested criterion with current evidence, then challenge the result with relevant edge cases and realistic failure conditions. '
  + 'Label evidence truthfully as static, simulated, or live; static or simulated checks must never be described as live real-world observation. '
  + 'Risk forecasts are hypotheses, not facts: record likelihood, confidence, impact, evidence, and mitigation separately, and do not promote a forecast to a verified lesson without later observation or reproducible evidence. '
  + 'Material failed or untested scenarios and open high-impact risks require repair or explicit human risk acceptance. '
  + 'Innovation comes only after requested work is satisfied. Innovation must never substitute for unfinished requirements; use not-applicable when no responsible extra improvement adds value.'

type QualityAction = typeof ACTIONS[number]

function present(title: string, rawInput?: JsonValue): GenericCallView {
  return { card: 'generic', title, kind: 'other', ...rawInput === undefined ? {} : { rawInput } }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HarnessError(`${label} must be a non-empty string`, 'QUALITY_INVALID_REQUEST')
  }
  return value.trim()
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && item.trim().length > 0)) {
    throw new HarnessError(`${label} must be an array of non-empty strings`, 'QUALITY_INVALID_REQUEST')
  }
  return value.map(item => item.trim())
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new HarnessError(`${label} must be one of ${values.join(', ')}`, 'QUALITY_INVALID_REQUEST')
  }
  return value as T
}

function ref(args: Record<string, unknown>): { id: QualityAssessmentId; revision: number } {
  const id = text(args.assessment_id, 'assessment_id')
  const revision = args.revision
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) {
    throw new HarnessError('revision must be a positive safe integer', 'QUALITY_INVALID_REQUEST')
  }
  return { id: id as QualityAssessmentId, revision: revision as number }
}

function result(assessment: QualityAssessmentSnapshot | undefined): Record<string, JsonValue> {
  if (assessment === undefined) return { assessment: null }
  return {
    assessment: assessment as unknown as JsonValue,
    readiness: qualityReadiness(assessment) as unknown as JsonValue,
  }
}

/** Register the quality tools and the standing self-challenge policy. */
export function registerQualityTools(ctx: Context): void {
  const ledger = goalQualityLedger(ctx.goals)
  ctx.systemPrompt.section({ name: 'tool:quality', order: 113, text: QUALITY_GUIDANCE })

  ctx.tools.register(defineTool({
    name: 'quality_get',
    description: 'Read the current durable quality/foresight assessment and its completion blockers.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value: Record<string, JsonValue>) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    execute(_args, exec) {
      const execution = goalToolExecution(ctx, exec)
      return Promise.resolve(result(ledger.get(execution.agent)))
    },
    presentCall: () => present('Read quality assessment'),
  }))

  ctx.tools.register(defineTool({
    name: 'quality_record',
    description: 'Start or update the durable quality assessment for the current mission. Use exact assessment_id and revision for updates.',
    parameters: {
      action: { type: 'string', required: true, enum: ACTIONS },
      assessment_id: { type: 'string', description: 'Exact current quality assessment id for non-start actions.' },
      revision: { type: 'number', description: 'Exact current quality revision for non-start actions.' },
      task_class: { type: 'string', enum: TASK_CLASSES },
      objective: { type: 'string' },
      criterion_id: { type: 'string' },
      criterion: { type: 'string' },
      tier: { type: 'string', enum: CRITERION_TIERS },
      mandatory: { type: 'boolean' },
      criterion_status: { type: 'string', enum: CRITERION_STATUSES },
      scenario_id: { type: 'string' },
      scenario_title: { type: 'string' },
      severity: { type: 'string', enum: SCENARIO_SEVERITIES },
      scenario_status: { type: 'string', enum: SCENARIO_STATUSES },
      evidence_kind: { type: 'string', enum: EVIDENCE_KINDS },
      forecast_id: { type: 'string' },
      forecast_scenario: { type: 'string' },
      likelihood: { type: 'string', enum: LEVELS },
      confidence: { type: 'string', enum: LEVELS },
      impact: { type: 'string', enum: IMPACTS },
      mitigation: { type: 'string' },
      forecast_status: { type: 'string', enum: FORECAST_STATUSES },
      evidence: { type: 'array', items: { type: 'string' } },
      blocker: { type: 'string' },
      required_change: { type: 'string' },
      resolved: { type: 'boolean' },
      innovation_status: { type: 'string', enum: INNOVATION_STATUSES },
      rationale: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value: Record<string, JsonValue>) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      const execution = goalToolExecution(ctx, exec)
      completionAuthority(ctx, execution)
      const action = enumValue(args.action, ACTIONS, 'action') as QualityAction
      if (action === 'start') {
        const taskClass = enumValue(args.task_class, TASK_CLASSES, 'task_class') as QualityTaskClass
        const goal = ctx.goals.get(execution.agent)
        const objective = args.objective === undefined ? goal?.objective : text(args.objective, 'objective')
        if (objective === undefined) {
          throw new HarnessError('start requires objective when no current goal exists', 'QUALITY_INVALID_REQUEST')
        }
        const assessment = ledger.start(execution.agent, {
          objective,
          taskClass,
          ...goal === undefined ? {} : { goalId: goal.id, goalRevision: goal.revision },
        })
        return Promise.resolve(result(assessment))
      }

      const currentRef = ref(args as Record<string, unknown>)
      if (action === 'criterion') {
        const assessment = ledger.record(execution.agent, currentRef, {
          kind: 'criterion',
          criterion: {
            id: text(args.criterion_id, 'criterion_id'),
            text: text(args.criterion, 'criterion'),
            tier: enumValue(args.tier, CRITERION_TIERS, 'tier') as QualityCriterionTier,
            mandatory: args.mandatory === true,
            status: enumValue(args.criterion_status, CRITERION_STATUSES, 'criterion_status') as QualityCriterionStatus,
            evidence: stringList(args.evidence ?? [], 'evidence'),
          },
        })
        return Promise.resolve(result(assessment))
      }
      if (action === 'scenario') {
        const status = enumValue(args.scenario_status, SCENARIO_STATUSES, 'scenario_status') as QualityScenarioStatus
        if (status === 'accepted-risk') requireDirectHuman(ctx, execution)
        const evidenceKind = args.evidence_kind === undefined
          ? undefined
          : enumValue(args.evidence_kind, EVIDENCE_KINDS, 'evidence_kind') as QualityEvidenceKind
        const assessment = ledger.record(execution.agent, currentRef, {
          kind: 'scenario',
          scenario: {
            id: text(args.scenario_id, 'scenario_id'),
            title: text(args.scenario_title, 'scenario_title'),
            severity: enumValue(args.severity, SCENARIO_SEVERITIES, 'severity') as QualityScenarioSeverity,
            status,
            ...(evidenceKind === undefined ? {} : { evidenceKind }),
            evidence: stringList(args.evidence ?? [], 'evidence'),
            ...(args.blocker === undefined ? {} : { blocker: text(args.blocker, 'blocker') }),
          },
        })
        return Promise.resolve(result(assessment))
      }
      if (action === 'forecast') {
        const status = enumValue(args.forecast_status, FORECAST_STATUSES, 'forecast_status') as RiskForecastStatus
        if (status === 'accepted') requireDirectHuman(ctx, execution)
        const assessment = ledger.record(execution.agent, currentRef, {
          kind: 'forecast',
          forecast: {
            id: text(args.forecast_id, 'forecast_id'),
            scenario: text(args.forecast_scenario, 'forecast_scenario'),
            likelihood: enumValue(args.likelihood, LEVELS, 'likelihood') as QualityLikelihood,
            confidence: enumValue(args.confidence, LEVELS, 'confidence') as QualityConfidence,
            impact: enumValue(args.impact, IMPACTS, 'impact') as QualityImpact,
            evidence: stringList(args.evidence ?? [], 'evidence'),
            mitigation: typeof args.mitigation === 'string' ? args.mitigation.trim() : '',
            status,
          },
        })
        return Promise.resolve(result(assessment))
      }
      if (action === 'required_change') {
        const assessment = ledger.record(execution.agent, currentRef, {
          kind: 'required-change',
          value: text(args.required_change, 'required_change'),
          ...(args.resolved === undefined ? {} : { resolved: args.resolved === true }),
        })
        return Promise.resolve(result(assessment))
      }
      const innovationStatus = enumValue(args.innovation_status, INNOVATION_STATUSES, 'innovation_status') as QualityInnovationStatus
      const assessment = ledger.record(execution.agent, currentRef, {
        kind: 'innovation',
        innovation: {
          status: innovationStatus,
          rationale: text(args.rationale, 'rationale'),
          ...args.evidence === undefined ? {} : { evidence: stringList(args.evidence, 'evidence') },
        },
      })
      return Promise.resolve(result(assessment))
    },
    presentCall: args => present(`Quality: ${String(args.action)}`, args.assessment_id ?? args.objective),
  }))
}
