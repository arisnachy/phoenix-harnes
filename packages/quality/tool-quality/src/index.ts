/** Model-facing evidence controls and standing policy for PHOENIX quality assessments. */

import type { Context } from '@phoenix-ai/cordis'
import {
  QualityAssessmentId,
  type QualityAssessmentRef,
  type QualityCriterion,
  type QualityCriterionStatus,
  type QualityCriterionTier,
  type QualityEvidenceKind,
  type QualityInnovation,
  type QualityScenario,
  type QualityScenarioStatus,
  type QualitySeverity,
  type QualityTaskClass,
  type RiskConfidence,
  type RiskForecast,
  type RiskForecastStatus,
  type RiskLikelihood,
} from '@phoenix-ai/dsh-quality'
import { defineTool, type GenericCallView, type ToolRunContext } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'

export const name = 'tool-quality'
export const inject = ['agents', 'quality', 'tools', 'systemPrompt']

export const QUALITY_POLICY = 'Quality/Foresight rule: for substantial or living work, derive explicit acceptance criteria, challenge the result with relevant real-world edge cases, and record evidence truthfully as static, simulated, or live. Never label simulated evidence as live. Forecasts are hypotheses, not facts: record likelihood separately from confidence, repair or mitigate material open risks, and do not promote a forecast to verified learning without observed or reproducible evidence. Keep required changes active until evidence shows they are resolved. Innovation never substitutes for unfinished requested work; after the request is complete, evaluate at most one useful bounded improvement and record implemented, offered, or not-applicable. Use quality_get before revision-bound updates and copy the exact assessment_id and revision.'

const TASK_CLASSES: readonly QualityTaskClass[] = ['conversational', 'bounded', 'substantial', 'living']
const TIERS: readonly QualityCriterionTier[] = ['requested', 'professional', 'excellent']
const CRITERION_STATUSES: readonly QualityCriterionStatus[] = ['pending', 'implemented', 'tested', 'verified', 'failed', 'blocked_external']
const SEVERITIES: readonly QualitySeverity[] = ['low', 'medium', 'high', 'critical']
const SCENARIO_STATUSES: readonly QualityScenarioStatus[] = ['pending', 'pass', 'fail', 'untested', 'accepted-risk']
const EVIDENCE_KINDS: readonly QualityEvidenceKind[] = ['static', 'simulated', 'live']
const LIKELIHOODS: readonly RiskLikelihood[] = ['low', 'medium', 'high']
const CONFIDENCES: readonly RiskConfidence[] = ['low', 'medium', 'high']
const FORECAST_STATUSES: readonly RiskForecastStatus[] = ['open', 'mitigated', 'accepted', 'confirmed', 'contradicted', 'unknown']
const INNOVATION_STATUSES: readonly QualityInnovation['status'][] = ['pending', 'implemented', 'offered', 'not-applicable']
const ACTIONS = ['start', 'criterion', 'scenario', 'forecast', 'required_change', 'innovation'] as const

type QualityAction = typeof ACTIONS[number]

function present(title: string, rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'other', ...rawInput === undefined ? {} : { rawInput } }
}

function agent(ctx: Context, exec: ToolRunContext) {
  const current = exec.agent
  if (current === undefined || ctx.agents.get(current.id) !== current) throw new Error('quality tools require the exact live calling agent')
  return current
}

function text(label: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} is required`)
  return value.trim()
}

function list(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new TypeError('evidence must be an array of strings')
  return value.map(item => item.trim()).filter(Boolean)
}

function oneOf<T extends string>(label: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new TypeError(`${label} is invalid`)
  return value as T
}

function ref(args: Record<string, unknown>): QualityAssessmentRef {
  const id = text('assessment_id', args.assessment_id)
  const revision = args.revision
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) throw new TypeError('revision must be a positive safe integer')
  return { id: QualityAssessmentId(id), revision }
}

function response(value: unknown): { assessment_json: string } {
  return { assessment_json: JSON.stringify(value ?? null) }
}

/** Register quality policy plus revision-bound read/write controls. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name: 'tool:quality', order: 116, text: QUALITY_POLICY })

  ctx.tools.register(defineTool({
    name: 'quality_get',
    description: 'Read the current durable quality and foresight assessment for this mission before recording revision-bound evidence.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { assessment_json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text' as const, text: value.assessment_json }],
    },
    execute(_args, exec) { return Promise.resolve(response(ctx.quality.get(agent(ctx, exec)))) },
    presentCall: () => present('Read quality assessment'),
  }))

  ctx.tools.register(defineTool({
    name: 'quality_record',
    description: 'Start or update the current quality assessment with acceptance evidence, adversarial scenarios, future-risk forecasts, required repairs, or the bounded innovation decision.',
    parameters: {
      action: { type: 'string', required: true, enum: ACTIONS },
      assessment_id: { type: 'string' }, revision: { type: 'number' },
      objective: { type: 'string' }, task_class: { type: 'string', enum: TASK_CLASSES },
      item_id: { type: 'string' }, text: { type: 'string' }, tier: { type: 'string', enum: TIERS },
      mandatory: { type: 'boolean' }, criterion_status: { type: 'string', enum: CRITERION_STATUSES },
      severity: { type: 'string', enum: SEVERITIES }, status: { type: 'string' },
      evidence_kind: { type: 'string', enum: EVIDENCE_KINDS }, evidence: { type: 'array', items: { type: 'string' } }, blocker: { type: 'string' },
      likelihood: { type: 'string', enum: LIKELIHOODS }, confidence: { type: 'string', enum: CONFIDENCES }, mitigation: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { assessment_json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text' as const, text: value.assessment_json }],
    },
    execute(args, exec) {
      const owner = agent(ctx, exec)
      const action = oneOf<QualityAction>('action', args.action, ACTIONS)
      if (action === 'start') {
        return Promise.resolve(response(ctx.quality.start(owner, {
          objective: text('objective', args.objective),
          taskClass: oneOf('task_class', args.task_class, TASK_CLASSES),
        })))
      }
      const exact = ref(args)
      if (action === 'criterion') {
        const value: QualityCriterion = {
          id: text('item_id', args.item_id), text: text('text', args.text),
          tier: oneOf('tier', args.tier, TIERS), mandatory: args.mandatory === true,
          status: oneOf('criterion_status', args.criterion_status, CRITERION_STATUSES), evidence: list(args.evidence ?? []),
        }
        return Promise.resolve(response(ctx.quality.record(owner, exact, { kind: 'criterion', value })))
      }
      if (action === 'scenario') {
        const value: QualityScenario = {
          id: text('item_id', args.item_id), title: text('text', args.text), severity: oneOf('severity', args.severity, SEVERITIES),
          status: oneOf('status', args.status, SCENARIO_STATUSES), evidenceKind: oneOf('evidence_kind', args.evidence_kind, EVIDENCE_KINDS),
          evidence: list(args.evidence ?? []), ...typeof args.blocker === 'string' && args.blocker.trim() ? { blocker: args.blocker.trim() } : {},
        }
        return Promise.resolve(response(ctx.quality.record(owner, exact, { kind: 'scenario', value })))
      }
      if (action === 'forecast') {
        const value: RiskForecast = {
          id: text('item_id', args.item_id), scenario: text('text', args.text),
          likelihood: oneOf('likelihood', args.likelihood, LIKELIHOODS), confidence: oneOf('confidence', args.confidence, CONFIDENCES),
          impact: oneOf('severity', args.severity, SEVERITIES), evidence: list(args.evidence ?? []),
          mitigation: typeof args.mitigation === 'string' ? args.mitigation.trim() : '', status: oneOf('status', args.status, FORECAST_STATUSES),
        }
        return Promise.resolve(response(ctx.quality.record(owner, exact, { kind: 'forecast', value })))
      }
      if (action === 'required_change') {
        return Promise.resolve(response(ctx.quality.record(owner, exact, { kind: 'required-changes', value: list(args.evidence ?? []) })))
      }
      const value: QualityInnovation = {
        status: oneOf('status', args.status, INNOVATION_STATUSES), rationale: text('text', args.text), evidence: list(args.evidence ?? []),
      }
      return Promise.resolve(response(ctx.quality.record(owner, exact, { kind: 'innovation', value })))
    },
    presentCall: args => present(`Quality: ${args.action}`, args.item_id ?? args.objective),
  }))
}
